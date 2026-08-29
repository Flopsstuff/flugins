#!/usr/bin/env node
/**
 * n8n-api.mjs — zero-dependency client for the n8n Public REST API (/api/v1).
 *
 * STDOUT: exactly one JSON object.  STDERR: progress, warnings, human hints.
 * Exit codes: 0 ok · 2 usage · 3 auth (401) · 4 forbidden/license (403) ·
 *             5 rate limit (429) · 6 not found (404) · 7 bad request/conflict ·
 *             8 timeout · 9 network · 10 server error · 130 interrupted.
 *
 * Docs: https://docs.n8n.io/connect/n8n-api/
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const VERSION = '0.1.0';

const EXIT = {
  ok: 0, usage: 2, auth: 3, forbidden: 4, ratelimit: 5, notfound: 6,
  badrequest: 7, timeout: 8, network: 9, server: 10, interrupted: 130,
};

/* ------------------------------------------------------------------ *
 * argv parsing
 * ------------------------------------------------------------------ */

// Flags that never consume the next token.
const BOOLEAN_FLAGS = new Set([
  'all', 'full', 'pretty', 'dry-run', 'yes', 'debug', 'help', 'version', 'quiet',
  'active', 'inactive', 'archived', 'include-archived', 'include-data', 'include-role',
  'stdin', 'refresh', 'force', 'test', 'raw', 'ignore-data-size-limit', 'redact',
  'exclude-pinned-data', 'no-retry', 'retry-unsafe', 'compact', 'follow', 'list-entrypoints', 'schemas', 'no-spec', 'json',
]);
// Flags that may be repeated and collect into an array.
const REPEATABLE_FLAGS = new Set(['query', 'header', 'set', 'param']);

function parseArgv(argv) {
  const positional = [];
  const flags = Object.create(null);
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (!tok.startsWith('--')) { positional.push(tok); continue; }
    let name = tok.slice(2);
    let value;
    const eq = name.indexOf('=');
    if (eq !== -1) { value = name.slice(eq + 1); name = name.slice(0, eq); }
    else if (BOOLEAN_FLAGS.has(name)) { value = true; }
    else {
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('--') && next.length > 2)) value = true;
      else { value = next; i++; }
    }
    if (REPEATABLE_FLAGS.has(name)) (flags[name] ||= []).push(value);
    else flags[name] = value;
  }
  return { positional, flags };
}

function flagList(flags, name) {
  const v = flags[name];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/* ------------------------------------------------------------------ *
 * errors & output
 * ------------------------------------------------------------------ */

class CliError extends Error {
  constructor(kind, message, { status = null, hint = null, details = null } = {}) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.hint = hint;
    this.details = details;
  }
  get exitCode() { return EXIT[this.kind] ?? 1; }
}

const usage = (msg, hint) => new CliError('usage', msg, { hint });

let PRETTY = false;
let QUIET = false;

function log(...parts) { if (!QUIET) process.stderr.write(parts.join(' ') + '\n'); }
function warn(...parts) { process.stderr.write('warning: ' + parts.join(' ') + '\n'); }

function emit(payload, code = EXIT.ok) {
  process.stdout.write(JSON.stringify(payload, null, PRETTY ? 2 : 0) + '\n');
  process.exitCode = code;
}

/* ------------------------------------------------------------------ *
 * configuration
 * ------------------------------------------------------------------ */

/** Normalise anything the user might paste into `<origin>` + `<origin>/api/v1`. */
function normaliseBase(raw) {
  let u = String(raw).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  let parsed;
  try { parsed = new URL(u); }
  catch { throw usage(`invalid instance URL: ${raw}`); }
  // Strip a trailing /api/v1 (or /api) so we control the version segment.
  // Note: assigning back to parsed.pathname would re-normalise '' to '/', so keep it local.
  const basePath = parsed.pathname
    .replace(/\/api(\/v\d+)?\/?$/, '')
    .replace(/\/+$/, '');
  const origin = parsed.origin + basePath;
  return { origin, api: origin + '/api/v1' };
}

function resolveConfig(flags) {
  const env = process.env;
  const rawUrl = flags.url || env.N8N_URL || env.N8N_BASE_URL || env.N8N_HOST || env.N8N_API_URL;
  if (!rawUrl) {
    throw usage(
      'no n8n instance URL',
      'set N8N_URL (e.g. export N8N_URL=https://n8n.example.com) or pass --url <instance-url>',
    );
  }
  const apiKey = flags['api-key'] || flags.apiKey || env.N8N_API_KEY || env.N8N_API_TOKEN;
  const { origin, api } = normaliseBase(rawUrl);
  // Webhook URLs are NOT derived from the API base: n8n lets the host move them
  // (N8N_ENDPOINT_WEBHOOK / _TEST) and, behind a reverse proxy, replace the whole
  // base (N8N_WEBHOOK_URL, aliased by the deprecated WEBHOOK_URL). Flags win, then
  // the environment this client runs in, then the instance origin.
  const trimSlashes = (v) => String(v).replace(/^\/+|\/+$/g, '');
  const webhookBase = flags['webhook-base'] || env.N8N_WEBHOOK_URL || env.WEBHOOK_URL || origin;
  return {
    origin,
    api,
    webhook: {
      base: String(webhookBase).replace(/\/+$/, ''),
      path: trimSlashes(flags['webhook-path'] || env.N8N_ENDPOINT_WEBHOOK || 'webhook'),
      testPath: trimSlashes(flags['webhook-test-path'] || env.N8N_ENDPOINT_WEBHOOK_TEST || 'webhook-test'),
      formPath: trimSlashes(flags['form-path'] || env.N8N_ENDPOINT_FORM || 'form'),
      formTestPath: trimSlashes(flags['form-test-path'] || env.N8N_ENDPOINT_FORM_TEST || 'form-test'),
      customised: Boolean(flags['webhook-base'] || env.N8N_WEBHOOK_URL || env.WEBHOOK_URL
        || flags['webhook-path'] || env.N8N_ENDPOINT_WEBHOOK
        || flags['webhook-test-path'] || env.N8N_ENDPOINT_WEBHOOK_TEST),
    },
    apiKey: apiKey ? String(apiKey).trim() : null,
    timeout: Number(flags.timeout || env.N8N_API_TIMEOUT || 60000),
    debug: Boolean(flags.debug),
    retry: !flags['no-retry'],
    retryUnsafe: Boolean(flags['retry-unsafe']),
  };
}

function requireKey(cfg) {
  if (!cfg.apiKey) {
    throw new CliError('auth', 'no API key', {
      hint: 'set N8N_API_KEY or pass --api-key. Create one in n8n under Settings → n8n API.',
    });
  }
  return cfg.apiKey;
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildUrl(cfg, endpoint, query) {
  const base = /^https?:\/\//i.test(endpoint)
    ? endpoint
    : cfg.api + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
  const url = new URL(base);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url;
}

function classify(status) {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notfound';
  if (status === 429) return 'ratelimit';
  if (status >= 500) return 'server';
  return 'badrequest';
}

function hintFor(status, body, url, authenticated = true) {
  const msg = typeof body?.message === 'string' ? body.message : '';
  // Webhook/form calls go out without the API key on purpose, so a 401/403 there
  // is the trigger node's own auth talking — not a problem with the key.
  if (!authenticated && (status === 401 || status === 403)) {
    return 'this entrypoint was called without the API key (webhooks are public, the key is never sent to them). '
      + "A 401/403 means the trigger node has its own authentication — pass it with --header 'Authorization=…' "
      + "or --header 'X-My-Header=…'.";
  }
  if (status === 401) {
    return 'the API key was rejected — it may be expired, revoked, or issued by another instance. '
      + 'Regenerate it in n8n under Settings → n8n API.';
  }
  if (status === 403) {
    if (/license/i.test(msg)) {
      return 'this endpoint is gated by the instance licence (Enterprise feature) — it is not available here.';
    }
    return 'the key lacks the scope for this endpoint, or the feature is disabled on this instance.';
  }
  if (status === 404) {
    return `nothing at ${url.pathname} — check the id, or run \`spec --grep <term>\` to confirm the endpoint exists on this version.`;
  }
  if (status === 429) return 'rate limited — retry with a smaller --limit or fewer parallel calls.';
  if (status === 400 && /nodes|connections|settings|name/i.test(msg)) {
    return 'workflow payloads must carry name, nodes, connections and settings, and must NOT carry read-only '
      + 'fields (id, active, tags, versionId, …). `workflows update` strips those for you.';
  }
  return null;
}

/**
 * One API call. Retries 429 / 5xx / transient network errors with backoff.
 * Returns { status, headers, body }.
 */
async function apiRequest(cfg, method, endpoint, { query, body, headers, auth = true, raw = false } = {}) {
  const url = buildUrl(cfg, endpoint, query);
  const hdrs = { accept: 'application/json', ...(headers || {}) };
  if (auth) {
    // An absolute endpoint keeps its own origin, so without this the key would travel to whatever
    // host was passed in. Unauthenticated calls (webhooks) are deliberately free to go elsewhere.
    if (/^https?:\/\//i.test(endpoint) && !url.href.startsWith(cfg.api)) {
      throw new CliError('usage', `refusing to send the API key to ${url.origin}`, {
        hint: `absolute URLs are only allowed for the configured instance (${cfg.api}). `
          + 'Pass a path like /workflows, or point --url at that host if it really is your n8n.',
      });
    }
    hdrs['X-N8N-API-KEY'] = requireKey(cfg);
  }
  let payload;
  if (body !== undefined && body !== null) {
    if (typeof body === 'string') { payload = body; hdrs['content-type'] ||= 'application/json'; }
    else { payload = JSON.stringify(body); hdrs['content-type'] = 'application/json'; }
  }

  // A retried POST/PATCH can apply twice: the first attempt may have succeeded server-side and
  // only lost its response. Retry those on 429 alone, where nothing was applied.
  const idempotent = ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'].includes(method);
  const mayRetryFailures = idempotent || cfg.retryUnsafe;
  const maxAttempts = cfg.retry ? 4 : 1;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeout);
    try {
      if (cfg.debug) {
        const shown = { ...hdrs };
        if (shown['X-N8N-API-KEY']) shown['X-N8N-API-KEY'] = '***redacted***';
        process.stderr.write(`[http] ${method} ${url} ${JSON.stringify(shown)}\n`);
      }
      const res = await fetch(url, { method, headers: hdrs, body: payload, signal: ac.signal });
      const text = await res.text();
      let parsed = null;
      if (text) { try { parsed = JSON.parse(text); } catch { parsed = raw ? text : { message: text.slice(0, 500) }; } }

      if (res.ok) return { status: res.status, headers: res.headers, body: parsed };

      const retryable = res.status === 429 || (res.status >= 500 && mayRetryFailures);
      if (retryable && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1);
        log(`[retry ${attempt}/${maxAttempts - 1}] HTTP ${res.status} — waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw new CliError(classify(res.status), parsed?.message || `HTTP ${res.status} on ${method} ${url.pathname}`, {
        status: res.status,
        hint: hintFor(res.status, parsed, url, auth),
        details: parsed,
      });
    } catch (err) {
      if (err instanceof CliError) throw err;
      if (err?.name === 'AbortError') {
        lastErr = new CliError('timeout', `request timed out after ${cfg.timeout}ms: ${method} ${url.pathname}`, {
          hint: 'raise it with --timeout <ms>, or narrow the request (drop --include-data, lower --limit).',
        });
      } else {
        lastErr = new CliError('network', `cannot reach ${url.origin}: ${err?.message || err}`, {
          hint: 'check N8N_URL, DNS, and that the instance is reachable from here.',
        });
      }
      // A network error gives no way to tell "never sent" from "applied, reply lost".
      if (attempt < maxAttempts && mayRetryFailures) { await sleep(500 * 2 ** (attempt - 1)); continue; }
      throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** GET one page, or every page when `all` is set (follows nextCursor). */
async function apiList(cfg, endpoint, query = {}, { all = false, max = Infinity } = {}) {
  const q = { ...query };
  if (q.limit === undefined) q.limit = 100;
  q.limit = Math.min(Number(q.limit) || 100, 250);
  const items = [];
  let cursor = q.cursor || undefined;
  let pages = 0;
  let nextCursor = null;
  for (;;) {
    const { body } = await apiRequest(cfg, 'GET', endpoint, { query: { ...q, cursor } });
    const page = Array.isArray(body) ? body : (body?.data ?? []);
    items.push(...page);
    pages++;
    nextCursor = (Array.isArray(body) ? null : body?.nextCursor) || null;
    if (!all || !nextCursor || items.length >= max) break;
    cursor = nextCursor;
    log(`[page ${pages}] ${items.length} items so far…`);
  }
  return { items: items.slice(0, max === Infinity ? undefined : max), nextCursor: all ? nextCursor : nextCursor, pages };
}

/* ------------------------------------------------------------------ *
 * input helpers
 * ------------------------------------------------------------------ */

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** Body from --data <json> | --file <path> | --stdin. Returns undefined if none given. */
async function readBody(flags, { required = false, what = 'request body' } = {}) {
  let text = null;
  if (flags.stdin) text = await readStdin();
  else if (flags.file) {
    const p = path.resolve(String(flags.file));
    if (!existsSync(p)) throw usage(`file not found: ${p}`);
    text = readFileSync(p, 'utf8');
  } else if (flags.data !== undefined && flags.data !== true) {
    text = String(flags.data);
  }
  if (text === null || text.trim() === '') {
    if (required) throw usage(`missing ${what}`, 'pass --data \'{"…":"…"}\', --file <path.json>, or pipe JSON with --stdin');
    return undefined;
  }
  try { return JSON.parse(text); }
  catch (err) { throw usage(`${what} is not valid JSON: ${err.message}`); }
}

/** `--query a=b --query c=d` → { a: 'b', c: 'd' } */
function pairsToObject(list, flagName) {
  const out = {};
  for (const entry of list) {
    const s = String(entry);
    const eq = s.indexOf('=');
    if (eq === -1) throw usage(`--${flagName} expects key=value, got: ${s}`);
    out[s.slice(0, eq)] = s.slice(eq + 1);
  }
  return out;
}

/** Assign `a.b.c=value` into an object, coercing JSON-ish scalars. */
function setPath(target, dotted, value) {
  const parts = dotted.split('.');
  let node = target;
  for (const key of parts.slice(0, -1)) {
    if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
    node = node[key];
  }
  let coerced = value;
  if (value === 'true') coerced = true;
  else if (value === 'false') coerced = false;
  else if (value === 'null') coerced = null;
  else if (value !== '' && !Number.isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value)) coerced = Number(value);
  else if (/^[[{]/.test(value)) { try { coerced = JSON.parse(value); } catch { /* keep string */ } }
  node[parts.at(-1)] = coerced;
  return target;
}

function writeJsonFile(dir, name, data) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return file;
}

const slug = (s) => String(s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';

/* ------------------------------------------------------------------ *
 * workflow payload hygiene
 * ------------------------------------------------------------------ */

// Server-owned fields. Sending them back on PUT/POST is the #1 source of HTTP 400.
const WORKFLOW_READONLY = [
  'id', 'active', 'createdAt', 'updatedAt', 'isArchived', 'versionId', 'triggerCount',
  'meta', 'tags', 'shared', 'activeVersion', 'homeProject', 'sharedWithProjects',
  'usedCredentials', 'scopes', 'versionCount', 'hash',
  'activeVersionId', 'sourceWorkflowId', 'versionCounter',
];
// `null` means something for these — everywhere else it is just an absent value.
// parentFolderId is writeOnly (a GET never returns it), so keeping an explicit null
// cannot move a workflow by accident on a plain get → update round-trip.
const WORKFLOW_NULLABLE = new Set(['parentFolderId']);
const WORKFLOW_UPDATE_ALLOWED = [
  'name', 'nodes', 'connections', 'settings', 'description', 'staticData', 'pinData',
  'nodeGroups', 'parentFolderId',
];
const WORKFLOW_CREATE_ALLOWED = [...WORKFLOW_UPDATE_ALLOWED, 'projectId'];

/**
 * Strip read-only fields and keep only what the API accepts, so a workflow fetched
 * from GET (or exported from the UI) can be sent straight back.
 */
function sanitiseWorkflow(input, { mode = 'update' } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw usage('workflow payload must be a JSON object');
  }
  const allowed = mode === 'create' ? WORKFLOW_CREATE_ALLOWED : WORKFLOW_UPDATE_ALLOWED;
  const out = {};
  for (const key of allowed) {
    const value = input[key];
    if (value === undefined) continue;
    // A GET returns description: null and friends; the API rejects those. Keep a null
    // only where it carries meaning (see WORKFLOW_NULLABLE).
    if (value === null && !WORKFLOW_NULLABLE.has(key)) continue;
    out[key] = value;
  }

  const dropped = Object.keys(input).filter((k) => !allowed.includes(k));
  if (dropped.length) {
    const readOnly = dropped.filter((k) => WORKFLOW_READONLY.includes(k));
    const unknown = dropped.filter((k) => !WORKFLOW_READONLY.includes(k));
    log('[sanitise] dropped'
      + (readOnly.length ? ` read-only: ${readOnly.join(', ')}` : '')
      + (unknown.length ? ` unknown: ${unknown.join(', ')}` : ''));
  }

  if (!out.name) throw usage('workflow payload has no "name"');
  if (!Array.isArray(out.nodes)) throw usage('workflow payload has no "nodes" array');
  if (!out.connections || typeof out.connections !== 'object') out.connections = {};
  if (!out.settings || typeof out.settings !== 'object') {
    warn('workflow payload had no "settings" — sending {} (the API requires the field)');
    out.settings = {};
  }
  return { payload: out, dropped };
}

/** `--parent-folder <id|root>`: `root` (or an explicit `null`) moves it to the project root. */
function applyParentFolder(payload, flags) {
  const raw = flags['parent-folder'] ?? flags.parentFolder;
  if (raw === undefined) return payload;
  if (raw === true) throw usage('--parent-folder expects a folder id, or "root"');
  const value = String(raw).trim();
  payload.parentFolderId = (value === 'root' || value === 'null' || value === '') ? null : value;
  return payload;
}

/* ------------------------------------------------------------------ *
 * compact projections (default output; --full returns everything)
 * ------------------------------------------------------------------ */

function compactWorkflow(w) {
  return {
    id: w.id,
    name: w.name,
    active: w.active,
    isArchived: w.isArchived,
    triggerCount: w.triggerCount,
    nodeCount: Array.isArray(w.nodes) ? w.nodes.length : undefined,
    tags: Array.isArray(w.tags) ? w.tags.map((t) => t?.name ?? t) : undefined,
    updatedAt: w.updatedAt,
    createdAt: w.createdAt,
  };
}

function compactExecution(e) {
  return {
    id: e.id,
    workflowId: e.workflowId,
    status: e.status,
    mode: e.mode,
    finished: e.finished,
    startedAt: e.startedAt,
    stoppedAt: e.stoppedAt,
    retryOf: e.retryOf ?? undefined,
  };
}

function compactCredential(c) {
  return { id: c.id, name: c.name, type: c.type, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

const COMPACTORS = {
  workflows: compactWorkflow,
  executions: compactExecution,
  credentials: compactCredential,
};

function project(kind, items, flags) {
  if (flags.full || !COMPACTORS[kind]) return items;
  return items.map((item) => {
    const out = COMPACTORS[kind](item);
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
  });
}

/* ------------------------------------------------------------------ *
 * live OpenAPI spec (self-documenting: works against whatever the instance runs)
 * ------------------------------------------------------------------ */

function cachePath(cfg) {
  // Keyed on the whole base, not just the host: two instances can share a host under different
  // paths (…/team-a, …/team-b) and run different n8n versions, so a host-only key serves one
  // instance's spec to the other for 24 hours.
  const u = new URL(cfg.origin);
  const key = `${u.protocol.replace(':', '')}_${u.host}${u.pathname}`
    .replace(/[^a-z0-9._-]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  const dir = process.env.XDG_CACHE_HOME
    ? path.join(process.env.XDG_CACHE_HOME, 'n8n-api')
    : path.join(homedir() || tmpdir(), '.cache', 'n8n-api');
  return path.join(dir, `${key}.openapi.json`);
}

/** Pull the JSON spec out of the Swagger UI bootstrap script (no YAML parser needed). */
function extractSwaggerDoc(text) {
  const key = '"swaggerDoc":';
  const at = text.indexOf(key);
  if (at === -1) return null;
  const start = text.indexOf('{', at);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { i++; while (i < text.length && !(text[i] === '"' && text[i - 1] !== '\\')) i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

/** Minimal YAML fallback: enough to list paths, methods and summaries. */
function parseOpenapiYamlLite(text) {
  const paths = {};
  let currentPath = null;
  let currentMethod = null;
  let inPaths = false;
  for (const line of text.split('\n')) {
    if (/^paths:\s*$/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^[a-z]/i.test(line)) { inPaths = false; }
    if (!inPaths) continue;
    let m = line.match(/^ {2}(\/\S*):\s*$/);
    if (m) { currentPath = m[1]; paths[currentPath] = {}; currentMethod = null; continue; }
    m = line.match(/^ {4}(get|post|put|patch|delete):\s*$/);
    if (m && currentPath) { currentMethod = m[1]; paths[currentPath][currentMethod] = {}; continue; }
    m = line.match(/^ {6}summary:\s*(.+)$/);
    if (m && currentPath && currentMethod) {
      paths[currentPath][currentMethod].summary = m[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return { openapi: 'lite', info: { title: 'n8n Public API', version: 'unknown' }, paths, components: { schemas: {} } };
}

async function loadSpec(cfg, { refresh = false } = {}) {
  const file = cachePath(cfg);
  if (!refresh && existsSync(file)) {
    const age = Date.now() - statSync(file).mtimeMs;
    if (age < 24 * 60 * 60 * 1000) {
      try { return { spec: JSON.parse(readFileSync(file, 'utf8')), source: 'cache', cachedAt: statSync(file).mtime.toISOString() }; }
      catch { /* fall through and refetch */ }
    }
  }
  let spec = null;
  let source = null;
  try {
    const res = await apiRequest(cfg, 'GET', '/docs/swagger-ui-init.js', { auth: false, raw: true });
    if (typeof res.body === 'string') { spec = extractSwaggerDoc(res.body); source = 'swagger-ui-init.js'; }
  } catch { /* try the yaml next */ }
  if (!spec) {
    try {
      const res = await apiRequest(cfg, 'GET', '/openapi.yml', { auth: false, raw: true });
      if (typeof res.body === 'string') { spec = parseOpenapiYamlLite(res.body); source = 'openapi.yml (lite parse)'; }
    } catch { /* handled below */ }
  }
  if (!spec) {
    throw new CliError('notfound', 'could not load the OpenAPI spec from this instance', {
      hint: `tried ${cfg.api}/docs/swagger-ui-init.js and ${cfg.api}/openapi.yml — the built-in playground may be disabled.`,
    });
  }
  try { writeJsonFile(path.dirname(file), path.basename(file), spec); } catch { /* cache is best-effort */ }
  return { spec, source, cachedAt: new Date().toISOString() };
}

function specOperations(spec) {
  const ops = [];
  for (const [p, methods] of Object.entries(spec.paths || {})) {
    for (const [m, op] of Object.entries(methods || {})) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(m)) continue;
      const params = (op.parameters || []).map((prm) => {
        if (prm.$ref) {
          const key = prm.$ref.split('/').pop();
          const resolved = spec.components?.parameters?.[key];
          return resolved ? `${resolved.name}(${resolved.in})` : key;
        }
        const en = prm.schema?.enum ? '=' + prm.schema.enum.join('|') : '';
        return `${prm.name}(${prm.in}${en})`;
      });
      let body;
      const content = op.requestBody?.content;
      if (content) {
        const first = Object.values(content)[0]?.schema || {};
        body = (first.$ref || '').split('/').pop() || first.type || 'object';
      }
      ops.push({ method: m.toUpperCase(), path: p, summary: op.summary || '', params, body, operationId: op.operationId });
    }
  }
  return ops.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/* ------------------------------------------------------------------ *
 * shared command plumbing
 * ------------------------------------------------------------------ */

function confirmed(flags, what) {
  if (flags.yes) return;
  throw usage(`refusing to ${what} without confirmation`, 'add --yes once the user has approved it');
}

async function dryRun(flags, method, endpoint, { query, body } = {}) {
  if (!flags['dry-run']) return false;
  emit({ ok: true, dryRun: true, request: { method, endpoint, query: query || {}, body: body ?? null } });
  return true;
}

/** Resolve a workflow by id, exact name, or unique substring of a name. */
async function resolveWorkflow(cfg, ref, { full = true } = {}) {
  if (!ref) throw usage('missing workflow id or name');
  try {
    const { body } = await apiRequest(cfg, 'GET', `/workflows/${encodeURIComponent(ref)}`, {
      query: full ? {} : { excludePinnedData: 'true' },
    });
    if (body?.id) return body;
  } catch (err) {
    if (err.kind !== 'notfound' && err.kind !== 'badrequest') throw err;
  }
  const { items } = await apiList(cfg, '/workflows', { name: ref, limit: 250, excludePinnedData: 'true' }, { all: true });
  let matches = items;
  if (!matches.length) {
    const { items: everything } = await apiList(cfg, '/workflows', { limit: 250, excludePinnedData: 'true' }, { all: true });
    const needle = String(ref).toLowerCase();
    matches = everything.filter((w) => String(w.name).toLowerCase().includes(needle));
  }
  if (!matches.length) {
    throw new CliError('notfound', `no workflow matches "${ref}"`, { hint: 'run `workflows list` to see ids and names.' });
  }
  if (matches.length > 1) {
    throw usage(
      `"${ref}" matches ${matches.length} workflows`,
      'pass the id instead: ' + matches.slice(0, 8).map((w) => `${w.id} (${w.name})`).join(', '),
    );
  }
  const { body } = await apiRequest(cfg, 'GET', `/workflows/${encodeURIComponent(matches[0].id)}`);
  return body;
}

/** Generic list/get/create/update/delete for the plain resources. */
async function crud(ctx, spec) {
  const { cfg, flags, args } = ctx;
  const [sub = 'list', id, ...rest] = args;
  const base = spec.base;
  const kind = spec.kind;

  switch (sub) {
    case 'list': {
      const query = { limit: flags.limit, cursor: flags.cursor, ...(spec.listQuery ? spec.listQuery(flags) : {}) };
      const { items, nextCursor } = await apiList(cfg, base, query, { all: Boolean(flags.all) });
      return { ok: true, command: `${kind} list`, count: items.length, nextCursor, data: project(kind, items, flags) };
    }
    case 'get': {
      if (!id) throw usage(`${kind} get needs an id`);
      const { body } = await apiRequest(cfg, 'GET', `${base}/${encodeURIComponent(id)}`, {
        query: spec.getQuery ? spec.getQuery(flags) : undefined,
      });
      return { ok: true, command: `${kind} get`, data: body };
    }
    case 'create': {
      if (!spec.create) throw usage(`${kind} create is not supported`);
      const body = (await readBody(flags)) ?? spec.create(flags, [id, ...rest].filter(Boolean));
      if (await dryRun(flags, 'POST', base, { body })) return null;
      const res = await apiRequest(cfg, 'POST', base, { body });
      return { ok: true, command: `${kind} create`, data: res.body };
    }
    case 'update': {
      if (!spec.update) throw usage(`${kind} update is not supported`);
      if (!id) throw usage(`${kind} update needs an id`);
      const body = (await readBody(flags)) ?? spec.update(flags, rest);
      const method = spec.updateMethod || 'PUT';
      if (await dryRun(flags, method, `${base}/${id}`, { body })) return null;
      const res = await apiRequest(cfg, method, `${base}/${encodeURIComponent(id)}`, { body });
      return { ok: true, command: `${kind} update`, data: res.body };
    }
    case 'delete': {
      if (!id) throw usage(`${kind} delete needs an id`);
      confirmed(flags, `delete ${kind} ${id}`);
      if (await dryRun(flags, 'DELETE', `${base}/${id}`)) return null;
      const res = await apiRequest(cfg, 'DELETE', `${base}/${encodeURIComponent(id)}`);
      return { ok: true, command: `${kind} delete`, deleted: id, data: res.body };
    }
    default:
      throw usage(`unknown subcommand: ${kind} ${sub}`, `try: ${['list', 'get', spec.create && 'create', spec.update && 'update', 'delete'].filter(Boolean).join(', ')}`);
  }
}

/* ------------------------------------------------------------------ *
 * workflows
 * ------------------------------------------------------------------ */

async function cmdWorkflows(ctx) {
  const { cfg, flags, args } = ctx;
  const [sub = 'list', ...rest] = args;
  const id = rest[0];

  const simplePost = async (action, label) => {
    const wf = await resolveWorkflow(cfg, id, { full: false });
    if (await dryRun(flags, 'POST', `/workflows/${wf.id}/${action}`)) return null;
    const { body } = await apiRequest(cfg, 'POST', `/workflows/${encodeURIComponent(wf.id)}/${action}`);
    return { ok: true, command: `workflows ${label}`, workflow: { id: wf.id, name: wf.name }, data: compactWorkflow(body ?? wf) };
  };

  switch (sub) {
    case 'list': {
      const query = {
        limit: flags.limit,
        cursor: flags.cursor,
        offset: flags.offset,
        name: flags.name,
        projectId: flags.project || flags.projectId,
        tags: flags.tags,
        excludePinnedData: flags.full ? undefined : 'true',
      };
      if (flags.active) query.active = 'true';
      if (flags.inactive) query.active = 'false';
      const { items, nextCursor } = await apiList(cfg, '/workflows', query, { all: Boolean(flags.all) });
      const filtered = flags.archived ? items.filter((w) => w.isArchived)
        : (flags['include-archived'] ? items : items.filter((w) => !w.isArchived));
      const hidden = items.length - filtered.length;
      return {
        ok: true, command: 'workflows list', count: filtered.length, nextCursor,
        ...(hidden > 0 ? { archivedHidden: hidden, hint: 'pass --include-archived (or --archived) to see them' } : {}),
        data: project('workflows', filtered, flags),
      };
    }

    case 'get': {
      const wf = await resolveWorkflow(cfg, id);
      let written;
      if (flags.out) written = writeJsonFile(path.resolve(String(flags.out)), `${slug(wf.name)}.${wf.id}.json`, wf);
      return { ok: true, command: 'workflows get', written, data: flags.compact ? compactWorkflow(wf) : wf };
    }

    case 'nodes': {
      const wf = await resolveWorkflow(cfg, id);
      const nodes = (wf.nodes || []).map((n) => ({
        name: n.name, type: n.type, typeVersion: n.typeVersion, disabled: n.disabled || undefined,
        credentials: n.credentials ? Object.keys(n.credentials) : undefined, webhookId: n.webhookId,
      }));
      return { ok: true, command: 'workflows nodes', workflow: { id: wf.id, name: wf.name }, count: nodes.length, data: nodes };
    }

    case 'create': {
      const raw = await readBody(flags, { required: true, what: 'workflow JSON' });
      const { payload } = sanitiseWorkflow(raw, { mode: 'create' });
      if (flags.name) payload.name = String(flags.name);
      if (flags.project || flags.projectId) payload.projectId = String(flags.project || flags.projectId);
      applyParentFolder(payload, flags);
      if (await dryRun(flags, 'POST', '/workflows', { body: payload })) return null;
      const { body } = await apiRequest(cfg, 'POST', '/workflows', { body: payload });
      return { ok: true, command: 'workflows create', data: compactWorkflow(body), hint: 'new workflows start inactive — activate with `workflows activate <id>`' };
    }

    case 'update': {
      const raw = await readBody(flags, { required: true, what: 'workflow JSON' });
      const target = id || raw.id;
      if (!target) throw usage('workflows update needs an id (argument or "id" in the payload)');
      const { payload, dropped } = sanitiseWorkflow(raw, { mode: 'update' });
      applyParentFolder(payload, flags);
      for (const entry of flagList(flags, 'set')) {
        const eq = String(entry).indexOf('=');
        if (eq === -1) throw usage(`--set expects key=value, got: ${entry}`);
        setPath(payload, String(entry).slice(0, eq), String(entry).slice(eq + 1));
      }
      const query = flags['publish-if-active'] !== undefined ? { publishIfActive: String(flags['publish-if-active']) } : {};
      if (await dryRun(flags, 'PUT', `/workflows/${target}`, { query, body: payload })) return null;
      const { body } = await apiRequest(cfg, 'PUT', `/workflows/${encodeURIComponent(target)}`, { query, body: payload });
      return { ok: true, command: 'workflows update', droppedFields: dropped, data: compactWorkflow(body) };
    }

    case 'rename': {
      const newName = rest[1];
      if (!newName) throw usage('workflows rename needs: <id-or-name> <new name>');
      const wf = await resolveWorkflow(cfg, id);
      const { payload } = sanitiseWorkflow(wf, { mode: 'update' });
      payload.name = newName;
      if (await dryRun(flags, 'PUT', `/workflows/${wf.id}`, { body: payload })) return null;
      const { body } = await apiRequest(cfg, 'PUT', `/workflows/${encodeURIComponent(wf.id)}`, { body: payload });
      return { ok: true, command: 'workflows rename', from: wf.name, to: newName, data: compactWorkflow(body) };
    }

    case 'delete': {
      const wf = await resolveWorkflow(cfg, id, { full: false });
      confirmed(flags, `delete workflow ${wf.id} (${wf.name})`);
      if (await dryRun(flags, 'DELETE', `/workflows/${wf.id}`)) return null;
      const { body } = await apiRequest(cfg, 'DELETE', `/workflows/${encodeURIComponent(wf.id)}`);
      return { ok: true, command: 'workflows delete', deleted: { id: wf.id, name: wf.name }, data: body };
    }

    case 'activate':   return simplePost('activate', 'activate');
    case 'deactivate': return simplePost('deactivate', 'deactivate');
    case 'archive':    return simplePost('archive', 'archive');
    case 'unarchive':  return simplePost('unarchive', 'unarchive');
    case 'publish':    return simplePost('publish', 'publish');
    case 'unpublish':  return simplePost('unpublish', 'unpublish');

    case 'history': {
      const wf = await resolveWorkflow(cfg, id, { full: false });
      const { items, nextCursor } = await apiList(cfg, `/workflows/${encodeURIComponent(wf.id)}/history`,
        { limit: flags.limit, cursor: flags.cursor }, { all: Boolean(flags.all) });
      return { ok: true, command: 'workflows history', workflow: { id: wf.id, name: wf.name }, count: items.length, nextCursor, data: items };
    }

    case 'version': {
      const versionId = rest[1];
      if (!versionId) throw usage('workflows version needs: <id-or-name> <versionId>', 'list them with `workflows history <id>`');
      const wf = await resolveWorkflow(cfg, id, { full: false });
      const { body } = await apiRequest(cfg, 'GET', `/workflows/${encodeURIComponent(wf.id)}/${encodeURIComponent(versionId)}`);
      return { ok: true, command: 'workflows version', data: body };
    }

    case 'tags': {
      const wf = await resolveWorkflow(cfg, id, { full: false });
      if (flags.set !== undefined) {
        const ids = flagList(flags, 'set').flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
        const body = ids.map((tagId) => ({ id: tagId }));
        if (await dryRun(flags, 'PUT', `/workflows/${wf.id}/tags`, { body })) return null;
        const res = await apiRequest(cfg, 'PUT', `/workflows/${encodeURIComponent(wf.id)}/tags`, { body });
        return { ok: true, command: 'workflows tags set', data: res.body };
      }
      const { body } = await apiRequest(cfg, 'GET', `/workflows/${encodeURIComponent(wf.id)}/tags`);
      return { ok: true, command: 'workflows tags', workflow: { id: wf.id, name: wf.name }, data: body };
    }

    case 'transfer': {
      const projectId = flags.project || flags.projectId || rest[1];
      if (!projectId) throw usage('workflows transfer needs --project <projectId>');
      const wf = await resolveWorkflow(cfg, id, { full: false });
      const body = { destinationProjectId: String(projectId) };
      if (await dryRun(flags, 'PUT', `/workflows/${wf.id}/transfer`, { body })) return null;
      const res = await apiRequest(cfg, 'PUT', `/workflows/${encodeURIComponent(wf.id)}/transfer`, { body });
      return { ok: true, command: 'workflows transfer', data: res.body };
    }

    case 'export': {
      const out = path.resolve(String(flags.out || './n8n-export'));
      let targets;
      if (flags.all || !id) {
        const { items } = await apiList(cfg, '/workflows', { limit: 250 }, { all: true });
        targets = items;
      } else {
        targets = [await resolveWorkflow(cfg, id, { full: false })];
      }
      const written = [];
      for (const meta of targets) {
        const { body } = await apiRequest(cfg, 'GET', `/workflows/${encodeURIComponent(meta.id)}`);
        written.push(writeJsonFile(out, `${slug(body.name)}.${body.id}.json`, body));
        log(`[export] ${body.name} → ${written.at(-1)}`);
      }
      return { ok: true, command: 'workflows export', count: written.length, out, written };
    }

    default:
      throw usage(`unknown subcommand: workflows ${sub}`,
        'list, get, nodes, create, update, rename, delete, activate, deactivate, archive, unarchive, publish, unpublish, history, version, tags, transfer, export');
  }
}

/* ------------------------------------------------------------------ *
 * executions
 * ------------------------------------------------------------------ */

/** Dig the failure out of an execution payload (shape varies across versions). */
function extractFailure(exec) {
  let data = exec?.data;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = null; } }
  const result = data?.resultData;
  if (result?.error) {
    return {
      message: result.error.message || result.error.description || String(result.error),
      node: result.lastNodeExecuted || result.error.node?.name || result.error.nodeName,
      type: result.error.name || result.error.type,
    };
  }
  if (result?.lastNodeExecuted && result.runData) {
    const runs = result.runData[result.lastNodeExecuted];
    const err = Array.isArray(runs) ? runs.find((r) => r?.error)?.error : null;
    if (err) return { message: err.message || String(err), node: result.lastNodeExecuted, type: err.name };
  }
  // Last resort: a bounded search for the first `message` under an `error` key.
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || depth > 8 || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    if (node.error && typeof node.error === 'object' && node.error.message) {
      return { message: node.error.message, node: node.name || undefined, type: node.error.name };
    }
    for (const value of Object.values(node)) {
      const hit = walk(value, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(data, 0);
}

async function cmdExecutions(ctx) {
  const { cfg, flags, args } = ctx;
  const [sub = 'list', id] = args;

  const listQuery = () => ({
    limit: flags.limit,
    cursor: flags.cursor,
    status: flags.status,
    workflowId: flags.workflow || flags.workflowId,
    projectId: flags.project || flags.projectId,
    includeData: flags['include-data'] ? 'true' : undefined,
    ignoreDataSizeLimit: flags['ignore-data-size-limit'] ? 'true' : undefined,
    redactExecutionData: flags.redact ? 'true' : undefined,
  });

  switch (sub) {
    case 'list': {
      let q = listQuery();
      if (q.workflowId && !/^[A-Za-z0-9]{10,}$/.test(String(q.workflowId))) {
        q = { ...q, workflowId: (await resolveWorkflow(cfg, q.workflowId, { full: false })).id };
      }
      const { items, nextCursor } = await apiList(cfg, '/executions', q, { all: Boolean(flags.all) });
      return { ok: true, command: 'executions list', count: items.length, nextCursor, data: project('executions', items, flags) };
    }

    case 'get': {
      if (!id) throw usage('executions get needs an execution id');
      const { body } = await apiRequest(cfg, 'GET', `/executions/${encodeURIComponent(id)}`, {
        query: {
          includeData: flags['include-data'] ? 'true' : undefined,
          ignoreDataSizeLimit: flags['ignore-data-size-limit'] ? 'true' : undefined,
          redactExecutionData: flags.redact ? 'true' : undefined,
        },
      });
      let written;
      if (flags.out) written = writeJsonFile(path.resolve(String(flags.out)), `execution-${id}.json`, body);
      const failure = body?.status === 'error' || body?.status === 'crashed' ? extractFailure(body) : undefined;
      return { ok: true, command: 'executions get', failure, written, data: flags.full ? body : { ...compactExecution(body), data: body.data } };
    }

    /** Why did it fail? — list recent failures with the offending node and message. */
    case 'errors': {
      let workflowId = flags.workflow || flags.workflowId;
      if (workflowId && !/^[A-Za-z0-9]{10,}$/.test(String(workflowId))) {
        workflowId = (await resolveWorkflow(cfg, workflowId, { full: false })).id;
      }
      const max = Number(flags.limit || 5);
      const { items } = await apiList(cfg, '/executions',
        { status: flags.status || 'error', workflowId, limit: Math.min(max, 250) }, { all: false, max });
      const out = [];
      for (const item of items) {
        const { body } = await apiRequest(cfg, 'GET', `/executions/${encodeURIComponent(item.id)}`, { query: { includeData: 'true' } });
        out.push({ ...compactExecution(body), failure: extractFailure(body) });
        log(`[errors] execution ${item.id} inspected`);
      }
      return { ok: true, command: 'executions errors', count: out.length, data: out };
    }

    case 'retry': {
      if (!id) throw usage('executions retry needs an execution id');
      const body = (await readBody(flags)) ?? {};
      if (await dryRun(flags, 'POST', `/executions/${id}/retry`, { body })) return null;
      const res = await apiRequest(cfg, 'POST', `/executions/${encodeURIComponent(id)}/retry`, { body });
      return { ok: true, command: 'executions retry', data: res.body };
    }

    case 'stop': {
      if (!id) throw usage('executions stop needs an execution id (or --all with --workflow)');
      if (await dryRun(flags, 'POST', `/executions/${id}/stop`)) return null;
      const res = await apiRequest(cfg, 'POST', `/executions/${encodeURIComponent(id)}/stop`);
      return { ok: true, command: 'executions stop', data: res.body };
    }

    case 'delete': {
      if (!id) throw usage('executions delete needs an execution id');
      confirmed(flags, `delete execution ${id}`);
      if (await dryRun(flags, 'DELETE', `/executions/${id}`)) return null;
      const res = await apiRequest(cfg, 'DELETE', `/executions/${encodeURIComponent(id)}`);
      return { ok: true, command: 'executions delete', deleted: id, data: res.body };
    }

    case 'tags': {
      if (!id) throw usage('executions tags needs an execution id');
      if (flags.set !== undefined) {
        const ids = flagList(flags, 'set').flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
        const body = ids.map((tagId) => ({ id: tagId }));
        if (await dryRun(flags, 'PUT', `/executions/${id}/tags`, { body })) return null;
        const res = await apiRequest(cfg, 'PUT', `/executions/${encodeURIComponent(id)}/tags`, { body });
        return { ok: true, command: 'executions tags set', data: res.body };
      }
      const { body } = await apiRequest(cfg, 'GET', `/executions/${encodeURIComponent(id)}/tags`);
      return { ok: true, command: 'executions tags', data: body };
    }

    default:
      throw usage(`unknown subcommand: executions ${sub}`, 'list, get, errors, retry, stop, delete, tags');
  }
}

/* ------------------------------------------------------------------ *
 * credentials
 * ------------------------------------------------------------------ */

async function cmdCredentials(ctx) {
  const { cfg, flags, args } = ctx;
  const [sub = 'list', id] = args;

  switch (sub) {
    case 'list': {
      const { items, nextCursor } = await apiList(cfg, '/credentials',
        { limit: flags.limit, cursor: flags.cursor }, { all: Boolean(flags.all) });
      return { ok: true, command: 'credentials list', count: items.length, nextCursor, data: project('credentials', items, flags) };
    }
    case 'get': {
      if (!id) throw usage('credentials get needs an id');
      const { body } = await apiRequest(cfg, 'GET', `/credentials/${encodeURIComponent(id)}`);
      return { ok: true, command: 'credentials get', data: body, note: 'secret values are never returned by the API' };
    }
    case 'schema': {
      if (!id) throw usage('credentials schema needs a credential type name, e.g. `credentials schema slackApi`');
      const { body } = await apiRequest(cfg, 'GET', `/credentials/schema/${encodeURIComponent(id)}`);
      return { ok: true, command: 'credentials schema', type: id, data: body };
    }
    case 'create': {
      const data = (await readBody(flags)) ?? {};
      const payload = data.type && data.name && data.data
        ? data
        : { name: flags.name, type: flags.type, data, ...(flags.project ? { projectId: String(flags.project) } : {}) };
      if (!payload.name || !payload.type) {
        throw usage('credentials create needs --name and --type (plus the secret fields via --data/--file/--stdin)',
          'discover the fields first with `credentials schema <type>`');
      }
      if (await dryRun(flags, 'POST', '/credentials', { body: { ...payload, data: '***' } })) return null;
      const { body } = await apiRequest(cfg, 'POST', '/credentials', { body: payload });
      return { ok: true, command: 'credentials create', data: body };
    }
    case 'update': {
      if (!id) throw usage('credentials update needs an id');
      const body = await readBody(flags, { required: true, what: 'credential JSON' });
      if (await dryRun(flags, 'PATCH', `/credentials/${id}`, { body: { ...body, data: '***' } })) return null;
      const res = await apiRequest(cfg, 'PATCH', `/credentials/${encodeURIComponent(id)}`, { body });
      return { ok: true, command: 'credentials update', data: res.body };
    }
    case 'test': {
      if (!id) throw usage('credentials test needs an id');
      const { body } = await apiRequest(cfg, 'POST', `/credentials/${encodeURIComponent(id)}/test`);
      return { ok: true, command: 'credentials test', data: body };
    }
    case 'transfer': {
      const projectId = flags.project || flags.projectId;
      if (!id || !projectId) throw usage('credentials transfer needs <id> --project <projectId>');
      const body = { destinationProjectId: String(projectId) };
      if (await dryRun(flags, 'PUT', `/credentials/${id}/transfer`, { body })) return null;
      const res = await apiRequest(cfg, 'PUT', `/credentials/${encodeURIComponent(id)}/transfer`, { body });
      return { ok: true, command: 'credentials transfer', data: res.body };
    }
    case 'delete': {
      if (!id) throw usage('credentials delete needs an id');
      confirmed(flags, `delete credential ${id}`);
      if (await dryRun(flags, 'DELETE', `/credentials/${id}`)) return null;
      const res = await apiRequest(cfg, 'DELETE', `/credentials/${encodeURIComponent(id)}`);
      return { ok: true, command: 'credentials delete', deleted: id, data: res.body };
    }
    default:
      throw usage(`unknown subcommand: credentials ${sub}`, 'list, get, schema, create, update, test, transfer, delete');
  }
}

/* ------------------------------------------------------------------ *
 * data tables
 * ------------------------------------------------------------------ */

async function cmdDataTables(ctx) {
  const { cfg, flags, args } = ctx;
  const [sub = 'list', id] = args;
  const rowsBase = (tableId) => `/data-tables/${encodeURIComponent(tableId)}/rows`;

  switch (sub) {
    case 'list': {
      const { items, nextCursor } = await apiList(cfg, '/data-tables',
        { limit: flags.limit, cursor: flags.cursor, filter: flags.filter, sortBy: flags.sort }, { all: Boolean(flags.all) });
      return { ok: true, command: 'data-tables list', count: items.length, nextCursor, data: items };
    }
    case 'get': {
      if (!id) throw usage('data-tables get needs a table id');
      const { body } = await apiRequest(cfg, 'GET', `/data-tables/${encodeURIComponent(id)}`);
      return { ok: true, command: 'data-tables get', data: body };
    }
    case 'columns': {
      if (!id) throw usage('data-tables columns needs a table id');
      const { body } = await apiRequest(cfg, 'GET', `/data-tables/${encodeURIComponent(id)}/columns`);
      return { ok: true, command: 'data-tables columns', data: body };
    }
    case 'rows': {
      if (!id) throw usage('data-tables rows needs a table id');
      const { items, nextCursor } = await apiList(cfg, rowsBase(id),
        { limit: flags.limit, cursor: flags.cursor, filter: flags.filter, sortBy: flags.sort, search: flags.search },
        { all: Boolean(flags.all) });
      return { ok: true, command: 'data-tables rows', count: items.length, nextCursor, data: items };
    }
    case 'create': {
      const body = (await readBody(flags)) ?? {
        name: flags.name,
        columns: flags.columns ? JSON.parse(String(flags.columns)) : undefined,
        ...(flags.project ? { projectId: String(flags.project) } : {}),
      };
      if (!body.name || !Array.isArray(body.columns)) {
        throw usage('data-tables create needs --name and --columns \'[{"name":"item","type":"string"}]\'');
      }
      if (await dryRun(flags, 'POST', '/data-tables', { body })) return null;
      const res = await apiRequest(cfg, 'POST', '/data-tables', { body });
      return { ok: true, command: 'data-tables create', data: res.body };
    }
    case 'add-rows':
    case 'update-rows':
    case 'upsert-rows': {
      if (!id) throw usage(`data-tables ${sub} needs a table id`);
      const body = await readBody(flags, { required: true, what: 'rows JSON' });
      const route = sub === 'add-rows' ? rowsBase(id) : `${rowsBase(id)}/${sub === 'update-rows' ? 'update' : 'upsert'}`;
      const method = sub === 'update-rows' ? 'PATCH' : 'POST';
      if (await dryRun(flags, method, route, { body })) return null;
      const res = await apiRequest(cfg, method, route, { body });
      return { ok: true, command: `data-tables ${sub}`, data: res.body };
    }
    case 'delete-rows': {
      if (!id) throw usage('data-tables delete-rows needs a table id');
      confirmed(flags, `delete rows from data table ${id}`);
      const body = await readBody(flags);
      if (await dryRun(flags, 'DELETE', `${rowsBase(id)}/delete`, { body })) return null;
      const res = await apiRequest(cfg, 'DELETE', `${rowsBase(id)}/delete`, { body, query: flags.filter ? { filter: flags.filter } : undefined });
      return { ok: true, command: 'data-tables delete-rows', data: res.body };
    }
    case 'clear-rows': {
      if (!id) throw usage('data-tables clear-rows needs a table id');
      confirmed(flags, `clear every row of data table ${id}`);
      if (await dryRun(flags, 'DELETE', `${rowsBase(id)}/clear`)) return null;
      const res = await apiRequest(cfg, 'DELETE', `${rowsBase(id)}/clear`);
      return { ok: true, command: 'data-tables clear-rows', data: res.body };
    }
    case 'delete': {
      if (!id) throw usage('data-tables delete needs a table id');
      confirmed(flags, `delete data table ${id}`);
      if (await dryRun(flags, 'DELETE', `/data-tables/${id}`)) return null;
      const res = await apiRequest(cfg, 'DELETE', `/data-tables/${encodeURIComponent(id)}`);
      return { ok: true, command: 'data-tables delete', deleted: id, data: res.body };
    }
    default:
      throw usage(`unknown subcommand: data-tables ${sub}`,
        'list, get, columns, rows, create, add-rows, update-rows, upsert-rows, delete-rows, clear-rows, delete');
  }
}

/* ------------------------------------------------------------------ *
 * trigger — the one thing the REST API cannot do: actually run a workflow
 * ------------------------------------------------------------------ */

const WEBHOOK_NODE_TYPES = new Set(['n8n-nodes-base.webhook']);
const FORM_NODE_TYPES = new Set(['n8n-nodes-base.formTrigger', '@n8n/n8n-nodes-langchain.formTrigger']);
const CHAT_NODE_TYPES = new Set(['@n8n/n8n-nodes-langchain.chatTrigger']);

function describeEntrypoints(wf, cfg) {
  const { base, path: hook, testPath: hookTest, formPath: form, formTestPath: formTest } = cfg.webhook;
  const out = [];
  for (const node of wf.nodes || []) {
    const type = node.type || '';
    const p = node.parameters || {};
    const routePath = p.path || node.webhookId;
    if (WEBHOOK_NODE_TYPES.has(type) && routePath) {
      out.push({
        kind: 'webhook', node: node.name, method: (p.httpMethod || 'GET').toUpperCase(),
        production: `${base}/${hook}/${routePath}`, test: `${base}/${hookTest}/${routePath}`,
        authentication: p.authentication && p.authentication !== 'none' ? p.authentication : undefined,
        disabled: node.disabled || undefined,
      });
    } else if (FORM_NODE_TYPES.has(type) && routePath) {
      out.push({ kind: 'form', node: node.name, method: 'POST', production: `${base}/${form}/${routePath}`, test: `${base}/${formTest}/${routePath}`, disabled: node.disabled || undefined });
    } else if (CHAT_NODE_TYPES.has(type) && routePath) {
      out.push({ kind: 'chat', node: node.name, method: 'POST', production: `${base}/${hook}/${routePath}/chat`, test: `${base}/${hookTest}/${routePath}/chat`, disabled: node.disabled || undefined });
    } else if (/trigger$/i.test(type) || type.endsWith('.cron') || type.endsWith('.interval')) {
      out.push({ kind: 'non-http', node: node.name, type, note: 'fires on its own schedule/event — cannot be called over HTTP' });
    }
  }
  return out;
}

async function cmdTrigger(ctx) {
  const { cfg, flags, args } = ctx;
  const [ref] = args;
  const wf = await resolveWorkflow(cfg, ref);
  const entrypoints = describeEntrypoints(wf, cfg);
  const callable = entrypoints.filter((e) => e.kind !== 'non-http' && !e.disabled);

  if (flags['list-entrypoints'] || flags.raw) {
    return { ok: true, command: 'trigger --list-entrypoints', workflow: { id: wf.id, name: wf.name, active: wf.active }, data: entrypoints };
  }
  if (!callable.length) {
    throw new CliError('badrequest', `workflow "${wf.name}" has no HTTP entrypoint`, {
      hint: 'the n8n API cannot run a workflow on demand — it needs a Webhook / Form / Chat trigger. '
        + 'Triggers found: ' + (entrypoints.map((e) => `${e.node} (${e.type || e.kind})`).join(', ') || 'none'),
      details: entrypoints,
    });
  }
  let target = callable[0];
  if (flags.node) {
    const found = callable.find((e) => e.node === flags.node);
    if (!found) throw usage(`no callable trigger named "${flags.node}"`, 'available: ' + callable.map((e) => e.node).join(', '));
    target = found;
  } else if (callable.length > 1) {
    warn(`workflow has ${callable.length} entrypoints; using "${target.node}" — pick another with --node <name>`);
  }

  const useTest = Boolean(flags.test);
  const url = useTest ? target.test : target.production;
  const method = String(flags.method || target.method || 'POST').toUpperCase();
  if (!useTest && !wf.active) {
    warn(`workflow "${wf.name}" is INACTIVE — the production webhook is not registered and will return 404. `
      + 'Activate it, or use --test (someone must press "Listen for test event" in the editor first).');
  }
  if (target.authentication) {
    warn(`this webhook requires "${target.authentication}" auth — pass it with --header 'Authorization=…'`);
  }

  let body = await readBody(flags);
  const headers = pairsToObject(flagList(flags, 'header'), 'header');

  // fetch throws on a GET/HEAD with a body, so a GET webhook takes its payload as query
  // parameters — which is where n8n reads it from anyway ($json.query).
  let payloadQuery;
  if (['GET', 'HEAD'].includes(method) && body !== undefined) {
    const scalar = body && typeof body === 'object' && !Array.isArray(body)
      && Object.values(body).every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v));
    if (!scalar) {
      throw usage(
        `a ${method} webhook cannot carry a body, and this payload is not flat enough for query parameters`,
        'pass --method POST, or reduce the payload to top-level string/number/boolean fields',
      );
    }
    payloadQuery = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== null).map(([k, v]) => [k, String(v)]),
    );
    log(`[trigger] ${method} entrypoint — payload moved into the query string`);
    body = undefined;
  }

  if (await dryRun(flags, method, url, { query: payloadQuery, body })) return null;

  // Remember where the execution list stood before firing, so --follow can only ever report an
  // execution this call produced — not one from a minute ago or from a concurrent run.
  let baselineId = 0;
  if (flags.follow) {
    const { items } = await apiList(cfg, '/executions', { workflowId: wf.id, limit: 1 });
    baselineId = items[0] ? Number(items[0].id) || 0 : 0;
  }

  log(`[trigger] ${method} ${url}`);
  // Deliberately unauthenticated: a webhook is a public entrypoint, the API key must not leak to it.
  let res;
  try {
    res = await apiRequest(cfg, method, url, { query: payloadQuery, body, headers, auth: false, raw: true });
  } catch (err) {
    if (err.kind === 'notfound') {
      throw new CliError('notfound', `the webhook at ${url} answered 404`, {
        status: 404,
        hint: useTest
          ? 'a test webhook only exists while the editor is open on that workflow with "Listen for test event" pressed.'
          : (wf.active
            ? 'the workflow is active, so the path is probably wrong for this host: n8n can move the webhook '
              + 'endpoints (N8N_ENDPOINT_WEBHOOK / N8N_ENDPOINT_WEBHOOK_TEST) and a reverse proxy can change the '
              + 'base (N8N_WEBHOOK_URL). Override with --webhook-base / --webhook-path, or read the real URL off '
              + 'the node in the n8n editor.'
            : 'the workflow is inactive, so no production webhook is registered — activate it or use --test.'),
        details: { url, webhookBase: cfg.webhook.base, webhookPath: useTest ? cfg.webhook.testPath : cfg.webhook.path },
      });
    }
    throw err;
  }

  let execution;
  if (flags.follow) {
    const deadline = Date.now() + Number(flags['follow-timeout'] || 30000);
    while (Date.now() < deadline) {
      await sleep(1500);
      const { items } = await apiList(cfg, '/executions', { workflowId: wf.id, limit: 1 });
      const latest = items[0];
      if (latest && Number(latest.id) > baselineId) {
        execution = compactExecution(latest);
        if (latest.finished || ['success', 'error', 'crashed', 'canceled'].includes(latest.status)) break;
      }
      log('[follow] waiting for the execution to appear…');
    }
  }

  return {
    ok: true,
    command: 'trigger',
    workflow: { id: wf.id, name: wf.name, active: wf.active },
    entrypoint: {
      node: target.node, kind: target.kind, url, method, mode: useTest ? 'test' : 'production',
      webhookBase: cfg.webhook.base,
    },
    response: { status: res.status, body: res.body },
    execution,
  };
}

/* ------------------------------------------------------------------ *
 * spec / ping / call
 * ------------------------------------------------------------------ */

async function cmdSpec(ctx) {
  const { cfg, flags, args } = ctx;
  const { spec, source, cachedAt } = await loadSpec(cfg, { refresh: Boolean(flags.refresh) });
  const meta = { apiTitle: spec.info?.title, apiVersion: spec.info?.version, source, cachedAt };

  if (flags.schema) {
    const name = String(flags.schema);
    const schema = spec.components?.schemas?.[name];
    if (!schema) {
      const near = Object.keys(spec.components?.schemas || {}).filter((k) => k.toLowerCase().includes(name.toLowerCase()));
      throw new CliError('notfound', `no schema named "${name}"`, { hint: near.length ? 'did you mean: ' + near.join(', ') : 'list them with `spec --schemas`' });
    }
    return { ok: true, command: 'spec --schema', ...meta, data: schema };
  }
  if (flags.schemas) {
    return { ok: true, command: 'spec --schemas', ...meta, data: Object.keys(spec.components?.schemas || {}).sort() };
  }

  let ops = specOperations(spec);
  const pathFilter = flags.path || args[0];
  if (pathFilter) ops = ops.filter((o) => o.path.startsWith(String(pathFilter)));
  if (flags.grep) {
    const re = new RegExp(String(flags.grep), 'i');
    ops = ops.filter((o) => re.test(o.path) || re.test(o.summary) || re.test(o.operationId || ''));
  }
  if (!flags.grep && !pathFilter && !flags.full) {
    const groups = {};
    for (const op of ops) {
      const group = '/' + (op.path.split('/')[1] || '');
      (groups[group] ||= []).push(`${op.method} ${op.path}`);
    }
    return {
      ok: true, command: 'spec', ...meta, operations: ops.length,
      hint: 'narrow it with `spec --grep <term>` or `spec /workflows`; schemas via `spec --schema workflowCreate`',
      data: groups,
    };
  }
  return { ok: true, command: 'spec', ...meta, count: ops.length, data: ops };
}

async function cmdPing(ctx) {
  const { cfg, flags } = ctx;
  const probes = {
    workflows: '/workflows?limit=1',
    executions: '/executions?limit=1',
    credentials: '/credentials?limit=1',
    tags: '/tags?limit=1',
    users: '/users?limit=1',
    variables: '/variables?limit=1',
    projects: '/projects?limit=1',
    'data-tables': '/data-tables?limit=1',
    insights: '/insights/summary',
  };
  const features = {};
  let reachable = false;
  for (const [name, endpoint] of Object.entries(probes)) {
    try {
      await apiRequest({ ...cfg, retry: false }, 'GET', endpoint);
      features[name] = 'ok';
      reachable = true;
    } catch (err) {
      if (err.kind === 'auth') { features[name] = 'unauthorized'; }
      else if (err.kind === 'forbidden') { features[name] = /license/i.test(err.message) ? 'licence-gated' : 'forbidden'; reachable = true; }
      else if (err.kind === 'notfound') { features[name] = 'not-on-this-version'; reachable = true; }
      else { features[name] = err.kind; }
    }
  }
  if (!reachable && Object.values(features).every((v) => v === 'unauthorized')) {
    throw new CliError('auth', 'the API key was rejected by every endpoint', {
      hint: 'regenerate it in n8n under Settings → n8n API, then export N8N_API_KEY.',
    });
  }
  let api = null;
  if (!flags['no-spec']) {
    try {
      const { spec, source } = await loadSpec(cfg);
      api = { title: spec.info?.title, version: spec.info?.version, operations: specOperations(spec).length, source };
    } catch { api = null; }
  }
  return {
    ok: true, command: 'ping', instance: cfg.origin, apiBase: cfg.api,
    webhookBase: `${cfg.webhook.base}/${cfg.webhook.path}` + (cfg.webhook.customised ? '' : ' (default)'),
    keyPresent: Boolean(cfg.apiKey), api, features,
  };
}

async function cmdCall(ctx) {
  const { cfg, flags, args } = ctx;
  let [method, endpoint] = args;
  if (method && !endpoint && method.startsWith('/')) { endpoint = method; method = 'GET'; }
  if (!method || !endpoint) throw usage('call needs: call <METHOD> <path>', 'example: call GET /workflows/{id}/history');
  method = method.toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) throw usage(`unsupported method: ${method}`);
  if (['DELETE'].includes(method)) confirmed(flags, `send ${method} ${endpoint}`);

  const query = pairsToObject(flagList(flags, 'query'), 'query');
  if (flags.limit) query.limit ||= flags.limit;
  if (flags.cursor) query.cursor ||= flags.cursor;
  const body = await readBody(flags);
  const headers = pairsToObject(flagList(flags, 'header'), 'header');

  if (await dryRun(flags, method, endpoint, { query, body })) return null;

  if (flags.all && method === 'GET') {
    const { items, nextCursor, pages } = await apiList(cfg, endpoint, query, { all: true });
    return { ok: true, command: `call ${method} ${endpoint}`, pages, count: items.length, nextCursor, data: items };
  }
  const res = await apiRequest(cfg, method, endpoint, { query, body, headers });
  return { ok: true, command: `call ${method} ${endpoint}`, status: res.status, data: res.body };
}

/* ------------------------------------------------------------------ *
 * plain resources & one-off endpoints
 * ------------------------------------------------------------------ */

const cmdTags = (ctx) => crud(ctx, {
  base: '/tags', kind: 'tags',
  create: (flags) => {
    if (!flags.name) throw usage('tags create needs --name <name>');
    return { name: String(flags.name) };
  },
  update: (flags) => {
    if (!flags.name) throw usage('tags update needs --name <new name>');
    return { name: String(flags.name) };
  },
});

const cmdVariables = (ctx) => crud(ctx, {
  base: '/variables', kind: 'variables',
  listQuery: (flags) => ({ projectId: flags.project || flags.projectId, state: flags.state }),
  create: (flags) => {
    if (!flags.key || flags.value === undefined) throw usage('variables create needs --key and --value');
    return { key: String(flags.key), value: String(flags.value), ...(flags.project ? { projectId: String(flags.project) } : {}) };
  },
  update: (flags) => {
    if (!flags.key || flags.value === undefined) throw usage('variables update needs --key and --value');
    return { key: String(flags.key), value: String(flags.value) };
  },
});

const cmdProjects = (ctx) => crud(ctx, {
  base: '/projects', kind: 'projects',
  create: (flags) => {
    if (!flags.name) throw usage('projects create needs --name <name>');
    return { name: String(flags.name) };
  },
  update: (flags) => {
    if (!flags.name) throw usage('projects update needs --name <new name>');
    return { name: String(flags.name) };
  },
});

async function cmdUsers(ctx) {
  const { cfg, flags, args } = ctx;
  const [sub = 'list', id] = args;
  if (sub === 'list') {
    const { items, nextCursor } = await apiList(cfg, '/users', {
      limit: flags.limit, cursor: flags.cursor, offset: flags.offset,
      includeRole: flags['include-role'] ? 'true' : undefined,
      projectId: flags.project || flags.projectId,
    }, { all: Boolean(flags.all) });
    return { ok: true, command: 'users list', count: items.length, nextCursor, data: items };
  }
  if (sub === 'get') {
    if (!id) throw usage('users get needs an id or email');
    const { body } = await apiRequest(cfg, 'GET', `/users/${encodeURIComponent(id)}`, {
      query: flags['include-role'] ? { includeRole: 'true' } : undefined,
    });
    return { ok: true, command: 'users get', data: body };
  }
  throw usage(`unknown subcommand: users ${sub}`, 'list, get — invites and role changes go through `call POST /users`');
}

async function cmdAudit(ctx) {
  const { cfg, flags } = ctx;
  const additionalOptions = {};
  if (flags.categories) additionalOptions.categories = String(flags.categories).split(',').map((s) => s.trim()).filter(Boolean);
  if (flags.days) additionalOptions.daysAbandonedWorkflow = Number(flags.days);
  const body = Object.keys(additionalOptions).length ? { additionalOptions } : {};
  if (await dryRun(flags, 'POST', '/audit', { body })) return null;
  const { body: report } = await apiRequest(cfg, 'POST', '/audit', { body });
  const summary = Object.fromEntries(Object.entries(report || {}).map(([section, value]) => [section, Array.isArray(value?.sections) ? value.sections.length : undefined]));
  return { ok: true, command: 'audit', summary, data: flags.full ? report : report };
}

async function cmdInsights(ctx) {
  const { cfg, flags } = ctx;
  const { body } = await apiRequest(cfg, 'GET', '/insights/summary', {
    query: { startDate: flags.start, endDate: flags.end, projectId: flags.project || flags.projectId },
  });
  return { ok: true, command: 'insights', data: body };
}

async function cmdSourceControl(ctx) {
  const { cfg, flags, args } = ctx;
  const [sub = 'pull'] = args;
  if (sub !== 'pull') throw usage(`unknown subcommand: source-control ${sub}`, 'only `pull` is exposed by the public API');
  const body = { ...(flags.force ? { force: true } : {}), ...(flags['auto-publish'] ? { autoPublish: String(flags['auto-publish']) } : {}) };
  confirmed(flags, 'pull from source control (this overwrites instance state)');
  if (await dryRun(flags, 'POST', '/source-control/pull', { body })) return null;
  const res = await apiRequest(cfg, 'POST', '/source-control/pull', { body });
  return { ok: true, command: 'source-control pull', data: res.body };
}

async function cmdTestRuns(ctx) {
  const { cfg, flags, args } = ctx;
  const [sub = 'list', ref, runId] = args;
  const wf = await resolveWorkflow(cfg, ref, { full: false });
  const base = `/workflows/${encodeURIComponent(wf.id)}/test-runs`;
  switch (sub) {
    case 'list': {
      const { items, nextCursor } = await apiList(cfg, base, { limit: flags.limit, cursor: flags.cursor, status: flags.status }, { all: Boolean(flags.all) });
      return { ok: true, command: 'test-runs list', workflow: { id: wf.id, name: wf.name }, count: items.length, nextCursor, data: items };
    }
    case 'start': {
      if (await dryRun(flags, 'POST', base)) return null;
      const res = await apiRequest(cfg, 'POST', base, { body: (await readBody(flags)) ?? {} });
      return { ok: true, command: 'test-runs start', data: res.body };
    }
    case 'get': {
      if (!runId) throw usage('test-runs get needs: <workflow> <runId>');
      const { body } = await apiRequest(cfg, 'GET', `${base}/${encodeURIComponent(runId)}`);
      return { ok: true, command: 'test-runs get', data: body };
    }
    case 'cases': {
      if (!runId) throw usage('test-runs cases needs: <workflow> <runId>');
      const { items, nextCursor } = await apiList(cfg, `${base}/${encodeURIComponent(runId)}/test-cases`, { limit: flags.limit, cursor: flags.cursor }, { all: Boolean(flags.all) });
      return { ok: true, command: 'test-runs cases', count: items.length, nextCursor, data: items };
    }
    case 'cancel': {
      if (!runId) throw usage('test-runs cancel needs: <workflow> <runId>');
      if (await dryRun(flags, 'POST', `${base}/${runId}/cancel`)) return null;
      const res = await apiRequest(cfg, 'POST', `${base}/${encodeURIComponent(runId)}/cancel`);
      return { ok: true, command: 'test-runs cancel', data: res.body };
    }
    default:
      throw usage(`unknown subcommand: test-runs ${sub}`, 'list, start, get, cases, cancel');
  }
}

/* ------------------------------------------------------------------ *
 * help
 * ------------------------------------------------------------------ */

const HELP = {
  ping: 'Check connectivity, key validity and which endpoint groups this instance exposes.',
  spec: 'Browse the instance\'s own OpenAPI spec: `spec`, `spec --grep tags`, `spec /workflows`, `spec --schema workflowCreate`.',
  call: 'Any endpoint: `call <METHOD> <path> [--query k=v] [--data JSON|--file f|--stdin] [--all]`.',
  workflows: 'list · get · nodes · create · update · rename · delete · activate · deactivate · archive · unarchive · publish · unpublish · history · version · tags · transfer · export',
  executions: 'list · get · errors · retry · stop · delete · tags',
  credentials: 'list · get · schema · create · update · test · transfer · delete',
  'data-tables': 'list · get · columns · rows · create · add-rows · update-rows · upsert-rows · delete-rows · clear-rows · delete',
  tags: 'list · get · create · update · delete',
  variables: 'list · create · update · delete',
  projects: 'list · create · update · delete',
  users: 'list · get',
  'test-runs': 'list · start · get · cases · cancel  (workflow evaluations)',
  trigger: 'Run a workflow through its Webhook/Form/Chat entrypoint: `trigger <id-or-name> [--data JSON] [--test] [--follow] [--list-entrypoints]`. Webhook host/paths are configurable — see --webhook-base.',
  audit: 'Security audit report: `audit [--categories credentials,nodes] [--days 30]`.',
  insights: 'Instance insights summary: `insights [--start ISO] [--end ISO]`.',
  'source-control': 'pull  (requires --yes)',
};

const GLOBAL_FLAGS = {
  '--url <u>': 'instance URL (else $N8N_URL / $N8N_BASE_URL / $N8N_HOST)',
  '--api-key <k>': 'API key (else $N8N_API_KEY)',
  '--limit <n>': 'page size, max 250 (default 100)',
  '--cursor <c>': 'start from a cursor',
  '--all': 'follow nextCursor and return every page',
  '--full': 'return complete objects instead of the compact projection',
  '--pretty': 'indent the JSON on stdout',
  '--dry-run': 'print the request that would be sent, send nothing',
  '--yes': 'confirm a destructive call (delete, source-control pull)',
  '--data / --file / --stdin': 'request body as inline JSON, a file, or piped JSON',
  '--query k=v': 'extra query parameter (repeatable, `call` only)',
  '--header k=v': 'extra header (repeatable, `call` and `trigger`)',
  '--parent-folder <id>': 'move the workflow into a folder; "root" moves it to the project root',
  '--webhook-base <url>': 'webhook host when it differs from the API host (else $N8N_WEBHOOK_URL)',
  '--webhook-path <seg>': 'production webhook segment (else $N8N_ENDPOINT_WEBHOOK, default "webhook")',
  '--webhook-test-path <seg>': 'test webhook segment (else $N8N_ENDPOINT_WEBHOOK_TEST, default "webhook-test")',
  '--form-path <seg>': 'form segment (else $N8N_ENDPOINT_FORM, default "form")',
  '--timeout <ms>': 'per-request timeout (default 60000)',
  '--retry-unsafe': 'also retry POST/PATCH on 5xx and network errors (may duplicate the operation)',
  '--debug': 'log HTTP details to stderr (the key is redacted)',
};

function helpText() {
  const lines = [
    `n8n-api ${VERSION} — n8n Public REST API client`,
    '',
    'Usage: node n8n-api.mjs <command> [subcommand] [args] [flags]',
    '',
    'Commands:',
    ...Object.entries(HELP).map(([k, v]) => `  ${k.padEnd(15)} ${v}`),
    '',
    'Global flags:',
    ...Object.entries(GLOBAL_FLAGS).map(([k, v]) => `  ${k.padEnd(26)} ${v}`),
    '',
    'Environment: N8N_URL (required), N8N_API_KEY (required for everything but `spec`).',
    'Docs: https://docs.n8n.io/connect/n8n-api/',
  ];
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * dispatch
 * ------------------------------------------------------------------ */

const COMMANDS = {
  ping: cmdPing,
  spec: cmdSpec,
  call: cmdCall,
  workflows: cmdWorkflows,
  workflow: cmdWorkflows,
  executions: cmdExecutions,
  execution: cmdExecutions,
  credentials: cmdCredentials,
  credential: cmdCredentials,
  'data-tables': cmdDataTables,
  'data-table': cmdDataTables,
  tags: cmdTags,
  tag: cmdTags,
  variables: cmdVariables,
  variable: cmdVariables,
  projects: cmdProjects,
  project: cmdProjects,
  users: cmdUsers,
  user: cmdUsers,
  'test-runs': cmdTestRuns,
  trigger: cmdTrigger,
  audit: cmdAudit,
  insights: cmdInsights,
  'source-control': cmdSourceControl,
};

async function main() {
  const { positional, flags } = parseArgv(process.argv.slice(2));
  PRETTY = Boolean(flags.pretty);
  QUIET = Boolean(flags.quiet);

  const [command, ...rest] = positional;

  if (flags.version) { emit({ ok: true, command: 'version', version: VERSION }); return; }
  if (!command || command === 'help' || flags.help) {
    if (flags.json || rest[0] === '--json') { emit({ ok: true, command: 'help', version: VERSION, commands: HELP, flags: GLOBAL_FLAGS }); return; }
    process.stderr.write(helpText() + '\n');
    emit({ ok: true, command: 'help', version: VERSION, commands: Object.keys(COMMANDS) });
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    throw usage(`unknown command: ${command}`, 'available: ' + Object.keys(HELP).join(', '));
  }

  const cfg = resolveConfig(flags);
  const result = await handler({ cfg, flags, args: rest });
  if (result) emit(result);
}

process.on('SIGINT', () => {
  process.stderr.write('\ninterrupted\n');
  process.exit(EXIT.interrupted);
});

main().catch((err) => {
  if (err instanceof CliError) {
    process.stderr.write(`error [${err.kind}] ${err.message}\n` + (err.hint ? `hint: ${err.hint}\n` : ''));
    emit({ ok: false, error: { kind: err.kind, status: err.status, message: err.message, hint: err.hint, details: err.details } }, err.exitCode);
    return;
  }
  process.stderr.write(`error [internal] ${err?.stack || err}\n`);
  emit({ ok: false, error: { kind: 'internal', message: String(err?.message || err) } }, 1);
});
