# Choosing nodes

Read before `get_node_types`, or when picking nodes without MCP.

## The version rule

**Take `type` and `typeVersion` from `search_nodes` on the target instance.** Not from this file,
not from SDK examples (they pin stale versions), not from memory. A wrong `typeVersion` either
fails validation or silently changes parameter names.

Without MCP, read the real values off the instance instead of guessing:

```bash
node "${CLAUDE_SKILL_DIR}/../n8n-api/scripts/n8n-api.mjs" workflows nodes <some-existing-workflow>
```

That prints every node's `type`, `typeVersion` and credential keys — a workflow already running on
the instance is the most reliable source there is.

## Reading `search_nodes` results

Results carry **discriminators** — `resource`, `operation`, `mode` — and they matter, because one
node type has many parameter sets. `n8n-nodes-base.gmail` with `resource: message, operation: send`
takes entirely different parameters from `resource: draft`. Pass the discriminators into
`get_node_types`, or you get the wrong schema and 2.5k wasted tokens.

`usage: "agentTool"` filters to nodes attachable to an agent — use it when picking tools.

## Which nodes need `explore_node_resources`

Any parameter whose type definition is annotated `@searchListMethod` or `@loadOptionsMethod` is a
picker backed by a live API call: Slack channel, Google Sheets document/tab, Drive folder, Notion
database, Airtable base. Their values are opaque instance-specific ids.

Resolve them with `explore_node_resources` using a real `credentialId`, then use a returned
`value` verbatim. **Never invent one** — an invented channel id produces a workflow that validates
cleanly and fails at run time.

## Trigger matrix

| Trigger | Fireable from outside? | Notes |
|---|---|---|
| Webhook | ✅ | Production URL needs the workflow published; test URL lives 120 s after "Listen for test event" |
| Form Trigger | ✅ | `/form/<path>`; output keys are **field names**, not labels |
| Chat Trigger | ✅ | Public or embedded; one execution per message |
| MCP Server Trigger | ✅ | Exposes the workflow as an MCP tool |
| Schedule Trigger | ❌ | Cron takes **6 fields** (leading seconds). Must be published. Timezone: workflow → instance → `America/New_York` |
| Manual Trigger | ❌ | Editor only, and only one per workflow |
| Error Trigger | ❌ | Fires when a workflow naming this one as `errorWorkflow` fails |
| Execute Sub-workflow Trigger | ❌ | Called by another workflow. Input modes: define fields / JSON example / accept all |
| App triggers (Gmail, Telegram, RSS…) | ❌ | Poll or push on their own schedule |

Only one trigger fires per execution.

## Nodes seen in production on this instance

A starting point for what exists and works — **not** a version reference.

| Node | Typical use |
|---|---|
| `n8n-nodes-base.merge` | Fan-in. Breaks `.item` linking downstream |
| `n8n-nodes-base.set` | Rename/reshape fields. Cheap, no `get_node_types` needed |
| `n8n-nodes-base.code` | Anything Set cannot express |
| `n8n-nodes-base.switch` | Multi-way branch; Rules or Expression mode |
| `n8n-nodes-base.if` / `.filter` | Two-way branch (0 = true, 1 = false) / drop non-matching items |
| `n8n-nodes-base.splitInBatches` | Loop. **Output 0 = done, 1 = loop** |
| `n8n-nodes-base.httpRequest` | Any REST call not covered by an app node |
| `n8n-nodes-base.executeWorkflow` + `.executeWorkflowTrigger` | Sub-workflow call and its entry point |
| `n8n-nodes-base.wait` | Delay, or resume on a webhook |
| `n8n-nodes-base.telegram` / `.gmail` / `.googleDrive` / `.postgres` | App nodes, each with resource/operation discriminators |
| `@n8n/n8n-nodes-langchain.agent` | AI agent root node |
| `@n8n/n8n-nodes-langchain.lmChat*` | Chat models (OpenAi, OpenRouter, AwsBedrock, …) |
| `@n8n/n8n-nodes-langchain.memoryRedisChat` / `memoryBufferWindow` | Agent memory |
| `@n8n/n8n-nodes-langchain.outputParserStructured` | Force JSON out of a model |
| `n8n-nodes-base.stickyNote` | Canvas documentation — free, use it |

Nodes with `n8n-nodes-globals.*` or other non-`n8n-nodes-base` prefixes are community or
instance-specific installs. Confirm with `search_nodes` before relying on one.

## When the node does not exist

Search again with synonyms (the catalogue names things by vendor, not by verb). Then check
`mcp__n8n-docs__searchDocumentation`. If it genuinely is not installed, say so and offer HTTP
Request against the service's API. **Never invent `n8n-nodes-base.<something>`** — it validates as
an unknown node and fails on execution.
