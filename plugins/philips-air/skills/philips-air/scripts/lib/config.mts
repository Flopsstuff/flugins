// config.mts — saved devices. One JSON file, by default
// ${XDG_CONFIG_HOME:-~/.config}/philips-air/devices.json, overridable with
// $PHILIPS_AIR_CONFIG. Holds no secrets: the protocol key is negotiated per
// session, so the file only maps names to devices.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export interface SavedDevice {
  /** config key, e.g. "living-room" */
  key: string;
  /** name the device reports (/sys/dev/info "name") */
  name: string;
  aliases: string[];
  ip: string;
  mac?: string;
  model: string;
  type?: string;
  device_id: string;
  product_id?: string;
  swversion?: string;
  paired_at: string;
  last_seen?: string;
}

export interface Config {
  version: 1;
  default?: string;
  devices: Record<string, SavedDevice>;
}

export function configPath(): string {
  if (process.env.PHILIPS_AIR_CONFIG) return process.env.PHILIPS_AIR_CONFIG;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'philips-air', 'devices.json');
}

export async function loadConfig(): Promise<Config> {
  try {
    const c = JSON.parse(await readFile(configPath(), 'utf8'));
    return { version: 1, default: c.default, devices: c.devices ?? {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, devices: {} };
    throw new Error(`cannot read ${configPath()}: ${(err as Error).message}`);
  }
}

export async function saveConfig(c: Config): Promise<void> {
  const file = configPath();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(c, null, 2) + '\n');
  await rename(tmp, file);
}

/** "Living room" → "living-room"; keeps non-Latin letters. */
export function slug(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'device';
}

const norm = (s: string) => s.normalize('NFKC').toLowerCase().trim();

/** Find a device by key, alias or reported name (case-insensitive). */
export function findDevice(c: Config, query: string): SavedDevice | undefined {
  const q = norm(query);
  const all = Object.values(c.devices);
  return c.devices[query]
    ?? all.find((d) => norm(d.key) === q)
    ?? all.find((d) => d.aliases.some((a) => norm(a) === q))
    ?? all.find((d) => norm(d.name) === q)
    ?? all.find((d) => slug(d.name) === slug(query));
}

export class SelectError extends Error {
  constructor(message: string) { super(message); this.name = 'SelectError'; }
}

/**
 * Resolve a selector to devices: a name/alias, a comma list, "all", or
 * nothing (the default device, or the only one).
 */
export function selectDevices(c: Config, selector: string | undefined): SavedDevice[] {
  const all = Object.values(c.devices);
  if (!all.length) throw new SelectError('no devices are set up yet — run the onboarding: setup.mts discover, then setup.mts pair <ip>');
  if (!selector) {
    if (c.default && c.devices[c.default]) return [c.devices[c.default]];
    if (all.length === 1) return all;
    throw new SelectError(`several devices are saved (${all.map((d) => d.key).join(', ')}); pick one with -d <name>, or set a default: setup.mts default <name>`);
  }
  if (norm(selector) === 'all') return all;
  return selector.split(',').map((s) => {
    const d = findDevice(c, s);
    if (!d) throw new SelectError(`no saved device called "${s}"; saved: ${all.map((x) => [x.key, ...x.aliases].join('/')).join(', ')}`);
    return d;
  });
}
