#!/usr/bin/env node
// meshy.mjs — zero-dependency Node (ESM) CLI client for the Meshy AI REST API.
//
// Wraps every public Meshy endpoint behind a single generic async engine:
//   create task (POST) -> poll until terminal (GET /:id) -> optionally download assets.
//
// Output contract:
//   STDOUT — exactly ONE machine-readable JSON object (so the calling skill parses
//            it without re-reading files). Emitted once, at the very end.
//   STDERR — all human progress, warnings and stack traces.
//
// Auth: --api-key, else $MESHY_AI_API_KEY, else $MESHY_API_KEY. Keys look like `msy_...`.
//       Free no-cost test key: msy_dummy_api_key_for_test_mode_12345678
//
// Exit codes: 0 ok · 2 usage · 3 auth · 4 credits · 5 rate-limit · 6 not-found
//             7 task-failed · 8 timeout · 9 network · 1 generic · 130 interrupted
//
// Requires Node 18+ (native fetch / Readable.fromWeb).
//
// Examples:
//   node meshy.mjs balance
//   node meshy.mjs text-to-3d --prompt "a red ceramic mug" --out ./out --formats glb,fbx
//   node meshy.mjs text-to-3d --prompt "a cube" --no-wait
//   node meshy.mjs status text-to-3d <task_id>
//   node meshy.mjs download image-to-3d <task_id> --out ./out --all
//   node meshy.mjs help --json

import { createWriteStream } from 'node:fs';
import { readFile, mkdir, rename, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import process from 'node:process';

// ── Section 3: constants ───────────────────────────────────────────────────
const VERSION = '0.1.0';
const TEST_KEY = 'msy_dummy_api_key_for_test_mode_12345678';

const DEFAULTS = {
  baseUrl: 'https://api.meshy.ai/openapi/',
  requestTimeoutMs: 60_000,
  pollTimeoutMs: 1_200_000, // 20 min
  pollIntervalMs: 5_000,
  maxRetries: 5,
  formats: ['glb'],
};

const EXIT = {
  OK: 0, GENERIC: 1, USAGE: 2, AUTH: 3, CREDITS: 4, RATELIMIT: 5,
  NOTFOUND: 6, TASK_FAILED: 7, TIMEOUT: 8, NETWORK: 9, INTERRUPTED: 130,
};

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELED']);

// ── Section 4: registry (type -> endpoint + params + requirements) ─────────
// `params` keys are the snake_case API field names. The CLI accepts both
// `--target_polycount` and `--target-polycount` (dashes normalize to underscores).
// `requires`: each entry is a field name (must be present) or an array = OR-group.

const AI_MODELS = ['meshy-5', 'meshy-6', 'latest'];
const FORMATS = ['glb', 'fbx', 'obj', 'usdz', 'blend', 'stl', '3mf', 'mtl', 'gltf'];

// shared param fragments
const meshParams = {
  ai_model: { type: 'string', enum: AI_MODELS },
  should_remesh: { type: 'boolean' },
  model_type: { type: 'string', enum: ['standard', 'lowpoly'] },
  topology: { type: 'string', enum: ['quad', 'triangle'] },
  target_polycount: { type: 'number', min: 100, max: 300000 },
  target_formats: { type: 'array' },
  pose_mode: { type: 'string', enum: ['a-pose', 't-pose', ''] },
  moderation: { type: 'boolean' },
  auto_size: { type: 'boolean' },
  alpha_thumbnail: { type: 'boolean' },
};
const textureParams = {
  enable_pbr: { type: 'boolean' },
  hd_texture: { type: 'boolean' },
  texture_prompt: { type: 'string', maxLen: 600 },
  texture_image_url: { type: 'string' },
  remove_lighting: { type: 'boolean' },
};

const TYPES = {
  'text-to-3d': {
    path: 'v2/text-to-3d',
    params: {
      mode: { type: 'string', enum: ['preview', 'refine'] },
      prompt: { type: 'string', maxLen: 600 },
      seed: { type: 'number' },
      decimation_mode: { type: 'number', min: 1, max: 4 },
      origin_at: { type: 'string', enum: ['bottom', 'center'] },
      preview_task_id: { type: 'string' },
      ...meshParams, ...textureParams,
    },
    validate(body) {
      if (body.mode === 'refine') {
        if (!body.preview_task_id) throw usage('refine requires --preview-task-id');
      } else {
        if (!body.mode) body.mode = 'preview';
        if (!body.prompt) throw usage('text-to-3d (preview) requires --prompt');
      }
    },
  },
  'image-to-3d': {
    path: 'v1/image-to-3d',
    params: {
      image_url: { type: 'string' },
      image: { type: 'string' }, // local path alias -> image_url (base64 data URI)
      input_task_id: { type: 'string' },
      should_texture: { type: 'boolean' },
      image_enhancement: { type: 'boolean' },
      ...meshParams, ...textureParams,
    },
    requires: [['image_url', 'image', 'input_task_id']],
  },
  'multi-image-to-3d': {
    path: 'v1/multi-image-to-3d',
    params: {
      image_urls: { type: 'array' },
      images: { type: 'array' }, // local paths alias -> image_urls
      input_task_id: { type: 'string' },
      should_texture: { type: 'boolean' },
      ...meshParams, ...textureParams,
    },
    requires: [['image_urls', 'images', 'input_task_id']],
  },
  retexture: {
    path: 'v1/retexture',
    params: {
      input_task_id: { type: 'string' },
      model_url: { type: 'string' },
      text_style_prompt: { type: 'string', maxLen: 600 },
      image_style_url: { type: 'string' },
      enable_original_uv: { type: 'boolean' },
      ai_model: { type: 'string', enum: AI_MODELS },
      target_formats: { type: 'array' },
      alpha_thumbnail: { type: 'boolean' },
      ...textureParams,
    },
    requires: [['input_task_id', 'model_url'], ['text_style_prompt', 'image_style_url']],
  },
  remesh: {
    path: 'v1/remesh',
    params: {
      input_task_id: { type: 'string' },
      model_url: { type: 'string' },
      target_formats: { type: 'array' },
      topology: { type: 'string', enum: ['quad', 'triangle'] },
      target_polycount: { type: 'number', min: 100, max: 300000 },
      origin_at: { type: 'string', enum: ['bottom', 'center'] },
    },
    requires: [['input_task_id', 'model_url']],
  },
  rigging: {
    path: 'v1/rigging',
    params: {
      input_task_id: { type: 'string' },
      model_url: { type: 'string' },
      character_height: { type: 'number' },
      height_meters: { type: 'number' },
      texture_image_url: { type: 'string' },
    },
    requires: [['input_task_id', 'model_url']],
  },
  animation: {
    path: 'v1/animation',
    params: {
      rig_task_id: { type: 'string' },
      action: { type: 'string' },
      animation_id: { type: 'string' },
    },
    requires: ['rig_task_id'],
  },
  'text-to-image': {
    path: 'v1/text-to-image',
    params: {
      ai_model: { type: 'string', enum: ['nano-banana', 'nano-banana-2', 'nano-banana-pro', 'gpt-image-2'] },
      prompt: { type: 'string' },
      aspect_ratio: { type: 'string' },
      generate_multi_view: { type: 'boolean' },
      pose_mode: { type: 'string', enum: ['a-pose', 't-pose'] },
    },
    requires: ['ai_model', 'prompt'],
  },
  'image-to-image': {
    path: 'v1/image-to-image',
    params: {
      ai_model: { type: 'string', enum: ['nano-banana', 'nano-banana-2', 'nano-banana-pro', 'gpt-image-2'] },
      prompt: { type: 'string' },
      image_url: { type: 'string' },
      image: { type: 'string' },
      input_task_id: { type: 'string' },
      aspect_ratio: { type: 'string' },
    },
    requires: ['ai_model', 'prompt', ['image_url', 'image', 'input_task_id']],
  },
  convert: {
    path: 'v1/convert',
    params: {
      input_task_id: { type: 'string' },
      model_url: { type: 'string' },
      target_formats: { type: 'array' },
    },
    requires: [['input_task_id', 'model_url'], 'target_formats'],
  },
  resize: {
    path: 'v1/resize',
    params: {
      input_task_id: { type: 'string' },
      model_url: { type: 'string' },
      resize_height: { type: 'number' },
      resize_longest_side: { type: 'number' },
      auto_size: { type: 'boolean' },
      origin_at: { type: 'string', enum: ['bottom', 'center'] },
    },
    requires: [['input_task_id', 'model_url'], ['resize_height', 'resize_longest_side', 'auto_size']],
  },
  'uv-unwrap': {
    path: 'v1/uv-unwrap',
    params: {
      input_task_id: { type: 'string' },
      model_url: { type: 'string' }, // .glb only
    },
    requires: [['input_task_id', 'model_url']],
  },
  'analyze-printability': {
    path: 'v1/analyze-printability',
    params: {
      input_task_id: { type: 'string' },
      model_url: { type: 'string' },
    },
    requires: [['input_task_id', 'model_url']],
  },
  'repair-printability': {
    path: 'v1/repair-printability',
    params: {
      input_task_id: { type: 'string' },
      model_url: { type: 'string' },
    },
    requires: [['input_task_id', 'model_url']],
  },
  'multi-color-print': {
    path: 'v1/multi-color-print',
    params: {
      input_task_id: { type: 'string' },
      model_url: { type: 'string' },
    },
    requires: [['input_task_id', 'model_url']],
  },
  // Creative Lab uses product-scoped URLs: creative-lab/<product>/v1/<stage>.
  // EXPERIMENTAL: pass product via --product and stage via --stage; thinly documented.
  'creative-lab': {
    creativeLab: true,
    params: {
      prompt: { type: 'string', maxLen: 600 },
      image_url: { type: 'string' },
      image: { type: 'string' },
      input_task_id: { type: 'string' },
    },
  },
};

// command name -> { type, presets } : ergonomic aliases routed through the engine
const COMMAND_ALIASES = {
  refine: { type: 'text-to-3d', presets: { mode: 'refine' } },
  rig: { type: 'rigging' },
  animate: { type: 'animation' },
};

// control flags (everything not a body param)
const CONTROL = new Set([
  'api_key', 'base_url', 'request_timeout', 'poll_timeout', 'interval', 'retries',
  'no_wait', 'wait', 'json', 'param', 'out', 'formats', 'textures', 'thumbnail',
  'all', 'pretty', 'quiet', 'verbose', 'product', 'stage',
  'page_num', 'page_size', 'sort_by', 'help', 'version',
]);
const CONTROL_BOOLEANS = new Set([
  'no_wait', 'wait', 'textures', 'thumbnail', 'all', 'pretty', 'quiet', 'verbose', 'help', 'version',
]);

// union of every boolean flag (control + registry params) — used by the arg parser
const ALL_BOOLEANS = new Set(CONTROL_BOOLEANS);
for (const t of Object.values(TYPES)) {
  for (const [k, s] of Object.entries(t.params || {})) if (s.type === 'boolean') ALL_BOOLEANS.add(k);
}

const GENERATE_COMMANDS = new Set([...Object.keys(TYPES), ...Object.keys(COMMAND_ALIASES)]);

// ── Section 5: error types ─────────────────────────────────────────────────
class ApiError extends Error {
  constructor(status, message, { code = null, docUrl = null, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.docUrl = docUrl;
    this.body = body;
  }
}
class CliError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'CliError';
    this.kind = kind;
    this.taskId = extra.taskId || null;
    this.status = extra.status ?? null;
    this.code = extra.code ?? null;
    this.docUrl = extra.docUrl ?? null;
  }
}
const usage = (msg) => new CliError('usage', msg);

const KIND_EXIT = {
  usage: EXIT.USAGE, auth: EXIT.AUTH, credits: EXIT.CREDITS, 'rate-limit': EXIT.RATELIMIT,
  'not-found': EXIT.NOTFOUND, 'task-failed': EXIT.TASK_FAILED, timeout: EXIT.TIMEOUT,
  network: EXIT.NETWORK, interrupted: EXIT.INTERRUPTED, generic: EXIT.GENERIC,
};
const RETRYABLE_KINDS = new Set(['rate-limit', 'timeout', 'network']);

function classifyApiError(e) {
  const map = { 401: 'auth', 402: 'credits', 404: 'not-found', 400: 'usage', 429: 'rate-limit' };
  const kind = map[e.status] || (e.status >= 500 ? 'network' : 'generic');
  return new CliError(kind, e.message, { status: e.status, code: e.code, docUrl: e.docUrl });
}

// ── Section 6: tiny no-dependency arg parser ───────────────────────────────
function parseArgs(argv) {
  const positionals = [];
  const opts = new Map();
  const setOpt = (k, v) => {
    if (opts.has(k)) {
      const prev = opts.get(k);
      opts.set(k, Array.isArray(prev) ? [...prev, v] : [prev, v]);
    } else opts.set(k, v);
  };

  let noMoreFlags = false;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (noMoreFlags) { positionals.push(tok); continue; }
    if (tok === '--') { noMoreFlags = true; continue; }
    if (tok === '-h') { setOpt('help', true); continue; }

    if (tok.startsWith('--')) {
      let name = tok.slice(2);
      let val;
      const eq = name.indexOf('=');
      if (eq >= 0) { val = name.slice(eq + 1); name = name.slice(0, eq); }
      const norm = name.replace(/-/g, '_');

      // negation: --no-<bool> sets that boolean to false (but not the literal control flag no_wait)
      if (val === undefined && norm.startsWith('no_') && !CONTROL.has(norm)) {
        const base = norm.slice(3);
        if (ALL_BOOLEANS.has(base)) { setOpt(base, false); continue; }
      }
      if (val !== undefined) { setOpt(norm, val); continue; }
      if (ALL_BOOLEANS.has(norm)) { setOpt(norm, true); continue; }

      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw usage(`--${name} expects a value`);
      setOpt(norm, next);
      i++;
      continue;
    }
    if (tok.startsWith('-') && tok.length > 1 && !/^-\d/.test(tok)) throw usage(`unknown option ${tok}`);
    positionals.push(tok);
  }

  const command = positionals.shift();
  return { command, positionals, opts };
}

const lastOf = (v) => (Array.isArray(v) ? v[v.length - 1] : v);
const splitList = (v) => (Array.isArray(v) ? v : [v]).flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);

function coerce(value, spec, name) {
  const flag = '--' + name.replace(/_/g, '-');
  switch (spec.type) {
    case 'number': {
      const n = Number(lastOf(value));
      if (!Number.isFinite(n)) throw usage(`${flag} expects a number`);
      if (spec.min != null && n < spec.min) throw usage(`${flag} must be >= ${spec.min}`);
      if (spec.max != null && n > spec.max) throw usage(`${flag} must be <= ${spec.max}`);
      return n;
    }
    case 'boolean': {
      const v = lastOf(value);
      if (v === true || v === 'true' || v === '') return true;
      if (v === false || v === 'false') return false;
      throw usage(`${flag} expects true/false`);
    }
    case 'array':
      return splitList(value);
    default: {
      const s = String(lastOf(value));
      if (spec.maxLen && s.length > spec.maxLen) throw usage(`${flag} exceeds ${spec.maxLen} characters (${s.length})`);
      if (spec.enum && !spec.enum.includes(s)) {
        throw usage(`${flag} must be one of: ${spec.enum.map((x) => (x === '' ? '""' : x)).join(', ')}`);
      }
      return s;
    }
  }
}

function parseParamValue(s) {
  try { return JSON.parse(s); } catch { return s; }
}

// Body-merge precedence: presets < --json < typed flags < --param
function buildBody(type, presets, opts) {
  const spec = TYPES[type].params || {};
  const body = { ...(presets || {}) };

  if (opts.has('json')) {
    let parsed;
    try { parsed = JSON.parse(lastOf(opts.get('json'))); } catch (e) { throw usage(`--json is not valid JSON: ${e.message}`); }
    if (parsed && typeof parsed === 'object') Object.assign(body, parsed);
    else throw usage('--json must be a JSON object');
  }

  for (const [k, v] of opts) {
    if (CONTROL.has(k)) continue;
    const ps = spec[k];
    if (!ps) {
      throw usage(`unknown option --${k.replace(/_/g, '-')} for "${type}"; pass arbitrary API fields with --param ${k}=VALUE or --json '{...}'`);
    }
    body[k] = coerce(v, ps, k);
  }

  if (opts.has('param')) {
    for (const p of (Array.isArray(opts.get('param')) ? opts.get('param') : [opts.get('param')])) {
      const idx = String(p).indexOf('=');
      if (idx < 0) throw usage(`--param expects key=value, got "${p}"`);
      body[String(p).slice(0, idx)] = parseParamValue(String(p).slice(idx + 1));
    }
  }
  return body;
}

// ── Section 7: output ──────────────────────────────────────────────────────
let LOG_QUIET = false;
function logErr(...args) { if (!LOG_QUIET) process.stderr.write(args.join(' ') + '\n'); }
function emit(obj, pretty) { process.stdout.write(JSON.stringify(obj, null, pretty ? 2 : 0) + '\n'); }

function emitError(err, command, pretty, startedAt) {
  const cli = err instanceof CliError ? err
    : err instanceof ApiError ? classifyApiError(err)
    : new CliError('generic', err?.message || String(err));
  const envelope = {
    ok: false,
    command: command || null,
    error: {
      kind: cli.kind,
      message: cli.message,
      status: cli.status ?? null,
      code: cli.code ?? null,
      doc_url: cli.docUrl ?? null,
      task_id: cli.taskId ?? null,
      retryable: RETRYABLE_KINDS.has(cli.kind),
    },
    meta: { elapsed_ms: startedAt ? Date.now() - startedAt : null },
  };
  emit(envelope, pretty);
  logErr(`error[${cli.kind}]: ${cli.message}${cli.taskId ? ` (task ${cli.taskId})` : ''}`);
  if (process.env.MESHY_DEBUG && err?.stack) logErr(err.stack);
  return KIND_EXIT[cli.kind] ?? EXIT.GENERIC;
}

// ── Section 8: HTTP core ───────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function backoffDelay(attempt, retryAfterHeader) {
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs)) return Math.min(secs * 1000, 30_000);
  }
  const base = 500 * 2 ** (attempt - 1);
  return Math.min(base, 15_000) + Math.floor(((attempt * 137) % 250)); // small deterministic jitter
}

function buildUrl(baseUrl, p, query) {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  let u = base + p.replace(/^\//, '');
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    if (qs) u += (u.includes('?') ? '&' : '?') + qs;
  }
  return u;
}

async function request(method, p, { body, query, ctx, auth = true } = {}) {
  const url = buildUrl(ctx.baseUrl, p, query);
  let attempt = 0;
  for (;;) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ctx.requestTimeoutMs);
    try {
      const headers = { Accept: 'application/json' };
      if (auth) headers.Authorization = `Bearer ${ctx.apiKey}`;
      let payload;
      if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

      const res = await fetch(url, { method, headers, body: payload, signal: ac.signal });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

      if (res.ok) return { status: res.status, headers: res.headers, data };

      const message = data?.message || data?.error || res.statusText || `HTTP ${res.status}`;
      if (res.status === 429 && attempt < ctx.maxRetries) {
        attempt++;
        logErr(`rate-limited (429), retry ${attempt}/${ctx.maxRetries}…`);
        await sleep(backoffDelay(attempt, res.headers.get('retry-after')));
        continue;
      }
      throw new ApiError(res.status, message, { code: data?.code ?? null, docUrl: data?.doc_url ?? null, body: data });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // Only retry network errors/timeouts for idempotent methods. A POST that
      // reached the server but lost its response would otherwise be re-sent,
      // creating a second task and charging credits twice on the paid API.
      const idempotent = method === 'GET' || method === 'HEAD';
      const transient = e.name === 'AbortError' || ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(e.code);
      if (idempotent && transient && attempt < ctx.maxRetries) {
        attempt++;
        logErr(`network error (${e.code || e.name}), retry ${attempt}/${ctx.maxRetries}…`);
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw new CliError('network', `request failed: ${e.code || e.name || e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Section 9: input helpers ───────────────────────────────────────────────
const LOCAL_IMAGE_FIELDS = ['image_url', 'texture_image_url', 'image_style_url'];

async function toDataUri(v) {
  if (!v || typeof v !== 'string') return v;
  if (/^https?:\/\//i.test(v) || /^data:/i.test(v)) return v;
  let buf;
  try { buf = await readFile(v); } catch (e) {
    if (e.code === 'ENOENT') throw usage(`image file not found: ${v}`);
    throw e;
  }
  const ext = (v.split('.').pop() || '').toLowerCase();
  const mime = ext === 'png' ? 'image/png'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp' : 'application/octet-stream';
  if (buf.length > 5 * 1024 * 1024) logErr(`warning: ${v} is ${(buf.length / 1048576).toFixed(1)}MB; the API may reject large images`);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function resolveImageFields(body) {
  if (body.image && !body.image_url) body.image_url = body.image;
  delete body.image;
  if (body.images && !body.image_urls) body.image_urls = Array.isArray(body.images) ? body.images : [body.images];
  delete body.images;
  for (const f of LOCAL_IMAGE_FIELDS) if (typeof body[f] === 'string') body[f] = await toDataUri(body[f]);
  if (Array.isArray(body.image_urls)) body.image_urls = await Promise.all(body.image_urls.map(toDataUri));
}

// ── Section 10: engine ─────────────────────────────────────────────────────
function basePath(type, opts) {
  if (TYPES[type]?.creativeLab) {
    const product = opts.get('product') && lastOf(opts.get('product'));
    const stage = (opts.get('stage') && lastOf(opts.get('stage'))) || 'prototype';
    if (!product) throw usage('creative-lab requires --product (e.g. keychain|fridge-magnet|figure|lamp)');
    if (!['prototype', 'build'].includes(stage)) throw usage('creative-lab --stage must be prototype or build');
    return `creative-lab/${product}/v1/${stage}`;
  }
  if (!TYPES[type]) throw usage(`unknown type "${type}"`);
  return TYPES[type].path;
}

async function getBalance(ctx) {
  const { data } = await request('GET', 'v1/balance', { ctx });
  return data.balance;
}
async function createTask(base, body, ctx) {
  const { data } = await request('POST', base, { body, ctx });
  const id = data.result || data.id || data.task_id;
  if (!id) throw new CliError('generic', `create returned no task id: ${JSON.stringify(data).slice(0, 200)}`);
  return id;
}
async function getTask(base, id, ctx) {
  const { data } = await request('GET', `${base}/${id}`, { ctx });
  return data;
}
async function listTasks(base, query, ctx) {
  const { data } = await request('GET', base, { ctx, query });
  if (Array.isArray(data)) return data;
  return data.result || data.data || data.tasks || [];
}

async function pollTask(base, id, ctx, onProgress) {
  const deadline = Date.now() + ctx.pollTimeoutMs;
  for (;;) {
    const task = await getTask(base, id, ctx);
    onProgress?.(task);
    if (TERMINAL.has(task.status)) {
      if (task.status === 'SUCCEEDED') return task;
      const te = task.task_error || {};
      throw new CliError('task-failed', te.message || `task ${task.status}`, {
        taskId: id, code: te.code ?? null, docUrl: te.doc_url ?? null,
      });
    }
    if (Date.now() > deadline) {
      throw new CliError('timeout', `poll timed out after ${Math.round(ctx.pollTimeoutMs / 1000)}s (last status: ${task.status})`, { taskId: id });
    }
    await sleep(ctx.pollIntervalMs);
  }
}

// ── Section 11: download ───────────────────────────────────────────────────
function extFromUrl(url, fallback) {
  try {
    const clean = String(url).split('?')[0];
    const ext = clean.split('.').pop();
    return ext && ext.length <= 5 ? ext.toLowerCase() : fallback;
  } catch { return fallback; }
}
function sanitizeName(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 120);
}

function collectUrls(task, sel) {
  const items = [];
  const idShort = sanitizeName((task.id || 'model').slice(0, 12));

  if (task.model_urls && typeof task.model_urls === 'object') {
    const want = sel.all ? Object.keys(task.model_urls) : sel.formats;
    for (const fmt of want) {
      if (!sel.all && fmt.startsWith('pre_remeshed')) continue;
      const url = task.model_urls[fmt];
      if (url) items.push({ asset: 'model', format: fmt, url, name: `${idShort}.${fmt}` });
      else items.push({ asset: 'model', format: fmt, url: null, skip: 'not available' });
    }
  }

  for (const [k, label] of [
    ['rigged_character_glb_url', 'rigged.glb'],
    ['animated_model_glb_url', 'animated.glb'],
    ['video_url', 'video.mp4'],
  ]) {
    if (task[k]) items.push({ asset: label.split('.')[0], format: label.split('.').pop(), url: task[k], name: `${idShort}-${label}` });
  }

  if (Array.isArray(task.image_urls)) {
    task.image_urls.forEach((url, i) => {
      if (url) { const ext = extFromUrl(url, 'png'); items.push({ asset: 'image', format: ext, url, name: `${idShort}-image-${i}.${ext}` }); }
    });
  }

  if (sel.textures && Array.isArray(task.texture_urls)) {
    task.texture_urls.forEach((tex, i) => {
      for (const [map, url] of Object.entries(tex || {})) {
        if (url) { const ext = extFromUrl(url, 'png'); items.push({ asset: 'texture', format: ext, url, name: `${idShort}-tex${i}-${map}.${ext}` }); }
      }
    });
  }

  if (sel.thumbnail && task.thumbnail_url) {
    const ext = extFromUrl(task.thumbnail_url, 'png');
    items.push({ asset: 'thumbnail', format: ext, url: task.thumbnail_url, name: `${idShort}-thumb.${ext}` });
  }
  return items;
}

async function ensureDir(dir) { await mkdir(dir, { recursive: true }); }

async function downloadOne(url, dest, ctx) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(ctx.requestTimeoutMs, 120_000));
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) { const e = new Error(`download HTTP ${res.status}`); e.status = res.status; throw e; }
    const tmp = dest + '.part';
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    await rename(tmp, dest);
    const st = await stat(dest);
    return { bytes: st.size };
  } finally { clearTimeout(timer); }
}

async function downloadAssets(base, task, sel, ctx) {
  const outDir = sel.outDir;
  await ensureDir(outDir);
  const written = [], skipped = [], errors = [];
  let refreshed = false;

  for (const it of collectUrls(task, sel)) {
    if (!it.url) { skipped.push({ asset: it.asset, format: it.format, reason: it.skip || 'not available' }); continue; }
    const dest = path.join(outDir, sanitizeName(it.name));
    try {
      const { bytes } = await downloadOne(it.url, dest, ctx);
      written.push({ asset: it.asset, format: it.format, path: dest, bytes });
    } catch (e) {
      if ([401, 403, 410].includes(e.status) && !refreshed) {
        refreshed = true;
        logErr('a download URL expired; re-fetching task for fresh URLs…');
        try {
          const fresh = await getTask(base, task.id, ctx);
          const match = collectUrls(fresh, sel).find((x) => x.name === it.name && x.url);
          if (match) { const { bytes } = await downloadOne(match.url, dest, ctx); written.push({ asset: it.asset, format: it.format, path: dest, bytes }); continue; }
        } catch { /* fall through to error */ }
        errors.push({ asset: it.asset, format: it.format, reason: `expired (${e.status})` });
      } else {
        errors.push({ asset: it.asset, format: it.format, reason: e.message || String(e) });
      }
    }
  }
  return { out_dir: outDir, written, skipped, errors };
}

function downloadSelection(opts) {
  return {
    outDir: opts.has('out') ? lastOf(opts.get('out')) : null,
    formats: opts.has('formats') ? splitList(opts.get('formats')) : DEFAULTS.formats,
    textures: opts.has('textures') || opts.has('all'),
    thumbnail: opts.has('thumbnail') || opts.has('all'),
    all: opts.has('all'),
  };
}

// ── Section 12: command handlers ───────────────────────────────────────────
function progressLogger(label) {
  let lastPct = -1;
  const started = Date.now();
  return (task) => {
    const pct = task.progress ?? 0;
    if (task.status === 'IN_PROGRESS' && pct === lastPct) return;
    lastPct = pct;
    const secs = Math.round((Date.now() - started) / 1000);
    logErr(`[${label} ${String(task.id || '').slice(0, 8)} ${task.status} ${pct}% • ${secs}s]`);
  };
}

async function cmdGenerate(command, opts, ctx, startedAt) {
  const alias = COMMAND_ALIASES[command];
  const type = alias ? alias.type : command;
  const presets = alias ? alias.presets : undefined;

  const base = basePath(type, opts);
  const body = buildBody(type, presets, opts);
  await resolveImageFields(body);
  checkRequired(type, body);
  TYPES[type].validate?.(body);

  const id = await createTask(base, body, ctx);
  logErr(`created ${type} task ${id}`);

  if (opts.has('no_wait')) {
    emit({ ok: true, command, type, task_id: id, status: 'PENDING', waited: false, meta: meta(ctx, startedAt) }, opts.has('pretty'));
    return EXIT.OK;
  }

  const task = await pollTask(base, id, ctx, progressLogger(type));

  const sel = downloadSelection(opts);
  let downloads;
  if (sel.outDir) downloads = await downloadAssets(base, task, sel, ctx);
  else if (hasDownloadableAssets(task)) logErr('tip: pass --out <dir> to download assets (URLs expire within ~days)');

  emit({
    ok: true, command, type, task_id: id, status: task.status, waited: true,
    task, downloads, credits_consumed: task.consumed_credits ?? null, meta: meta(ctx, startedAt),
  }, opts.has('pretty'));
  return EXIT.OK;
}

function hasDownloadableAssets(task) {
  return !!(task.model_urls && Object.values(task.model_urls).some(Boolean))
    || (Array.isArray(task.image_urls) && task.image_urls.length)
    || task.rigged_character_glb_url || task.animated_model_glb_url || task.video_url;
}

function checkRequired(type, body) {
  for (const r of TYPES[type].requires || []) {
    if (Array.isArray(r)) {
      if (!r.some((k) => body[k] != null && body[k] !== '' && !(Array.isArray(body[k]) && body[k].length === 0))) {
        throw usage(`${type} requires one of: ${r.map((k) => '--' + k.replace(/_/g, '-')).join(', ')}`);
      }
    } else if (body[r] == null || body[r] === '') {
      throw usage(`${type} requires --${r.replace(/_/g, '-')}`);
    }
  }
}

function resolveTypeArg(token) {
  if (!token) throw usage('expected a <type> argument (e.g. text-to-3d)');
  if (COMMAND_ALIASES[token]) return COMMAND_ALIASES[token].type;
  if (TYPES[token]) return token;
  throw usage(`unknown type "${token}"; see "help" for the list`);
}

async function cmdStatus(positionals, opts, ctx, startedAt) {
  const type = resolveTypeArg(positionals[0]);
  const id = positionals[1];
  if (!id) throw usage('status requires: status <type> <task_id>');
  const base = basePath(type, opts);
  const task = opts.has('wait') ? await pollTask(base, id, ctx, progressLogger(type)) : await getTask(base, id, ctx);
  emit({ ok: true, command: 'status', type, task_id: id, status: task.status, task, meta: meta(ctx, startedAt) }, opts.has('pretty'));
  return EXIT.OK;
}

async function cmdList(positionals, opts, ctx, startedAt) {
  const type = resolveTypeArg(positionals[0]);
  const base = basePath(type, opts);
  const query = {
    page_num: opts.has('page_num') ? Number(lastOf(opts.get('page_num'))) : 1,
    page_size: opts.has('page_size') ? Number(lastOf(opts.get('page_size'))) : 10,
    sort_by: opts.has('sort_by') ? lastOf(opts.get('sort_by')) : '-created_at',
  };
  const tasks = await listTasks(base, query, ctx);
  emit({ ok: true, command: 'list', type, ...query, count: tasks.length, tasks, meta: meta(ctx, startedAt) }, opts.has('pretty'));
  return EXIT.OK;
}

async function cmdDownload(positionals, opts, ctx, startedAt) {
  const type = resolveTypeArg(positionals[0]);
  const id = positionals[1];
  if (!id) throw usage('download requires: download <type> <task_id> --out <dir>');
  const sel = downloadSelection(opts);
  if (!sel.outDir) throw usage('download requires --out <dir>');
  const base = basePath(type, opts);
  let task = await getTask(base, id, ctx);
  if (!TERMINAL.has(task.status)) task = await pollTask(base, id, ctx, progressLogger(type));
  if (task.status !== 'SUCCEEDED') throw new CliError('task-failed', `task is ${task.status}`, { taskId: id });
  const downloads = await downloadAssets(base, task, sel, ctx);
  emit({ ok: true, command: 'download', type, task_id: id, status: task.status, downloads, meta: meta(ctx, startedAt) }, opts.has('pretty'));
  return EXIT.OK;
}

async function cmdBalance(opts, ctx, startedAt) {
  const balance = await getBalance(ctx);
  emit({ ok: true, command: 'balance', balance, meta: meta(ctx, startedAt) }, opts.has('pretty'));
  return EXIT.OK;
}

const meta = (ctx, startedAt) => ({ elapsed_ms: Date.now() - startedAt, api_base: ctx.baseUrl });

// ── help / version ─────────────────────────────────────────────────────────
const COMMAND_CATALOG = [
  { name: 'balance', summary: 'show remaining credits' },
  { name: 'text-to-3d', summary: 'generate a 3D model from a text prompt (mode preview|refine)' },
  { name: 'refine', summary: 'alias: text-to-3d refine (needs --preview-task-id)' },
  { name: 'image-to-3d', summary: 'generate a 3D model from one image (--image-url|--image)' },
  { name: 'multi-image-to-3d', summary: 'generate a 3D model from 1-4 images (--images)' },
  { name: 'retexture', summary: 're-texture an existing model' },
  { name: 'remesh', summary: 'remesh an existing model (topology/polycount/formats)' },
  { name: 'rig', summary: 'alias: rigging — auto-rig a character model' },
  { name: 'animate', summary: 'alias: animation — animate a rigged model' },
  { name: 'text-to-image', summary: 'generate 2D image(s) from a text prompt' },
  { name: 'image-to-image', summary: 'transform an image from a prompt' },
  { name: 'convert', summary: 'convert a model to other formats (--target-formats)' },
  { name: 'resize', summary: 'resize a model (--resize-height/--resize-longest-side/--auto-size)' },
  { name: 'uv-unwrap', summary: 'generate a UV layout for a .glb model' },
  { name: 'analyze-printability', summary: 'analyze a model for 3D printing (free)' },
  { name: 'repair-printability', summary: 'repair a model for 3D printing' },
  { name: 'multi-color-print', summary: 'convert to multi-color 3MF' },
  { name: 'creative-lab', summary: 'EXPERIMENTAL: --product <p> --stage prototype|build' },
  { name: 'status <type> <id>', summary: 'fetch a task snapshot (--wait to poll)' },
  { name: 'list <type>', summary: 'list tasks (--page-num/--page-size/--sort-by)' },
  { name: 'download <type> <id>', summary: 'download a finished task’s assets (--out required)' },
  { name: 'help [--json]', summary: 'show this help' },
];

function printHelp(wantJson) {
  if (wantJson) {
    emit({ ok: true, command: 'help', version: VERSION, commands: COMMAND_CATALOG, types: Object.keys(TYPES) }, true);
    return;
  }
  const lines = [
    `meshy.mjs v${VERSION} — Meshy AI REST client`,
    '',
    'Usage: node meshy.mjs <command> [options]',
    '',
    'Commands:',
    ...COMMAND_CATALOG.map((c) => `  ${c.name.padEnd(26)} ${c.summary}`),
    '',
    'Common options:',
    '  --out <dir>             download finished assets to <dir>',
    '  --formats glb,fbx       model formats to download (default: glb)',
    '  --textures --thumbnail  also download textures / thumbnail (or --all)',
    '  --no-wait               create the task and return its id immediately',
    '  --wait                  (status) poll until the task finishes',
    '  --json \'{...}\'          raw request body (merged under typed flags)',
    '  --param key=value       set any API field (value parsed as JSON if possible)',
    '  --poll-timeout <ms>     total wait (default 1200000) · --interval <ms> (5000)',
    '  --api-key <key>         override $MESHY_AI_API_KEY / $MESHY_API_KEY',
    '  --pretty                pretty-print the JSON output',
    '',
    'STDOUT is a single JSON object; progress goes to STDERR. Exit codes in the header.',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

// ── Section 13: context + dispatch ─────────────────────────────────────────
function buildContext(opts) {
  const apiKey = (opts.has('api_key') && lastOf(opts.get('api_key'))) || process.env.MESHY_AI_API_KEY || process.env.MESHY_API_KEY || '';
  const num = (k, d) => (opts.has(k) ? Number(lastOf(opts.get(k))) : d);
  return {
    apiKey,
    baseUrl: (opts.has('base_url') && lastOf(opts.get('base_url'))) || DEFAULTS.baseUrl,
    requestTimeoutMs: num('request_timeout', DEFAULTS.requestTimeoutMs),
    pollTimeoutMs: num('poll_timeout', DEFAULTS.pollTimeoutMs),
    pollIntervalMs: num('interval', DEFAULTS.pollIntervalMs),
    maxRetries: num('retries', DEFAULTS.maxRetries),
  };
}

function requireKey(ctx) {
  if (!ctx.apiKey) throw new CliError('auth', 'no API key: set $MESHY_AI_API_KEY (or $MESHY_API_KEY), or pass --api-key');
  if (!/^msy_/.test(ctx.apiKey)) logErr('warning: API key does not start with "msy_"');
}

async function main(argv) {
  const startedAt = Date.now();

  // Help/version are handled from raw argv so value-flags like --json need no value here.
  if (argv.length === 0 || argv[0] === 'help' || argv.includes('--help') || argv.includes('-h')) {
    printHelp(argv.includes('--json'));
    return EXIT.OK;
  }
  if (argv[0] === 'version' || argv.includes('--version')) { process.stdout.write(VERSION + '\n'); return EXIT.OK; }

  let parsed;
  try { parsed = parseArgs(argv); } catch (e) { return emitError(e, null, argv.includes('--pretty'), startedAt); }
  const { command, positionals, opts } = parsed;

  LOG_QUIET = opts.has('quiet');
  const pretty = opts.has('pretty');

  let installInterrupt;
  try {
    const ctx = buildContext(opts);
    requireKey(ctx);

    // expose current task id to SIGINT handler for resumable abort
    const state = { taskId: null };
    installInterrupt = () => process.once('SIGINT', () => {
      process.exitCode = emitError(new CliError('interrupted', 'interrupted', { taskId: state.taskId }), command, pretty, startedAt);
      process.exit(process.exitCode);
    });
    installInterrupt();

    if (command === 'balance') return await cmdBalance(opts, ctx, startedAt);
    if (command === 'status') return await cmdStatus(positionals, opts, ctx, startedAt);
    if (command === 'list') return await cmdList(positionals, opts, ctx, startedAt);
    if (command === 'download') return await cmdDownload(positionals, opts, ctx, startedAt);
    if (GENERATE_COMMANDS.has(command)) return await cmdGenerate(command, opts, ctx, startedAt);

    throw usage(`unknown command "${command}"; run "help" for the list`);
  } catch (e) {
    return emitError(e, command, pretty, startedAt);
  }
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code ?? EXIT.OK; }).catch((e) => {
  process.stderr.write(`fatal: ${e?.stack || e}\n`);
  process.exitCode = EXIT.GENERIC;
});
