#!/usr/bin/env node
// observer.mts — background process that keeps ONE status observation open on
// one device and mirrors every notification into a cache file (see
// lib/observer.mts for the why and the file layout). Started on demand by
// air.mts / setup.mts; not meant to be run by hand.
//
//   node observer.mts <key> [--ip <addr>]
//
// One socket, one token, one registration, made only after /sys/dev/info at
// the address reports the saved device_id. When the device has been silent
// for twice its Max-Age it re-registers from the same socket with the same
// token (that replaces the registration instead of adding one); after several
// silent rounds it re-syncs and checks the address again. It never sends RST
// or an Observe=1 deregistration. It exits after PHILIPS_AIR_OBSERVER_IDLE
// minutes (default 60, 0 = never) without a CLI read.

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { AirClient } from './lib/client.mts';
import type { State } from './lib/client.mts';
import { CoapSocket } from './lib/coap.mts';
import { loadConfig, saveConfig } from './lib/config.mts';
import { allLocalHosts, scan } from './lib/net.mts';
import { claimPid, files, idleMinutes } from './lib/observer.mts';
import type { Cache } from './lib/observer.mts';

const { values: opt, positionals } = parseArgs({ allowPositionals: true, options: { ip: { type: 'string' } } });
const key = positionals[0];
if (!key) { process.stderr.write('usage: observer.mts <key> [--ip <addr>]\n'); process.exit(2); }

const f = files(key);
await mkdir(f.dir, { recursive: true });

// Single instance per device: the pid file is claimed atomically, and a
// daemon that loses exits before it truncates the winner's log or opens a
// second subscription.
if (await claimPid(key)) process.exit(0);
const logStream = createWriteStream(f.log, { flags: 'w' });
const log = (line: string) => logStream.write(`${new Date().toISOString()} ${line}\n`);

// Reuse the previous run's port when it is free, so the device sees the same
// observer endpoint again (RFC 7641: same endpoint + token replaces).
const previousPort = Number(await readFile(f.port, 'utf8').catch(() => '0')) || 0;
const sock = new CoapSocket(previousPort);
let stopping = false;
const shutdown = async (why: string) => {
  if (stopping) return;
  stopping = true;
  log(`stopping: ${why}`);
  try { if (Number((await readFile(f.pid, 'utf8')).trim()) === process.pid) await rm(f.pid, { force: true }); } catch { /* gone */ }
  sock.close();
  logStream.end(() => process.exit(0));
};
process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });

async function deviceRecord() {
  return (await loadConfig()).devices[key];
}

let ip = opt.ip ?? (await deviceRecord())?.ip;
if (!ip) { log(`no IP for ${key}: not in the config and no --ip`); await shutdown('no address'); }

let client = new AirClient(ip!, { log }, sock);
let lastMessage = 0;
let registeredAt = 0;
let maxAge = 60;
let silentRounds = 0;
/** the last identity check found another device at client.host */
let foreign = false;

async function writeCache(state: State): Promise<void> {
  const c: Cache = {
    key, ip: client.host,
    updated_at: new Date(lastMessage).toISOString(),
    registered_at: new Date(registeredAt).toISOString(),
    max_age: maxAge,
    state,
  };
  const tmp = `${f.state}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(c, null, 2));
  await rename(tmp, f.state);
}

/**
 * Subscribe (or re-subscribe). With `verify`, or while the address last
 * belonged to another device, first make sure client.host is still this
 * device — a valid stream of notifications from the wrong one would never
 * trigger relocation on its own.
 */
async function register(verify = false): Promise<void> {
  registeredAt = Date.now();
  if (verify || foreign) {
    foreign = !(await relocate());
    if (foreign) { log(`${client.host} answers as a different device and ${key} was not found elsewhere; not registering`); return; }
    await client.sync();
  }
  await client.observe((state, age) => {
    lastMessage = Date.now();
    maxAge = age;
    silentRounds = 0;
    writeCache(state).catch((e) => log(`cache write failed: ${e.message}`));
  }, (err) => log(`skipped a message: ${err.message}`));
  log(`registered with ${client.host}`);
}

/**
 * The device may have moved (DHCP): look for it by device_id. False only when
 * another device answers at client.host and this one is nowhere to be found;
 * a silent address is kept — the device may just be off.
 */
async function relocate(): Promise<boolean> {
  const dev = await deviceRecord();
  if (!dev) return true;
  try {
    const probe = new AirClient(client.host, { log, localPort: 0 });
    const info = await probe.info(1500).catch(() => null);
    probe.close();
    if (info?.device_id === dev.device_id) return true;
    const hit = (await scan({ hosts: allLocalHosts(), stopOn: (c) => c.info.device_id === dev.device_id }))
      .find((c) => c.info.device_id === dev.device_id);
    if (!hit) return !info;
    if (hit.ip === client.host) return true;
    log(`${dev.name} moved ${client.host} → ${hit.ip}`);
    const cfg = await loadConfig();
    if (cfg.devices[key]) { cfg.devices[key].ip = hit.ip; await saveConfig(cfg); }
    client = new AirClient(hit.ip, { log }, sock);
    return true;
  } catch (err) {
    log(`relocate failed: ${(err as Error).message}`);
    return true;
  }
}

async function idleExpired(): Promise<boolean> {
  const minutes = idleMinutes();
  if (!minutes) return false;
  try {
    return Date.now() - (await stat(f.access)).mtimeMs > minutes * 60_000;
  } catch {
    return Date.now() - registeredAt > minutes * 60_000;
  }
}

const boundPort = await sock.localPort();
await writeFile(f.port, String(boundPort));
log(`observer for ${key} (pid ${process.pid}) → ${ip}, local port ${boundPort}${previousPort && previousPort !== boundPort ? ` (previous port ${previousPort} was taken)` : ''}`);
try {
  await register(true);
} catch (err) {
  log(`first registration failed: ${(err as Error).message}`);
}

while (!stopping) {
  await sleep(5_000);
  if (stopping) break;
  if (await idleExpired()) { await shutdown(`idle for ${idleMinutes()} min`); break; }
  // Twice Max-Age of silence → re-register. While the device answers nothing
  // at all, back off (2, 4, 8 … 20 min): every attempt is one more
  // subscription, and those are what jam its status side in the first place.
  const silence = Date.now() - Math.max(lastMessage, registeredAt);
  const base = Math.max(2 * maxAge, 60) * 1000;
  const wait = lastMessage > registeredAt ? base : Math.min(base * 2 ** silentRounds, 20 * 60_000);
  if (silence < wait) continue;
  silentRounds++;
  log(`no notification for ${Math.round(silence / 1000)} s (round ${silentRounds}); re-registering`);
  try {
    await register(silentRounds % 3 === 0);
  } catch (err) {
    log(`re-registration failed: ${(err as Error).message}`);
  }
}
