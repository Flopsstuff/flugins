---
name: n8n-build
description: Author n8n workflows — design the node graph, pick node types and versions, wire AI agents to their model/memory/tool sub-nodes, write expressions, then validate, create, dry-run and publish. Use when the user wants to build, create, design, scaffold or extend an n8n workflow or automation, add or rewire a node, turn a description into a working workflow, make an n8n AI agent or chatbot, or fix a workflow that is wired wrong. Prefers the official n8n MCP server (n8n-local) and its Workflow SDK, and falls back to hand-written workflow JSON when that server is unavailable. To inspect, run, back up or troubleshoot an existing workflow, use the n8n-api skill instead.
disable-model-invocation: false
user-invocable: true
allowed-tools: >-
  Read Write Edit Glob AskUserQuestion
  mcp__n8n-local
  mcp__n8n-docs
  Bash(node ${CLAUDE_SKILL_DIR}/../n8n-api/scripts/*)
---

Build n8n workflows that work on the first run — right node types, right versions, right wiring,
right expressions — and leave them verified rather than merely created.

**This skill authors.** Listing, exporting, running, activating, backing up, reading executions or
diagnosing a failure belongs to the **`n8n-api`** skill; hand over rather than reimplementing it.

## Two paths

Check once, before anything else: are `mcp__n8n-local__*` tools present in this session?

| | MCP present | MCP absent |
|---|---|---|
| Node types & versions | `search_nodes` + `get_node_types` (authoritative) | `docs/node-catalog.md` + real nodes lifted off the user's own instance |
| Authoring | TypeScript against `@n8n/workflow-sdk` | workflow JSON by hand (`docs/workflow-json.md`) |
| Validation | `validate_workflow` **plus** the local preflight | local preflight only |
| Creation | `create_workflow_from_code` | hand to `n8n-api` → `workflows create --file` |
| Dry run | `prepare_workflow_pin_data` + `test_workflow` | `n8n-api` → `trigger --test` (webhook/form/chat only) |

Two different failures look alike and are not: **the server is down** (nothing to do but fall back)
versus **this session's connection dropped** (the endpoint answers, the tools don't). The second is
common on tunnelled instances and is fixed by the user running `/mcp` — say so explicitly instead
of silently degrading.

Even with MCP up, four things only the REST client can do: **create credentials**, **triage a
failed execution**, **back up a workflow before editing it**, and **call a production webhook with
custom headers**.

## The loop

Follow it in order. Each step names the tool and the guard that stops it going wrong.

**0 — Frame the request.** At most one `AskUserQuestion` round, and only for what cannot be
inferred: what starts it, which services, where the result goes, what "done" looks like. A concrete
request ("webhook → filter → Slack") needs no questions at all.

**1 — Probe.** `list_credentials` confirms the instance is reachable *and* returns the credential
inventory you will need in step 4 — one call, two answers. Without MCP: `n8n-api` → `ping`.

**2 — Sketch, then get a yes.** State the graph before spending anything:

```
Schedule (daily 08:00) → Gmail: get many → Code: summarise → Telegram: send
```

Name each node, its trigger/branch role, and every credential it needs. Confirm with the user
**before** step 3. Discovery is the expensive part; do not pay for it twice because the shape was
wrong.

**3 — Discover.** In this order, and no more than this:
- `get_workflow_best_practices` for at most **2** techniques (pick from `docs/techniques.md`; five
  techniques there are empty — never call those).
- **One** `search_nodes` call with every query batched. Take `type` **and `typeVersion`** from its
  results — never from an SDK example or from memory; SDK docs pin stale versions.
- **One** `get_node_types` call, batched, only for nodes whose parameters you will actually set.
  Skip Set / Code / If / Merge / NoOp. Cap: 8 nodes.
- `explore_node_resources` only for parameters whose type definition shows `@searchListMethod` or
  `@loadOptionsMethod` (Slack channel, Sheets tab, Drive folder…), and only with a real
  `credentialId`. Use a returned `value`; never invent an id.

**4 — Author.** SDK code with MCP, JSON without. Keep a **build sheet** — instance, credential ids,
`type@typeVersion` per node, resolved resource ids — and write it as a comment header at the top of
the generated file. A resumed session then reads the file instead of re-calling the MCP.

**5 — Validate.** `validate_workflow`, then the local preflight below. **Treat warnings as
errors**: the validator returned `valid: true` for a node missing a required parameter.

**6 — Create as a draft.** `create_workflow_from_code` — unpublished, and into the folder or
project the user named (it defaults to the personal project). Without MCP, write the JSON to a file
and hand to `n8n-api` → `workflows create --file`.

**7 — Prove it runs.** `prepare_workflow_pin_data` → `test_workflow` for a pinned dry run, or
`execute_workflow` for manual/schedule triggers, or `n8n-api` → `trigger --test` for a webhook.
Warn first if the graph writes anywhere: `test_workflow` pins triggers, credentialed nodes and HTTP
Request, but Code, Set, If and credential-free I/O **really execute**.

**8 — Publish only when asked.** Never publish or activate on your own initiative. A published
workflow with a schedule or webhook starts doing things to the real world.

**9 — Hand back.** The workflow id and URL, what you verified, every `placeholder()` left open, and
the exact next step the user must take (attach a credential, publish, point a webhook at it).

## SDK core

The MCP builds workflows from TypeScript, not JSON. What you need on every build:

```javascript
const start = trigger({ type: 'n8n-nodes-base.scheduleTrigger', version: 1.2,
  config: { name: 'Every morning', parameters: { rule: { interval: [{ triggerAtHour: 8 }] } } } });

const fetch = node({ type: 'n8n-nodes-base.httpRequest', version: 4.5,
  config: { name: 'Fetch', parameters: { method: 'GET', url: 'https://api.example.com/items' } } });

export default workflow('daily-digest', 'Daily digest').add(start).to(fetch);
```

- `.add()` starts the chain, `.to()` continues it. Branching: `.onTrue(...) / .onFalse(...)` on an
  `ifElse`, `.onDone(...) / .onEachBatch(...)` on `splitInBatches`, `.onError(handler)` on a node
  that also sets `onError: 'continueErrorOutput'`.
- `.input(n)` / `.output(n)` are **0-based**.
- `expr('Hello {{ $json.name }}')` for expressions — single or double quotes, **never backticks**,
  and `$json` / `$()` must sit *inside* the `{{ }}`.
- `fromAi('recipient', 'Email address')` for a parameter the agent fills in.
- `sticky()` for canvas notes — the SDK forbids code comments in workflow code.
- `placeholder('what is missing')` where a value is not yet known.

**Sub-nodes are not connected with `.to()`.** An AI agent takes them in `config.subnodes`:

```javascript
const model = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.3,
  config: { name: 'Model', parameters: {}, credentials: { openAiApi: newCredential('OpenAI') } } });
const calc = tool({ type: '@n8n/n8n-nodes-langchain.toolCalculator', version: 1,
  config: { name: 'Calculator', parameters: {} } });

const agent = node({ type: '@n8n/n8n-nodes-langchain.agent', version: 3.1,
  config: { name: 'Agent', parameters: { promptType: 'define', text: 'Answer with tools' },
            subnodes: { model, tools: [calc] } } });
```

Everything beyond this — `merge`, `switchCase`, `.group()`, importing an existing workflow,
multi-output wiring — is in **`docs/sdk-authoring.md`**.

## Facts you will get wrong from memory

Check every one of these before validating. They are the difference between a workflow that runs
and one that looks right and silently does nothing.

- **AI wires:** `ai_languageModel`, `ai_memory`, `ai_tool`, `ai_outputParser`, `ai_embedding`,
  `ai_document`, `ai_textSplitter`, `ai_vectorStore` (full list in `docs/workflow-json.md`). The
  **sub-node is the source and the root node is the target** — the arrow points at the agent, not
  away from it. Docs list these strings on exactly one page, and it is not a cluster-node page.
- **Loop Over Items / SplitInBatches: output `0` is `done`, output `1` is `loop`.** Swapping them
  is the single most common wiring bug.
- **Webhook data is `{ headers, params, query, body }`** — write `{{ $json.body.city }}`, never
  `{{ $json.city }}`.
- **`connections` is keyed by node *name*.** Renaming a node breaks every connection and every
  `$('Old Name')` expression.
- **`$('Node Name')` is current syntax.** `$node["X"]` and `$items()` are legacy and absent from the
  reference.
- **After Merge or Aggregate, `.item` throws "Multiple matching items"** — use `.first()`,
  `.last()` or `.all()[i]`.
- **AI sub-nodes resolve expressions against item 0 only.** Root nodes iterate; sub-nodes do not.
- **An Agent needs a field literally named `chatInput`** when its prompt is "take from previous
  node", and **a chat model sub-node** (that one is mandatory; tools are a design choice). A Chat Trigger reads the reply from a field named
  `output` or `text` — any other name returns the whole object.
- **`onError`, not `continueOnFail`** (deprecated). Values: `stopWorkflow`, `continueRegularOutput`,
  `continueErrorOutput`.
- **Always set `settings.executionOrder: "v1"`.** Node `position` genuinely affects execution order.
- **Never invent a credential id.** List them, reference a real one, or leave a `placeholder()`.
- **Respond to Webhook runs on the first item only**; a second Respond node is ignored.

## The validation gate

`validate_workflow` is lenient — it accepts unknown parameters and downgrades a missing required
field to a warning. So:

1. Run it, and treat **every warning as a blocker**.
2. Then run the local preflight, which the validator does not cover:
   - Loop Over Items outputs the right way round (`done` = 0)?
   - every credential id present in `list_credentials`?
   - webhook expressions going through `$json.body`?
   - agent has a chat model attached, a `chatInput` (or `promptType: define`) and a system message?
   - anything downstream of Respond to Webhook that expects more than item 0?
3. Two failed correction rounds → stop, show the graph and name the exact blocker. Do not keep
   guessing.

## Reference map

Load on demand — not on every build.

| File | Read it when |
|---|---|
| `docs/sdk-authoring.md` | Any non-linear graph: branches, merges, loops, groups, or importing an existing workflow |
| `docs/workflow-json.md` | No MCP, or reviewing/patching raw workflow JSON. Carries the `ai_*` wire table and the SDK→JSON mapping |
| `docs/expressions.md` | Writing any expression or Code node |
| `docs/ai-agents.md` | The request mentions an agent, chatbot, LLM, RAG or tools |
| `docs/node-catalog.md` | Choosing nodes, or before calling `get_node_types` |
| `docs/techniques.md` | Before `get_workflow_best_practices` — says which techniques are worth calling |
| `docs/errors-and-recovery.md` | Adding error handling, or when something is failing |

## Spend discipline

MCP payloads are large. Budget **≤25k tokens of MCP output per build**; if a build needs more, say
so rather than spending silently.

- `get_workflow_sdk_reference`: **default is not to call it.** `docs/sdk-authoring.md` already
  covers `patterns`, `functions`, `rules` and `import`. At most one call per build, only for
  `patterns_detailed`, `design` or `groups`, and only for something the local doc does not answer.
  Never `all`.
- `get_workflow_best_practices`: ≤2 techniques, never `technique="list"` (the list is in
  `docs/techniques.md`).
- `search_nodes`: exactly one batched call.
- `get_node_types`: ≈2.5k tokens **per node** — one batched call, ≤8 nodes, parameterised nodes
  only.
- Never re-fetch what the build sheet already holds.

## When things break

| Situation | Do this |
|---|---|
| No `mcp__n8n-local__*` tools at all | Say so plainly, offer the setup (`N8N_MCP_URL` + `N8N_MCP_TOKEN`, then `/mcp`), and build via `docs/workflow-json.md` + `n8n-api` |
| Tools vanish mid-build ("not connected") | Retry once with a cheap call. Still down: **do not rewrite the workflow** — convert it with the SDK→JSON map in `docs/workflow-json.md`, create it through `n8n-api`, and tell the user it went in **unvalidated and unpublished** |
| Validation warnings | Blocking. Fix, re-validate |
| Node type not found | Re-search with synonyms → `mcp__n8n-docs__searchDocumentation` → say honestly it is not on this instance and offer HTTP Request. **Never fabricate `n8n-nodes-base.X`** |
| Credential missing | Default: ship a `placeholder()` and tell the user to attach it. Only create one via `n8n-api` → `credentials create` if the user offers the secret — collect it with `AskUserQuestion`, never echo it |
| Workflow already exists | Back it up first (`n8n-api` → `workflows get <id> --out`), then patch with `update_workflow` operations rather than replacing it wholesale |

## Conventions

- Name workflows for what they do, verb first: `Daily: Gmail digest → Telegram`.
- One `sticky()` at the top of any graph over ~8 nodes, saying what it does and what it needs.
- Never modify or publish a workflow this session did not create, without explicit approval.
- Leave the instance as you found it if a build is abandoned — delete the draft.

## REST fallback — the five commands that matter

```bash
S="${CLAUDE_SKILL_DIR}/../n8n-api/scripts/n8n-api.mjs"
node "$S" ping                                   # instance reachable, key valid
node "$S" workflows get <id> --out ./backup      # before touching anything
node "$S" workflows create --file wf.json        # the fallback create
node "$S" trigger <id> --test --data '{...}'     # fire a webhook build
node "$S" executions errors --workflow <id>      # why the run failed
```

Prefer handing these to the `n8n-api` skill, which owns the client and its permissions; the path
above is the direct route when a handover is not worth the round trip.
