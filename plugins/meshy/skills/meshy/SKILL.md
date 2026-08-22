---
name: meshy
description: Generate 3D assets from text or images via the Meshy AI API — text-to-3D and image-to-3D models, multi-image-to-3D, re-texturing, remeshing, auto-rigging, animation, 2D image generation, format conversion/resize/UV-unwrap, and 3D-printing prep. Use this skill whenever the user wants to create / generate / make a 3D model, mesh, or texture, turn a prompt or photo into 3D, rig or animate a character, check their Meshy credit balance, or otherwise mentions Meshy. Drives a bundled zero-dependency Node CLI; no MCP server needed.
disable-model-invocation: false
user-invocable: true
allowed-tools: >-
  Read AskUserQuestion
  Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)
---

Generate 3D assets with the **Meshy AI** REST API through a bundled, zero-dependency Node CLI (`meshy.mjs`). The script handles auth, the async create→poll→download lifecycle, retries, and asset downloads; you just choose a command, run it, and parse its JSON output.

## Requirements (check before first use)

- **Node 18+** must be on PATH (`node --version`). If missing, tell the user to install Node — the script cannot run without it.
- An API key in **`$MESHY_AI_API_KEY`** (or `$MESHY_API_KEY`, or pass `--api-key`). Keys look like `msy_...` and are created at https://www.meshy.ai/settings/api. There is a free, no-cost **test key** `msy_dummy_api_key_for_test_mode_12345678` that returns sample assets without spending credits — use it for dry-runs.

## How to run it

```bash
node "${CLAUDE_SKILL_DIR}/scripts/meshy.mjs" <command> [options]
```

**Output contract — rely on this, don't re-read files:**
- **STDOUT** is exactly one JSON object. Parse it; never scrape the human text.
- **STDERR** carries progress lines (`[text-to-3d <id> IN_PROGRESS 42% • 30s]`) and warnings.
- **Exit codes:** `0` ok · `2` usage · `3` auth (no/invalid key) · `4` insufficient credits · `5` rate-limit · `6` not-found · `7` task failed · `8` poll timeout · `9` network · `130` interrupted.

The script **polls internally** until the task finishes — do **not** write your own polling loop. For very long jobs you may pass `--no-wait` (returns the `task_id` immediately) and later resume with `status` / `download`.

## Core workflow

1. **Pre-flight:** confirm `node` exists and a key is set. Optionally run `node "${CLAUDE_SKILL_DIR}/scripts/meshy.mjs" balance` to show remaining credits before spending.
2. **Pick the command** from the user's intent (see table below; full parameters in `docs/api-reference.md`).
3. **Run it.** Generation commands cost credits — for anything beyond a trivial request, briefly confirm with the user first, and prefer the **test key** when validating an approach.
4. **Always pass `--out <dir>`** when the user wants the asset saved — result URLs are signed and **expire within ~days**. Without `--out` the JSON still contains the URLs but nothing is downloaded.
5. **Parse the JSON**, then report: the `status`, where files were written (`downloads.written[].path`), `credits_consumed`, and any `downloads.skipped` / `downloads.errors`. On a non-zero exit, read `error.kind` / `error.message` and explain it (e.g. `credits` → out of credits, `auth` → key problem). If a long job was interrupted or timed out, the `task_id` in the output lets you resume with `download <type> <id> --out <dir>`.

## Commands (most common)

| Intent | Command |
|---|---|
| Text → 3D model | `text-to-3d --prompt "a red ceramic mug"` |
| Higher-quality textured pass | `refine --preview-task-id <id> --enable-pbr` |
| Image → 3D model | `image-to-3d --image ./photo.png` (local file is auto-base64'd) or `--image-url <url>` |
| Several images → 3D | `multi-image-to-3d --images a.png,b.png,c.png` |
| Re-texture a model | `retexture --input-task-id <id> --text-style-prompt "weathered bronze"` |
| Remesh (topology/polycount) | `remesh --input-task-id <id> --topology quad --target-polycount 20000` |
| Auto-rig a character | `rig --input-task-id <id>` |
| Animate a rigged model | `animate --rig-task-id <id> --action <action>` |
| Text → 2D image | `text-to-image --ai-model nano-banana --prompt "..."` |
| Convert / resize / UV-unwrap | `convert --input-task-id <id> --target-formats glb,fbx` · `resize` · `uv-unwrap` |
| Credit balance | `balance` |
| Task snapshot / resume | `status <type> <id>` (add `--wait` to block) |
| Download a finished task | `download <type> <id> --out <dir> [--all]` |
| Full help / catalog | `help` · `help --json` |

Useful options: `--out <dir>`, `--formats glb,fbx` (default `glb`), `--textures`/`--thumbnail`/`--all`, `--no-wait`, `--ai-model meshy-5|meshy-6|latest`, `--pretty`. Any API field not exposed as a flag is reachable via `--param key=value` or `--json '{...}'`.

## Notes & gotchas

- **Credits:** preview text-to-3d ≈ 5 (meshy-5) or up to 20 (meshy-6/lowpoly); refine ≈ 10; image-to-3d 20–30; rig/animate/remesh small. `analyze-printability` is free. Check `balance` if unsure; an exit code `4` means out of credits.
- **`meshy-5`** is the cheapest model for a quick text-to-3d preview; default `ai_model` is `latest`.
- **Don't hand-roll base64** for images — pass a local path to `--image` / `--images` / `--texture-image-url` and the CLI encodes it.
- **Creative Lab** (`creative-lab --product <keychain|fridge-magnet|figure|lamp> --stage prototype|build`) is experimental and thinly documented; rely on `--param`/`--json` for its body.
- For the complete endpoint/parameter reference, read **`docs/api-reference.md`** in this skill directory (`${CLAUDE_SKILL_DIR}/docs/api-reference.md`) — load it on demand, not every run.
