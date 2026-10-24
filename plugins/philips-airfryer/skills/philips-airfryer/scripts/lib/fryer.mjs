// The Philips HD928x airfryer over the Versuni AWS IoT relay (FUSION firmware):
//  - connect → MQTT over WSS with Custom Authorizer headers in the handshake,
//  - NCP commands as JSON on da_ctrl/<thing>/to_ncp, replies on .../from_ncp,
//  - updatePort events merge into this.state.

import { randomBytes, randomUUID } from "node:crypto";

import { connect as mqttConnect } from "./mqtt.mjs";
import { loadState, saveState } from "./state.mjs";
import {
  FUSION_MQTT_HOST,
  FUSION_TENANT,
  getDevices,
  getMqttSignature,
  getMqttUserId,
  getOidcTokens,
  refreshTokens,
  requestOtp,
  verifyOtp,
} from "./cloud.mjs";

export const PRESETS = {
  manual: 0,
  frozen_snacks: 1,
  fresh_fries: 2,
  chicken: 3,
  fish: 4,
  muffins_cake: 5,
  meat_chops: 6,
  vegetables: 7,
  keep_warm: 8,
};

const PRESET_NAMES = Object.fromEntries(
  Object.entries(PRESETS).map(([k, v]) => [v, k]),
);

export const TEMP_MIN_C = 60;
export const TEMP_MAX_C = 200;
export const MINUTES_MIN = 1;
export const MINUTES_MAX = 60;
export const KEEP_WARM_C = 80;

export const STANDBY = "standby";
export const IDLE = "idle";
export const SETTING = "setting";
export const COOKING = "cooking";
export const PAUSE = "pause";
export const FINISH = "finish";

const NCP_STATUS = {
  0: "ok",
  1: "busy",
  2: "json_error",
  3: "correlation_id_error",
  4: "client_type_error",
  5: "time_error",
  6: "message_type_error",
  7: "command_name_error",
  8: "port_error",
  9: "write_read_only_port",
  10: "read_write_only_port",
  11: "serialization_error",
  12: "mqtt_error",
};

// The appliance only accepts a program after idle → setting with a pause in
// between; shorter delays make it drop the program without an error.
const STEP_DELAY_MS = 1500;

export class AirFryerError extends Error {}
export class NotLoggedInError extends AirFryerError {}
export class ValueError extends AirFryerError {}

// Out-of-range values are not rejected by the appliance: it silently clamps
// them to 180 °C / 1 min. So they are refused here instead.
export function checkRanges(temp, minutes, preset = 0) {
  if (
    temp !== undefined &&
    temp !== null &&
    preset !== PRESETS.keep_warm &&
    !(Number.isInteger(temp) && temp >= TEMP_MIN_C && temp <= TEMP_MAX_C)
  ) {
    throw new ValueError(
      `Temperature ${temp}°C: must be an integer in ${TEMP_MIN_C}–${TEMP_MAX_C}°C`,
    );
  }
  if (minutes !== undefined && minutes !== null) {
    if (!Number.isInteger(minutes) || minutes < MINUTES_MIN || minutes > MINUTES_MAX) {
      throw new ValueError(
        `Time ${minutes} min: must be an integer in ${MINUTES_MIN}–${MINUTES_MAX}`,
      );
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function loginStart(email) {
  const state = await loadState();
  const vtoken = await requestOtp(email);
  state.email = email;
  state.vtoken = vtoken;
  await saveState(state);
}

export async function loginFinish(code) {
  const state = await loadState();
  if (!state.vtoken) throw new NotLoggedInError("No code was requested — run `login <email>` first");
  const sessionToken = await verifyOtp(state.email, code, state.vtoken);
  const tokens = await getOidcTokens(sessionToken);
  const devices = await getDevices(tokens.access_token);
  delete state.vtoken;
  state.refresh_token = tokens.refresh_token;
  state.devices = devices;
  const fryer = devices.find((d) =>
    String(d.ctn ?? "").toUpperCase().startsWith("HD9"),
  );
  if (fryer) {
    state.thing_name = fryer.thingName;
    state.model = fryer.ctn ?? "";
  }
  await saveState(state);
  return { devices, fryer: fryer ?? null };
}

async function freshTokens(state) {
  const tokens = await refreshTokens(state.refresh_token);
  // The refresh_token rotates: persist the new one before anything else can
  // fail, or the next run starts from a token the cloud no longer accepts.
  if (tokens.refresh_token && tokens.refresh_token !== state.refresh_token) {
    state.refresh_token = tokens.refresh_token;
    await saveState(state);
  }
  return tokens;
}

// Re-reads the account's device list from the cloud and saves it.
export async function refreshDevices() {
  const state = await loadState();
  if (!state.refresh_token) throw new NotLoggedInError("Not logged in to Philips HomeID");
  const tokens = await freshTokens(state);
  state.devices = await getDevices(tokens.access_token);
  await saveState(state);
  return state;
}

async function mqttCredentials(state) {
  const tokens = await freshTokens(state);
  const [userId, sig] = await Promise.all([
    getMqttUserId(tokens.access_token, tokens.id_token),
    getMqttSignature(tokens.access_token),
  ]);
  if (!userId) throw new AirFryerError("Cloud returned no MQTT user_id");
  return {
    accessToken: tokens.access_token,
    userId,
    signature: sig.signature,
  };
}

export class AirFryer {
  constructor({ thingName = null, timeoutMs = 10_000 } = {}) {
    this.thingName = thingName;
    this.timeoutMs = timeoutMs;
    this._client = null;
    this._pending = new Map();
    this._shadowState = {};
    this._shadowResolve = null;
    this.state = {};
    this.onUpdate = null;
  }

  async connect() {
    const state = await loadState();
    if (!state.refresh_token) {
      throw new NotLoggedInError("Not logged in to Philips HomeID");
    }
    this.thingName = this.thingName ?? state.thing_name;
    if (!this.thingName) {
      throw new NotLoggedInError("No airfryer on this account — log in again or check `devices`");
    }
    const topicBase = `${FUSION_TENANT}_ctrl/${this.thingName}`;
    this._toNcp = `${topicBase}/to_ncp`;
    this._fromNcp = `${topicBase}/from_ncp`;
    this._shadow = `$aws/things/${this.thingName}/shadow`;

    const { accessToken, userId, signature } = await mqttCredentials(state);
    this._client = await mqttConnect(`wss://${FUSION_MQTT_HOST}:443/mqtt`, {
      clientId: `${userId}_${randomUUID()}`,
      keepalive: 30,
      timeoutMs: this.timeoutMs + 20_000,
      headers: {
        "x-amz-customauthorizer-name": "CustomAuthorizer",
        "x-amz-customauthorizer-signature": signature,
        "token-header": `Bearer ${accessToken}`,
        tenant: FUSION_TENANT,
        "content-type": "application/json",
      },
    });
    this._client.onMessage = (topic, payload) => this._onMessage(topic, payload);
    // Only these topics: a wildcard (#) violates the IoT policy and the broker
    // drops the connection.
    await this._client.subscribe([
      this._fromNcp,
      `${this._shadow}/get/accepted`,
      `${this._shadow}/update/accepted`,
    ]);
    return this;
  }

  async close() {
    if (!this._client) return;
    await this._client.close();
    this._client = null;
  }

  _onMessage(topic, payload) {
    let msg;
    try {
      msg = JSON.parse(payload.toString("utf8"));
    } catch {
      return;
    }
    if (topic === this._fromNcp) {
      if (msg.type === "event") {
        const data = msg.data ?? {};
        if (data.portName === "Status") {
          Object.assign(this.state, data.properties ?? {});
          this.onUpdate?.({ ...this.state });
        }
        return;
      }
      const waiter = this._pending.get(msg.cid);
      if (waiter) waiter(msg);
    } else if (topic.startsWith(this._shadow)) {
      Object.assign(this._shadowState, msg?.state?.reported ?? {});
      if (this._shadowResolve) this._shadowResolve();
    }
  }

  // One NCP request/response. Replies are matched by a fresh 4-byte cid;
  // status 1 (busy) is retried with jitter, as the official app does.
  async ncp(command, port = "", properties = null) {
    if (!this._client?.connected) {
      throw new AirFryerError("MQTT not connected");
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const cid = randomBytes(4).toString("hex");
      const payload = {
        cid,
        time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        type: "command",
        cn: command,
        ct: "mobile",
      };
      if (port) {
        payload.data = { portName: port };
        if (properties) payload.data.properties = properties;
      }

      const reply = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this._pending.delete(cid);
          reject(new AirFryerError(`No reply from the appliance for ${command} ${port}`));
        }, this.timeoutMs);
        this._pending.set(cid, (msg) => {
          clearTimeout(timer);
          this._pending.delete(cid);
          resolve(msg);
        });
        this._client.publish(this._toNcp, JSON.stringify(payload), { qos: 1 }).catch((err) => {
          clearTimeout(timer);
          this._pending.delete(cid);
          reject(err);
        });
      });

      const status = reply.status;
      if (status === 0) return reply.data;
      if (status === 1 && attempt < 3) {
        await sleep(300 + Math.floor(Math.random() * 700));
        continue;
      }
      const name = NCP_STATUS[status] ?? status;
      throw new AirFryerError(
        `${command} ${port}${properties ? " " + JSON.stringify(properties) : ""}: ${name}`,
      );
    }
    throw new AirFryerError("busy");
  }

  async getPort(port) {
    const data = (await this.ncp("getPort", port)) ?? {};
    return data.properties ?? {};
  }

  // Success is the NCP status 0 on the reply. Do not wait for a Status echo:
  // the Wi-Fi module can lose sync with the main board and keep serving an old
  // Status snapshot while Control writes still go through.
  // temp_unit goes out on every write, status-only ones included: leaving it
  // off switches the appliance to Fahrenheit.
  async setControl(props) {
    await this.ncp("setPort", "Control", { ...props, temp_unit: false });
  }

  async ports() {
    return this.ncp("getAllPorts");
  }

  async shadow() {
    this._shadowState = {};
    const done = new Promise((resolve) => {
      this._shadowResolve = resolve;
    });
    await this._client.publish(`${this._shadow}/get`, "{}", { qos: 1 });
    await Promise.race([done, sleep(this.timeoutMs)]);
    this._shadowResolve = null;
    return { ...this._shadowState };
  }

  async status() {
    this.state = await this.getPort("Status");
    return { ...this.state };
  }

  async configure(temp, minutes, preset = 0) {
    const presetId = typeof preset === "string" ? PRESETS[preset] : preset;
    if (presetId === undefined) {
      throw new ValueError(`Unknown preset: ${preset}`);
    }
    checkRanges(temp, minutes, presetId);
    await this.setControl({ status: IDLE });
    await sleep(STEP_DELAY_MS);
    await this.setControl({
      status: SETTING,
      temp: Math.trunc(temp),
      time: Math.round(minutes * 60),
      preset: presetId,
    });
    await sleep(STEP_DELAY_MS);
  }

  async start() {
    await this.setControl({ status: COOKING });
  }

  async cook(temp, minutes, preset = 0) {
    await this.configure(temp, minutes, preset);
    await this.start();
  }

  async adjust({ temp = null, minutes = null } = {}) {
    checkRanges(temp, minutes);
    const props = {};
    if (temp !== null) props.temp = Math.trunc(temp);
    if (minutes !== null) props.time = Math.round(minutes * 60);
    if (Object.keys(props).length === 0) {
      throw new ValueError("adjust needs --temp and/or --minutes");
    }
    await this.setControl(props);
  }

  async pause() {
    await this.setControl({ status: PAUSE });
  }

  async resume() {
    await this.setControl({ status: COOKING });
  }

  async stop() {
    await this.setControl({ status: STANDBY });
  }

  // The keep_warm preset always runs at 80 °C, whatever temperature is sent.
  async keepWarm(minutes = 30) {
    await this.cook(KEEP_WARM_C, minutes, "keep_warm");
  }
}

export function snapshotAgeSec(st) {
  if (!st.timestamp) return null;
  const ts = Date.parse(st.timestamp.endsWith("Z") ? st.timestamp : `${st.timestamp}Z`);
  return Number.isNaN(ts) ? null : Math.floor((Date.now() - ts) / 1000);
}

export function formatStatus(st) {
  if (!st || Object.keys(st).length === 0) return "no data";
  const unit = st.temp_unit ? "°F" : "°C";
  const parts = [`status: ${st.status}`, `${st.temp}${unit}`];
  const total = st.time ?? 0;
  const left = st.cur_time ?? 0;
  if (total) {
    const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    parts.push(`time: ${fmt(total)}`);
    parts.push(`remaining: ${fmt(left)}`);
  }
  parts.push(`preset: ${PRESET_NAMES[st.preset] ?? st.preset}`);
  if (st.drw_opn) parts.push("BASKET OPEN");
  if (st.error) parts.push(`error: ${st.error}`);
  const age = snapshotAgeSec(st);
  if (age !== null && age > 120) {
    parts.push(`(snapshot ${Math.floor(age / 60)} min old — may be stale)`);
  }
  return parts.join(", ");
}
