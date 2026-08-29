# n8n Plugin

**Name:** `n8n`

**Description:** Build and drive n8n workflows — author them with the official n8n MCP server and its Workflow SDK, and operate the instance through its Public REST API

**Author:** Flop (flopspm@gmail.com)

**Version:** 0.2.1

**Keywords:** n8n, automation, workflow, rest-api, mcp, ai-agent, webhook, executions, self-hosted

The n8n plugin covers both halves of the job. **Authoring** goes through `n8n-build`, which prefers the official n8n MCP servers bundled with the plugin (instance Workflow SDK + documentation) and falls back to hand-written workflow JSON when they are unavailable. **Operating** goes through `n8n-api`, which drives an [n8n](https://n8n.io) instance's **Public REST API** (`/api/v1`) from a **single zero-dependency Node script** (`n8n-api.mjs`) — no `npm install`, no build step, just Node 18+.

Beyond the usual CRUD, the client covers what generic API wrappers usually miss: it reads the target instance's **own OpenAPI document** so it stays correct across n8n versions, follows cursor pagination automatically, strips the read-only fields that make workflow updates fail with HTTP 400, extracts the actual failure message and node out of a broken execution, and can **run a workflow through its webhook** — something the REST API itself cannot do.

## Installation

```bash
claude plugin install n8n@flugins
```

**Important:** After installing the plugin, restart Claude Code to activate skills.

**Tip:** Enable auto-update via `/plugin` → **Installed** → select the plugin → enable auto-update.

## Requirements

- **Node.js 18+** on `PATH` (`node --version`) — the script uses native `fetch`; nothing else is required.
- **`N8N_URL`** — your instance origin, e.g. `https://n8n.example.com`. `N8N_BASE_URL` and `N8N_HOST` work too, as does the `--url` flag. A trailing `/api/v1` is tolerated.
- **`N8N_API_KEY`** — created in the n8n UI under **Settings → n8n API**. API keys cannot be created through the API itself. Scopes are an Enterprise feature; a Community key has full account access.

```bash
export N8N_URL=https://n8n.example.com
export N8N_API_KEY=n8n_api_...
```

Only the `spec` command works without a key.

## Features

### Skills

- [n8n Build](#n8n-build) - Author workflows: design the graph, wire AI agents, validate, create, dry-run and publish
- [n8n API](#n8n-api) - Manage workflows, executions, credentials, data tables and the instance itself over the n8n Public REST API

The two split by verb, not by noun. **`n8n-build` creates** — "make a workflow that…", "add a node",
"build an AI agent". **`n8n-api` operates** — "what's running", "why did it fail", "back this up",
"run it now".

### Usage

Ask in natural language — *"which n8n workflows are active?"*, *"why did the invoice workflow fail last night?"*, *"back up all my workflows"*, *"activate the GDPR workflow"*, *"run the intake webhook with this payload"* — and the skill activates automatically, picks the right endpoint, runs the bundled client, and reports the result.

### Bundled MCP servers

`plugins/n8n/.mcp.json` declares two servers that start with the plugin:

- **`n8n-docs`** — the official [n8n documentation MCP server](https://docs.n8n.io/connect/connect-to-n8n-docs-mcp-server)
  (GitBook, anonymous). Gives `searchDocumentation` and `getPage` over the live docs. Read-only
  apart from `sendFeedback`, which reports a docs issue to the n8n team and is never called
  unprompted.
- **`n8n-local`** — your own instance's [MCP server](https://docs.n8n.io/connect/connect-to-n8n-mcp-server)
  at `<instance>/mcp-server/http`, which carries the n8n Workflow SDK, node type definitions,
  validation and workflow creation. Configured from `N8N_MCP_URL` and `N8N_MCP_TOKEN`, so no secret
  lives in the repo; without those variables it simply does not start and `n8n-build` falls back to
  hand-written workflow JSON. Get both values in n8n under **Settings → Instance-level MCP →
  Connect a client**.

### Configuration

No plugin-specific configuration. The skill reads `N8N_URL` and `N8N_API_KEY` from the environment (or `--url` / `--api-key` flags). The instance's OpenAPI document is cached for 24 hours under `~/.cache/n8n-api/`; `spec --refresh` reloads it. The full endpoint reference lives in `skills/n8n-api/docs/api-reference.md` and is loaded on demand rather than into every session.

---

## n8n Build

**Skill:** `n8n-build`
**Type:** Model-invoked (automatic) / user-invocable

Turns a description into a working workflow. It prefers the official instance MCP server and its
Workflow SDK — TypeScript, not hand-assembled JSON — and falls back to writing workflow JSON
directly when that server is unavailable.

### How it Activates

- "make a workflow that emails me a daily digest"
- "build an n8n agent that answers questions from our docs"
- "add a Slack node after the filter"
- "this workflow is wired wrong, fix the branches"

### What it Does

1. Frames the request, then **sketches the node graph and confirms it before spending anything** —
   discovery is the expensive part.
2. Discovers nodes with one batched `search_nodes` and one batched `get_node_types` (≈2.5k tokens
   per node, so parameterised nodes only, capped at 8).
3. Authors against the SDK, keeping a build sheet in the file header so a resumed session does not
   re-query the MCP.
4. Validates with `validate_workflow` **plus a local preflight** — the validator is lenient enough
   to return `valid: true` for a node missing a required field, so warnings are treated as errors.
5. Creates the workflow as an unpublished draft, dry-runs it, and publishes only when asked.

### What it Carries

Seven references loaded on demand, covering the things a model gets wrong from memory: the AI
sub-node wire names (`ai_languageModel`, `ai_tool`, `ai_memory` — **documented nowhere on
docs.n8n.io**, and the model is the *source*, the agent the *target*), `Loop Over Items` output 0 =
done / 1 = loop, the webhook `{headers, params, query, body}` shape, `$('Node')` versus the legacy
`$node[]`, the `chatInput` requirement, `onError` versus the deprecated `continueOnFail`, and the
SDK→JSON mapping used when the MCP drops mid-build.

### Safety Rails

Never publishes or activates unasked · backs up an existing workflow before editing it · never
invents a credential id or a node type · warns before `test_workflow`, which pins triggers and
credentialed nodes but really executes Code, Set, If and credential-free I/O.

---

## n8n API

**Skill:** `n8n-api`
**Type:** Model-invoked (automatic) / user-invocable

Drives the whole n8n Public API from one generic client. Every command prints exactly one machine-readable JSON object to STDOUT (progress and warnings go to STDERR), so Claude never scrapes human text.

### How it Activates

The skill activates whenever you mention n8n or an automation running on it. Examples:

- "list my n8n workflows"
- "why did the Telegram bot workflow stop working?"
- "export every workflow to ./backup"
- "deactivate the LinkedIn workflow"
- "create a credential for the Slack node"
- "trigger the intake form workflow with this JSON"
- "audit my n8n instance"

### What it Covers

| Area | Commands |
|---|---|
| Connectivity | `ping` — validates the key and reports which endpoint groups the instance exposes |
| Discovery | `spec`, `spec --grep <term>`, `spec /workflows`, `spec --schema workflowCreate` |
| Escape hatch | `call <METHOD> <path>` — any endpoint on any n8n version, with `--all` pagination |
| Workflows | `list`, `get`, `nodes`, `create`, `update`, `rename`, `delete`, `activate`, `deactivate`, `archive`, `unarchive`, `publish`, `unpublish`, `history`, `version`, `tags`, `transfer`, `export` |
| Executions | `list`, `get`, `errors`, `retry`, `stop`, `delete`, `tags` |
| Running a workflow | `trigger <id-or-name>` via its Webhook / Form / Chat node, `--test`, `--follow`, `--list-entrypoints` |
| Credentials | `list`, `get`, `schema`, `create`, `update`, `test`, `transfer`, `delete` |
| Data tables | `list`, `get`, `columns`, `rows`, `create`, `add-rows`, `update-rows`, `upsert-rows`, `delete-rows`, `clear-rows`, `delete` |
| Tags · projects · variables · users | `list`, `get`, `create`, `update`, `delete` |
| Evaluations | `test-runs list / start / get / cases / cancel` |
| Instance | `audit`, `insights`, `source-control pull` |

### Example Session

```bash
S=~/.claude/plugins/n8n/skills/n8n-api/scripts/n8n-api.mjs

# What does this instance expose, and is my key good?
node "$S" ping --pretty

# Which workflows are live?
node "$S" workflows list --active

# Why did the invoicing workflow fail?
node "$S" executions errors --workflow "aimost_faktura" --limit 5
# → { "failure": { "message": "Bad request …", "node": "Send a text message EN" } }

# Back everything up before touching anything
node "$S" workflows export --all --out ./n8n-backup

# Edit and push it back — read-only fields are stripped automatically
node "$S" workflows update <id> --file ./n8n-backup/my-flow.<id>.json --dry-run
```

### Safety Rails

- **Destructive calls require `--yes`** — deleting workflows, executions, data-table rows, and `source-control pull`. n8n has no trash: deletes are permanent.
- **`--dry-run`** on any mutation prints the exact request and sends nothing.
- **The API key never reaches a webhook.** `trigger` calls the public webhook URL unauthenticated, as n8n itself does; the key stays on `/api/v1` requests only. `--debug` redacts it in logs.
- **Errors are classified, not swallowed** — distinct exit codes for auth (`3`), licence-gated/forbidden (`4`), rate limit (`5`), not found (`6`), bad request (`7`), timeout (`8`), network (`9`), server (`10`), and each carries a hint. A Community instance answering `403 Your license does not allow for feat:variables` is reported as a licence limit, not an auth failure.

### Known Limits of the n8n API

- **There is no "execute this workflow now" endpoint.** A workflow can only be run through a Webhook, Form or Chat trigger (that is what `trigger` does), or through `test-runs` where evaluations are set up. Schedule and Manual triggers cannot be fired over HTTP.
- Production webhooks (`/webhook/<path>`) only answer while the workflow is **active**; `--test` targets `/webhook-test/<path>`, which needs the editor listening.
- The webhook host is **not always the API host** — n8n moves these endpoints with `N8N_ENDPOINT_WEBHOOK` / `N8N_ENDPOINT_WEBHOOK_TEST`, and a reverse proxy replaces the base with `N8N_WEBHOOK_URL`. The client honours those variables and takes `--webhook-base` / `--webhook-path` / `--webhook-test-path`; `ping` shows which base it would use.
- Variables, projects, folders, roles and SSO settings are **licence-gated** and return 403 on Community instances.
- `limit` is capped at **250** server-side — use `--all`.
- API keys are created in the UI only.

### Related Tooling

n8n ships an official CLI, `npx @n8n/cli` (with `n8n-cli skill install` for Claude Code), covering the common CRUD subset. This skill needs no install and additionally reaches publish/archive, workflow versions, test-runs, insights, community packages, instance settings, raw `call`, auto-pagination and `trigger`. Both talk to the same API with the same key, so they interoperate freely.

## Reference

- [n8n Public API docs](https://docs.n8n.io/connect/n8n-api/)
- [Authentication](https://docs.n8n.io/connect/n8n-api/authentication) · [Pagination](https://docs.n8n.io/connect/n8n-api/pagination) · [Endpoint reference](https://docs.n8n.io/connect/n8n-api/api-reference)
- Self-hosted instances serve a live playground at `<instance>/api/v1/docs`
