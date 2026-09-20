#!/usr/bin/env node
// gen.mjs — generate and edit images with Google's Gemini image models (Nano Banana).
//
// Zero-dependency Node (ESM): standard library only, requires Node 18+ (native fetch).
//
// Auth: $GEMINI_IMAGE_API_KEY, else $GEMINI_API_KEY, else ~/.secrets/gemini-api.key.
//       The key is scrubbed out of every line the script prints.
//
// Exit codes: 0 ok · 1 error · 2 usage · 130 interrupted
//             78 (EX_CONFIG) — and only 78 — for any API-key problem: no key,
//             HTTP 401/403, or a 429 from a project without billing. The skill's
//             onboarding flow keys off this code, so nothing else may return it.
//
// Examples:
//   node gen.mjs "a red rubber duck on graph paper" -m lite -a 16:9
//   node gen.mjs "make the background night" -r ./assets/ai-gen/hero.png
//   node gen.mjs --spend --month

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

// ── constants ──────────────────────────────────────────────────────────────

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const KEY_FILE = path.join(homedir(), '.secrets', 'gemini-api.key');
const LEDGER = path.join(homedir(), '.local', 'state', 'ai-gen', 'ledger.jsonl');
const MAX_REFS = 14;
const TIMEOUT_MS = 300_000;
const EX_CONFIG = 78;

// price in USD per generated image, by output size
const MODELS = {
  lite: { id: 'gemini-3.1-flash-lite-image', price: { '1K': 0.034 } },
  flash: {
    id: 'gemini-3.1-flash-image',
    price: { '0.5K': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151 },
  },
  pro: {
    id: 'gemini-3-pro-image',
    price: { '0.5K': 0.134, '1K': 0.134, '2K': 0.134, '4K': 0.24 },
  },
};

const ASPECTS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const SIZES = ['0.5K', '1K', '2K', '4K'];

const MAGIC = [
  [Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png'],
  [Buffer.from('ffd8ff', 'hex'), 'image/jpeg'],
  [Buffer.from('RIFF'), 'image/webp'],
];

// a 429 saying this is an unbilled key, not a rate limit that retrying would clear
const ZERO_QUOTA = /billing|free[_ ]?tier|(?:quota|limit)[^,;\n]{0,24}:\s*['"]?0\b/i;

// what --format accepts; the API decides which a given model actually supports
const FORMATS = { jpeg: ['image/jpeg', '.jpg'], png: ['image/png', '.png'] };
const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
};

// --thumb needs a resizer; none ships with Node, so borrow whatever is installed
const THUMB_TOOLS = [
  ['magick', (src, dst) => [src, '-resize', '512x512>', dst]],
  ['convert', (src, dst) => [src, '-resize', '512x512>', dst]],
  ['ffmpeg', (src, dst) => ['-v', 'error', '-y', '-i', src, '-vf',
    "scale='min(512,iw)':'min(512,ih)':force_original_aspect_ratio=decrease", dst]],
];

// ── errors ─────────────────────────────────────────────────────────────────

/** User-facing error: printed without a stack trace. */
class Fail extends Error {}

/** Bad invocation: argparse-style exit 2. */
class Usage extends Fail {}

/** HTTP error from the API, kept structured so callers can react to it. */
class ApiError extends Fail {
  constructor(code, message, explained) {
    super(explained);
    this.code = code;
    this.apiMessage = message;
  }
}

/** No usable API key: exits EX_CONFIG so a caller can onboard and retry. */
class AuthFail extends Fail {
  constructor(message, reason) {
    super(message);
    this.reason = reason;
  }
}

// ── auth ───────────────────────────────────────────────────────────────────

async function loadKey() {
  const env = process.env.GEMINI_IMAGE_API_KEY || process.env.GEMINI_API_KEY;
  if (env) return env.trim();
  const fromFile = await readFile(KEY_FILE, 'utf8').then((t) => t.trim(), () => '');
  if (fromFile) return fromFile;
  throw new AuthFail(
    `No API key. Put one in ${KEY_FILE} (chmod 600) or set $GEMINI_IMAGE_API_KEY.\n` +
    'Get it at https://aistudio.google.com/apikey and enable billing on the linked\n' +
    'Cloud project - image models have no free tier, an unbilled key gets quota 0.',
    'no_key',
  );
}

/** Never let the key reach stdout/stderr/logs. */
function scrub(text, key) {
  return key ? String(text).split(key).join('<key>') : String(text);
}

// ── request bits ───────────────────────────────────────────────────────────

function sniffMime(file, data) {
  for (const [magic, mime] of MAGIC) {
    if (data.subarray(0, magic.length).equals(magic)) return mime;
  }
  const guessed = MIME_BY_EXT[path.extname(file).toLowerCase()];
  if (guessed) return guessed;
  throw new Fail(`${file}: not a recognisable image (png/jpeg/webp expected)`);
}

async function loadRefs(paths) {
  if (paths.length > MAX_REFS) {
    throw new Fail(`At most ${MAX_REFS} reference images, got ${paths.length}.`);
  }
  const refs = [];
  for (const p of paths) {
    const file = expandUser(p);
    const data = await readFile(file).catch(() => null);
    if (!data) throw new Fail(`Reference image not found: ${file}`);
    refs.push({ path: file, mime: sniffMime(file, data), b64: data.toString('base64') });
  }
  return refs;
}

function buildInteractionsBody(modelId, prompt, refs, aspect, size, prevId, mime) {
  const input = [{ type: 'text', text: prompt }];
  for (const r of refs) input.push({ type: 'image', mime_type: r.mime, data: r.b64 });
  const body = {
    model: modelId,
    input,
    response_format: {
      type: 'image',
      mime_type: mime,
      aspect_ratio: aspect,
      image_size: size,
    },
  };
  if (prevId) body.previous_interaction_id = prevId;
  return body;
}

function buildGenerateContentBody(prompt, refs, aspect, size) {
  const parts = [{ text: prompt }];
  for (const r of refs) parts.push({ inline_data: { mime_type: r.mime, data: r.b64 } });
  return {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: aspect, imageSize: size },
    },
  };
}

/** Copy of the request with base64 blobs shortened, for --dry-run. */
function redactBody(node) {
  if (Array.isArray(node)) return node.map((v) => redactBody(v));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [
      k,
      (k === 'data' || k === 'b64') && typeof v === 'string' && v.length > 64
        ? `<base64 ${v.length} bytes>`
        : redactBody(v),
    ]));
  }
  return node;
}

// ── http + parsing ─────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, body, key) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      last = [0, String(e.message || e)];
      if (attempt < 2) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new Fail(`Network error talking to the Gemini API: ${scrub(e.message || e, key)}`);
    }
    if (res.ok) return res.json();

    const detail = await res.text().catch(() => '');
    last = [res.status, detail];
    const { message, explained, auth } = explainHttp(res.status, scrub(detail, key));
    if (auth) throw new AuthFail(explained, auth);
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 2) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    throw new ApiError(res.status, message, explained);
  }
  throw new Fail(`Gemini API unreachable after 3 attempts: ${last}`);
}

function explainHttp(code, detail) {
  let msg = detail;
  try {
    msg = JSON.parse(detail)?.error?.message ?? detail;
  } catch {
    /* not JSON: keep the raw body */
  }
  let hint = '';
  let auth = null;
  if (code === 429) {
    hint = '\nHint: image models have no free tier. If the quota reads 0, enable\n' +
           'billing on the Cloud project behind this API key.';
    auth = ZERO_QUOTA.test(msg) ? 'billing' : null;
  } else if (code === 401 || code === 403) {
    hint = '\nHint: the API key looks invalid or lacks access to the Gemini API.';
    auth = 'bad_key';
  } else if (code === 400 && msg.toLowerCase().includes('safety')) {
    hint = '\nHint: the prompt was blocked by safety filters - rephrase it.';
  }
  return { message: msg, explained: `Gemini API returned HTTP ${code}: ${msg}${hint}`, auth };
}

/** Models differ on output mime; the 400 tells us which one to use. */
function supportedMime(message) {
  if (!message.includes('response_format.mime_type')) return null;
  return message.match(/Supported values:\s*'([^']+)'/)?.[1] ?? null;
}

/** Pull (mime, bytes) out of a response without depending on its exact shape. */
function findImage(obj) {
  const hits = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      const mime = node.mime_type || node.mimeType || '';
      const data = node.data;
      if (typeof data === 'string' && data.length > 512) {
        if (mime.startsWith('image/')) hits.push([0, mime, data]);
        else if (!mime) hits.push([1, 'image/png', data]);
      }
      Object.values(node).forEach(walk);
    }
  };
  walk(obj);
  for (const [, , data] of hits.sort((a, b) => a[0] - b[0])) {
    const raw = Buffer.from(data, 'base64');
    for (const [magic, real] of MAGIC) {
      if (raw.subarray(0, magic.length).equals(magic)) return [real, raw];
    }
  }
  return [null, null];
}

function findInteractionId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of ['interaction_id', 'interactionId', 'id', 'name']) {
    if (typeof obj[key] === 'string' && obj[key]) return obj[key];
  }
  return obj.interaction ? findInteractionId(obj.interaction) : null;
}

/** When no image comes back, the model usually explains why in text. */
function refusalText(obj) {
  const out = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      if (typeof node.text === 'string' && node.text.trim()) out.push(node.text.trim());
      Object.values(node).forEach(walk);
    }
  };
  walk(obj);
  return out.join(' ').slice(0, 500);
}

// ── output io ──────────────────────────────────────────────────────────────

function expandUser(p) {
  return p.startsWith('~') ? path.join(homedir(), p.slice(1)) : path.resolve(p);
}

function slugify(text) {
  const s = text.replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().toLowerCase()
    .replace(/[\s_]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '');
  return s || 'image';
}

function stamped(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
         `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function localIso(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
         `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function defaultOut(prompt, stamp, ext) {
  return path.join(process.cwd(), 'assets', 'ai-gen', `${slugify(prompt)}-${stamp}${ext}`);
}

function withSuffix(file, ext) {
  return path.join(path.dirname(file), path.basename(file, path.extname(file)) + ext);
}

function indexed(file, i, total) {
  if (total === 1) return file;
  const ext = path.extname(file);
  return path.join(path.dirname(file), `${path.basename(file, ext)}-${i + 1}${ext}`);
}

function writeThumb(file) {
  const thumb = withSuffix(file, '.thumb.png');
  for (const [tool, argv] of THUMB_TOOLS) {
    const run = spawnSync(tool, argv(file, thumb), { stdio: ['ignore', 'ignore', 'pipe'] });
    if (run.error) continue; // not installed, try the next one
    if (run.status === 0) return thumb;
    process.stderr.write(`thumb: ${tool} failed: ${String(run.stderr).trim()}\n`);
    return null;
  }
  process.stderr.write('thumb: no resizer found (magick, convert or ffmpeg), skipped\n');
  return null;
}

/** Pixel size straight from the file header — no image library needed. */
function imageSize(raw) {
  if (raw.subarray(0, 8).equals(MAGIC[0][0])) {
    return [raw.readUInt32BE(16), raw.readUInt32BE(20), 'PNG'];
  }
  if (raw.subarray(0, 3).equals(MAGIC[1][0])) {
    let i = 2;
    while (i + 9 < raw.length) {
      if (raw[i] !== 0xff) { i += 1; continue; }
      const marker = raw[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return [raw.readUInt16BE(i + 7), raw.readUInt16BE(i + 5), 'JPEG'];
      }
      // standalone markers (padding, RSTn, SOI/EOI) carry no length field
      if (marker === 0xff) { i += 1; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
      i += 2 + raw.readUInt16BE(i + 2);
    }
    return null;
  }
  if (raw.subarray(0, 4).toString() === 'RIFF' && raw.subarray(8, 12).toString() === 'WEBP') {
    const chunk = raw.subarray(12, 16).toString();
    if (chunk === 'VP8X') {
      return [raw.readUIntLE(24, 3) + 1, raw.readUIntLE(27, 3) + 1, 'WEBP'];
    }
    if (chunk === 'VP8 ') {
      const sync = raw.indexOf(Buffer.from('9d012a', 'hex'), 20);
      if (sync > 0) {
        return [raw.readUInt16LE(sync + 3) & 0x3fff, raw.readUInt16LE(sync + 5) & 0x3fff, 'WEBP'];
      }
    }
    if (chunk === 'VP8L') {
      const bits = raw.readUInt32LE(21);
      return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1, 'WEBP'];
    }
  }
  return null;
}

function describe(raw) {
  const size = imageSize(raw);
  return size ? `${size[0]}x${size[1]} ${size[2]}` : `${raw.length} bytes`;
}

async function logSpend(record) {
  await mkdir(path.dirname(LEDGER), { recursive: true });
  await appendFile(LEDGER, `${JSON.stringify(record)}\n`);
}

async function showSpend(monthOnly) {
  const text = await readFile(LEDGER, 'utf8').catch(() => null);
  if (text === null) {
    console.log(`No ledger yet at ${LEDGER} - nothing generated so far.`);
    return 0;
  }
  const prefix = monthOnly ? localIso(new Date()).slice(0, 7) : '';
  const rows = [];
  let total = 0;
  for (const line of text.split('\n')) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (prefix && !String(rec.ts ?? '').startsWith(prefix)) continue;
    rows.push(rec);
    total += Number(rec.cost_usd) || 0;
  }
  const scope = prefix ? `${prefix} ` : 'all time, ';
  for (const rec of rows.slice(-15)) {
    console.log(
      `${String(rec.ts ?? '?').padEnd(20)} ${String(rec.model ?? '?').padEnd(26)} ` +
      `${String(rec.size ?? '?').padEnd(5)} $${(Number(rec.cost_usd) || 0).toFixed(3)}  ` +
      `${rec.out ?? ''}`,
    );
  }
  if (rows.length > 15) console.log(`... ${rows.length - 15} earlier rows omitted`);
  console.log(`\n${rows.length} images (${scope}estimated) = $${total.toFixed(2)}`);
  return 0;
}

// ── argv ───────────────────────────────────────────────────────────────────

const HELP = `usage: gen.mjs [-h] [-o OUT] [-m {lite,flash,pro}] [-a ASPECT] [-s SIZE]
               [-f {jpeg,png}] [-r FILE] [-n COUNT] [--continue ID] [--thumb]
               [--json] [--dry-run] [--yes] [--spend] [--month] [prompt]

Generate or edit images with Gemini image models (Nano Banana).

positional arguments:
  prompt                what to draw, or how to change --ref images

options:
  -h, --help            show this help message and exit
  -o, --out OUT         output path (default ./assets/ai-gen/<slug>-<ts>.jpg)
  -m, --model MODEL     ${Object.keys(MODELS).join(', ')} (default: flash)
  -a, --aspect ASPECT   ${ASPECTS.join(' ')} (default: 1:1)
  -s, --size SIZE       ${SIZES.join(' ')} (default: 1K)
  -f, --format FORMAT   output format; falls back automatically if the model refuses it
  -r, --ref FILE        reference image to edit or draw from, repeatable (max ${MAX_REFS})
  -n, --count COUNT     number of variants
  --continue ID         refine a previous result (interaction_id from its sidecar)
  --thumb               also write a 512px preview
  --json                machine-readable result on stdout
  --dry-run             show the request and cost, no call
  --yes                 skip the confirmation for large batches
  --spend               report spend from the ledger and exit
  --month               with --spend: current month only

example: gen.mjs "a red rubber duck on graph paper" -m lite -a 16:9`;

const VALUED = {
  '-o': 'out', '--out': 'out',
  '-m': 'model', '--model': 'model',
  '-a': 'aspect', '--aspect': 'aspect',
  '-s': 'size', '--size': 'size',
  '-f': 'format', '--format': 'format',
  '-n': 'count', '--count': 'count',
  '--continue': 'continueId',
};
const SWITCHES = {
  '--thumb': 'thumb', '--json': 'json', '--dry-run': 'dryRun',
  '--yes': 'yes', '--spend': 'spend', '--month': 'month',
};

function choice(name, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Usage(`argument ${name}: invalid choice: '${value}' ` +
                    `(choose from ${allowed.join(', ')})`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    prompt: null, out: null, model: 'flash', aspect: '1:1', size: '1K',
    format: 'jpeg', ref: [], count: 1, continueId: null,
    thumb: false, json: false, dryRun: false, yes: false, spend: false, month: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    let token = argv[i];
    let inline = null;
    const eq = token.startsWith('--') ? token.indexOf('=') : -1;
    if (eq > 0) {
      inline = token.slice(eq + 1);
      token = token.slice(0, eq);
    }
    const value = () => {
      if (inline !== null) return inline;
      if (i + 1 >= argv.length) throw new Usage(`argument ${token}: expected one argument`);
      i += 1;
      return argv[i];
    };

    if (token === '-h' || token === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (token in SWITCHES) {
      if (inline !== null) throw new Usage(`argument ${token}: ignored explicit argument`);
      args[SWITCHES[token]] = true;
    } else if (token === '-r' || token === '--ref') {
      args.ref.push(value());
    } else if (token in VALUED) {
      args[VALUED[token]] = value();
    } else if (token.startsWith('-') && token !== '-') {
      throw new Usage(`unrecognized argument: ${token}`);
    } else if (args.prompt === null) {
      args.prompt = token;
    } else {
      throw new Usage(`unrecognized argument: ${token}`);
    }
  }
  args.model = choice('-m/--model', args.model, Object.keys(MODELS));
  args.aspect = choice('-a/--aspect', args.aspect, ASPECTS);
  args.size = choice('-s/--size', args.size, SIZES);
  args.format = choice('-f/--format', args.format, Object.keys(FORMATS));
  if (!/^-?\d+$/.test(String(args.count))) {
    throw new Usage(`argument -n/--count: invalid int value: '${args.count}'`);
  }
  args.count = Number(args.count);
  return args;
}

// ── main ───────────────────────────────────────────────────────────────────

async function run(args) {
  if (args.spend) return showSpend(args.month);
  if (!args.prompt) {
    throw new Fail('Nothing to draw. Pass a prompt, or --spend to see the ledger.');
  }

  const model = MODELS[args.model];
  let size = args.size;
  if (args.model === 'lite' && size !== '1K') {
    process.stderr.write(`note: ${model.id} only does 1K, using that instead of ${size}\n`);
    size = '1K';
  }
  const unit = model.price[size];

  if (args.count < 1) throw new Fail('--count must be at least 1.');
  if (args.count > 4 && !args.yes) {
    throw new Fail(`--count ${args.count} would cost about ` +
                   `$${(unit * args.count).toFixed(2)}. Re-run with --yes if that is intended.`);
  }
  if (args.model === 'pro' && size === '4K') {
    process.stderr.write(`note: pro at 4K costs ~$${unit.toFixed(2)} per image\n`);
  }

  const refs = await loadRefs(args.ref);
  const [reqMime, ext] = FORMATS[args.format];
  const now = new Date();
  const outBase = args.out ? expandUser(args.out) : defaultOut(args.prompt, stamped(now), ext);

  const body = buildInteractionsBody(model.id, args.prompt, refs, args.aspect, size,
                                     args.continueId, reqMime);

  if (args.dryRun) {
    console.log(`POST ${API_ROOT}/interactions`);
    console.log(JSON.stringify(redactBody(body), null, 2));
    console.log(`\nwould write ${args.count} image(s) to ${outBase}`);
    console.log(`estimated cost: ${args.count} x $${unit.toFixed(3)} = ` +
                `$${(unit * args.count).toFixed(3)}`);
    return 0;
  }

  const key = await loadKey();
  const results = [];
  for (let i = 0; i < args.count; i += 1) {
    let payload;
    try {
      payload = await post(`${API_ROOT}/interactions`, body, key);
    } catch (e) {
      const fallback = e instanceof ApiError && e.code === 400 ? supportedMime(e.apiMessage) : null;
      if (!fallback) throw e;
      process.stderr.write(
        `note: ${model.id} does not emit ${reqMime}, retrying as ${fallback}\n`);
      body.response_format.mime_type = fallback;
      payload = await post(`${API_ROOT}/interactions`, body, key);
    }
    let [mime, raw] = findImage(payload);
    if (raw === null) {
      // older/alternate surface: models/<id>:generateContent
      if (args.continueId) {
        throw new Fail('No image came back and --continue is only supported by the ' +
                       'interactions endpoint, so there is no fallback to try.');
      }
      const alt = buildGenerateContentBody(args.prompt, refs, args.aspect, size);
      payload = await post(`${API_ROOT}/models/${model.id}:generateContent`, alt, key);
      [mime, raw] = findImage(payload);
    }
    if (raw === null) {
      const why = refusalText(payload);
      throw new Fail(`The API returned no image.${why ? ` Model said: ${why}` : ''}`);
    }

    let file = indexed(outBase, i, args.count);
    const realExt = EXT_BY_MIME[mime];
    if (realExt && !['.jpeg', realExt].includes(path.extname(file).toLowerCase())) {
      file = withSuffix(file, realExt);
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, raw);

    const interactionId = findInteractionId(payload);
    const meta = {
      ts: localIso(new Date()),
      prompt: args.prompt,
      model: model.id,
      aspect: args.aspect,
      size,
      refs: refs.map((r) => r.path),
      previous_interaction_id: args.continueId,
      interaction_id: interactionId,
      cost_usd_estimate: unit,
    };
    await writeFile(`${file}.json`, JSON.stringify(meta, null, 2));
    await logSpend({
      ts: meta.ts, model: model.id, size, cost_usd: unit, out: file,
      prompt_sha: createHash('sha256').update(args.prompt).digest('hex').slice(0, 12),
    });

    const thumb = args.thumb ? writeThumb(file) : null;
    results.push({
      path: file, interaction_id: interactionId, thumb,
      cost_usd_estimate: unit, info: describe(raw),
    });
  }

  if (args.json) {
    console.log(JSON.stringify({
      model: model.id, size, aspect: args.aspect, images: results,
      cost_usd_estimate: Number((unit * args.count).toFixed(3)),
    }, null, 2));
  } else {
    for (const r of results) {
      console.log(`${r.path}  (${r.info})`);
      if (r.thumb) console.log(`  thumb: ${r.thumb}`);
      if (r.interaction_id) console.log(`  refine with: --continue ${r.interaction_id}`);
    }
    console.log(`${model.id} ${size} ${args.aspect} - ` +
                `estimated $${(unit * args.count).toFixed(3)} for ${args.count} image(s)`);
  }
  return 0;
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`gen.mjs: error: ${e.message}\n`);
    return 2;
  }
  try {
    return await run(args);
  } catch (e) {
    if (e instanceof AuthFail) {
      process.stderr.write(`error: IMAGEGEN_AUTH: ${e.message}\n`);
      if (args.json) {
        console.log(JSON.stringify(
          { error: 'auth', reason: e.reason, message: e.message }, null, 2));
      }
      return EX_CONFIG;
    }
    if (e instanceof Fail) {
      process.stderr.write(`error: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

process.on('SIGINT', () => process.exit(130));
process.exitCode = await main(process.argv.slice(2));
