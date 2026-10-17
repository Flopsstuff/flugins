// hu5710.mts — Philips HU5710 (2-in-1 purifier + humidifier, "Stargazer").
// Field codes from kongo09/philips-airpurifier-coap, checked on a live
// HU5710/00. The model has no PM2.5 or allergen sensor.

import { Param } from './types.mts';
import type { Profile, Raw } from './types.mts';

const ONOFF = { off: 0, on: 1 };

const timer: Record<string, number> = { off: 0 };
for (let h = 1; h <= 12; h++) timer[`${h}h`] = h + 1;

export const HU5710: Profile = {
  id: 'HU5710',
  title: 'Philips HU5710 humidifying purifier',
  match: (m) => /^HU5710\b/i.test(m),
  params: [
    new Param({ name: 'power', code: 'D03102', values: ONOFF, doc: 'main power' }),
    new Param({ name: 'mode', code: 'D0310C', values: { auto: 0, sleep: 17, medium: 19, high: 65 }, doc: 'preset; fan speed follows it' }),
    new Param({ name: 'backlight', code: 'D03105', values: { off: 0, medium: 115, on: 123 }, doc: 'display brightness' }),
    new Param({ name: 'lamp', code: 'D03135', values: { off: 0, humidity: 1, ambient: 2 }, doc: 'what the light ring shows' }),
    new Param({ name: 'ambient', code: 'D03137', values: { warm: 1, dawn: 2, calm: 3, breath: 4 }, doc: 'ambient light scene', requires: { param: 'lamp', value: 'ambient' } }),
    new Param({ name: 'humidity-target', code: 'D03128', range: [30, 70, 5], unit: '%', doc: 'target relative humidity' }),
    new Param({ name: 'timer', code: 'D03110', values: timer, doc: 'auto-off timer, 1h..12h' }),
    new Param({ name: 'beep', code: 'D03130', values: ONOFF, doc: 'button sounds' }),
    new Param({ name: 'childlock', code: 'D03103', values: ONOFF, doc: 'lock the control panel' }),
    new Param({ name: 'standby-sensors', code: 'D03134', values: ONOFF, doc: 'keep sensors running in standby' }),
    new Param({ name: 'auto-quickdry', code: 'D03138', values: ONOFF, doc: 'dry the wick automatically' }),
    new Param({ name: 'quickdry', code: 'D03139', values: ONOFF, doc: 'dry the wick now' }),
  ],
  sensors: [
    // Follows mode (sleep→1, medium→2, high→3); not writable.
    { code: 'D0310D', name: 'fan speed' },
    { code: 'D03125', name: 'humidity', format: (v) => `${v} %` },
    { code: 'D03224', name: 'temperature', format: (v) => `${(Number(v) / 10).toFixed(1)} °C` },
    { code: 'D0312B', name: 'humidifying', format: (v) => String(v) },
    { code: 'D03240', name: 'error code', format: (v) => (v === 0 ? '0 (no faults)' : `${v}  <-- CHECK`) },
    // D03211 keeps its last value after the timer is cleared, so it only
    // means something while D03110 is non-zero.
    { code: 'D03211', name: 'timer remaining', format: (v, s: Record<string, Raw>) => (s.D03110 ? `${v} min` : null) },
  ],
  info: [
    { code: 'D01S03', name: 'name' },
    { code: 'D01S05', name: 'model' },
    { code: 'D01S04', name: 'type' },
    { code: 'D01S12', name: 'firmware' },
    { code: 'WifiVersion', name: 'wifi stack' },
    { code: 'rssi', name: 'rssi', format: (v) => `${v} dBm` },
    { code: 'Runtime', name: 'uptime', format: (v) => (Number(v) < 3_600_000 ? `${Math.round(Number(v) / 60_000)} min` : `${(Number(v) / 3_600_000).toFixed(1)} h`) },
  ],
  filters: [
    { name: 'pre-filter', left: 'D0520D', total: 'D05207' },
    { name: 'NanoProtect', left: 'D0540E', total: 'D05408' },
  ],
  // D03104 mirrors D03105 (backlight): observed, not documented.
  quiet: ['D03104', 'free_memory', 'ProductId', 'DeviceId', 'StatusType', 'ConnectType'],
  notes: [
    'Fan speed is not writable: set mode instead (sleep→1, medium→2, high→3).',
    'ambient only shows while lamp=ambient.',
  ],
};
