# Imagegen Plugin

**Name:** `imagegen`

**Description:** Generate and edit images with Gemini image models (Nano Banana / Nano Banana Pro) through a zero-dependency Python script, with guided API-key onboarding

**Author:** Flop (flopspm@gmail.com)

**Version:** 0.1.1

**Keywords:** image, image-generation, gemini, nano-banana, ai, illustration, logo, image-editing

The Imagegen plugin lets Claude Code draw and edit images with Google's Gemini image models — `gemini-3.1-flash-lite-image`, `gemini-3.1-flash-image` and `gemini-3-pro-image` (Nano Banana Pro) — through a single **stdlib-only Python script** (`gen.py`). There is no `pip install`, no SDK and no MCP server: the skill's one-line description is all that sits in context until you actually ask for a picture.

Because image models are billed per picture and have **no free tier**, the skill is built around cost awareness: it knows the price of every model/size combination, warns before an expensive batch, refuses more than four variants without `--yes`, and keeps a local spend ledger. Generation runs on **your own** Google API key, which never appears in the script's output.

The skill content is written in Russian; it works regardless of the language you talk to Claude in.

## Installation

```bash
claude plugin install imagegen@flugins
```

**Important:** After installing the plugin, restart Claude Code to activate skills.

**Tip:** Enable auto-update via `/plugin` → **Installed** → select the plugin → enable auto-update.

## Requirements

- **Python 3** on `PATH` (`python3 --version`) — standard library only. [Pillow](https://pypi.org/project/Pillow/) is used opportunistically for `--thumb` and image info; everything works without it.
- A **Google API key** with access to the Gemini API. Create one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
- **Billing enabled** on the Cloud project behind that key. Gemini image models have no free tier — an unbilled key is granted quota 0 and every request comes back as HTTP 429.

If no key is configured, you do not have to set anything up in advance: the first generation attempt triggers the onboarding flow below.

## Features

### Skills

- [Image Generation](#image-generation) - Generate and edit images with Gemini image models, priced and confirmed before each run

### Usage

Ask in natural language — *"нарисуй акварельного кота на подоконнике"*, *"make a flat vector icon for a settings screen"*, *"сделай фон этой картинки ночным"*, *"generate a 16:9 hero banner with the text «OPEN»"* — and the skill activates automatically. It picks a model and size, tells you what the run will cost, generates, and reports the path of every file it wrote.

### Configuration

The API key is read, in order, from `$GEMINI_IMAGE_API_KEY`, `$GEMINI_API_KEY`, then the file `~/.secrets/gemini-api.key` (mode 600). See [`.env.example`](https://github.com/Flopsstuff/flugins/blob/main/.env.example) for the environment-variable block.

Other paths the script uses:

| Path | What it holds |
|---|---|
| `./assets/ai-gen/` | Default output directory, relative to the current working directory |
| `<image>.json` | Sidecar next to every image: prompt, model, aspect, size, references, `interaction_id` |
| `~/.local/state/ai-gen/ledger.jsonl` | Spend ledger, one line per generated image |
| `~/.secrets/gemini-api.key` | The API key, written by `save-key.sh` with mode 600 |

---

## Image Generation

**Skill:** `imagegen`
**Type:** Model-invoked (automatic) / user-invocable

### How it Activates

The skill activates whenever the conversation turns to producing or editing an image. Examples:

- "сгенерируй картинку кота в стиле акварели"
- "make a logo for a coffee shop"
- "нужна иконка настроек, плоский вектор"
- "edit this image — make the background night"
- "перерисуй баннер в 21:9"

### Models and Pricing

| `-m` | Model | Price per image |
|---|---|---|
| `lite` | `gemini-3.1-flash-lite-image` | $0.034 (1K only) |
| `flash` (default) | `gemini-3.1-flash-image` | $0.045 / $0.067 / $0.101 / $0.151 for 0.5K / 1K / 2K / 4K |
| `pro` | `gemini-3-pro-image` (Nano Banana Pro) | $0.134 (1K and 2K), $0.24 (4K) |

Use `lite` for drafts and composition sweeps, `flash` as the everyday default, and `pro` when the picture must contain **legible text** or a complex multi-object scene.

### Cost Control

- Every run prints an estimate; `--dry-run` prints the request and the estimate without calling the API.
- `-n` above 4 requires `--yes`. Before an expensive batch the skill states the expected total and waits for your confirmation.
- `--spend` (optionally `--spend --month`) reports what has been spent so far from the local ledger.

### Editing and Iteration

Pass reference images with `-r` (repeatable, up to 14) and write the prompt as a *change*: *"make the background night, keep the pose and the jacket colour"*. Each result's sidecar carries an `interaction_id`; `--continue <id>` keeps refining the same scene with its context intact.

### API-Key Onboarding

`gen.py` exits with code **78** (`EX_CONFIG`) — and only with that code — when the key is missing, rejected (HTTP 401/403), or attached to an unbilled project (HTTP 429 with zero quota). The stderr line is prefixed `error: IMAGEGEN_AUTH:`, and under `--json` the script prints `{"error": "auth", "reason": "no_key" | "bad_key" | "billing"}`.

The skill treats that exit code as the signal to onboard rather than an error to surface:

1. It explains that image generation runs on your own Google API key and that the key's Cloud project must have billing enabled.
2. It points you at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) to create the key and enable billing.
3. It asks for the key in a plain chat message and waits for your reply (not `AskUserQuestion`, which is meant for picking between options and forces a confusing "Other" box for free text).
4. It saves the key by piping it into the bundled `save-key.sh` — **on stdin**, never as a command-line argument, so the key never reaches your shell history or the process list. The script writes `~/.secrets/gemini-api.key` with mode 600 and confirms without echoing the key.
5. It retries your original request unchanged. If that exits 78 again, it tells you which of the two causes applies — wrong key or missing billing — and stops instead of looping.
6. Afterwards it tells you plainly where the key is stored and that, since you typed it into the conversation, the transcript should be treated as sensitive.

### Notes

- Google embeds an invisible **SynthID** watermark in every generated image.
- A safety block means the prompt needs rephrasing, not retrying.
- The API key is scrubbed from every message the script prints, including API error text.
