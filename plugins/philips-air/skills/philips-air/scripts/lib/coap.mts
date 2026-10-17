// coap.mts — the slice of CoAP (RFC 7252 + RFC 7641 Observe) that Philips air
// devices speak: NON (and, for status, CON) messages over UDP, Uri-Path and
// Observe options, a token per request. Answers are matched by token only —
// the device answers a CON with a separate NON carrying its own message ID.
// No retransmission layer: a resent CON would be another Observe registration,
// so callers retry at their own level.

import { Buffer } from 'node:buffer';
import dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';
import process from 'node:process';

export const COAP_PORT = 5683;

// PHILIPS_AIR_DEBUG=1 traces every datagram in and out on stderr.
const DEBUG = !!process.env.PHILIPS_AIR_DEBUG;
const T0 = Date.now();

function trace(dir: string, peer: string, buf: Buffer): void {
  if (!DEBUG) return;
  let desc: string;
  try {
    const m = decode(buf);
    const opts = m.options.map((o) => `${o.number}:${o.number === OPT.URI_PATH ? o.value.toString() : o.value.toString('hex')}`).join(' ');
    desc = `t${m.type} ${codeString(m.code)} mid=${m.mid} tok=${m.token.toString('hex')} [${opts}] ${m.payload.length}B ${m.payload.subarray(0, 120).toString()}`;
  } catch (err) {
    desc = `undecodable ${buf.length}B: ${(err as Error).message}`;
  }
  process.stderr.write(`[coap +${Date.now() - T0}ms ${dir} ${peer}] ${desc}\n`);
}

export const TYPE = { CON: 0, NON: 1, ACK: 2, RST: 3 } as const;
export const CODE = { EMPTY: 0x00, GET: 0x01, POST: 0x02, PUT: 0x03, DELETE: 0x04 } as const;
export const OPT = { OBSERVE: 6, URI_PATH: 11, CONTENT_FORMAT: 12, MAX_AGE: 14 } as const;

export interface CoapOption { number: number; value: Buffer }

export interface CoapMessage {
  type: number;
  code: number;
  mid: number;
  token: Buffer;
  options: CoapOption[];
  payload: Buffer;
}

export interface Received extends CoapMessage { from: { address: string; port: number } }

/** "2.05" style rendering of a response code. */
export function codeString(code: number): string {
  return `${code >> 5}.${String(code & 0x1f).padStart(2, '0')}`;
}

/** Unsigned integer option value, shortest big-endian form (0 → empty). */
export function uintOption(n: number): Buffer {
  if (n === 0) return Buffer.alloc(0);
  const bytes: number[] = [];
  while (n > 0) { bytes.unshift(n & 0xff); n = Math.floor(n / 256); }
  return Buffer.from(bytes);
}

export function readUint(buf: Buffer): number {
  let n = 0;
  for (const b of buf) n = n * 256 + b;
  return n;
}

function nibble(n: number): [number, Buffer] {
  if (n < 13) return [n, Buffer.alloc(0)];
  if (n < 269) return [13, Buffer.from([n - 13])];
  const ext = Buffer.alloc(2);
  ext.writeUInt16BE(n - 269);
  return [14, ext];
}

export function encode(msg: CoapMessage): Buffer {
  if (msg.token.length > 8) throw new Error('CoAP token longer than 8 bytes');
  const parts: Buffer[] = [Buffer.from([
    0x40 | (msg.type << 4) | msg.token.length,
    msg.code,
    (msg.mid >> 8) & 0xff,
    msg.mid & 0xff,
  ]), msg.token];
  let prev = 0;
  for (const opt of [...msg.options].sort((a, b) => a.number - b.number)) {
    const [d, dExt] = nibble(opt.number - prev);
    const [l, lExt] = nibble(opt.value.length);
    parts.push(Buffer.from([(d << 4) | l]), dExt, lExt, opt.value);
    prev = opt.number;
  }
  if (msg.payload.length) parts.push(Buffer.from([0xff]), msg.payload);
  return Buffer.concat(parts);
}

export function decode(buf: Buffer): CoapMessage {
  if (buf.length < 4) throw new Error('CoAP datagram shorter than its header');
  const version = buf[0] >> 6;
  if (version !== 1) throw new Error(`unsupported CoAP version ${version}`);
  const tkl = buf[0] & 0x0f;
  if (tkl > 8 || 4 + tkl > buf.length) throw new Error('bad CoAP token length');
  const msg: CoapMessage = {
    type: (buf[0] >> 4) & 0x03,
    code: buf[1],
    mid: buf.readUInt16BE(2),
    token: Buffer.from(buf.subarray(4, 4 + tkl)),
    options: [],
    payload: Buffer.alloc(0),
  };
  let i = 4 + tkl;
  let number = 0;
  const ext = (n: number): number => {
    if (n < 13) return n;
    if (n === 13) return 13 + buf[i++];
    if (n === 14) { const v = 269 + buf.readUInt16BE(i); i += 2; return v; }
    throw new Error('reserved option nibble 15');
  };
  while (i < buf.length) {
    if (buf[i] === 0xff) { msg.payload = Buffer.from(buf.subarray(i + 1)); break; }
    const head = buf[i++];
    number += ext(head >> 4);
    const len = ext(head & 0x0f);
    if (i + len > buf.length) throw new Error('CoAP option runs past the datagram');
    msg.options.push({ number, value: Buffer.from(buf.subarray(i, i + len)) });
    i += len;
  }
  return msg;
}

export function pathOptions(path: string): CoapOption[] {
  return path.split('/').filter(Boolean).map((seg) => ({ number: OPT.URI_PATH, value: Buffer.from(seg, 'utf8') }));
}

export function option(msg: CoapMessage, number: number): Buffer | undefined {
  return msg.options.find((o) => o.number === number)?.value;
}

export class CoapTimeout extends Error {
  constructor(what: string, ms: number) { super(`no CoAP answer to ${what} within ${ms} ms`); this.name = 'CoapTimeout'; }
}

export interface RequestSpec {
  host: string;
  port?: number;
  code: number;
  path: string;
  payload?: Buffer | string;
  observe?: number;
  /** message type, default NON */
  type?: number;
}

type Listener = (msg: Received) => void;

/**
 * One UDP socket shared by every request of a session. Answers are routed by
 * token; a datagram whose token nobody is waiting for — typically a late
 * Observe notification for a status read that already returned — is dropped.
 *
 * `localPort` pins the source port (falling back to a random one when it is
 * taken); 0 picks a random port.
 */
export class CoapSocket {
  private sock!: dgram.Socket;
  private listeners = new Map<string, Listener>();
  private mid = randomBytes(2).readUInt16BE();
  private ready: Promise<void>;
  private closed = false;

  constructor(localPort = 0) {
    this.ready = this.open(localPort).catch(() => this.open(0));
  }

  private open(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket('udp4');
      const fail = (err: Error) => { try { sock.close(); } catch { /* never bound */ } reject(err); };
      sock.once('error', fail);
      sock.bind(port, () => {
        sock.off('error', fail);
        // ICMP-driven errors on an unconnected socket are not fatal to the session.
        sock.on('error', () => {});
        sock.on('message', (buf, rinfo) => this.onDatagram(buf, rinfo));
        this.sock = sock;
        if (this.closed) sock.close();
        resolve();
      });
    });
  }

  async localPort(): Promise<number> { await this.ready; return this.sock.address().port; }

  private nextMid(): number { this.mid = (this.mid + 1) & 0xffff; return this.mid; }

  private onDatagram(buf: Buffer, rinfo: dgram.RemoteInfo): void {
    trace('<-', `${rinfo.address}:${rinfo.port}`, buf);
    let msg: CoapMessage;
    try { msg = decode(buf); } catch { return; }
    const fn = this.listeners.get(msg.token.toString('hex'));
    const empty = (type: number) => this.sendRaw(
      encode({ type, code: CODE.EMPTY, mid: msg.mid, token: Buffer.alloc(0), options: [], payload: Buffer.alloc(0) }),
      rinfo.address, rinfo.port,
    ).catch(() => {});
    if (fn) {
      // A confirmable message must be acknowledged or the device drops the
      // observation; an empty ACK carrying the same message ID is enough.
      if (msg.type === TYPE.CON) empty(TYPE.ACK);
      fn({ ...msg, from: { address: rinfo.address, port: rinfo.port } });
      return;
    }
    // Unknown confirmable message: reject it so the device stops retransmitting.
    // Unknown NON notifications are ignored, as aiocoap does — the reference
    // client that ran against these devices for weeks never RSTs them.
    if (msg.type === TYPE.CON) empty(TYPE.RST);
  }

  private sendRaw(buf: Buffer, host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed || !this.sock) { reject(new Error('socket closed')); return; }
      trace('->', `${host}:${port}`, buf);
      this.sock.send(buf, port, host, (err) => (err ? reject(err) : resolve()));
    });
  }

  async enableBroadcast(): Promise<void> {
    await this.ready;
    this.sock.setBroadcast(true);
    this.sock.setMulticastTTL(1);
  }

  /**
   * Send one NON request; `onMessage` sees every datagram that carries its token.
   * Tokens are 2 bytes, like aiocoap's — the client these devices are known to tolerate.
   */
  async send(spec: RequestSpec, onMessage: Listener, token: Buffer = randomBytes(2)): Promise<() => void> {
    await this.ready;
    const key = token.toString('hex');
    this.listeners.set(key, onMessage);
    const options = pathOptions(spec.path);
    if (spec.observe !== undefined) options.push({ number: OPT.OBSERVE, value: uintOption(spec.observe) });
    const payload = spec.payload === undefined ? Buffer.alloc(0) : Buffer.from(spec.payload);
    const buf = encode({ type: spec.type ?? TYPE.NON, code: spec.code, mid: this.nextMid(), token, options, payload });
    try {
      await this.sendRaw(buf, spec.host, spec.port ?? COAP_PORT);
    } catch (err) {
      this.listeners.delete(key);
      throw err;
    }
    return () => { this.listeners.delete(key); };
  }

  /** Send one NON request and resolve with the first answer that carries its token. */
  request(spec: RequestSpec, timeoutMs: number, token?: Buffer): Promise<Received> {
    return new Promise((resolve, reject) => {
      let cancel: (() => void) | undefined;
      let done = false;
      const finish = (fn: () => void) => { if (done) return; done = true; clearTimeout(timer); cancel?.(); fn(); };
      const timer = setTimeout(() => finish(() => reject(new CoapTimeout(`${spec.path} @ ${spec.host}`, timeoutMs))), timeoutMs);
      this.send(spec, (msg) => finish(() => resolve(msg)), token)
        .then((c) => { cancel = c; if (done) c(); })
        .catch((err) => finish(() => reject(err)));
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    try { this.sock?.close(); } catch { /* already closed */ }
  }
}
