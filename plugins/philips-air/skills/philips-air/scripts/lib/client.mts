// client.mts — a session with one Philips air device: plain-text
// /sys/dev/info, key sync, encrypted status reads and control writes.
// Port of aioairctrl.coap.client.Client plus the retry policy that the
// reference hu5710.py needed in practice.

import { Buffer } from 'node:buffer';
import { setTimeout as sleep } from 'node:timers/promises';
import { CoapSocket, CoapTimeout, CODE, OPT, TYPE, codeString, option, readUint } from './coap.mts';
import type { Received } from './coap.mts';
import { EncryptionContext, decryptEnvelope, syncNonce } from './crypto.mts';
import type { Raw } from './models/index.mts';

export type State = Record<string, Raw>;

export interface DeviceInfo {
  product_id?: string;
  device_id?: string;
  name?: string;
  type?: string;
  modelid?: string;
  swversion?: string;
  option?: string;
  [k: string]: unknown;
}

export const PATHS = {
  INFO: '/sys/dev/info',
  SYNC: '/sys/dev/sync',
  STATUS: '/sys/dev/status',
  CONTROL: '/sys/dev/control',
} as const;

/** Fixed token for status reads — see readOnce. */
const STATUS_TOKEN = Buffer.from('5041', 'hex');

export interface ClientOptions {
  port?: number;
  timeoutMs?: number;
  /** status read attempts before giving up */
  retries?: number;
  /** how long one status read waits; the device takes 1.6–8 s */
  statusTimeoutMs?: number;
  /** pause between failed status reads */
  retryPauseMs?: number;
  log?: (line: string) => void;
  /** source port; default 0 = random */
  localPort?: number;
}

export class ProtocolError extends Error {
  constructor(message: string) { super(message); this.name = 'ProtocolError'; }
}

export function parseInfo(msg: Received): DeviceInfo | null {
  if (msg.code >> 5 !== 2) return null;
  try {
    const j = JSON.parse(msg.payload.toString('utf8'));
    return j && typeof j === 'object' && (j.modelid || j.device_id) ? (j as DeviceInfo) : null;
  } catch {
    return null;
  }
}

export class AirClient {
  readonly host: string;
  readonly port: number;
  private sock: CoapSocket;
  private ownsSock: boolean;
  private enc = new EncryptionContext();
  private timeoutMs: number;
  private retries: number;
  private statusTimeoutMs: number;
  private retryPauseMs: number;
  private log: (line: string) => void;

  constructor(host: string, opts: ClientOptions = {}, sock?: CoapSocket) {
    this.host = host;
    this.port = opts.port ?? 5683;
    this.timeoutMs = opts.timeoutMs ?? 3000;
    this.retries = opts.retries ?? 5;
    this.statusTimeoutMs = opts.statusTimeoutMs ?? 12_000;
    this.retryPauseMs = opts.retryPauseMs ?? 1200;
    this.log = opts.log ?? (() => {});
    this.ownsSock = !sock;
    this.sock = sock ?? new CoapSocket(opts.localPort ?? 0);
  }

  private req(code: number, path: string, payload?: string, observe?: number, timeoutMs = this.timeoutMs): Promise<Received> {
    return this.sock.request({ host: this.host, port: this.port, code, path, payload, observe }, timeoutMs);
  }

  /** Unencrypted identity: modelid, device_id, name, … */
  async info(timeoutMs = this.timeoutMs): Promise<DeviceInfo> {
    const res = await this.req(CODE.GET, PATHS.INFO, undefined, undefined, timeoutMs);
    const info = parseInfo(res);
    if (!info) throw new ProtocolError(`${PATHS.INFO} answered ${codeString(res.code)} without device JSON`);
    return info;
  }

  /** Exchange a nonce for the starting value of the client key counter. */
  async sync(): Promise<string> {
    const res = await this.req(CODE.POST, PATHS.SYNC, syncNonce());
    const key = res.payload.toString('utf8').trim();
    this.enc.setClientKey(key);
    this.log(`synced, client key ${key}`);
    return key;
  }

  private async ensureSynced(): Promise<void> {
    if (!this.enc.hasKey) await this.sync();
  }

  /**
   * One status read: a **CON** GET with Observe=0. The device answers it with
   * a separate NON response (its own message ID, our token) after 1.6–8 s and
   * no empty ACK. Sent as NON, the same request can go unanswered for good
   * while sync and control keep working. Take the first answer and silently
   * ignore later notifications — never RST them, never deregister with
   * Observe=1. There is deliberately no CoAP retransmission: each copy would
   * be another registration. The device copes badly with many short-lived
   * subscriptions, so saved devices are read through observe() in a
   * long-running observer instead; this is for one-off reads.
   */
  private async readOnce(): Promise<State> {
    const res = await this.sock.request({ host: this.host, port: this.port, type: TYPE.CON, code: CODE.GET, path: PATHS.STATUS, observe: 0 }, this.statusTimeoutMs, STATUS_TOKEN);
    if (res.code >> 5 !== 2) throw new ProtocolError(`${PATHS.STATUS} answered ${codeString(res.code)}`);
    const plain = decryptEnvelope(res.payload.toString('utf8'));
    const doc = JSON.parse(plain);
    const reported = doc?.state?.reported;
    if (!reported || typeof reported !== 'object') throw new ProtocolError('status payload has no state.reported');
    return reported as State;
  }

  /**
   * Long-lived subscription: register once (CON GET Observe=0) and hand every
   * answer and notification to `onState`. Calling it again re-registers from
   * the same socket with the same token, which replaces the registration.
   * Undecryptable messages go to `onError` and are otherwise skipped — the
   * next notification carries a fresh envelope.
   */
  async observe(onState: (s: State, maxAge: number) => void, onError: (err: Error) => void = () => {}): Promise<() => void> {
    await this.ensureSynced();
    return this.sock.send({ host: this.host, port: this.port, type: TYPE.CON, code: CODE.GET, path: PATHS.STATUS, observe: 0 }, (msg) => {
      try {
        if (msg.code >> 5 !== 2) throw new ProtocolError(`${PATHS.STATUS} answered ${codeString(msg.code)}`);
        const reported = JSON.parse(decryptEnvelope(msg.payload.toString('utf8')))?.state?.reported;
        if (!reported || typeof reported !== 'object') throw new ProtocolError('status payload has no state.reported');
        const maxAge = option(msg, OPT.MAX_AGE);
        onState(reported as State, maxAge ? readUint(maxAge) : 60);
      } catch (err) {
        onError(err as Error);
      }
    }, STATUS_TOKEN);
  }

  /**
   * Encrypted status, with the retry policy the device needs: decrypt
   * occasionally fails (counter desync, a stray answer), and a fresh read a
   * second later succeeds. From the third failure on, re-sync first. A
   * silent device gets two long waits, not five.
   */
  async status(): Promise<State> {
    await this.ensureSynced();
    let last: unknown;
    let timeouts = 0;
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        return await this.readOnce();
      } catch (err) {
        last = err;
        this.log(`status attempt ${attempt}/${this.retries} failed: ${(err as Error).message}`);
        if (err instanceof CoapTimeout && ++timeouts >= 2) break;
        if (attempt === this.retries) break;
        await sleep(this.retryPauseMs);
        if (attempt >= 2) await this.sync().catch((e) => this.log(`re-sync failed: ${(e as Error).message}`));
      }
    }
    const why = last instanceof CoapTimeout ? 'the device does not answer status requests' : (last as Error)?.message;
    throw new ProtocolError(`could not read status: ${why}`);
  }

  /**
   * Write fields through /sys/dev/control. The answer is plain JSON
   * {"status":"success"}; on anything else re-sync once, then retry.
   */
  async control(fields: Record<string, Raw>, retries = 5): Promise<boolean> {
    await this.ensureSynced();
    const body = JSON.stringify({ state: { desired: { CommandType: 'app', DeviceId: '', EnduserId: '', ...fields } } });
    for (let attempt = 0; attempt <= retries; attempt++) {
      let status = '';
      try {
        const res = await this.req(CODE.POST, PATHS.CONTROL, this.enc.encrypt(body));
        const text = res.payload.toString('utf8');
        try { status = JSON.parse(text)?.status ?? text; } catch { status = text; }
      } catch (err) {
        status = (err as Error).message;
      }
      if (status === 'success') return true;
      this.log(`control ${JSON.stringify(fields)} attempt ${attempt + 1} → ${status}`);
      if (attempt === 0) await this.sync().catch((e) => this.log(`re-sync failed: ${(e as Error).message}`));
      else await sleep(500);
    }
    return false;
  }

  /** Closes the socket only if this client created it. */
  close(): void { if (this.ownsSock) this.sock.close(); }
}
