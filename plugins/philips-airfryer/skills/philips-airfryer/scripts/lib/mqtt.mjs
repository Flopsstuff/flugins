// Minimal MQTT 3.1.1 client over Node's built-in WebSocket — just what the
// airfryer relay needs: CONNECT with a clean session, SUBSCRIBE, PUBLISH at
// QoS 0/1 (both ways), keepalive pings and DISCONNECT. No reconnects, no QoS 2,
// no persistence: every CLI run opens one connection and closes it.
//
// The built-in WebSocket (undici) is used rather than a hand-rolled handshake
// because it accepts a non-standard `headers` option, which the AWS IoT Custom
// Authorizer needs (Node 22.4+).

export class MqttError extends Error {}

const CONNACK_CODES = {
  1: "unacceptable protocol version",
  2: "client identifier rejected",
  3: "server unavailable",
  4: "bad user name or password",
  5: "not authorized",
};

function encodeLength(n) {
  const out = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return Buffer.from(out);
}

function str(s) {
  const body = Buffer.from(s, "utf8");
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length);
  return Buffer.concat([len, body]);
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}

function packet(first, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([first]), encodeLength(body.length), body]);
}

export class MqttClient {
  constructor(ws, keepalive) {
    this._ws = ws;
    this._buf = Buffer.alloc(0);
    this._nextId = 1;
    this._acks = new Map(); // packet id → { resolve, reject }
    this._onConnack = null;
    this._closed = false;
    this.onMessage = null;
    this.onClose = null;

    ws.addEventListener("message", (ev) => this._onData(Buffer.from(ev.data)));
    ws.addEventListener("close", () => this._onSocketClose());
    // Keepalive: the broker drops a client that stays silent for 1.5 × keepalive.
    this._ping = setInterval(() => this._send(packet(0xc0)), (keepalive * 1000) / 2);
    this._ping.unref();
  }

  get connected() {
    return !this._closed;
  }

  _send(buf) {
    if (!this._closed) this._ws.send(buf);
  }

  _id() {
    const id = this._nextId;
    this._nextId = id === 0xffff ? 1 : id + 1;
    return id;
  }

  _awaitAck(id, what, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._acks.delete(id);
        reject(new MqttError(`${what}: no acknowledgement`));
      }, timeoutMs);
      this._acks.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
    });
  }

  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    // A WebSocket frame may carry several MQTT packets or part of one.
    for (;;) {
      if (this._buf.length < 2) return;
      let len = 0;
      let mult = 1;
      let i = 1;
      for (;; i++) {
        if (i >= this._buf.length) return;
        if (i > 4) {
          // Unparseable stream: drop the connection, pending waiters fail.
          this._ws.close();
          return;
        }
        const byte = this._buf[i];
        len += (byte & 0x7f) * mult;
        mult *= 128;
        if (!(byte & 0x80)) break;
      }
      const end = i + 1 + len;
      if (this._buf.length < end) return;
      const first = this._buf[0];
      const body = this._buf.subarray(i + 1, end);
      this._buf = this._buf.subarray(end);
      this._onPacket(first, body);
    }
  }

  _onPacket(first, body) {
    switch (first >> 4) {
      case 2: // CONNACK
        this._onConnack?.(body[1]);
        break;
      case 3: { // PUBLISH
        const qos = (first >> 1) & 3;
        const topicLen = body.readUInt16BE(0);
        const topic = body.subarray(2, 2 + topicLen).toString("utf8");
        let off = 2 + topicLen;
        if (qos > 0) {
          const id = body.readUInt16BE(off);
          off += 2;
          if (qos === 1) this._send(packet(0x40, u16(id)));
        }
        try {
          this.onMessage?.(topic, body.subarray(off));
        } catch {
          // A bad handler must not take the read loop down.
        }
        break;
      }
      case 4: // PUBACK
      case 9: { // SUBACK
        const id = body.readUInt16BE(0);
        const waiter = this._acks.get(id);
        if (!waiter) break;
        this._acks.delete(id);
        if (first >> 4 === 9 && body.subarray(2).includes(0x80)) {
          waiter.reject(new MqttError("subscription refused by the broker"));
        } else {
          waiter.resolve();
        }
        break;
      }
      // PINGRESP (13) and anything else: nothing to do.
    }
  }

  _onSocketClose() {
    if (this._closed) return;
    this._closed = true;
    clearInterval(this._ping);
    const err = new MqttError("connection closed by the broker");
    for (const w of this._acks.values()) w.reject(err);
    this._acks.clear();
    this.onClose?.();
  }

  subscribe(topics, timeoutMs = 10_000) {
    const id = this._id();
    const filters = topics.map((t) => Buffer.concat([str(t), Buffer.from([0])]));
    const ack = this._awaitAck(id, "SUBSCRIBE", timeoutMs);
    this._send(packet(0x82, u16(id), ...filters));
    return ack;
  }

  // QoS 1 resolves on PUBACK; QoS 0 resolves as soon as the frame is queued.
  publish(topic, payload, { qos = 0, timeoutMs = 10_000 } = {}) {
    if (this._closed) return Promise.reject(new MqttError("not connected"));
    const data = Buffer.from(payload);
    if (qos === 0) {
      this._send(packet(0x30, str(topic), data));
      return Promise.resolve();
    }
    const id = this._id();
    const ack = this._awaitAck(id, `PUBLISH ${topic}`, timeoutMs);
    this._send(packet(0x32, str(topic), u16(id), data));
    return ack;
  }

  async close() {
    if (this._closed) return;
    const closed = new Promise((resolve) =>
      this._ws.addEventListener("close", resolve, { once: true }),
    );
    this._send(packet(0xe0));
    this._ws.close();
    await Promise.race([closed, new Promise((r) => setTimeout(r, 2000).unref())]);
    this._onSocketClose();
  }
}

export function connect(url, { clientId, headers = {}, keepalive = 30, timeoutMs = 30_000 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      reject(err);
    };
    const timer = setTimeout(() => fail(new MqttError("connect timeout")), timeoutMs);

    const ws = new WebSocket(url, { protocols: ["mqtt"], headers });
    ws.binaryType = "arraybuffer";
    const client = new MqttClient(ws, keepalive);

    // A rejected Custom Authorizer shows up as a failed handshake (HTTP 401/403
    // before the upgrade); the WebSocket API does not expose the status code.
    ws.addEventListener("error", (ev) =>
      fail(new MqttError(`WebSocket handshake failed${ev.message ? `: ${ev.message}` : ""}`)),
    );
    ws.addEventListener("close", () => fail(new MqttError("connection closed during connect")));

    ws.addEventListener("open", () => {
      const flags = 0x02; // clean session, no will, no credentials
      ws.send(
        packet(0x10, str("MQTT"), Buffer.from([4, flags]), u16(keepalive), str(clientId)),
      );
    });
    client._onConnack = (code) => {
      client._onConnack = null;
      if (code !== 0) {
        fail(new MqttError(`CONNACK refused: ${CONNACK_CODES[code] ?? code}`));
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(client);
    };
  });
}
