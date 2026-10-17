// render.mts — human-readable views of a device state through its profile,
// and a raw fallback for models without one.

import type { Profile, Raw } from './models/index.mts';
import type { State } from './client.mts';

const pad = (s: string, n: number) => s.padEnd(n);
const pct = (left: number, total: number) => (total ? `${Math.round((100 * left) / total)}%` : '?');

/** Codes the profile accounts for — the rest is shown as "unmapped". */
export function knownCodes(p: Profile): Set<string> {
  return new Set([
    ...p.params.map((x) => x.code),
    ...p.sensors.map((x) => x.code),
    ...p.info.map((x) => x.code),
    ...p.filters.flatMap((f) => [f.left, f.total]),
    ...p.quiet,
  ]);
}

export function filterSummary(p: Profile, s: State) {
  return p.filters.map((f) => {
    const left = Number(s[f.left] ?? 0);
    const total = Number(s[f.total] ?? 0);
    return { name: f.name, left_h: left, total_h: total, percent: total ? Math.round((100 * left) / total) : null };
  });
}

export function sensorValue(p: Profile, s: State, code: string): string | null {
  const r = p.sensors.find((x) => x.code === code) ?? p.info.find((x) => x.code === code);
  const v = s[code];
  if (v === undefined) return null;
  return r?.format ? r.format(v, s) : String(v);
}

export function statusText(p: Profile, s: State, title: string): string {
  const out: string[] = [`=== ${title} — ${s.D01S05 ?? p.id} ===`];
  for (const r of p.info) {
    if (r.code === 'D01S03' || r.code === 'D01S05') continue;
    const v = sensorValue(p, s, r.code);
    if (v !== null) out.push(`  ${pad(r.name, 16)} ${v}`);
  }
  out.push('', '  -- state --');
  for (const x of p.params) {
    const raw = s[x.code];
    if (raw === undefined) continue;
    out.push(`  ${pad(x.name, 16)} ${pad(x.label(raw), 12)} (raw ${raw})`);
  }
  out.push('', '  -- sensors --');
  for (const r of p.sensors) {
    const v = sensorValue(p, s, r.code);
    if (v !== null) out.push(`  ${pad(r.name, 16)} ${v}`);
  }
  if (p.filters.length) {
    out.push('', '  -- filters --');
    for (const f of filterSummary(p, s)) out.push(`  ${pad(f.name, 16)} ${f.left_h}/${f.total_h} h   ${pct(f.left_h, f.total_h)} left`);
  }
  const known = knownCodes(p);
  const rest = Object.entries(s).filter(([k]) => !known.has(k));
  if (rest.length) out.push('', '  -- unmapped --', `  ${rest.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  ')}`);
  return out.join('\n');
}

export function rawText(s: State, title: string): string {
  const keys = Object.keys(s).sort();
  const w = Math.max(8, ...keys.map((k) => k.length));
  return [`=== ${title} (raw) ===`, ...keys.map((k) => `  ${pad(k, w)} ${JSON.stringify(s[k])}`)].join('\n');
}

export function listText(p: Profile): string {
  const out = [`writable parameters — ${p.title}:`, ''];
  for (const x of p.params) out.push(`  ${pad(x.name, 16)} ${pad(x.code, 8)} ${pad(x.choices(), 34)} ${x.doc}`);
  out.push('', `read-only: ${[...p.sensors.map((r) => r.name), ...p.filters.map((f) => f.name), ...p.info.map((r) => r.name)].join(', ')}`);
  if (p.notes.length) out.push('', ...p.notes.map((n) => `note: ${n}`));
  return out.join('\n');
}

/** Readable map {param: label} for --json output. */
export function readable(p: Profile, s: State) {
  const params: Record<string, { value: string; raw: Raw; code: string }> = {};
  for (const x of p.params) if (s[x.code] !== undefined) params[x.name] = { value: x.label(s[x.code]), raw: s[x.code], code: x.code };
  const sensors: Record<string, string> = {};
  for (const r of [...p.sensors, ...p.info]) {
    const v = sensorValue(p, s, r.code);
    if (v !== null) sensors[r.name] = v;
  }
  return { params, sensors, filters: filterSummary(p, s) };
}
