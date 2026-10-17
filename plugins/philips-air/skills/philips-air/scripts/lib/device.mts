// device.mts — open a session with a saved device. DHCP can move it, so when
// it does not answer at the saved IP (or someone else answers there), look it
// up again by MAC in the ARP table, then by device_id across the subnet, and
// write the new address back to the config.

import { AirClient } from './client.mts';
import type { CoapSocket } from './coap.mts';
import type { ClientOptions, DeviceInfo } from './client.mts';
import { saveConfig } from './config.mts';
import type { Config, SavedDevice } from './config.mts';
import { allLocalHosts, arpTable, scan } from './net.mts';

export class UnreachableError extends Error {
  constructor(message: string) { super(message); this.name = 'UnreachableError'; }
}

async function probe(ip: string, opts: ClientOptions, tries = 2): Promise<DeviceInfo | null> {
  // Info needs no observer, so a throwaway port is fine.
  const c = new AirClient(ip, { ...opts, localPort: 0 });
  try {
    for (let i = 0; i < tries; i++) {
      try { return await c.info(1500); } catch { /* retry */ }
    }
    return null;
  } finally {
    c.close();
  }
}

export interface Opened { client: AirClient; info: DeviceInfo; device: SavedDevice }

/** `notify` hears about relocation (always worth telling the user); `opts.log` gets protocol chatter. */
export async function openSaved(cfg: Config, dev: SavedDevice, opts: ClientOptions = {}, sock?: CoapSocket, notify?: (line: string) => void): Promise<Opened> {
  const log = notify ?? opts.log ?? (() => {});
  const matches = (i: DeviceInfo | null) => !!i && i.device_id === dev.device_id;

  let ip = dev.ip;
  let info = await probe(ip, opts);
  if (!matches(info)) {
    log(info
      ? `${dev.ip} now answers as ${info.name ?? info.device_id}, not ${dev.name}; searching the LAN`
      : `${dev.name} does not answer at ${dev.ip}; searching the LAN`);
    info = null;
    if (dev.mac) {
      for (const [addr, mac] of await arpTable()) {
        if (mac !== dev.mac || addr === dev.ip) continue;
        const i = await probe(addr, opts);
        if (matches(i)) { ip = addr; info = i; break; }
      }
    }
    if (!info) {
      const hit = (await scan({ hosts: allLocalHosts(), stopOn: (c) => c.info.device_id === dev.device_id }))
        .find((c) => c.info.device_id === dev.device_id);
      if (hit) { ip = hit.ip; info = hit.info; if (hit.mac) dev.mac = hit.mac; }
    }
    if (!info) throw new UnreachableError(`${dev.name} (${dev.key}) is not reachable: no answer at ${dev.ip} and not found on the local subnet — is it powered and on Wi-Fi?`);
    log(`found ${dev.name} at ${ip} (was ${dev.ip}); config updated`);
    dev.ip = ip;
    dev.last_seen = new Date().toISOString();
    cfg.devices[dev.key] = dev;
    await saveConfig(cfg);
  }
  return { client: new AirClient(ip, opts, sock), info: info!, device: dev };
}
