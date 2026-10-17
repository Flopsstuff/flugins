#!/usr/bin/env node
// setup.mts — onboarding for Philips air devices on the local network: find
// them, pair one (prove an encrypted session works) and keep the list of
// saved devices tidy. Day-to-day control is air.mts.
//
// "Pairing" is not a real pairing: the protocol secret is built in and the
// session key comes from /sys/dev/sync. Pairing = find the device, sync,
// prove the encrypted session with a no-op control, register for status and
// save the device under a name.
//
// Requires Node 22.18+ / 23.6+ (runs .mts directly). No dependencies.

import { parseArgs } from 'node:util';
import { AirClient, ProtocolError } from './lib/client.mts';
import type { State } from './lib/client.mts';
import { Link, dropState, moveState } from './lib/session.mts';
import { configPath, findDevice, loadConfig, saveConfig, selectDevices, slug } from './lib/config.mts';
import type { Config, SavedDevice } from './lib/config.mts';
import { EXIT, UsageError, main, warn } from './lib/cli.mts';
import { profileFor } from './lib/models/index.mts';
import { PHILIPS_OUIS, allLocalHosts, arpTable, isIPv4, localSubnets, scan } from './lib/net.mts';
import type { Candidate } from './lib/net.mts';
import { readable } from './lib/render.mts';

const USAGE = `usage: node setup.mts <command> [options]

  discover [--subnet CIDR] [--timeout ms] [--multicast] [--json]
                                   find devices on the LAN (GET /sys/dev/info to every host)
  pair <ip> [--as key] [--alias a]... [--default] [--json]
                                   sync, check encryption, register for status, save
  devices [--json]                 saved devices
  alias <device> <alias>...        add aliases        unalias <device> <alias>...
  rename <device> <new-key>        change the config key
  default <device>                 device used when -d is omitted
  forget <device>                  remove a saved device

config: ${configPath()}`;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    subnet: { type: 'string' },
    timeout: { type: 'string' },
    multicast: { type: 'boolean' },
    json: { type: 'boolean' },
    as: { type: 'string' },
    alias: { type: 'string', multiple: true },
    default: { type: 'boolean' },
    verbose: { type: 'boolean', short: 'v' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [cmd, ...args] = positionals;
const log = opt.verbose ? warn : () => {};
const out = (s: unknown) => console.log(typeof s === 'string' ? s : JSON.stringify(s, null, 2));

function savedKeyFor(cfg: Config, deviceId: string | undefined): string | undefined {
  return Object.values(cfg.devices).find((d) => d.device_id === deviceId)?.key;
}

function need(n: number, what: string): void {
  if (args.length < n) throw new UsageError(`${cmd} needs ${what}`);
}

/** Exactly one device: `all` and a,b lists are for air.mts, not for edits. */
function mustFind(cfg: Config, q: string): SavedDevice {
  if (q.trim().toLowerCase() === 'all' || q.includes(',')) throw new UsageError(`${cmd} works on one device; name it instead of "${q}"`);
  return selectDevices(cfg, q)[0];
}

async function discover(): Promise<number> {
  const timeoutMs = opt.timeout === undefined ? 2500 : Number(opt.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new UsageError(`--timeout needs milliseconds > 0, got "${opt.timeout}"`);
  const hosts = allLocalHosts(opt.subnet);
  if (!hosts.length) throw new Error('no active IPv4 interface found; pass --subnet 192.168.1.0/24');
  if (!opt.json) {
    const nets = opt.subnet ? opt.subnet : localSubnets().map((s) => `${s.address}/${s.prefix} (${s.iface})`).join(', ');
    warn(`scanning ${hosts.length} addresses on ${nets}${opt.multicast ? ' + multicast 224.0.1.187' : ''} …`);
  }
  const found = await scan({ hosts, timeoutMs, multicast: !!opt.multicast });
  const cfg = await loadConfig();
  const rows = found.map((c: Candidate) => ({
    ip: c.ip,
    mac: c.mac ?? null,
    philips_oui: c.mac ? PHILIPS_OUIS.some((p) => c.mac!.startsWith(p)) : null,
    model: c.info.modelid ?? null,
    name: c.info.name ?? null,
    type: c.info.type ?? null,
    device_id: c.info.device_id ?? null,
    profile: profileFor(c.info.modelid)?.id ?? null,
    saved_as: savedKeyFor(cfg, c.info.device_id) ?? null,
    via: c.via,
  }));
  if (opt.json) { out({ devices: rows }); return rows.length ? EXIT.OK : EXIT.UNREACHABLE; }
  if (!rows.length) {
    out('no devices answered /sys/dev/info. Check that the device is powered, joined to Wi-Fi via the Air+ app, and on the same subnet (or pass --subnet).');
    return EXIT.UNREACHABLE;
  }
  rows.forEach((r, i) => {
    out(`${i + 1}. ${r.name ?? '?'} — ${r.model ?? '?'} (${r.type ?? '?'})`);
    out(`   ip ${r.ip}   mac ${r.mac ?? 'unknown'}${r.philips_oui ? ' (Philips OUI)' : ''}`);
    out(`   device_id ${r.device_id ?? '?'}`);
    out(`   ${r.profile ? `profile ${r.profile}` : 'no profile for this model — raw mode only'}${r.saved_as ? `   already saved as "${r.saved_as}"` : ''}`);
  });
  return EXIT.OK;
}

async function pair(): Promise<number> {
  need(1, 'the device IP (from discover)');
  const ip = args[0];
  if (!isIPv4(ip)) throw new UsageError(`"${ip}" is not an IPv4 address`);
  const probe = new AirClient(ip, { log });
  let info;
  try { info = await probe.info(); } finally { probe.close(); }
  if (!info.device_id) throw new Error('the device did not report a device_id; cannot save it');
  if (!opt.json) warn(`found ${info.name ?? '?'} — ${info.modelid ?? '?'} at ${ip}; syncing …`);

  const cfg = await loadConfig();
  const existing = savedKeyFor(cfg, info.device_id);
  const key = existing ?? slug(opt.as ?? info.name ?? info.modelid ?? 'device');
  if (!existing && cfg.devices[key]) throw new UsageError(`a different device is already saved as "${key}"; choose another with --as`);
  // Same rule as the alias command: a name may resolve to one device only.
  for (const name of [key, ...(opt.alias ?? [])]) {
    const other = findDevice(cfg, name);
    if (other && other.key !== key) throw new UsageError(`"${name}" already points to ${other.key}; choose another`);
  }

  // An empty control is the encryption check: the device answers "failed" to
  // an envelope it cannot decrypt, and changes nothing either way. Then
  // register for status from the port later runs will reuse; the device may
  // or may not answer the registration right away.
  const link = await Link.open({ key, ip }, log);
  let state: State | null;
  try {
    if (!(await link.client.control({}, 1))) throw new ProtocolError(`${info.name ?? ip} syncs but rejects encrypted commands — not saved. Unplug it for 10 s and try again`);
    if (!opt.json) warn('encrypted session OK; registering for status …');
    await link.listen();
    state = await link.next(12_000);
  } catch (err) {
    if (!existing) await dropState(key);
    throw err;
  } finally {
    await link.close();
  }
  const prev = existing ? cfg.devices[existing] : undefined;
  const mac = (await arpTable()).get(ip) ?? prev?.mac;
  const now = new Date().toISOString();
  const dev: SavedDevice = {
    key,
    name: info.name ?? prev?.name ?? key,
    aliases: [...new Set([...(prev?.aliases ?? []), ...(opt.alias ?? [])])],
    ip,
    mac,
    model: info.modelid ?? 'unknown',
    type: info.type,
    device_id: info.device_id,
    product_id: info.product_id,
    swversion: info.swversion,
    paired_at: prev?.paired_at ?? now,
    last_seen: now,
  };
  cfg.devices[key] = dev;
  if (opt.default || !cfg.default || !cfg.devices[cfg.default]) cfg.default = key;
  await saveConfig(cfg);

  const profile = profileFor(dev.model);
  if (opt.json) {
    out({ saved: dev, default: cfg.default === key, profile: profile?.id ?? null, state: state && profile ? readable(profile, state) : state, config: configPath() });
    return EXIT.OK;
  }
  out(`${existing ? 'updated' : 'saved'} "${key}" — ${dev.name}, ${dev.model}, ${ip}${mac ? `, ${mac}` : ''}`);
  if (!state) out('no status yet: the device answers a fresh read only every 15–20 minutes, but reports every change — air.mts will show it once it does');
  else if (profile) {
    const r = readable(profile, state);
    const show = ['power', 'mode', 'humidity-target'].filter((n) => r.params[n]).map((n) => `${n}=${r.params[n].value}`);
    const sens = ['humidity', 'temperature'].filter((n) => r.sensors[n]).map((n) => `${n} ${r.sensors[n]}`);
    out(`now: ${[...show, ...sens].join(', ')}`);
  } else {
    out(`status: ${Object.keys(state).length} fields`);
  }
  if (!profile) warn(`warning: no profile for model ${dev.model} — air.mts will work in raw mode (get/set by D-code, no value checks)`);
  if (cfg.default === key) out(`default device: ${key}`);
  out(`config: ${configPath()}`);
  return EXIT.OK;
}

async function devices(): Promise<number> {
  const cfg = await loadConfig();
  const list = Object.values(cfg.devices);
  if (opt.json) { out({ default: cfg.default ?? null, devices: list, config: configPath() }); return list.length ? EXIT.OK : EXIT.NOT_CONFIGURED; }
  if (!list.length) { out(`no saved devices (config: ${configPath()}). Run: setup.mts discover`); return EXIT.NOT_CONFIGURED; }
  for (const d of list) {
    out(`${d.key}${cfg.default === d.key ? '  (default)' : ''}`);
    out(`   ${d.name} — ${d.model}${profileFor(d.model) ? '' : '  [raw mode]'}   ip ${d.ip}   mac ${d.mac ?? '?'}`);
    if (d.aliases.length) out(`   aliases: ${d.aliases.join(', ')}`);
  }
  out(`config: ${configPath()}`);
  return EXIT.OK;
}

async function edit(fn: (cfg: Config) => string | Promise<string>): Promise<number> {
  const cfg = await loadConfig();
  const msg = await fn(cfg);
  await saveConfig(cfg);
  out(msg);
  return EXIT.OK;
}

await main(async () => {
  if (opt.help || !cmd) { out(USAGE); return cmd ? EXIT.OK : EXIT.USAGE; }
  switch (cmd) {
    case 'discover': return discover();
    case 'pair': return pair();
    case 'devices': case 'list': return devices();
    case 'alias':
      need(2, '<device> <alias>...');
      return edit((cfg) => {
        const d = mustFind(cfg, args[0]);
        for (const a of args.slice(1)) {
          const other = findDevice(cfg, a);
          if (other && other.key !== d.key) throw new UsageError(`"${a}" already points to ${other.key}`);
        }
        d.aliases = [...new Set([...d.aliases, ...args.slice(1)])];
        return `${d.key}: aliases ${d.aliases.join(', ')}`;
      });
    case 'unalias':
      need(2, '<device> <alias>...');
      return edit((cfg) => {
        const d = mustFind(cfg, args[0]);
        const drop = new Set(args.slice(1).map((a) => a.toLowerCase()));
        d.aliases = d.aliases.filter((a) => !drop.has(a.toLowerCase()));
        return `${d.key}: aliases ${d.aliases.join(', ') || '(none)'}`;
      });
    case 'rename':
      need(2, '<device> <new-key>');
      return edit(async (cfg) => {
        const d = mustFind(cfg, args[0]);
        const key = slug(args[1]);
        if (cfg.devices[key] && key !== d.key) throw new UsageError(`"${key}" is taken`);
        // A key wins over aliases and names in findDevice: it must not capture another device's.
        const other = findDevice(cfg, key);
        if (other && other.key !== d.key) throw new UsageError(`"${key}" already points to ${other.key}; choose another`);
        // The cache and the registration's port are keyed by name.
        if (key !== d.key) await moveState(d.key, key);
        delete cfg.devices[d.key];
        if (cfg.default === d.key) cfg.default = key;
        const old = d.key;
        d.key = key;
        cfg.devices[key] = d;
        return `renamed ${old} → ${key}`;
      });
    case 'default':
      need(1, '<device>');
      return edit((cfg) => { const d = mustFind(cfg, args[0]); cfg.default = d.key; return `default device: ${d.key}`; });
    case 'forget':
      need(1, '<device>');
      return edit(async (cfg) => {
        const d = mustFind(cfg, args[0]);
        await dropState(d.key);
        delete cfg.devices[d.key];
        if (cfg.default === d.key) cfg.default = Object.keys(cfg.devices)[0];
        return `forgot ${d.key}${cfg.default ? `; default is now ${cfg.default}` : ''}`;
      });
    default:
      throw new UsageError(`unknown command "${cmd}"`, true);
  }
}, USAGE);
