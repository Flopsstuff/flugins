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
//   node air.mts observer [stop|restart]  the background observer
//
// Reads never hit the device directly: a per-device background observer
// (observer.mts, started on demand) holds one status subscription and caches
// every notification, because the device stops answering status after a few
// short-lived subscriptions. Writes go straight to /sys/dev/control and are
// verified against the next notification.
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
import { ageSeconds, currentState, files, idleMinutes, observerPid, readCache, startObserver, stopObserver, touch, waitForCache } from './lib/observer.mts';
import { filterSummary, listText, rawText, readable, sensorValue, statusText } from './lib/render.mts';

const USAGE = `usage: node air.mts <command> [-d device] [--json]

  status [--raw]                  current state, sensors and filters
  list                            writable parameters of the device's model
  get <name|code>...              read single fields (params, sensors, filters, raw D-codes)
  set <name=value>... [--raw] [--no-verify]
                                  write, then confirm from the next notification
  watch [seconds]                 print changes as the device reports them (0 = until Ctrl-C)
  info                            unencrypted /sys/dev/info
  observer [stop|restart]         state of the background observer, or stop/restart it

  -d, --device <name|alias|a,b|all>   which saved device(s); default: the default one
  --host <ip>                         read an unsaved device directly (diagnostics)
  --raw                               status: every field untouched; set: allow D-codes outside the profile
  -v, --verbose                       protocol chatter on stderr`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    device: { type: 'string', short: 'd' },
    host: { type: 'string' },
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

/** A device to act on: a saved one (read through its observer) or --host (read directly). */
interface Target { key: string; title: string; profile?: Profile; model?: string; dev?: SavedDevice; host?: string }

interface Snapshot { state: State; age: number; ip: string }

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

async function snapshot(t: Target): Promise<Snapshot> {
  if (t.dev) {
    const c = await currentState(t.dev.key, t.dev.ip, log);
    return { state: c.state, age: ageSeconds(c), ip: c.ip };
  }
  // --host: one direct read. Costs the device a subscription; fine for a one-off.
  const c = new AirClient(t.host!, { log });
  try { return { state: await c.status(), age: 0, ip: t.host! }; } finally { c.close(); }
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

const ageNote = (age: number) => (age >= 5 ? `last report from the device ${age < 120 ? `${age} s` : `${Math.round(age / 60)} min`} ago (it reports on change)` : null);

// ---------------------------------------------------------------- read

async function status(): Promise<number> {
  const docs: unknown[] = [];
  const code = await each(async (t) => {
    warnRaw(t);
    const { state: s, age } = await snapshot(t);
    if (opt.json) {
      docs.push({ device: t.key, name: t.title, model: t.model, profile: t.profile?.id ?? null, age_s: age, ...(t.profile && !opt.raw ? readable(t.profile, s) : {}), state: s });
    } else {
      out(opt.raw || !t.profile ? rawText(s, t.title) : statusText(t.profile, s, t.title));
      const note = ageNote(age);
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
    const { state: s, age } = await snapshot(t);
    const res: Record<string, unknown> = {};
    let missing = 0;
    for (const want of args) {
      const r = lookup(t.profile, s, want);
      if (!r) missing++;
      res[want] = r;
      if (!opt.json) out(r ? `${r.name} = ${r.value}${r.code && String(r.raw) !== r.value ? `  (raw ${JSON.stringify(r.raw)}, ${r.code})` : ''}` : `${want}: unknown field`);
    }
    if (opt.json) docs.push({ device: t.key, age_s: age, fields: res });
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

/** Wait until every sent value shows up in the device's own reports. */
async function confirm(t: Target, want: Record<string, Raw>, timeoutMs: number): Promise<State> {
  if (t.dev) {
    const ok = (s: State) => Object.entries(want).every(([k, v]) => s[k] === v);
    const c = await waitForCache(t.dev.key, timeoutMs, (x) => ok(x.state));
    return (c ?? await readCache(t.dev.key))?.state ?? {};
  }
  await sleep(1500);
  return (await snapshot(t)).state;
}

async function set(): Promise<number> {
  if (!args.length) throw new UsageError('set needs name=value pairs');
  const docs: unknown[] = [];
  const code = await each(async (t) => {
    warnRaw(t);
    const steps = plan(t.profile, args);
    const snap = await snapshot(t);
    const before = snap.state;
    const label = (st: Step, raw: Raw) => (st.param ? st.param.label(raw) : JSON.stringify(raw));

    for (const st of steps) {
      const dep = st.param?.requires;
      if (!dep || !t.profile) continue;
      const other = t.profile.params.find((x) => x.name === dep.param);
      const inPlan = steps.find((x) => x.param === other);
      const effective = inPlan ? inPlan.raw : other ? before[other.code] : undefined;
      if (other && effective !== other.values[dep.value]) {
        warn(`note: ${st.name} only shows while ${dep.param}=${dep.value} (now ${other.label(effective)}); add ${dep.param}=${dep.value} to see it`);
      }
    }

    // Control is a plain request/response — it never needs a subscription.
    let ip = snap.ip;
    if (t.dev) ip = (await openSaved(await loadConfig(), { ...t.dev, ip }, { log }, undefined, warn).then((o) => { o.client.close(); return o.device.ip; }));
    const client = new AirClient(ip, { log });
    const results: { name: string; code: string; from: string; to: string; sent: boolean; ok: boolean | null; device_says?: string }[] = [];
    try {
      for (const st of steps) {
        const was = before[st.code];
        const r = { name: st.name, code: st.code, from: label(st, was), to: label(st, st.raw), sent: false, ok: null as boolean | null };
        results.push(r);
        if (was === st.raw) { if (!opt.json) out(`  ${st.name}: already ${r.to}`); r.ok = true; continue; }
        if (!opt.json) out(`  ${st.name}: ${r.from} -> ${r.to}  (${st.code}=${JSON.stringify(st.raw)})`);
        r.sent = await client.control({ [st.code]: st.raw });
        if (!r.sent) { r.ok = false; warn(`  ${st.name}: the device rejected the command`); }
        if (steps.length > 1) await sleep(1000);
      }
    } finally {
      client.close();
    }

    let mismatch = results.some((r) => r.ok === false);
    const sent = results.filter((r) => r.sent);
    if (!opt['no-verify'] && sent.length) {
      const want = Object.fromEntries(sent.map((r) => [r.code, steps.find((x) => x.code === r.code)!.raw]));
      const after = await confirm(t, want, 10_000);
      if (!opt.json) out('verifying:');
      for (const r of sent) {
        const st = steps.find((x) => x.code === r.code)!;
        r.ok = after[r.code] === st.raw;
        if (!r.ok) { mismatch = true; r.device_says = label(st, after[r.code]); }
        if (!opt.json) out(`  ${r.name.padEnd(18)} ${r.ok ? 'ok' : `MISMATCH (device still reports ${r.device_says})`}`);
      }
    }
    if (opt.json) docs.push({ device: t.key, results, ok: !mismatch });
    return mismatch ? EXIT.MISMATCH : EXIT.OK;
  });
  if (opt.json) out(docs.length === 1 ? docs[0] : docs);
  return code;
}

// ---------------------------------------------------------------- watch / list / info / observer

const NOISY = new Set(['Runtime', 'free_memory', 'rssi']);

async function watch(): Promise<number> {
  const seconds = args[0] === undefined ? 60 : Number(args[0]);
  if (!(seconds >= 0)) throw new UsageError('watch [seconds ≥ 0]');
  const ts = await targets();
  if (ts.length !== 1 || !ts[0].dev) throw new UsageError('watch follows one saved device; pick it with -d');
  const t = ts[0];
  const key = t.dev!.key;
  warnRaw(t);
  let stop = false;
  process.once('SIGINT', () => { stop = true; });
  let prev = (await currentState(key, t.dev!.ip, log)).state;
  let seen = (await readCache(key))?.updated_at;
  const t0 = Date.now();
  if (!opt.json) out(`watching ${t.title} ${seconds ? `for ${seconds}s` : 'until Ctrl-C'} — printing changes as the device reports them`);
  let lastTouch = Date.now();
  while (!stop && (!seconds || Date.now() - t0 < seconds * 1000)) {
    await sleep(1000);
    if (Date.now() - lastTouch > 30_000) { await touch(key); lastTouch = Date.now(); }
    const c = await readCache(key);
    if (!c || c.updated_at === seen) continue;
    seen = c.updated_at;
    const cur = c.state;
    const at = Math.round((Date.now() - t0) / 1000);
    for (const [k, v] of Object.entries(cur)) {
      if (NOISY.has(k) || t.profile?.quiet.includes(k) || prev[k] === v) continue;
      const p = t.profile?.params.find((x) => x.code === k);
      const r = t.profile && [...t.profile.sensors, ...t.profile.info].find((x) => x.code === k);
      const name = p?.name ?? r?.name ?? k;
      const fmt = (x: Raw) => (p ? p.label(x) : r?.format ? (r.format(x, cur) ?? String(x)) : JSON.stringify(x));
      if (opt.json) out(JSON.stringify({ t: at, field: name, code: k, from: prev[k], to: v }));
      else out(`[${String(at).padStart(5)}s] ${name.padEnd(16)} ${fmt(prev[k])} -> ${fmt(v)}`);
    }
    prev = cur;
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

async function observer(): Promise<number> {
  const action = args[0] ?? 'status';
  if (!['status', 'stop', 'restart', 'start'].includes(action)) throw new UsageError('observer [status|start|stop|restart]');
  const docs: unknown[] = [];
  const code = await each(async (t) => {
    if (!t.dev) throw new UsageError('observer works on saved devices');
    const key = t.dev.key;
    if (action === 'stop' || action === 'restart') await stopObserver(key);
    if (action === 'start' || action === 'restart') { await touch(key); await startObserver(key, t.dev.ip); await sleep(300); }
    const pid = await observerPid(key);
    const c = await readCache(key);
    const doc = { device: key, running: !!pid, pid, last_report_age_s: c ? ageSeconds(c) : null, registered_at: c?.registered_at ?? null, idle_exit_min: idleMinutes(), log: files(key).log };
    if (opt.json) docs.push(doc);
    else out(`${key}: observer ${pid ? `running (pid ${pid})` : 'not running'}${c ? `, last report ${ageSeconds(c)} s ago` : ''}; exits after ${idleMinutes() || '∞'} min without reads; log ${doc.log}`);
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
    case 'observer': return observer();
    default: throw new UsageError(`unknown command "${cmd}"`, true);
  }
}, USAGE);
