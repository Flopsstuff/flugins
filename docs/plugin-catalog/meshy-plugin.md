# Meshy Plugin

**Name:** `meshy`

**Description:** Generate 3D models, textures, rigs and animations from text or images via the Meshy AI API

**Author:** Flop (flopspm@gmail.com)

**Version:** 0.1.0

**Keywords:** meshy, 3d, ai, text-to-3d, image-to-3d, generative, model-generation

The Meshy plugin gives Claude Code access to the full [Meshy AI](https://www.meshy.ai) 3D generation API through a **single zero-dependency Node script** (`meshy.mjs`) wrapped in a model-invoked skill. It deliberately avoids the official MCP server: an MCP server loads all of its tool schemas into context on every session, while a skill loads only its one-line description until it's actually needed — far cheaper for an API you reach for occasionally. The script runs identically on macOS, Linux, and Windows (it only needs Node), with no `npm install` and no build step.

## Installation

```bash
claude plugin install meshy@flugins
```

**Important:** After installing the plugin, restart Claude Code to activate skills.

**Tip:** Enable auto-update via `/plugin` → **Installed** → select the plugin → enable auto-update.

## Requirements

- **Node.js 18+** on `PATH` (`node --version`) — the script uses native `fetch` and streams; no other runtime or dependency is required.
- A **Meshy API key** in the `MESHY_AI_API_KEY` environment variable (or `MESHY_API_KEY`, or passed via `--api-key`). Create one at [meshy.ai/settings/api](https://www.meshy.ai/settings/api). Keys look like `msy_...`.
- Credits on your Meshy account for paid operations. A free, no-cost **test key** (`msy_dummy_api_key_for_test_mode_12345678`) returns sample assets without spending credits — handy for dry-runs.

## Features

### Skills

- [Meshy 3D Generation](#meshy-3d-generation) - Generate 3D models, textures, rigs, animations and images from text or photos, check credit balance, and download finished assets

### Usage

Ask in natural language — *"make a 3D model of a red ceramic mug"*, *"turn this photo into a 3D model"*, *"rig this character"*, *"how many Meshy credits do I have?"* — and the skill activates automatically. It picks the right endpoint, runs the bundled CLI (which handles the asynchronous create → poll → download lifecycle internally), parses the single JSON object the script prints, and reports where the files were saved and how many credits were spent. For long jobs it can fire-and-forget with `--no-wait` and resume later with `status` / `download`.

### Configuration

No plugin-specific configuration. The skill reads the API key from the environment (`MESHY_AI_API_KEY` / `MESHY_API_KEY`) or a `--api-key` flag, and the script ships sensible defaults (20-minute poll timeout, 5-second poll interval, automatic retry with backoff on rate limits). The full endpoint and parameter reference lives in `skills/meshy/docs/api-reference.md` and is loaded on demand rather than into every session.

---

## Meshy 3D Generation

**Skill:** `meshy`
**Type:** Model-invoked (automatic) / user-invocable

Drives the entire Meshy REST API from one generic client. The script exposes every endpoint behind a uniform `create → poll → download` engine and prints exactly one machine-readable JSON object to STDOUT (progress goes to STDERR), so Claude never has to scrape human text or write its own polling loop.

### How it Activates

The skill activates whenever you mention 3D generation or Meshy. Examples:

- "generate a 3D model of a low-poly tree"
- "turn this image into a 3D mesh"
- "re-texture this model to look like weathered bronze"
- "rig and animate this character"
- "check my Meshy balance"

You can also invoke it explicitly from the `/` menu.

### Capabilities

| Area | Commands |
|------|----------|
| 3D generation | `text-to-3d` (+ `refine`), `image-to-3d`, `multi-image-to-3d` |
| Post-processing | `retexture`, `remesh`, `rig`, `animate`, `convert`, `resize`, `uv-unwrap` |
| Image generation | `text-to-image`, `image-to-image` |
| 3D printing | `analyze-printability` (free), `repair-printability`, `multi-color-print` |
| Experimental | `creative-lab` (keychain / fridge-magnet / figure / lamp, prototype → build) |
| Account & tasks | `balance`, `status <type> <id>`, `list <type>`, `download <type> <id>` |

### Key Behaviors

- **Asynchronous handled for you.** Every generation `POST` returns a task id; the script polls until the task reaches `SUCCEEDED`/`FAILED`/`CANCELED`, streaming progress to STDERR. Use `--no-wait` to return the id immediately and resume later.
- **Downloads with `--out`.** Result URLs are short-lived signed links (models are retained for only a few days). Pass `--out <dir>` to stream assets to disk immediately; `--formats glb,fbx` selects model formats (default `glb`), and `--textures` / `--thumbnail` / `--all` pull extras. If a URL has expired, `download` re-fetches the task once for fresh links.
- **Local images, no manual base64.** Pass a local file to `--image` / `--images` / `--texture-image-url` and the CLI encodes it into a data URI for you.
- **Whole API reachable.** Common parameters have typed flags; anything exotic is reachable via `--param key=value` or `--json '{...}'`.
- **Clear failure signals.** Exit codes distinguish auth (`3`), insufficient credits (`4`), rate-limit (`5`), task-failed (`7`), timeout (`8`), and network (`9`), and the JSON `error.kind` mirrors them.

### Credits (approximate)

Preview text-to-3D ≈ 5 (meshy-5) to 20 (meshy-6 / low-poly); refine ≈ 10; image-to-3D ≈ 20–30; remesh / rig ≈ 5; animate ≈ 3; convert / resize ≈ 1; `analyze-printability` is free. Run `balance` before a large job; an exit code `4` means you're out of credits.

### What the Skill Will NOT Do

- Never spends credits on a non-trivial job without confirming with you first
- Never writes its own polling loop — the script owns the lifecycle
- Never hand-rolls base64 for images — local paths are encoded by the CLI
- Never requires an MCP server or any npm dependency

See the [SKILL.md reference](https://github.com/Flopsstuff/flugins/blob/main/plugins/meshy/skills/meshy/SKILL.md) and the bundled [`docs/api-reference.md`](https://github.com/Flopsstuff/flugins/blob/main/plugins/meshy/skills/meshy/docs/api-reference.md) for the full command and parameter specification.
