# Authoring with the n8n Workflow SDK

Read for any graph that is not a straight line, or before the first SDK build of a session.

This file covers `patterns`, `functions`, `rules` and `import` from
`get_workflow_sdk_reference` — **do not spend a call on those sections.** Fetch
`patterns_detailed`, `design` or `groups` only when this file does not answer the question.
The SDK's syntax lives nowhere on docs.n8n.io; that tool is the only authority.

## Imports

```javascript
import {
  workflow, node, trigger, sticky, placeholder, newCredential,
  ifElse, switchCase, merge, splitInBatches, nextBatch,
  languageModel, memory, tool, outputParser,
  embedding, embeddings, vectorStore, retriever, documentLoader, textSplitter, reranker,
  fromAi, expr, nodeJson
} from '@n8n/workflow-sdk';
```

## Shape of a build

Declare every node as a `const` first, then wire them. The export is the workflow.

```javascript
const start = trigger({ type: 'n8n-nodes-base.manualTrigger', version: 1,
  config: { name: 'Start' } });

const fetchData = node({ type: 'n8n-nodes-base.httpRequest', version: 4.5,
  config: { name: 'Fetch Data', parameters: { method: 'GET', url: 'https://api.example.com' } } });

export default workflow('daily-sync', 'Daily sync')
  .add(start)
  .to(fetchData);
```

`workflow(id, name)` — the id is the SDK's own handle, not the instance id; the instance assigns
its own on create.

## Branching

```javascript
const isPaid = ifElse({ type: 'n8n-nodes-base.if', version: 2.2,
  config: { name: 'Is paid?', parameters: { conditions: { /* … */ } } } });

export default workflow('orders', 'Orders')
  .add(webhook)
  .to(isPaid
    .onTrue(charge.to(receipt))
    .onFalse(reject));
```

`switchCase` for more than two ways; outputs are addressed with `.output(n)`, **0-based**, in rule
order.

## Loops

```javascript
const batches = splitInBatches({ type: 'n8n-nodes-base.splitInBatches', version: 3,
  config: { name: 'Loop Over Items', parameters: { batchSize: 10 } } });

  .to(batches
    .onDone(summarise)
    .onEachBatch(process.to(nextBatch(batches))));
```

`onDone` is output 0, `onEachBatch` is output 1 — and the batch branch **must** end in
`nextBatch(...)` pointing back at the loop node, or the loop never advances.

## Merging

```javascript
const combine = merge({ type: 'n8n-nodes-base.merge', version: 3.2,
  config: { name: 'Combine', parameters: { mode: 'combine' } } });

fetchA.to(combine.input(0));
fetchB.to(combine.input(1));
```

`.input(n)` selects which inlet a branch lands on. After a merge, item linking is broken —
downstream expressions must use `.first()` / `.all()[i]`, not `.item`, and `nodeJson(node, 'path')`
instead of `$json` where the SDK needs a resolved reference.

## Error branches

```javascript
const call = node({ type: 'n8n-nodes-base.httpRequest', version: 4.5,
  config: { name: 'Call API', parameters: { /* … */ },
            onError: 'continueErrorOutput', retryOnFail: true, maxTries: 3 } });

call.onError(notifyFailure);
```

`.onError(handler)` only produces a wire if the node config also sets
`onError: 'continueErrorOutput'`. Setting one without the other is the classic no-op.

## AI clusters

Sub-nodes go in `config.subnodes` — **never** `.to()`:

```javascript
const model = languageModel({ type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', version: 1.3,
  config: { name: 'Model', parameters: { model: 'gpt-4.1-mini' },
            credentials: { openAiApi: newCredential('OpenAI') } } });

const mem = memory({ type: '@n8n/n8n-nodes-langchain.memoryBufferWindow', version: 1.4,
  config: { name: 'Memory', parameters: { sessionKey: expr('{{ $json.chatId }}') } } });

const search = tool({ type: '@n8n/n8n-nodes-langchain.toolHttpRequest', version: 1.1,
  config: { name: 'Search', parameters: {
    url: 'https://api.example.com/search',
    toolDescription: 'Search the product catalogue by keyword',
    query: fromAi('keyword', 'What to search for', 'string') } } });

const agent = node({ type: '@n8n/n8n-nodes-langchain.agent', version: 3.1,
  config: { name: 'Agent',
            parameters: { promptType: 'define', text: 'Help the user find products' },
            subnodes: { model, memory: mem, tools: [search] } } });
```

Slots: `model`, `memory`, `tools[]`, `outputParser`, `retriever`, `vectorStore`, `embedding`,
`documentLoader`, `textSplitter`.

## Expressions

```javascript
expr('Hello {{ $json.name }}')
expr("{{ $('Fetch').first().json.id }}")
```

- Single or double quotes — **backticks are rejected**.
- `$json`, `$()` and friends must sit **inside** the `{{ }}`; `expr($json.name)` is not an
  expression, it is a crash.
- In sub-nodes and after fan-in, prefer `nodeJson(fetchData, 'id')` over a raw `$json` reference.

## Documentation and placeholders

```javascript
sticky('Pulls yesterday\'s orders and posts a digest. Needs the Postgres credential.');
placeholder('Slack channel id — ask the user');
```

The SDK **forbids code comments** in workflow code; a `sticky()` note is the sanctioned way to
explain a graph, and it shows up on the canvas where the next person will look.

## Grouping

```javascript
.group('Ingestion', [fetchData, normalise, dedupe], { description: 'Pull and clean' })
```

Groups are visual frames. They are the first thing to drop if a build is fighting the SDK — they
carry no runtime meaning.

## House rules the SDK enforces

- **Every node must carry an `output` property with sample data** — downstream expressions are
  resolved against it. This is not optional.
- **Never reuse a builder name as a variable**: `const node = node({…})` breaks the file. Give each
  handle a descriptive name.
- **Name nodes for what they do**: "Fetch Weather Data", "Check Temperature" — not "HTTP Request",
  "Set", "If".
- `placeholder('hint')` goes **directly** as the parameter value, never inside `expr()`, an object
  or an array.
- No comments in the code; use `sticky()`.
- No backticks in `expr()`; multiline is string concatenation with every variable **inside** the
  `{{ }}`:
  - wrong: `expr('Digest - ' + $now.toFormat('MMMM d'))` — `$now` is outside the braces
  - right: `expr('Digest - {{ $now.toFormat("MMMM d") }}')`
- Use double quotes for a string containing an apostrophe.
- **Always `newCredential('Name')`** — never a fake id, never `mock-*`, never a hardcoded key. If
  the build sheet lists existing credentials, copy an id from it exactly or use `newCredential()`.
- Node versions come from `search_nodes`, **not** from examples in the SDK reference: those are
  pinned and drift behind the instance (a doc example showed Slack 2.3 while the instance served
  2.7).

## Four traps the SDK reference calls out by name

**1. Do not fake items to "keep the chain alive."** When a query returns zero items, downstream
nodes simply do not run — for a scheduled workflow that is the correct "nothing to do" signal.
Adding `alwaysOutputData: true` to force an empty `{}` through is what produces `undefined` reads,
`GET undefined` calls and Code-node crashes. Use it only when a branch genuinely must run on the
empty case, and pair it with an IF that checks for that case. Likewise, **no IF gate before a
loop** — `splitInBatches`, per-item nodes and `filter` already no-op on empty input.

**2. `executeOnce: true` for nodes that should run once, not per item.** A summary notification, a
report, an API call that does not need repeating. Duplicate messages almost always mean a missing
`executeOnce`.

**3. Pick the right control-flow primitive.**

| Need | Use |
|---|---|
| Per-item work with side effects | `splitInBatches` with `batchSize: 1`, looped back via `nextBatch` |
| Drop items that fail a predicate | `filter` — emits 0 items and the chain stops cleanly |
| Two exclusive paths that both act | `ifElse` with `onTrue` / `onFalse` |
| Many exclusive paths keyed off a value | `switchCase` with `onCase(n, …)` |

A Filter or IF only *selects*; it performs no action. If the user asked to archive, delete or send
for matching items, the action node still has to be wired on the matching path. Nesting works:
`ifNode.onTrue(loopBuilder)`, `splitInBatches(sib).onEachBatch(ifElseBuilder)`.

**4. Inserting a node into an existing connection changes what the next node sees.** A node reads
only its immediate predecessor. Slip C between A and B and B now reads C's output — `$json` and
auto-mapped fields silently switch source. Write nodes are the sharp edge: they output the **API
response** (ids, `ok` flags), not the data that went in.

- wrong: `code.to(ensureSheet).to(appendRows)` — appendRows maps the create-sheet response
- right: `trigger.to(ensureSheet).to(code).to(appendRows)`, or have the downstream node read
  `$('Data Node').item.json.field` explicitly

## After writing

1. `validate_workflow(code)` — warnings are errors.
2. Local preflight (see SKILL.md).
3. `create_workflow_from_code(code, name, projectId?, folderId?, versionName)` — unpublished.
   Omitting `projectId` lands it in the caller's personal project; `folderId` requires `projectId`.

To change an existing workflow, prefer `update_workflow(workflowId, operations[], versionName)`
over rebuilding: it takes up to 100 atomic operations (`addNode`, `removeNode`, `renameNode`,
`addConnection`, `setNodeParameter`, `setNodeCredential`, `setWorkflowSettings`, …) and leaves the
rest of the graph untouched.
