# Workflow JSON — the format, and how SDK code maps onto it

Read when there is no MCP server, or when reviewing/patching raw JSON. This is the shape the REST
API accepts (`POST /workflows`, `PUT /workflows/{id}`).

## Required and forbidden

`name`, `nodes`, `connections`, `settings` are **required**. These ten are marked read-only in the
Public API schema and cause a 400 if sent back:

```
id · active · createdAt · updatedAt · isArchived · versionId · triggerCount · meta · tags · activeVersion
```

A newer instance may also return fields absent from the published schema — this one adds
`activeVersionId`, `sourceWorkflowId`, `versionCounter`. The schema is `additionalProperties:
false`, so those are rejected as *unknown*, which fails just the same. Strip anything a GET
returned that is not in the accepted list below.

Also accepted: `description`, `staticData`, `pinData`, `nodeGroups`, `parentFolderId`, and on
create `projectId`. `staticData` and `pinData` are nullable; `parentFolderId` is nullable **with
meaning** — `null` moves the workflow to the project root, omitting it leaves the folder alone.

`n8n-api`'s `workflows create` / `workflows update` strip all of this for you, so a workflow fetched
with `workflows get` can be edited and sent straight back.

## A node

```json
{
  "name": "Fetch orders",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.3,
  "position": [220, 0],
  "parameters": { "method": "GET", "url": "https://api.example.com/orders" },
  "credentials": { "httpHeaderAuth": { "id": "R5kgDQdxWKqnmbjX", "name": "API key" } },
  "onError": "continueErrorOutput",
  "retryOnFail": true,
  "maxTries": 3,
  "waitBetweenTries": 1000
}
```

- `name` is the identity used by connections and by `$('Fetch orders')` expressions. Renaming a node
  means rewriting both.
- `position` is `[x, y]` and is **not cosmetic** — under `executionOrder: "v1"` it decides which
  branch runs first (top to bottom, then left to right). Space nodes ~200px apart.
- `credentials` is keyed by **credential type name** (`slackApi`, `httpHeaderAuth`, `openAiApi`),
  and the id must be one that exists on the instance. Get real ones from
  `n8n-api credentials list` or `mcp__n8n-local__list_credentials`.
- Expression values are strings beginning with `=`: `"url": "=https://api.example.com/{{ $json.id }}"`.

## Connections

Keyed by **source node name**. The value maps a connection type to an array of outputs; each output
is an array of targets (fan-out). An unused output is `[]`, not omitted.

```json
"connections": {
  "Webhook":     { "main": [[{ "node": "Is paid?", "type": "main", "index": 0 }]] },
  "Is paid?":    { "main": [
                    [{ "node": "Charge",  "type": "main", "index": 0 }],
                    [{ "node": "Reject",  "type": "main", "index": 0 }]
                  ]},
  "Loop Over Items": { "main": [
                    [{ "node": "Summarise", "type": "main", "index": 0 }],
                    [{ "node": "Process",   "type": "main", "index": 0 }]
                  ]}
}
```

- **IF**: output 0 = true, output 1 = false.
- **Loop Over Items / SplitInBatches**: output **0 = `done`**, output **1 = `loop`**. The loop
  branch must lead back to the loop node.
- **Switch** in Rules mode: one output per rule, in rule order; the fallback output is last if
  enabled.
- **Respond to Webhook** only works when the Webhook node sets `responseMode: "responseNode"`.
  It responds from the **first incoming item** — including inside expressions — so aggregate first
  (Aggregate → "All Item Data") when the reply needs every item. It has an optional second output,
  *Enable Response Output Branch*, for continuing the flow after replying.
- **Merge**: fan-in, so the *targets* carry `index: 0` and `index: 1` — the index is the **input**
  number on the merge node, not the output of the source.

## AI sub-node wires

The full set of connection type names, and the only place docs.n8n.io lists them — on the
LangChain Code node page, not on any cluster-node page:
https://docs.n8n.io/build/code-in-n8n/use-built-in-shortcuts/langchain-code-node

```
ai_agent · ai_chain · ai_document · ai_embedding · ai_languageModel · ai_memory
ai_outputParser · ai_retriever · ai_textSplitter · ai_tool · ai_vectorRetriever · ai_vectorStore
```

The ones you will actually wire:

| Wire | Attaches |
|---|---|
| `ai_languageModel` | chat model → agent / chain |
| `ai_memory` | memory → **agent only** (n8n chains do not support memory) |
| `ai_tool` | tool → agent |
| `ai_outputParser` | structured output parser → agent / chain |
| `ai_embedding` | embeddings → vector store |
| `ai_document` | document loader → vector store |
| `ai_textSplitter` | text splitter → document loader |
| `ai_retriever` | retriever → chain |
| `ai_vectorStore` | vector store (mode `retrieve`) → retriever / chain |

**Direction is the trap: the sub-node is the source, the root node is the target.** The docs name
the wires but not their direction; this was verified against a live instance:

```json
"Model 1": { "ai_languageModel": [[{ "node": "Agent 1", "type": "ai_languageModel", "index": 0 }]] }
```

Read that as "the model feeds Agent 1", not "the agent has a model". Same for tools and memory —
each sub-node gets its own top-level entry in `connections` pointing at the agent.

## Settings

```json
"settings": { "executionOrder": "v1", "timezone": "Europe/Warsaw", "errorWorkflow": "aBc123" }
```

| Key | Note |
|---|---|
| `executionOrder` | **Always `"v1"`.** `v0` interleaves branches unpredictably |
| `timezone` | IANA name. Falls back to the instance tz, then to `America/New_York` — set it if a Schedule Trigger matters |
| `errorWorkflow` | Workflow **id** of a workflow starting with an Error Trigger |
| `saveDataErrorExecution` / `saveDataSuccessExecution` | `"all"` or `"none"`. `"none"` for errors means no `execution.url` in error notifications |
| `executionTimeout` | Seconds, max 3600 |
| `callerPolicy` | Who may call this as a sub-workflow. Default `workflowsFromSameOwner`; `any` is deprecated |
| `saveManualExecutions` / `saveExecutionProgress` | Booleans. `saveExecutionProgress` decides whether a failed run can be resumed at all |
| `redactionPolicy` | `none` / `non-manual` / `manual-only` / `all` — redacts stored execution data |
| `callerIds` | Comma-separated workflow ids. **Required** when `callerPolicy` is `workflowsFromAList` |
| `availableInMCP` | Exposes the workflow as a tool on the instance MCP server. Needs it published with a webhook, form, schedule or chat trigger |
| `binaryMode`, `credentialResolverId` | Derived — anything you send is ignored |

## SDK construct → JSON

Use this when the MCP drops after the SDK code is written. Do not rewrite the workflow; translate it.

| SDK | JSON |
|---|---|
| `workflow('id', 'Name')` | `{"name": "Name", …}` — the SDK id is not the instance id |
| `trigger({type, version, config})` / `node(...)` | an entry in `nodes` with `type`, `typeVersion`, `parameters` |
| `config.name` | `nodes[].name` |
| `.add(a).to(b)` | `connections.a.main[0] = [{node:"b", type:"main", index:0}]` |
| `.onTrue(x) / .onFalse(y)` | `main[0]` = x, `main[1]` = y |
| `.onDone(x) / .onEachBatch(y)` | `main[0]` = x (done), `main[1]` = y (loop) |
| `.onError(h)` | `"onError": "continueErrorOutput"` on the node + `connections.<node>.error[0]` |
| `.output(n)` / `.input(n)` | the array index in `main[n]` / the target's `index: n` |
| `config.subnodes.model` | `connections.<modelNode>.ai_languageModel[0] = [{node:"<agent>", type:"ai_languageModel", index:0}]` |
| `config.subnodes.tools[i]` | one `ai_tool` entry per tool node, all pointing at the agent |
| `config.subnodes.memory` | `ai_memory` entry pointing at the agent |
| `expr('{{ $json.x }}')` | `"=`… `{{ $json.x }}"` — the leading `=` marks the string as an expression |
| `newCredential('Name')` | `credentials: {"<type>": {"id": "<real id>", "name": "Name"}}` — you must supply the real id |
| `placeholder('…')` | leave the parameter out and tell the user |
| `sticky('text')` | a `n8n-nodes-base.stickyNote` node with `parameters.content` |

## Creating it

```bash
node "${CLAUDE_SKILL_DIR}/../n8n-api/scripts/n8n-api.mjs" workflows create --file wf.json
```

New workflows arrive **inactive**. Activation is a separate call and needs a trigger node.
