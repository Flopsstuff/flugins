---
name: n8n-api
description: Drive an n8n instance through its Public REST API — list, inspect, create, update, activate, archive and export workflows; read executions and diagnose why one failed; manage credentials, tags, data tables, projects and variables; run a workflow through its webhook; audit the instance. Use this skill whenever the user wants to inspect, operate, troubleshoot or back up an existing n8n instance — asks what is running, why an automation failed or stopped, wants to activate/archive/export/migrate workflows, manage credentials or data tables, or points at an n8n host. To design or build a new workflow, or to add and rewire nodes, use the n8n-build skill instead. Drives a bundled zero-dependency Node client; no MCP server and no npm install needed.
disable-model-invocation: false
user-invocable: true
allowed-tools: >-
  Read Write Edit AskUserQuestion
  Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)
---

Talk to any n8n instance over its **Public REST API** (`/api/v1`) through a bundled,
zero-dependency Node client (`n8n-api.mjs`). It handles auth, cursor pagination, retries,
payload hygiene and error triage; you pick a command, run it, and parse JSON.

## Requirements (check once, before the first call)

- **Node 18+** on PATH (`node --version`).
- **`$N8N_URL`** — the instance origin, e.g. `https://n8n.example.com`. `$N8N_BASE_URL` and
  `$N8N_HOST` also work, as does `--url`. A trailing `/api/v1` is tolerated.
- **`$N8N_API_KEY`** — created in the n8n UI under **Settings → n8n API** (never via the API).
  `--api-key` overrides it. Only `spec` works without a key.

If either is missing, the script says exactly which one — relay that instead of guessing a host.
**Never print the key**, and never pass it to a webhook URL.

## How to run it

```bash
node "${CLAUDE_SKILL_DIR}/scripts/n8n-api.mjs" <command> [subcommand] [args] [flags]
```

**Output contract — rely on this, don't scrape:**
- **STDOUT** is exactly one JSON object: `{"ok":true,"command":…,"data":…}` or `{"ok":false,"error":{…}}`.
- **STDERR** carries progress (`[page 2] 200 items so far…`), warnings and a human hint.
- **Exit codes:** `0` ok · `2` usage · `3` auth (bad/missing key) · `4` forbidden or licence-gated ·
  `5` rate limit · `6` not found · `7` bad request/conflict · `8` timeout · `9` network ·
  `10` server error · `130` interrupted.

Lists return a **compact projection** by default; add `--full` for whole objects. Add `--all` to
follow `nextCursor` through every page (page size is capped at 250 by n8n).

## Start here

Run `ping` first on an unfamiliar instance. It validates the key and reports which endpoint groups
that instance actually exposes — Community instances answer `403 licence-gated` for variables,
projects and folders, which is **not** an auth failure.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/n8n-api.mjs" ping --pretty
```

## Commands

| Intent | Command |
|---|---|
| Check access, key and available features | `ping` |
| What can this n8n version do? | `spec` · `spec --grep tags` · `spec /workflows` · `spec --schema workflowCreate` |
| **Any endpoint at all** | `call GET /workflows/{id}/history` · `call POST /users --data '[…]'` |
| List workflows | `workflows list [--active\|--inactive] [--name X] [--tags a,b] [--all]` |
| Read one (by id **or name**) | `workflows get <id-or-name> [--out <dir>]` · `workflows nodes <id>` |
| Create / update | `workflows create --file wf.json` · `workflows update <id> --file wf.json [--set name=New]` |
| Lifecycle | `workflows activate\|deactivate\|archive\|unarchive\|publish\|unpublish <id>` |
| Rename, tag, move | `workflows rename <id> "New name"` · `workflows tags <id> --set id1,id2` · `workflows transfer <id> --project <p>` · `workflows update <id> --parent-folder <id\|root>` |
| Versions | `workflows history <id>` · `workflows version <id> <versionId>` |
| Back up everything | `workflows export --all --out ./backup` |
| Executions | `executions list [--workflow <id-or-name>] [--status error] [--all]` · `executions get <id> --include-data` |
| **Why did it fail?** | `executions errors [--workflow <id-or-name>] [--limit 5]` |
| Retry / stop / delete | `executions retry <id>` · `executions stop <id>` · `executions delete <id> --yes` |
| **Actually run a workflow** | `trigger <id-or-name> [--data '{…}'] [--test] [--follow]` |
| Credentials | `credentials list` · `credentials schema <type>` · `credentials create --name X --type slackApi --data '{…}'` · `credentials test <id>` |
| Data tables | `data-tables list\|get\|columns\|rows\|create\|add-rows\|update-rows\|upsert-rows\|delete-rows\|clear-rows\|delete` |
| Tags / projects / variables / users | `tags list` · `projects list` · `variables list` · `users list --include-role` |
| Evaluations | `test-runs list <workflow>` · `test-runs start <workflow>` · `test-runs get <workflow> <runId>` |
| Instance health | `audit [--categories credentials,nodes]` · `insights` |

Full flag list: `node "${CLAUDE_SKILL_DIR}/scripts/n8n-api.mjs" help`.

## Working rules

1. **Read before you write.** `workflows get <id> --out <dir>` before any update — you get a
   backup and the exact current shape in one step.
2. **`--dry-run` any mutation you are unsure about.** It prints the request that *would* be sent
   and calls nothing.
3. **Destructive calls need `--yes`** (`workflows delete`, `executions delete`, `data-tables
   clear-rows`, `source-control pull`). Get the user's approval *before* passing it; prefer
   `workflows archive` over `delete` when they just want it out of the way.
4. **Don't hand-clean workflow JSON.** `workflows update` strips the read-only fields (`id`,
   `active`, `tags`, `versionId`, …) that otherwise produce HTTP 400, and enforces the four
   required keys. It also drops `null` optionals, which the API rejects — except
   `parentFolderId`, where `null` is a real instruction ("move to the project root") and is kept.
   Omitting that key leaves the workflow's folder untouched, so a plain get → update round-trip
   never moves anything; use `--parent-folder <id|root>` when you do mean to move it.
5. **Ids beat names.** Names resolve, but the script refuses an ambiguous match — pass the id when
   the user's wording could hit two workflows.
6. **`--include-data` is heavy.** Use it on a single execution, not on a list; `executions errors`
   already fetches only what it needs.
7. **Unknown endpoint? Ask the instance, not your memory.** `spec --grep <term>` reads that
   instance's own OpenAPI document (cached 24h, `--refresh` to reload), then `call` it.

## Running a workflow — the one real gap

The n8n API has **no "execute this workflow now" endpoint**. `trigger` works around it by finding
the workflow's Webhook / Form / Chat node and calling that URL directly:

- Production (`/webhook/<path>`) needs the workflow **active**; otherwise it 404s.
- `--test` hits `/webhook-test/<path>`, which only answers while someone has the editor open with
  *Listen for test event* pressed.
- **The webhook host is not always the API host.** n8n can move these endpoints
  (`N8N_ENDPOINT_WEBHOOK`, `N8N_ENDPOINT_WEBHOOK_TEST`) and a reverse proxy can replace the base
  entirely (`N8N_WEBHOOK_URL`, or the deprecated `WEBHOOK_URL`). The script reads those variables
  from its own environment and accepts `--webhook-base <url>`, `--webhook-path <seg>` and
  `--webhook-test-path <seg>`. `ping` prints the base it would use. If a webhook 404s on an
  **active** workflow, the path is wrong for that host — read the real URL off the node in the
  editor rather than guessing.
- Schedule, Manual, Telegram and similar triggers cannot be fired over HTTP —
  `trigger <wf> --list-entrypoints` shows what a workflow actually exposes.
- The webhook is a **public** entrypoint: the API key is deliberately not sent. A 401/403 from it
  therefore means the *node's own* authentication rejected the call — pass it with
  `--header 'Authorization=…'`, and don't go looking at the API key.
- `--follow` polls for the resulting execution and returns its status.

## Diagnosing a broken automation

```bash
S="${CLAUDE_SKILL_DIR}/scripts/n8n-api.mjs"
node "$S" executions errors --workflow "Daily invoice" --limit 5   # message + failing node
node "$S" executions get <id> --include-data --out ./debug          # full node I/O
node "$S" workflows nodes <id>                                     # node types + credentials used
node "$S" credentials test <credId>                                # is the credential still valid?
```

Report the failing **node name** and message, not just the execution id — that is what the user
acts on. `finished: false` with `status: "error"` is normal for a failed run.

## Gotchas

- **403 `Your license does not allow for feat:…`** is a licence limit (variables, projects,
  folders, SSO), not a bad key. Say so; don't retry.
- **Archived workflows are hidden** from `workflows list` — the response says `archivedHidden: N`.
  Use `--include-archived` or `--archived`.
- **Deletes are permanent** — no trash, no undo, for workflows, executions and credentials alike.
- **A new workflow starts inactive** and cannot be activated without a trigger node.
- **`limit` is capped at 250** server-side; `--all` is the way to get everything.
- **Two instances, two keys.** A key from another host answers 401 — check `ping` reports the host
  you meant.
- Prefer this skill's `call` over hand-rolled `curl`: it keeps the key out of the transcript,
  retries 429/5xx, and normalises errors.

For the complete endpoint table, payload shapes and limits, read
**`${CLAUDE_SKILL_DIR}/docs/api-reference.md`** on demand — not on every run.

## Looking something up

This plugin bundles the official **n8n docs MCP server** (`plugin:n8n:n8n-docs`), so
`searchDocumentation` / `getPage` are available whenever it is enabled. Use them for product
behaviour the API cannot tell you — node parameters, expression syntax, self-hosting variables —
and use `spec` for what *this instance's* API actually exposes. Between them, don't answer n8n
questions from memory. (`sendFeedback` reports a docs problem to the n8n team; only call it when
the user asks.)

## Related tooling

n8n also ships an official CLI (`npx @n8n/cli`, `n8n-cli skill install`) covering the common
CRUD subset. This skill needs no install and additionally reaches publish/archive, workflow
versions, test-runs, insights, community packages, instance settings, raw `call`, auto-pagination
and `trigger`. If the user already works with `@n8n/cli`, both talk to the same API and the same
key — they interoperate.
