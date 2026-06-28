# Meshy API reference (`meshy.mjs`)

Full endpoint and parameter reference for the bundled CLI. Load this on demand; the
lean workflow lives in `SKILL.md`. Run `node meshy.mjs help` for a quick command list.

- **Base URL:** `https://api.meshy.ai/openapi/` (override with `--base-url`)
- **Auth:** `--api-key`, else `$MESHY_AI_API_KEY`, else `$MESHY_API_KEY`. Keys are `msy_...`.
- **Test key (free, no credits):** `msy_dummy_api_key_for_test_mode_12345678`
- **Async lifecycle:** every generation `POST` returns a `task_id`; the CLI polls
  `GET <endpoint>/<id>` until `status` is terminal, then optionally downloads assets.
- **Status enum:** `PENDING` → `IN_PROGRESS` → `SUCCEEDED` | `FAILED` | `CANCELED`; `progress` is 0–100.
- **Asset URLs are short-lived signed URLs** (models retained ≤ ~3 days). Always `--out <dir>` to save promptly; `download` re-fetches the task once if a URL has expired.

## Global options

| Option | Meaning | Default |
|---|---|---|
| `--api-key <key>` | override env key | — |
| `--base-url <url>` | API base | `https://api.meshy.ai/openapi/` |
| `--out <dir>` | download finished assets to `<dir>` | — (no download) |
| `--formats glb,fbx` | model formats to download | `glb` |
| `--textures` / `--thumbnail` / `--all` | also download texture maps / thumbnail / everything | off |
| `--no-wait` | create the task, print its id, exit (no polling) | waits |
| `--wait` | (for `status`) poll until terminal | off |
| `--poll-timeout <ms>` | total wait before giving up | `1200000` (20 min) |
| `--interval <ms>` | poll interval | `5000` |
| `--request-timeout <ms>` | per-HTTP-request timeout | `60000` |
| `--retries <n>` | retries for 429 / transient network (exp. backoff) | `5` |
| `--json '{...}'` | raw request body (merged **under** typed flags) | — |
| `--param key=value` | set any API field; value parsed as JSON if possible, else string | — |
| `--pretty` | pretty-print the JSON output | off |
| `--quiet` / `--verbose` | suppress / expand STDERR progress | normal |

**Body-merge precedence:** command presets < `--json` < typed flags < `--param`.
Flag names accept dashes or underscores (`--target-polycount` = `--target_polycount`).
Booleans support `--flag`, `--flag=false`, and `--no-flag`. Unknown flags are a usage
error (exit 2) — use `--param`/`--json` for fields without a dedicated flag.

## Output JSON (STDOUT, exactly one object)

Success (generate / status):
```json
{ "ok": true, "command": "text-to-3d", "type": "text-to-3d", "task_id": "...",
  "status": "SUCCEEDED", "waited": true, "task": { /* full API task object */ },
  "downloads": { "out_dir": "...", "written": [{"asset":"model","format":"glb","path":"...","bytes":123}],
                 "skipped": [{"asset":"model","format":"usdz","reason":"not available"}], "errors": [] },
  "credits_consumed": 5, "meta": { "elapsed_ms": 65000, "api_base": "..." } }
```
`balance` → `{ "ok": true, "command": "balance", "balance": 835 }`.
`list` → `{ "ok": true, "command": "list", "type": "...", "page_num":1, "page_size":10, "count": N, "tasks": [...] }`.
Failure → `{ "ok": false, "command": "...", "error": { "kind", "message", "status", "code", "doc_url", "task_id", "retryable" }, "meta": {...} }`.

## Exit codes

`0` ok · `1` generic · `2` usage · `3` auth · `4` credits · `5` rate-limit ·
`6` not-found · `7` task-failed · `8` timeout · `9` network · `130` interrupted.

## Endpoints

All paths are relative to the base URL. Create = `POST`, retrieve/list = `GET`.
`(id|url)` means supply exactly one of `--input-task-id` or `--model-url`.

### `text-to-3d` — `v2/text-to-3d`  (alias `refine`)
Preview: `--prompt` (≤600, required), `--ai-model meshy-5|meshy-6|latest`,
`--should-remesh`, `--model-type standard|lowpoly`, `--topology quad|triangle`,
`--target-polycount 100..300000`, `--pose-mode a-pose|t-pose|""`, `--target-formats`,
`--moderation`, `--auto-size`, `--alpha-thumbnail`, `--origin-at bottom|center`,
`--decimation-mode 1..4`, `--seed`.
Refine (`--mode refine` or the `refine` alias): `--preview-task-id` (required),
`--enable-pbr`, `--hd-texture`, `--texture-prompt`, `--texture-image-url`, `--remove-lighting`.
→ `model_urls {glb,fbx,obj,mtl,usdz,stl}`, `texture_urls[]`, `thumbnail_url`. Preview ≈ 5–20 credits, refine ≈ 10.

### `image-to-3d` — `v1/image-to-3d`
`--image-url <url|dataURI>` or `--image <local path>` (auto-base64) or `--input-task-id`;
`--should-texture`, `--enable-pbr`, `--hd-texture`, `--ai-model`, `--should-remesh`,
`--target-polycount`, `--target-formats`, `--image-enhancement`, `--remove-lighting`,
`--texture-prompt`, `--texture-image-url`, `--pose-mode`, `--auto-size`. ≈ 20–30 credits.

### `multi-image-to-3d` — `v1/multi-image-to-3d`
`--images a.png,b.png` (1–4 local/URL) or `--image-urls` or `--input-task-id`; plus the
`image-to-3d` texture/mesh flags. → also `thumbnail_urls{front,right,back,left}`.

### `retexture` — `v1/retexture`
`(id|url)` + one of `--text-style-prompt` / `--image-style-url`; `--enable-original-uv`,
`--enable-pbr`, `--hd-texture`, `--ai-model`, `--remove-lighting`, `--target-formats`,
`--alpha-thumbnail`. ≈ 10 credits.

### `remesh` — `v1/remesh`
`(id|url)`, `--target-formats` (glb,fbx,obj,usdz,blend,stl,3mf), `--topology quad|triangle`,
`--target-polycount 100..300000`, `--origin-at`. ≈ 5 credits.

### `rigging` (alias `rig`) — `v1/rigging`
`(id|url)`, `--character-height` / `--height-meters`, `--texture-image-url`.
→ `rigged_character_glb_url`. ≈ 5 credits.

### `animation` (alias `animate`) — `v1/animation`
`--rig-task-id` (required), `--action` / `--animation-id`.
→ `animated_model_glb_url`, `video_url`. ≈ 3 credits.

### `text-to-image` — `v1/text-to-image`
`--ai-model nano-banana|nano-banana-2|nano-banana-pro|gpt-image-2` (required),
`--prompt` (required), `--aspect-ratio`, `--generate-multi-view`, `--pose-mode`.
→ `image_urls[]`. ≈ 3–9 credits.

### `image-to-image` — `v1/image-to-image`
`--ai-model` + `--prompt` + one of `--image-url`/`--image`/`--input-task-id`,
`--aspect-ratio`. → `image_urls[]`. ≈ 3–12 credits.

### `convert` — `v1/convert`
`(id|url)` + `--target-formats` (required). ≈ 1 credit.

### `resize` — `v1/resize`
`(id|url)` + one of `--resize-height` / `--resize-longest-side` / `--auto-size`;
`--origin-at bottom|center`. ≈ 1 credit.

### `uv-unwrap` — `v1/uv-unwrap`
`(id|url)` — **`.glb` only**. → `model_urls.glb`, `thumbnail_url`. ≈ 5 credits.

### `analyze-printability` — `v1/analyze-printability`
`(id|url)`. Returns watertightness / volume / hole / non-manifold metrics in the task
object. **Free** (0 credits).

### `repair-printability` — `v1/repair-printability`
`(id|url)`. → repaired `model_urls`. ≈ 10 credits.

### `multi-color-print` — `v1/multi-color-print`
`(id|url)` (textured model). → multi-color 3MF. ≈ 10 credits. Color-palette options
(1–16 colors) via `--param` / `--json` (thinly documented).

### `creative-lab` — `creative-lab/<product>/v1/<stage>`  (EXPERIMENTAL)
`--product keychain|fridge-magnet|figure|lamp`, `--stage prototype|build`.
Prototype: `--prompt` or `--image-url`/`--image`. Build: `--input-task-id` (the prototype
task). Prototype ≈ 6 credits, build ≈ 30. Response schema is thinly documented — use
`--param`/`--json` for product-specific options and inspect the raw `task` in the output.

### Account & task management
- `balance` — `GET v1/balance` → `{ "balance": N }`.
- `status <type> <id>` — task snapshot; add `--wait` to poll to terminal.
- `list <type>` — `GET <endpoint>` with `--page-num` (1), `--page-size` (≤50, default 10),
  `--sort-by +created_at|-created_at` (default `-created_at`).
- `download <type> <id> --out <dir>` — re-fetch a finished task and download its assets
  (always fresh signed URLs). Combine with `--formats` / `--all`.

## Rate limits

Pro 20 req/s & 10 queued tasks; Studio 20 & 20; Enterprise 100 & 50+. A `429`
(`RateLimitExceeded` / `NoMoreConcurrentTasks`) is retried automatically with backoff;
after `--retries` are exhausted it surfaces as exit `5`.
