// session.mts — one CLI run's connection to a device, and the little that
// persists between runs. No background process: every command does its work
// and exits.
//
// What the device does (measured on an HU5710, see docs/protocol.md):
// - It keeps exactly ONE status observer. A registration from a new endpoint
//   replaces the previous one; a registration from the same endpoint
//   (address, port, token) changes nothing.
// - Notifications are NON, so nothing tells the device a listener went away:
//   a registration outlives the process that made it, and whoever binds that
//   port later receives the notifications.
// - It notifies within a second of every real change, but answers the
//   registration itself only now and then — after one answer it tends to stay
//   silent for 15–20 minutes. Writing a value it already has notifies nobody.
//
// So every run binds the same local UDP port as the run before, re-registers
// from it (a no-op for the device, and it takes the slot back if another
// client took it) and listens. Whatever arrives is the current state and goes
// to a cache file. A write is confirmed by the notification it causes; a read
// that hears nothing within its wait falls back to the cache and says how old
// it is.
//
// Files, per device, in ${XDG_STATE_HOME:-~/.local/state}/philips-air/<key>/:
//   state.json  last reported state + when it arrived
//   port        the local UDP port the device's registration points at

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { AirClient } from './client.mts';
import type { State } from './client.mts';
import { CoapSocket } from './coap.mts';
import { loadConfig } from './config.mts';
import type { SavedDevice } from './config.mts';
import { openSaved } from './device.mts';

export interface Cache {
  key: string;
  ip: string;
  /** ISO time the state arrived from the device */
  updated_at: string;
  state: State;
}

/** No state from the device within the wait, and nothing cached either. */
export class NoReportError extends Error {
  constructor(message: string) { super(message); this.name = 'NoReportError'; }
}

export function stateDir(key: string): string {
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'philips-air', key);
}

export const files = (key: string) => {
  const dir = stateDir(key);
  return { dir, state: path.join(dir, 'state.json'), port: path.join(dir, 'port') };
};

export async function readCache(key: string): Promise<Cache | null> {
  try { return JSON.parse(await readFile(files(key).state, 'utf8')) as Cache; } catch { return null; }
}

export function ageSeconds(c: Cache): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(c.updated_at)) / 1000));
}

/** setup.mts rename: the registration's port stays useful under the new key. */
export async function moveState(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(stateDir(to)), { recursive: true });
  await rm(stateDir(to), { recursive: true, force: true });
  await rename(stateDir(from), stateDir(to)).catch(() => {});
}

export async function dropState(key: string): Promise<void> {
  await rm(stateDir(key), { recursive: true, force: true });
}

export interface Report { at: number; state: State }

/**
 * A connection for one run. `key` set: a saved device — bind its port, keep
 * the cache. `key` unset (--host): a throwaway port and no files.
 */
export class Link {
  readonly key?: string;
  readonly sock: CoapSocket;
  client!: AirClient;
  private reports: Report[] = [];
  private subs = new Set<(r: Report) => void>();
  private writing: Promise<void> = Promise.resolve();
  private listening = false;

  private constructor(key: string | undefined, port: number) {
    this.key = key;
    this.sock = new CoapSocket(port);
  }

  /**
   * Open a link to a saved device (checking its identity and following it if
   * DHCP moved it) or, with only `ip`, to an unsaved one.
   */
  static async open(target: { dev?: SavedDevice; key?: string; ip: string }, log: (l: string) => void, notify?: (l: string) => void): Promise<Link> {
    const key = target.dev?.key ?? target.key;
    const port = key ? Number(await readFile(files(key).port, 'utf8').catch(() => '0')) || 0 : 0;
    const link = new Link(key, port);
    try {
      link.client = target.dev
        ? (await openSaved(await loadConfig(), target.dev, { log }, link.sock, notify)).client
        : new AirClient(target.ip, { log }, link.sock);
    } catch (err) {
      link.sock.close();
      throw err;
    }
    return link;
  }

  get ip(): string { return this.client.host; }

  /** Register for status from this link's port and collect every report. */
  async listen(): Promise<void> {
    if (this.listening) return;
    this.listening = true;
    await this.client.observe((state) => {
      const r = { at: Date.now(), state };
      this.reports.push(r);
      if (this.key) this.writing = this.writing.then(() => this.save(r)).catch(() => {});
      for (const fn of this.subs) fn(r);
    }, (err) => this.client.log(`skipped a status message: ${err.message}`));
    if (this.key) {
      await mkdir(files(this.key).dir, { recursive: true });
      await writeFile(files(this.key).port, String(await this.sock.localPort()));
    }
  }

  private async save(r: Report): Promise<void> {
    const f = files(this.key!);
    const c: Cache = { key: this.key!, ip: this.ip, updated_at: new Date(r.at).toISOString(), state: r.state };
    const tmp = `${f.state}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(c, null, 2));
    await rename(tmp, f.state);
  }

  /** How many reports have arrived so far; pass it to next() to skip them. */
  mark(): number { return this.reports.length; }

  /** The newest report of this run, optionally only from `from` on. */
  latest(from = 0): Report | null {
    return this.reports.length > from ? this.reports[this.reports.length - 1] : null;
  }

  /** The first report from index `from` on that `accept`s, or null after `timeoutMs`. */
  next(timeoutMs: number, accept: (s: State) => boolean = () => true, from = 0): Promise<State | null> {
    const hit = this.reports.slice(from).find((r) => accept(r.state));
    if (hit) return Promise.resolve(hit.state);
    return new Promise((resolve) => {
      const done = (s: State | null) => { clearTimeout(timer); this.subs.delete(fn); resolve(s); };
      const fn = (r: Report) => { if (accept(r.state)) done(r.state); };
      const timer = setTimeout(() => done(null), timeoutMs);
      this.subs.add(fn);
    });
  }

  /** Every report as it arrives (watch). Returns an unsubscribe function. */
  onReport(fn: (r: Report) => void): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }

  /** Finish pending cache writes and release the port. The device's registration stays. */
  async close(): Promise<void> {
    await this.writing;
    this.sock.close();
  }
}
