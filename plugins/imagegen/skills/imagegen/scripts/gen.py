#!/usr/bin/env python3
"""Generate and edit images with Google's Gemini image models (Nano Banana).

Standalone: stdlib only. PIL is used opportunistically (validation, --thumb)
and the script still works without it.
"""

import argparse
import base64
import binascii
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from hashlib import sha256
from pathlib import Path

API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
KEY_FILE = Path.home() / ".secrets" / "gemini-api.key"
LEDGER = Path.home() / ".local" / "state" / "ai-gen" / "ledger.jsonl"
MAX_REFS = 14
TIMEOUT = 300
EX_CONFIG = 78

# price in USD per generated image, by output size
MODELS = {
    "lite": {
        "id": "gemini-3.1-flash-lite-image",
        "price": {"1K": 0.034},
    },
    "flash": {
        "id": "gemini-3.1-flash-image",
        "price": {"0.5K": 0.045, "1K": 0.067, "2K": 0.101, "4K": 0.151},
    },
    "pro": {
        "id": "gemini-3-pro-image",
        "price": {"0.5K": 0.134, "1K": 0.134, "2K": 0.134, "4K": 0.24},
    },
}

ASPECTS = ["1:1", "3:2", "2:3", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
SIZES = ["0.5K", "1K", "2K", "4K"]

MAGIC = [
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"RIFF", "image/webp"),
]

# a 429 saying this is an unbilled key, not a rate limit that retrying would clear
ZERO_QUOTA = re.compile(r"billing|free[_ ]?tier|(?:quota|limit)[^,;\n]{0,24}:\s*['\"]?0\b", re.I)

# what --format accepts; the API decides which a given model actually supports
FORMATS = {"jpeg": ("image/jpeg", ".jpg"), "png": ("image/png", ".png")}
EXT_BY_MIME = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


class Fail(Exception):
    """User-facing error: printed without a traceback."""


class ApiError(Fail):
    """HTTP error from the API, kept structured so callers can react to it."""

    def __init__(self, code, message, explained):
        super().__init__(explained)
        self.code = code
        self.message = message


class AuthFail(Fail):
    """No usable API key: exits EX_CONFIG so a caller can onboard and retry."""

    def __init__(self, message, reason):
        super().__init__(message)
        self.reason = reason


# --------------------------------------------------------------------------- auth

def load_key():
    key = os.environ.get("GEMINI_IMAGE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if key:
        return key.strip()
    if KEY_FILE.exists():
        key = KEY_FILE.read_text().strip()
        if key:
            return key
    raise AuthFail(
        f"No API key. Put one in {KEY_FILE} (chmod 600) or set $GEMINI_IMAGE_API_KEY.\n"
        "Get it at https://aistudio.google.com/apikey and enable billing on the linked\n"
        "Cloud project - image models have no free tier, an unbilled key gets quota 0.",
        "no_key",
    )


def scrub(text, key):
    """Never let the key reach stdout/stderr/logs."""
    return text.replace(key, "<key>") if key else text


# ------------------------------------------------------------------- request bits

def sniff_mime(path, data):
    for magic, mime in MAGIC:
        if data.startswith(magic):
            return mime
    guessed = mimetypes.guess_type(str(path))[0]
    if guessed and guessed.startswith("image/"):
        return guessed
    raise Fail(f"{path}: not a recognisable image (png/jpeg/webp expected)")


def load_refs(paths):
    if len(paths) > MAX_REFS:
        raise Fail(f"At most {MAX_REFS} reference images, got {len(paths)}.")
    refs = []
    for p in paths:
        path = Path(p).expanduser()
        if not path.is_file():
            raise Fail(f"Reference image not found: {path}")
        data = path.read_bytes()
        refs.append({"path": str(path), "mime": sniff_mime(path, data),
                     "b64": base64.b64encode(data).decode()})
    return refs


def build_interactions_body(model_id, prompt, refs, aspect, size, prev_id, mime):
    inputs = [{"type": "text", "text": prompt}]
    for r in refs:
        inputs.append({"type": "image", "mime_type": r["mime"], "data": r["b64"]})
    body = {
        "model": model_id,
        "input": inputs,
        "response_format": {
            "type": "image",
            "mime_type": mime,
            "aspect_ratio": aspect,
            "image_size": size,
        },
    }
    if prev_id:
        body["previous_interaction_id"] = prev_id
    return body


def build_generate_content_body(prompt, refs, aspect, size):
    parts = [{"text": prompt}]
    for r in refs:
        parts.append({"inline_data": {"mime_type": r["mime"], "data": r["b64"]}})
    return {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": aspect, "imageSize": size},
        },
    }


def redact_body(body):
    """Copy of the request with base64 blobs shortened, for --dry-run."""
    def walk(o):
        if isinstance(o, dict):
            return {k: ("<base64 %d bytes>" % len(v)
                        if k in ("data", "b64") and isinstance(v, str) and len(v) > 64
                        else walk(v))
                    for k, v in o.items()}
        if isinstance(o, list):
            return [walk(v) for v in o]
        return o
    return walk(body)


# ------------------------------------------------------------------ http + parsing

def post(url, body, key):
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            last = (e.code, detail)
            if e.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            message, explained, auth = explain_http(e.code, scrub(detail, key))
            if auth:
                raise AuthFail(explained, auth)
            raise ApiError(e.code, message, explained)
        except urllib.error.URLError as e:
            last = (0, str(e))
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            raise Fail(f"Network error talking to the Gemini API: {scrub(str(e), key)}")
    raise Fail(f"Gemini API unreachable after 3 attempts: {last}")


def explain_http(code, detail):
    try:
        msg = json.loads(detail).get("error", {}).get("message", detail)
    except (ValueError, AttributeError):
        msg = detail
    hint, auth = "", None
    if code == 429:
        hint = ("\nHint: image models have no free tier. If the quota reads 0, enable\n"
                "billing on the Cloud project behind this API key.")
        auth = "billing" if ZERO_QUOTA.search(msg) else None
    elif code in (401, 403):
        hint = "\nHint: the API key looks invalid or lacks access to the Gemini API."
        auth = "bad_key"
    elif code == 400 and "safety" in msg.lower():
        hint = "\nHint: the prompt was blocked by safety filters - rephrase it."
    return msg, f"Gemini API returned HTTP {code}: {msg}{hint}", auth


def supported_mime(message):
    """Models differ on output mime; the 400 tells us which one to use."""
    if "response_format.mime_type" not in message:
        return None
    m = re.search(r"Supported values:\s*'([^']+)'", message)
    return m.group(1) if m else None


def find_image(obj):
    """Pull (mime, base64) out of a response without depending on its exact shape."""
    hits = []

    def walk(node):
        if isinstance(node, dict):
            mime = node.get("mime_type") or node.get("mimeType") or ""
            data = node.get("data")
            if isinstance(data, str) and len(data) > 512:
                if mime.startswith("image/"):
                    hits.append((0, mime, data))
                elif not mime:
                    hits.append((1, "image/png", data))
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(obj)
    for _, mime, data in sorted(hits, key=lambda h: h[0]):
        try:
            raw = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError):
            continue
        for magic, real in MAGIC:
            if raw.startswith(magic):
                return real, raw
    return None, None


def find_interaction_id(obj):
    for key in ("interaction_id", "interactionId", "id", "name"):
        val = obj.get(key) if isinstance(obj, dict) else None
        if isinstance(val, str) and val:
            return val
    inner = obj.get("interaction") if isinstance(obj, dict) else None
    if isinstance(inner, dict):
        return find_interaction_id(inner)
    return None


def refusal_text(obj):
    """When no image comes back, the model usually explains why in text."""
    out = []

    def walk(node):
        if isinstance(node, dict):
            t = node.get("text")
            if isinstance(t, str) and t.strip():
                out.append(t.strip())
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(obj)
    return " ".join(out)[:500]


# ----------------------------------------------------------------------- output io

def slugify(text):
    s = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE).strip().lower()
    s = re.sub(r"[\s_]+", "-", s)[:40].strip("-")
    return s or "image"


def default_out(prompt, stamp, ext):
    return Path.cwd() / "assets" / "ai-gen" / f"{slugify(prompt)}-{stamp}{ext}"


def indexed(path, i, total):
    if total == 1:
        return path
    return path.with_name(f"{path.stem}-{i + 1}{path.suffix}")


def write_thumb(path):
    try:
        from PIL import Image
    except ImportError:
        print("thumb: Pillow not available, skipped", file=sys.stderr)
        return None
    thumb = path.with_name(f"{path.stem}.thumb.png")
    with Image.open(path) as im:
        im.thumbnail((512, 512))
        im.convert("RGB").save(thumb)
    return thumb


def describe(path):
    try:
        from PIL import Image
        with Image.open(path) as im:
            return f"{im.width}x{im.height} {im.format}"
    except Exception:
        return f"{path.stat().st_size} bytes"


def log_spend(record):
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER.open("a") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def show_spend(month_only):
    if not LEDGER.exists():
        print(f"No ledger yet at {LEDGER} - nothing generated so far.")
        return 0
    prefix = datetime.now().strftime("%Y-%m") if month_only else ""
    rows, total = [], 0.0
    for line in LEDGER.read_text().splitlines():
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if prefix and not rec.get("ts", "").startswith(prefix):
            continue
        rows.append(rec)
        total += float(rec.get("cost_usd") or 0)
    scope = f"{prefix} " if prefix else "all time, "
    for rec in rows[-15:]:
        print(f"{rec.get('ts', '?'):<20} {rec.get('model', '?'):<26} "
              f"{rec.get('size', '?'):<5} ${float(rec.get('cost_usd') or 0):.3f}  "
              f"{rec.get('out', '')}")
    if len(rows) > 15:
        print(f"... {len(rows) - 15} earlier rows omitted")
    print(f"\n{len(rows)} images ({scope}estimated) = ${total:.2f}")
    return 0


# --------------------------------------------------------------------------- main

def parse_args(argv):
    p = argparse.ArgumentParser(
        prog="gen.py",
        description="Generate or edit images with Gemini image models (Nano Banana).",
        epilog='example: gen.py "a red rubber duck on graph paper" -m lite -a 16:9',
    )
    p.add_argument("prompt", nargs="?", help="what to draw, or how to change --ref images")
    p.add_argument("-o", "--out", help="output path (default ./assets/ai-gen/<slug>-<ts>.jpg)")
    p.add_argument("-m", "--model", choices=list(MODELS), default="flash")
    p.add_argument("-a", "--aspect", choices=ASPECTS, default="1:1")
    p.add_argument("-s", "--size", choices=SIZES, default="1K")
    p.add_argument("-f", "--format", choices=list(FORMATS), default="jpeg",
                   help="output format; falls back automatically if the model refuses it")
    p.add_argument("-r", "--ref", action="append", default=[], metavar="FILE",
                   help=f"reference image to edit or draw from, repeatable (max {MAX_REFS})")
    p.add_argument("-n", "--count", type=int, default=1, help="number of variants")
    p.add_argument("--continue", dest="continue_id", metavar="ID",
                   help="refine a previous result (interaction_id from its sidecar)")
    p.add_argument("--thumb", action="store_true", help="also write a 512px preview")
    p.add_argument("--json", action="store_true", help="machine-readable result on stdout")
    p.add_argument("--dry-run", action="store_true", help="show the request and cost, no call")
    p.add_argument("--yes", action="store_true", help="skip the confirmation for large batches")
    p.add_argument("--spend", action="store_true", help="report spend from the ledger and exit")
    p.add_argument("--month", action="store_true", help="with --spend: current month only")
    return p.parse_args(argv)


def run(args):
    if args.spend:
        return show_spend(args.month)
    if not args.prompt:
        raise Fail("Nothing to draw. Pass a prompt, or --spend to see the ledger.")

    model = MODELS[args.model]
    size = args.size
    if args.model == "lite" and size != "1K":
        print(f"note: {model['id']} only does 1K, using that instead of {size}",
              file=sys.stderr)
        size = "1K"
    unit = model["price"][size]

    if args.count < 1:
        raise Fail("--count must be at least 1.")
    if args.count > 4 and not args.yes:
        raise Fail(f"--count {args.count} would cost about ${unit * args.count:.2f}. "
                   "Re-run with --yes if that is intended.")
    if args.model == "pro" and size == "4K":
        print(f"note: pro at 4K costs ~${unit:.2f} per image", file=sys.stderr)

    refs = load_refs(args.ref)
    req_mime, ext = FORMATS[args.format]
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_base = (Path(args.out).expanduser() if args.out
                else default_out(args.prompt, stamp, ext))

    body = build_interactions_body(model["id"], args.prompt, refs,
                                   args.aspect, size, args.continue_id, req_mime)

    if args.dry_run:
        print(f"POST {API_ROOT}/interactions")
        print(json.dumps(redact_body(body), indent=2, ensure_ascii=False))
        print(f"\nwould write {args.count} image(s) to {out_base}")
        print(f"estimated cost: {args.count} x ${unit:.3f} = ${unit * args.count:.3f}")
        return 0

    key = load_key()
    results = []
    for i in range(args.count):
        try:
            payload = post(f"{API_ROOT}/interactions", body, key)
        except ApiError as e:
            fallback = supported_mime(e.message) if e.code == 400 else None
            if not fallback:
                raise
            print(f"note: {model['id']} does not emit {req_mime}, retrying as {fallback}",
                  file=sys.stderr)
            body["response_format"]["mime_type"] = fallback
            payload = post(f"{API_ROOT}/interactions", body, key)
        mime, raw = find_image(payload)
        if raw is None:
            # older/alternate surface: models/<id>:generateContent
            if args.continue_id:
                raise Fail("No image came back and --continue is only supported by the "
                           "interactions endpoint, so there is no fallback to try.")
            alt = build_generate_content_body(args.prompt, refs, args.aspect, size)
            payload = post(f"{API_ROOT}/models/{model['id']}:generateContent", alt, key)
            mime, raw = find_image(payload)
        if raw is None:
            why = refusal_text(payload)
            raise Fail("The API returned no image." + (f" Model said: {why}" if why else ""))

        path = indexed(out_base, i, args.count)
        real_ext = EXT_BY_MIME.get(mime)
        if real_ext and path.suffix.lower() not in (real_ext, ".jpeg"):
            path = path.with_suffix(real_ext)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)

        interaction_id = find_interaction_id(payload)
        meta = {
            "ts": datetime.now().isoformat(timespec="seconds"),
            "prompt": args.prompt,
            "model": model["id"],
            "aspect": args.aspect,
            "size": size,
            "refs": [r["path"] for r in refs],
            "previous_interaction_id": args.continue_id,
            "interaction_id": interaction_id,
            "cost_usd_estimate": unit,
        }
        path.with_suffix(path.suffix + ".json").write_text(
            json.dumps(meta, indent=2, ensure_ascii=False))
        log_spend({"ts": meta["ts"], "model": model["id"], "size": size,
                   "cost_usd": unit, "out": str(path),
                   "prompt_sha": sha256(args.prompt.encode()).hexdigest()[:12]})

        thumb = write_thumb(path) if args.thumb else None
        results.append({"path": str(path), "interaction_id": interaction_id,
                        "thumb": str(thumb) if thumb else None,
                        "cost_usd_estimate": unit, "info": describe(path)})

    if args.json:
        print(json.dumps({"model": model["id"], "size": size, "aspect": args.aspect,
                          "images": results,
                          "cost_usd_estimate": round(unit * args.count, 3)},
                         indent=2, ensure_ascii=False))
    else:
        for r in results:
            print(f"{r['path']}  ({r['info']})")
            if r["thumb"]:
                print(f"  thumb: {r['thumb']}")
            if r["interaction_id"]:
                print(f"  refine with: --continue {r['interaction_id']}")
        print(f"{model['id']} {size} {args.aspect} - "
              f"estimated ${unit * args.count:.3f} for {args.count} image(s)")
    return 0


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        return run(args)
    except AuthFail as e:
        print(f"error: IMAGEGEN_AUTH: {e}", file=sys.stderr)
        if args.json:
            print(json.dumps({"error": "auth", "reason": e.reason, "message": str(e)},
                             indent=2, ensure_ascii=False))
        return EX_CONFIG
    except Fail as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
