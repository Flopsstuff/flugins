// types.mts — the shape of a model profile: friendly parameter names over the
// raw D-codes a device reports in state.reported and accepts in control.

export type Raw = number | string | boolean | null | undefined;

export interface ParamSpec {
  name: string;
  code: string;
  doc: string;
  /** label → raw value */
  values?: Record<string, number>;
  /** [min, max, step] for a free numeric value */
  range?: [number, number, number];
  unit?: string;
  /** Writing this parameter only has a visible effect while another one holds a value. */
  requires?: { param: string; value: string };
}

export class Param {
  readonly name: string;
  readonly code: string;
  readonly doc: string;
  readonly values: Record<string, number>;
  readonly range?: [number, number, number];
  readonly unit: string;
  readonly requires?: { param: string; value: string };

  constructor(spec: ParamSpec) {
    this.name = spec.name;
    this.code = spec.code;
    this.doc = spec.doc;
    this.values = spec.values ?? {};
    this.range = spec.range;
    this.unit = spec.unit ?? '';
    this.requires = spec.requires;
  }

  label(raw: Raw): string {
    for (const [k, v] of Object.entries(this.values)) if (v === raw) return k;
    if (raw === undefined || raw === null) return '—';
    return `${raw}${this.unit}`;
  }

  /** Parse user text into the raw value, or throw with the allowed choices. */
  parse(text: string): number {
    const t = text.trim().toLowerCase().replace(new RegExp(`${this.unit.replace(/[%]/g, '\\%')}$`), '');
    if (Object.hasOwn(this.values, t)) return this.values[t];
    if (/^-?\d+$/.test(t)) {
      const n = Number(t);
      if (this.range) {
        const [lo, hi, step] = this.range;
        if (n < lo || n > hi) throw new Error(`${this.name}: ${n} is outside ${lo}..${hi}`);
        if ((n - lo) % step) throw new Error(`${this.name}: must step by ${step} from ${lo}`);
        return n;
      }
      const allowed = Object.values(this.values);
      if (allowed.length && !allowed.includes(n)) throw new Error(`${this.name}: ${n} is not one of ${this.choices()}`);
      return n;
    }
    throw new Error(`${this.name}: cannot read ${JSON.stringify(text)}; allowed: ${this.choices()}`);
  }

  choices(): string {
    if (Object.keys(this.values).length) return Object.keys(this.values).join('/');
    if (this.range) { const [lo, hi, step] = this.range; return `${lo}..${hi} step ${step}${this.unit}`; }
    return '<int>';
  }
}

export interface Reading {
  code: string;
  name: string;
  format?: (v: Raw, state: Record<string, Raw>) => string | null;
}

export interface Filter {
  name: string;
  /** hours left */
  left: string;
  /** hours total */
  total: string;
}

export interface Profile {
  /** e.g. "HU5710" — matched against the modelid prefix before "/" */
  id: string;
  title: string;
  match: (modelid: string) => boolean;
  params: Param[];
  sensors: Reading[];
  info: Reading[];
  filters: Filter[];
  /** Codes that are known and deliberately not shown as "unmapped". */
  quiet: string[];
  notes: string[];
}
