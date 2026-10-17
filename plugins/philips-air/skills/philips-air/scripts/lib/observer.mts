// observer.mts (lib) — the CLI side of the per-device observer daemon.
//
// The device serves status only to CoAP observers and does not cope with a
// stream of short-lived registrations: after a handful of them, status goes
// silent for 15–20 minutes. So one background process per device
// (scripts/observer.mts) holds a single long registration and writes every
// notification to a cache file; status/get/watch read that cache, set writes
// through /sys/dev/control and verifies against the next notification.
//
// Files, per device, in ${XDG_STATE_HOME:-~/.local/state}/philips-air/<key>/:
//   state.json   last reported state + when it arrived
//   observer.pid pid of the running daemon
//   observer.log its log (rewritten on every start)
//   observer.port the local UDP port; a restarted daemon binds it again so the
//                device sees the same observer (same endpoint + token) and
//                replaces its entry instead of adding one
//   access       touched by every CLI read; the daemon exits after
//                $PHILIPS_AIR_OBSERVER_IDLE minutes (default 60) without one

import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { State } from './client.mts';

export interface Cache {
  key: string;
  ip: string;
  /** ISO time the last notification arrived */
  updated_at: string;
  /** ISO time the daemon (re)registered */
  registered_at: string;
  max_age: number;
  state: State;
}

export class ObserverError extends Error {
  constructor(message: string) { super(message); this.name = 'ObserverError'; }
}

export function stateDir(key: string): string {
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'philips-air', key);
}

export const files = (key: string) => {
  const dir = stateDir(key);
  return { dir, state: path.join(dir, 'state.json'), pid: path.join(dir, 'observer.pid'), port: path.join(dir, 'observer.port'), log: path.join(dir, 'observer.log'), access: path.join(dir, 'access') };
};

export function idleMinutes(): number {
  const v = Number(process.env.PHILIPS_AIR_OBSERVER_IDLE ?? 60);
  return Number.isFinite(v) && v >= 0 ? v : 60;
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}

export async function observerPid(key: string): Promise<number | null> {
  try {
    const pid = Number((await readFile(files(key).pid, 'utf8')).trim());
    return pid > 0 && alive(pid) ? pid : null;
  } catch {
    return null;
  }
}

export async function readCache(key: string): Promise<Cache | null> {
  try { return JSON.parse(await readFile(files(key).state, 'utf8')) as Cache; } catch { return null; }
}

export async function touch(key: string): Promise<void> {
  const f = files(key);
  await mkdir(f.dir, { recursive: true });
  const now = new Date();
  try { await utimes(f.access, now, now); } catch { await writeFile(f.access, ''); }
}

export function ageSeconds(c: Cache): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(c.updated_at)) / 1000));
}

/** Start the daemon for `key` unless it already runs. `ip` is for a device not saved yet. */
export async function startObserver(key: string, ip?: string): Promise<number> {
  const running = await observerPid(key);
  if (running) return running;
  await mkdir(files(key).dir, { recursive: true });
  const script = fileURLToPath(new URL('../observer.mts', import.meta.url));
  const args = ['--disable-warning=ExperimentalWarning', script, key, ...(ip ? ['--ip', ip] : [])];
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  return child.pid ?? 0;
}

export async function stopObserver(key: string): Promise<boolean> {
  const pid = await observerPid(key);
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
    for (let i = 0; i < 20 && alive(pid); i++) await sleep(100);
  }
  await rm(files(key).pid, { force: true });
  return !!pid;
}

/**
 * Wait until the cache holds a notification newer than `since` (ms epoch),
 * or `predicate` holds. Resolves with the cache, or null on timeout.
 */
export async function waitForCache(key: string, timeoutMs: number, accept: (c: Cache) => boolean): Promise<Cache | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const c = await readCache(key);
    if (c && accept(c)) return c;
    await sleep(300);
  }
  return null;
}

/**
 * The state the CLI should show: start the observer if needed and wait for
 * its first notification. A running observer's cache is returned as is, even
 * if old — `ageSeconds` tells how old, and the device only notifies on change.
 */
export async function currentState(key: string, ip: string | undefined, log: (l: string) => void, waitMs = 20_000): Promise<Cache> {
  await touch(key);
  const running = await observerPid(key);
  const cached = await readCache(key);
  if (running && cached) return cached;
  const since = Date.now();
  if (!running) {
    log(`starting the observer for ${key}`);
    await startObserver(key, ip);
  }
  const c = await waitForCache(key, waitMs, (x) => Date.parse(x.updated_at) >= since - 1000 || (!!running && !!x));
  if (!c) {
    throw new ObserverError(`no status from ${key} within ${Math.round(waitMs / 1000)} s — the device does not answer status requests (see ${files(key).log})`);
  }
  return c;
}
