# Workflow JSON — the format, and how SDK code maps onto it

Read when there is no MCP server, or when reviewing/patching raw JSON. This is the shape the REST
API accepts (`POST /workflows`, `PUT /workflows/{id}`).

## Required and forbidden

`name`, `nodes`, `connections`, `settings` are **required**. Send anything read-only and the API
answers 400:

```
id · active · createdAt · updatedAt · isArchived · versionId · triggerCount
meta · tags · shared · activeVersion · activeVersionId · sourceWorkflowId · versionCounter
```

Also accepted: `description`, `staticData`, `pinData`, `nodeGroups`, `parentFolderId`, and on
create only `projectId`. A `null` for these is rejected — omit the key instead. The one exception
is `parentFolderId`, where `null` means "move to the project root" and omitting it means "leave the
folder alone".

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
- **Merge**: fan-in, so the *targets* carry `index: 0` and `index: 1` — the index is the **input**
  number on the merge node, not the output of the source.

## AI sub-node wires

These connection type names are **not documented anywhere on docs.n8n.io**. They are the difference
between an agent that runs and one that reports no model attached.

| Wire | Attaches |
|---|---|
| `ai_languageModel` | chat model → agent / chain |
| `ai_memory` | memory → agent / chat trigger |
| `ai_tool` | tool → agent |
| `ai_outputParser` | structured output parser → agent / chain |
| `ai_embedding` | embeddings → vector store |
| `ai_document` | document loader → vector store |
| `ai_textSplitter` | text splitter → document loader |
| `ai_retriever` | retriever → chain |

**Direction is the trap: the sub-node is the source, the root node is the target.** Verified on a
live instance:

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
| `availableInMCP` | Exposes the workflow as a tool on the instance MCP server. Needs the workflow published with a webhook trigger |
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
