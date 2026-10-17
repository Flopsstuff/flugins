// net.mts — LAN discovery: enumerate the local IPv4 subnets, unicast
// GET /sys/dev/info to every address in parallel, and read MACs from the ARP
// table. Whoever answers with device JSON is a candidate — this finds
// look-alike devices with other vendor prefixes too, and needs no nmap.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import { CoapSocket, CODE } from './coap.mts';
import type { Received } from './coap.mts';
import { PATHS, parseInfo } from './client.mts';
import type { DeviceInfo } from './client.mts';

const run = promisify(execFile);

/** Philips OUIs seen on these devices. A hint only — never a filter. */
export const PHILIPS_OUIS = ['68:79:c4'];

/** CoAP "All CoAP Nodes" IPv4 group. Untested with Philips devices. */
export const COAP_MULTICAST = '224.0.1.187';

export interface Subnet { iface: string; address: string; prefix: number; hosts: string[] }

export interface Candidate {
  ip: string;
  mac?: string;
  info: DeviceInfo;
  via: 'unicast' | 'multicast' | 'direct';
}

const toInt = (ip: string) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
const toIp = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');

export function isIPv4(s: string): boolean {
  return /^(\d{1,3})(\.\d{1,3}){3}$/.test(s) && s.split('.').every((o) => Number(o) <= 255);
}

/** Every host address of a CIDR, minus network/broadcast and `exclude`. */
export function cidrHosts(cidr: string, exclude: string[] = []): string[] {
  const [base, bits] = cidr.split('/');
  const prefix = Number(bits ?? 24);
  if (!isIPv4(base) || !(prefix >= 16 && prefix <= 30)) throw new Error(`bad or too large subnet ${cidr} (allowed /16../30)`);
  const size = 2 ** (32 - prefix);
  const net = toInt(base) - (toInt(base) % size);
  const out: string[] = [];
  for (let i = 1; i < size - 1; i++) {
    const ip = toIp(net + i);
    if (!exclude.includes(ip)) out.push(ip);
  }
  return out;
}

/**
 * The active IPv4 subnets. Anything wider than /22 is narrowed to the /24
 * around our own address — a sweep of a /16 would take too long and the
 * device almost always sits next to us.
 */
export function localSubnets(): Subnet[] {
  const out: Subnet[] = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const real = Number(a.cidr?.split('/')[1] ?? 24);
      const prefix = real < 22 || real > 30 ? 24 : real;
      if (out.some((s) => s.hosts.includes(a.address))) continue;
      out.push({ iface, address: a.address, prefix, hosts: cidrHosts(`${a.address}/${prefix}`, [a.address]) });
    }
  }
  return out;
}

export function normalizeMac(mac: string): string {
  return mac.toLowerCase().split(/[:-]/).map((p) => p.padStart(2, '0')).join(':');
}

/** ip → MAC from the OS neighbour table. Empty map if it cannot be read. */
export async function arpTable(): Promise<Map<string, string>> {
  const table = new Map<string, string>();
  try {
    // Linux: /proc/net/arp — "IP address  HW type  Flags  HW address  Mask  Device"
    const text = await readFile('/proc/net/arp', 'utf8');
    for (const line of text.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 4 && cols[3] !== '00:00:00:00:00:00') table.set(cols[0], normalizeMac(cols[3]));
    }
    return table;
  } catch { /* not Linux */ }
  try {
    // macOS / BSD: "? (192.168.1.73) at 68:79:c4:f:b5:98 on en0 ifscope [ethernet]"
    // (macOS drops leading zeros in each octet; normalizeMac restores them)
    const { stdout } = await run('arp', ['-an'], { timeout: 5000 });
    for (const line of stdout.split('\n')) {
      const m = line.match(/\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f]{1,2}(?::[0-9a-f]{1,2}){5})/i);
      if (m) table.set(m[1], normalizeMac(m[2]));
    }
  } catch { /* no arp binary */ }
  return table;
}

export interface ScanOptions {
  hosts: string[];
  timeoutMs?: number;
  /** also ask the CoAP multicast group (experimental) */
  multicast?: boolean;
  /** resolve as soon as a device with this device_id answers */
  stopOn?: (c: Candidate) => boolean;
}

/**
 * Fire GET /sys/dev/info at every host from one socket, twice (the first
 * datagram to an unresolved neighbour can be lost while ARP resolves), and
 * collect the answers that look like Philips device JSON.
 */
export async function scan(opts: ScanOptions): Promise<Candidate[]> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const sock = new CoapSocket();
  const found = new Map<string, Candidate>();
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => { finish = resolve; });

  const onAnswer = (via: Candidate['via']) => (msg: Received) => {
    const info = parseInfo(msg);
    if (!info || found.has(msg.from.address)) return;
    const c: Candidate = { ip: msg.from.address, info, via };
    found.set(c.ip, c);
    if (opts.stopOn?.(c)) finish();
  };

  const fire = async (hosts: string[]) => {
    await Promise.all(hosts.map((host) =>
      sock.send({ host, code: CODE.GET, path: PATHS.INFO }, onAnswer('unicast')).catch(() => {})));
  };

  try {
    if (opts.multicast) {
      await sock.enableBroadcast();
      await sock.send({ host: COAP_MULTICAST, code: CODE.GET, path: PATHS.INFO }, onAnswer('multicast')).catch(() => {});
    }
    await fire(opts.hosts);
    const second = setTimeout(() => { fire(opts.hosts.filter((h) => !found.has(h))); }, Math.min(700, timeoutMs / 3));
    const stop = setTimeout(finish, timeoutMs);
    await done;
    clearTimeout(second);
    clearTimeout(stop);
  } finally {
    sock.close();
  }

  const arp = await arpTable();
  for (const c of found.values()) c.mac = arp.get(c.ip);
  return [...found.values()].sort((a, b) => toInt(a.ip) - toInt(b.ip));
}

export function allLocalHosts(subnet?: string): string[] {
  if (subnet) return cidrHosts(subnet.includes('/') ? subnet : `${subnet}/24`);
  return [...new Set(localSubnets().flatMap((s) => s.hosts))];
}
