// client.mts — a session with one Philips air device: plain-text
// /sys/dev/info, key sync, the encrypted status registration and control
// writes. Port of aioairctrl.coap.client.Client plus the control retry policy
// that the reference hu5710.py needed in practice.

import { Buffer } from 'node:buffer';
import { setTimeout as sleep } from 'node:timers/promises';
import { CoapSocket, CODE, OPT, TYPE, codeString, option, readUint } from './coap.mts';
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

/** Fixed token for the status registration — see observe(). */
const STATUS_TOKEN = Buffer.from('5041', 'hex');

export interface ClientOptions {
  port?: number;
  timeoutMs?: number;
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
  readonly log: (line: string) => void;

  constructor(host: string, opts: ClientOptions = {}, sock?: CoapSocket) {
    this.host = host;
    this.port = opts.port ?? 5683;
    this.timeoutMs = opts.timeoutMs ?? 3000;
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
   * Register for status — a **CON** GET with Observe=0 and the fixed token —
   * and hand every answer and notification to `onState`. The device answers
   * with a separate NON response (its own message ID, our token), when it
   * answers at all, and notifies on every change. It keeps one observer per
   * device: the same endpoint and token re-registering is a no-op, a new
   * endpoint replaces the old one. Never RST, never deregister with
   * Observe=1, no CoAP retransmission. Undecryptable messages go to `onError`
   * and are skipped — the next notification carries a fresh envelope.
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
   * Write fields through /sys/dev/control. The answer is plain JSON
   * {"status":"success"}; on anything else re-sync once, then retry. The
   * device answers "failed" to an envelope it cannot decrypt, so an empty
   * `fields` is a harmless check of the encrypted session.
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
