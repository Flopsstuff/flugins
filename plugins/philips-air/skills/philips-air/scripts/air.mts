#!/usr/bin/env node
// air.mts — read and control saved Philips air devices over local CoAP.
// Devices are addressed by name or alias (see setup.mts).
//
//   node air.mts status [--raw]           state, sensors, filters
//   node air.mts list                     writable parameters and their values
//   node air.mts get humidity mode
//   node air.mts set mode=sleep backlight=off
//   node air.mts watch 60                 print what changes
//   node air.mts info                     unencrypted /sys/dev/info
//
// Every command does its work and exits; nothing runs in the background. The
// device keeps one status observer, so each run re-registers from the same
// local port as the run before and listens (lib/session.mts). Writes go to
// /sys/dev/control and are confirmed by the notification they cause. Reads
// take whatever the device reports within --wait seconds and otherwise show
// the last report, with its age.
//
// -d <name|alias|a,b|all> picks the device(s); --host <ip> reads an unsaved
// device directly (diagnostics only). --json switches stdout to JSON.
//
// Requires Node 22.18+ / 23.6+ (runs .mts directly). No dependencies.

import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { AirClient } from './lib/client.mts';
import type { State } from './lib/client.mts';
import { loadConfig, selectDevices } from './lib/config.mts';
import type { SavedDevice } from './lib/config.mts';
import { openSaved } from './lib/device.mts';
import { EXIT, UsageError, exitCodeFor, main, warn } from './lib/cli.mts';
import { profileFor } from './lib/models/index.mts';
import type { Param, Profile, Raw } from './lib/models/index.mts';
import { isIPv4 } from './lib/net.mts';
import { Link, NoReportError, ageSeconds, readCache } from './lib/session.mts';
import { filterSummary, listText, rawText, readable, sensorValue, statusText } from './lib/render.mts';

const USAGE = `usage: node air.mts <command> [-d device] [--json]

  status [--raw]                  current state, sensors and filters
  list                            writable parameters of the device's model
  get <name|code>...              read single fields (params, sensors, filters, raw D-codes)
  set <name=value>... [--raw] [--no-verify]
                                  write, then confirm from the device's own report
  watch [seconds]                 print changes as the device reports them (0 = until Ctrl-C)
  info                            unencrypted /sys/dev/info

  -d, --device <name|alias|a,b|all>   which saved device(s); default: the default one
  --host <ip>                         read an unsaved device directly (diagnostics)
  --wait <s>                          how long a read listens for the device (default 10)
  --raw                               status: every field untouched; set: allow D-codes outside the profile
  -v, --verbose                       protocol chatter on stderr`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    device: { type: 'string', short: 'd' },
    host: { type: 'string' },
    wait: { type: 'string' },
    json: { type: 'boolean' },
    raw: { type: 'boolean' },
    'no-verify': { type: 'boolean' },
    verbose: { type: 'boolean', short: 'v' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [cmd, ...args] = positionals;
const log = opt.verbose ? (l: string) => warn(`  · ${l}`) : () => {};
const out = (s: unknown) => console.log(typeof s === 'string' ? s : JSON.stringify(s, null, 2));

/** A report this recent is served from the cache without asking the device. */
const FRESH_S = 30;
/** How long set waits for the notification its write causes (they take 0.4–1 s). */
const CONFIRM_MS = 4000;

function waitMs(): number {
  if (opt.wait === undefined) return 10_000;
  const s = Number(opt.wait);
  if (!(s >= 0)) throw new UsageError(`--wait needs seconds ≥ 0, got "${opt.wait}"`);
  return s * 1000;
}

/** A device to act on: a saved one, or --host (no name, no cache). */
interface Target { key: string; title: string; profile?: Profile; model?: string; dev?: SavedDevice; host?: string }

/** `age` in seconds; `stale` when the device said nothing new and this is the cache. */
interface Snapshot { state: State; age: number; stale: boolean }

async function targets(): Promise<Target[]> {
  if (opt.host) {
    if (!isIPv4(opt.host)) throw new UsageError(`--host needs an IPv4 address, got "${opt.host}"`);
    const c = new AirClient(opt.host, { log });
    try {
      const info = await c.info();
      return [{ key: opt.host, title: info.name ?? opt.host, model: info.modelid, profile: profileFor(info.modelid), host: opt.host }];
    } finally {
      c.close();
    }
  }
  const devs = selectDevices(await loadConfig(), opt.device);
  return devs.map((d) => ({ key: d.key, title: d.name, model: d.model, profile: profileFor(d.model), dev: d }));
}

const openLink = (t: Target) => Link.open(t.dev ? { dev: t.dev, ip: t.dev.ip } : { ip: t.host! }, log, warn);

/**
 * The device's state: a cache entry under FRESH_S old as is; otherwise
 * register and take the first report within --wait; otherwise the cache,
 * marked stale.
 */
async function snapshot(t: Target): Promise<Snapshot> {
  const cached = t.dev ? await readCache(t.dev.key) : null;
  if (cached && ageSeconds(cached) <= FRESH_S) return { state: cached.state, age: ageSeconds(cached), stale: false };
  const wait = waitMs();
  const link = await openLink(t);
  try {
    await link.listen();
    const s = await link.next(wait);
    if (s) return { state: s, age: 0, stale: false };
  } finally {
    await link.close();
  }
  if (cached) return { state: cached.state, age: ageSeconds(cached), stale: true };
  throw new NoReportError(`${t.title} sent no status within ${wait / 1000} s and nothing is cached yet. It answers a fresh read only every 15–20 minutes but reports every change at once — try again later, or change something with set`);
}

const ago = (age: number) => (age < 120 ? `${age} s` : age < 7200 ? `${Math.round(age / 60)} min` : `${Math.round(age / 3600)} h`);

function staleNote(snap: Snapshot): string | null {
  if (!snap.stale) return snap.age >= 5 ? `last report from the device ${ago(snap.age)} ago` : null;
  return `the device sent nothing new within ${waitMs() / 1000} s; this is its last report, ${ago(snap.age)} old. It reports every change at once while someone listens, but answers a fresh read only every 15–20 minutes, so changes made on the device itself since then may be missing`;
}

const rawWarned = new Set<string>();
function warnRaw(t: Target): void {
  if (t.profile || rawWarned.has(t.key)) return;
  rawWarned.add(t.key);
  warn(`warning: no profile for model ${t.model ?? 'unknown'} (${t.title}) — raw mode: fields by D-code, values are not checked`);
}

/** Run fn per device; with several devices, prefix each block with its name. */
async function each(fn: (t: Target) => Promise<number>): Promise<number> {
  const ts = await targets();
  let worst = EXIT.OK as number;
  for (const t of ts) {
    if (ts.length > 1 && !opt.json) out(`\n## ${t.title} (${t.key})`);
    try {
      worst = Math.max(worst, await fn(t));
    } catch (err) {
      if (ts.length === 1) throw err;
      warn(`${t.key}: ${(err as Error).message}`);
      worst = Math.max(worst, exitCodeFor(err));
    }
  }
  return worst;
}

// ---------------------------------------------------------------- read

async function status(): Promise<number> {
  const docs: unknown[] = [];
  const code = await each(async (t) => {
    warnRaw(t);
    const snap = await snapshot(t);
    const s = snap.state;
    if (opt.json) {
      docs.push({ device: t.key, name: t.title, model: t.model, profile: t.profile?.id ?? null, age_s: snap.age, stale: snap.stale, ...(t.profile && !opt.raw ? readable(t.profile, s) : {}), state: s });
    } else {
      out(opt.raw || !t.profile ? rawText(s, t.title) : statusText(t.profile, s, t.title));
      const note = staleNote(snap);
      if (note) out(`\n  (${note})`);
    }
    return EXIT.OK;
  });
  if (opt.json) out(docs.length === 1 ? docs[0] : docs);
  return code;
}

function lookup(p: Profile | undefined, s: State, want: string): { name: string; value: string; raw: Raw; code?: string } | null {
  const w = want.toLowerCase();
  const norm = (x: string) => x.toLowerCase().replace(/[\s_]+/g, '-');
  if (p) {
    const param = p.params.find((x) => x.name === w || x.code.toLowerCase() === w);
    if (param) return { name: param.name, value: param.label(s[param.code]), raw: s[param.code], code: param.code };
    const r = [...p.sensors, ...p.info].find((x) => norm(x.name) === norm(w) || x.code.toLowerCase() === w);
    if (r) return { name: r.name, value: sensorValue(p, s, r.code) ?? '—', raw: s[r.code], code: r.code };
    const f = filterSummary(p, s).find((x) => norm(x.name) === norm(w));
    if (f) return { name: f.name, value: `${f.left_h}/${f.total_h} h (${f.percent ?? '?'}% left)`, raw: f.left_h };
    if (w === 'filters' || w === 'filter') {
      const all = filterSummary(p, s);
      return { name: 'filters', value: all.map((x) => `${x.name} ${x.percent ?? '?'}% (${x.left_h}/${x.total_h} h)`).join(', '), raw: null };
    }
  }
  const hit = Object.keys(s).find((k) => k.toLowerCase() === w);
  return hit ? { name: hit, value: JSON.stringify(s[hit]), raw: s[hit], code: hit } : null;
}

async function get(): Promise<number> {
  if (!args.length) throw new UsageError('get needs at least one field name');
  const docs: unknown[] = [];
  const code = await each(async (t) => {
    warnRaw(t);
    const snap = await snapshot(t);
    const s = snap.state;
    const res: Record<string, unknown> = {};
    let missing = 0;
    for (const want of args) {
      const r = lookup(t.profile, s, want);
      if (!r) missing++;
      res[want] = r;
      if (!opt.json) out(r ? `${r.name} = ${r.value}${r.code && String(r.raw) !== r.value ? `  (raw ${JSON.stringify(r.raw)}, ${r.code})` : ''}` : `${want}: unknown field`);
    }
    if (opt.json) docs.push({ device: t.key, age_s: snap.age, stale: snap.stale, fields: res });
    else if (snap.stale) out(`  (${staleNote(snap)})`);
    return missing ? EXIT.USAGE : EXIT.OK;
  });
  if (opt.json) out(docs.length === 1 ? docs[0] : docs);
  return code;
}

// ---------------------------------------------------------------- write

interface Step { code: string; raw: Raw; param?: Param; name: string }

function parseRawValue(v: string): Raw {
  const t = v.trim();
  if (/^-?\d+$/.test(t)) return Number(t);
  if (t === 'true' || t === 'false') return t === 'true';
  return t;
}

function plan(p: Profile | undefined, pairs: string[]): Step[] {
  return pairs.map((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 1) throw new UsageError(`expected name=value, got "${pair}"`);
    const name = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1);
    const param = p?.params.find((x) => x.name === name.toLowerCase() || x.code.toLowerCase() === name.toLowerCase());
    if (param) {
      try { return { code: param.code, raw: param.parse(val), param, name: param.name }; } catch (err) { throw new UsageError((err as Error).message); }
    }
    if (/^D[0-9A-F]{2}[0-9A-Z]{3}$/i.test(name) && (!p || opt.raw)) return { code: name.toUpperCase(), raw: parseRawValue(val), name: name.toUpperCase() };
    if (!p) throw new UsageError(`"${name}": this model has no profile, so only raw D-codes can be set (e.g. D03105=0)`);
    throw new UsageError(`unknown parameter "${name}"; run: air.mts list${/^D[0-9A-F]/i.test(name) ? ' (or pass --raw to write a D-code outside the profile)' : ''}`);
  });
}

interface Result { name: string; code: string; from: string; to: string; sent: boolean; ok: boolean | null; note?: string; device_says?: string }

async function set(): Promise<number> {
  if (!args.length) throw new UsageError('set needs name=value pairs');
  // An unsaved address has no device_id to check: a reassigned IP would take
  // the write. --host stays read-only.
  if (opt.host) throw new UsageError('--host is read-only diagnostics; pair the device (setup.mts pair <ip>) to change it');
  const verify = !opt['no-verify'];
  const docs: unknown[] = [];
  const code = await each(async (t) => {
    warnRaw(t);
    const steps = plan(t.profile, args);
    const label = (st: Step, raw: Raw) => (raw === undefined ? '?' : st.param ? st.param.label(raw) : JSON.stringify(raw));
    const link = await openLink(t);
    const results: Result[] = [];
    try {
      // Listen first, so the notification each write causes is not missed.
      if (verify) await link.listen();
      const cached = t.dev ? await readCache(t.dev.key) : null;
      const before: State = link.latest()?.state ?? cached?.state ?? {};

      for (const st of steps) {
        const dep = st.param?.requires;
        if (!dep || !t.profile) continue;
        const other = t.profile.params.find((x) => x.name === dep.param);
        const inPlan = steps.find((x) => x.param === other);
        const effective = inPlan ? inPlan.raw : other ? before[other.code] : undefined;
        if (other && effective !== undefined && effective !== other.values[dep.value]) {
          warn(`note: ${st.name} only shows while ${dep.param}=${dep.value} (now ${other.label(effective)}); add ${dep.param}=${dep.value} to see it`);
        }
      }

      // Values the device may already have are written anyway: the cache can
      // be stale, and an unchanged value costs nothing.
      const mark = link.mark();
      for (const st of steps) {
        const r: Result = { name: st.name, code: st.code, from: label(st, before[st.code]), to: label(st, st.raw), sent: false, ok: null };
        results.push(r);
        if (!opt.json) out(`  ${st.name}: ${r.from} -> ${r.to}  (${st.code}=${JSON.stringify(st.raw)})`);
        r.sent = await link.client.control({ [st.code]: st.raw });
        if (!r.sent) { r.ok = false; warn(`  ${st.name}: the device rejected the command`); }
        if (steps.length > 1) await sleep(1000);
      }

      const sent = results.filter((r) => r.sent);
      if (verify && sent.length) {
        const want = Object.fromEntries(sent.map((r) => [r.code, steps.find((x) => x.code === r.code)!.raw]));
        const all = (s: State) => Object.entries(want).every(([k, v]) => s[k] === v);
        const after = (await link.next(CONFIRM_MS, all, mark)) ?? link.latest(mark)?.state ?? null;
        if (!opt.json) out('verifying:');
        for (const r of sent) {
          const raw = want[r.code];
          if (after) {
            r.ok = after[r.code] === raw;
            if (!r.ok) r.device_says = label(steps.find((x) => x.code === r.code)!, after[r.code]);
          } else if (before[r.code] === raw) {
            // No notification at all: the device notifies only on change.
            r.ok = true;
            r.note = 'already set — the device reports only changes';
          } else {
            r.ok = false;
            r.note = 'accepted, but the device sent no report — another client (the Air+ app?) may hold its status subscription';
          }
          if (!opt.json) out(`  ${r.name.padEnd(18)} ${r.ok ? `ok${r.note ? ` (${r.note})` : ''}` : r.device_says !== undefined ? `MISMATCH (device reports ${r.device_says})` : `NOT CONFIRMED (${r.note})`}`);
        }
      }
    } finally {
      await link.close();
    }
    const failed = results.some((r) => r.ok === false);
    if (opt.json) docs.push({ device: t.key, results, ok: !failed });
    return failed ? EXIT.MISMATCH : EXIT.OK;
  });
  if (opt.json) out(docs.length === 1 ? docs[0] : docs);
  return code;
}

// ---------------------------------------------------------------- watch / list / info

const NOISY = new Set(['Runtime', 'free_memory', 'rssi']);

async function watch(): Promise<number> {
  const seconds = args[0] === undefined ? 60 : Number(args[0]);
  if (!(seconds >= 0)) throw new UsageError('watch [seconds ≥ 0]');
  const ts = await targets();
  if (ts.length !== 1) throw new UsageError('watch follows one device; pick it with -d');
  const t = ts[0];
  warnRaw(t);
  const link = await openLink(t);
  let prev: State | undefined = t.dev ? (await readCache(t.dev.key))?.state : undefined;
  const t0 = Date.now();
  let printed = 0;
  const unsubscribe = link.onReport(({ state: cur }) => {
    const at = Math.round((Date.now() - t0) / 1000);
    if (prev) {
      for (const [k, v] of Object.entries(cur)) {
        if (NOISY.has(k) || t.profile?.quiet.includes(k) || prev[k] === v) continue;
        const p = t.profile?.params.find((x) => x.code === k);
        const r = t.profile && [...t.profile.sensors, ...t.profile.info].find((x) => x.code === k);
        const name = p?.name ?? r?.name ?? k;
        const fmt = (x: Raw) => (p ? p.label(x) : r?.format ? (r.format(x, cur) ?? String(x)) : JSON.stringify(x));
        if (opt.json) out(JSON.stringify({ t: at, field: name, code: k, from: prev[k], to: v }));
        else out(`[${String(at).padStart(5)}s] ${name.padEnd(16)} ${fmt(prev[k])} -> ${fmt(v)}`);
        printed++;
      }
    }
    prev = cur;
  });
  let stop = false;
  process.once('SIGINT', () => { stop = true; });
  try {
    await link.listen();
    if (!opt.json) out(`watching ${t.title} ${seconds ? `for ${seconds}s` : 'until Ctrl-C'} — printing changes as the device reports them`);
    while (!stop && (!seconds || Date.now() - t0 < seconds * 1000)) await sleep(250);
    if (!printed && !opt.json) out(`no changes reported in ${Math.round((Date.now() - t0) / 1000)} s`);
  } finally {
    unsubscribe();
    await link.close();
  }
  return EXIT.OK;
}

async function list(): Promise<number> {
  // Offline for saved devices: the model is in the config.
  const ts = await targets();
  const docs = ts.map((t) => ({
    device: t.key,
    profile: t.profile?.id ?? null,
    params: t.profile?.params.map((p) => ({ name: p.name, code: p.code, values: p.choices(), doc: p.doc })) ?? [],
  }));
  if (opt.json) { out(docs.length === 1 ? docs[0] : docs); return EXIT.OK; }
  for (const t of ts) {
    if (ts.length > 1) out(`\n## ${t.title} (${t.key})`);
    out(t.profile ? listText(t.profile) : `no profile for this model — raw mode: read with "status --raw", write with "set D0xxxx=value"`);
  }
  return EXIT.OK;
}

async function info(): Promise<number> {
  const docs: unknown[] = [];
  const cfg = await loadConfig();
  const code = await each(async (t) => {
    let ip = t.host!;
    let i;
    if (t.dev) {
      const o = await openSaved(cfg, t.dev, { log }, undefined, warn);
      o.client.close();
      ip = o.device.ip;
      i = o.info;
    } else {
      const c = new AirClient(ip, { log });
      try { i = await c.info(); } finally { c.close(); }
    }
    if (opt.json) docs.push({ device: t.key, ip, ...i });
    else out(Object.entries({ device: t.key, ip, ...i }).map(([k, v]) => `${k.padEnd(11)} ${v}`).join('\n'));
    return EXIT.OK;
  });
  if (opt.json) out(docs.length === 1 ? docs[0] : docs);
  return code;
}

await main(async () => {
  if (opt.help || !cmd) { out(USAGE); return cmd ? EXIT.OK : EXIT.USAGE; }
  switch (cmd) {
    case 'status': return status();
    case 'get': return get();
    case 'set': return set();
    case 'watch': return watch();
    case 'list': return list();
    case 'info': return info();
    default: throw new UsageError(`unknown command "${cmd}"`, true);
  }
}, USAGE);
