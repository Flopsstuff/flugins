# Error handling, and what to do when a build goes wrong

Read when adding error handling, or when something is failing.

## Node-level settings

```json
{ "retryOnFail": true, "maxTries": 3, "waitBetweenTries": 1000,
  "onError": "continueErrorOutput", "alwaysOutputData": false, "executeOnce": false }
```

| Field | Effect |
|---|---|
| `retryOnFail` + `maxTries` + `waitBetweenTries` | Retry in place. **The documented remedy for rate limits.** Try this before wiring error branches |
| `onError: "stopWorkflow"` | Default. The execution fails and the error workflow fires |
| `onError: "continueRegularOutput"` | The error is swallowed and the previous data flows on |
| `onError: "continueErrorOutput"` | Adds a second output carrying the error — wire it somewhere |
| `alwaysOutputData` | Emits an empty item when the node returns none |
| `executeOnce` | Run once against the first item only |

`continueOnFail` is **deprecated** — use `onError`.

## How failures go silent

Three mechanisms, all of them look like success:

1. **`onError: continueRegularOutput`** — downstream nodes receive the *previous* node's data and
   carry on as if nothing happened. Nothing is logged as an error, and the error workflow never
   fires.
2. **`alwaysOutputData: true`** — a node that found nothing emits `{}`, so a downstream "if we got
   here we have data" assumption quietly breaks.
3. **`saveDataErrorExecution: "none"`** — the run fails but leaves no execution to inspect, and the
   error-workflow payload arrives without `execution.id` or `execution.url`.

When a failure must be loud, use `n8n-nodes-base.stopAndError`.

## Per-node error branch — a two-step setup

Setting `onError: "continueErrorOutput"` alone does nothing visible: it creates a second output that
is not connected. The error path exists only once you also wire it:

```json
"Fetch orders": {
  "main":  [[{ "node": "Process", "type": "main", "index": 0 }]],
  "error": [[{ "node": "Notify failure", "type": "main", "index": 0 }]]
}
```

Forgetting the second half is the most common "my error handling does nothing" report.

## Workflow-level error workflow

Set `settings.errorWorkflow` to the **id** of a workflow whose first node is
`n8n-nodes-base.errorTrigger`. It receives:

```json
{ "execution": { "id": "123", "url": "https://…", "retryOf": null,
                 "error": { "message": "…", "stack": "…" },
                 "lastNodeExecuted": "Fetch orders", "mode": "trigger" },
  "workflow": { "id": "abc", "name": "Daily digest" } }
```

**If the failure happened in the trigger node itself the shape is different** — `{ trigger: {error,
mode}, workflow }`, with no `execution.id` and no url. An error handler that reads
`$json.execution.id` unconditionally will itself fail on exactly the executions you most want to
hear about. Guard it:

```
{{ $json.execution?.id ?? 'trigger failure' }}
```

## Designing for recovery

- Retry transient things (HTTP, rate limits) at the node; branch on permanent things (bad input,
  missing record).
- Put the error branch somewhere a human sees: Telegram, Slack, email — not a Set node.
- Include `workflow.name`, `lastNodeExecuted` and the message. An alert without the failing node
  name costs a manual investigation every time.
- For an unattended workflow, an `errorWorkflow` is not optional. Without it a failure is silent
  until someone notices the missing output.

## Recovery playbooks

**MCP dropped mid-build.** The SDK code exists; do not rewrite it. Retry one cheap call. If still
down, translate with the SDK→JSON table in `workflow-json.md`, create through the `n8n-api` skill,
and tell the user plainly that it went in **unvalidated and unpublished**.

**`validate_workflow` returned warnings.** Blocking, always. It is lenient enough to return
`valid: true` for a node missing a required parameter — a warning is the only signal you get.

**Node type not found.** Re-search with synonyms → `mcp__n8n-docs__searchDocumentation` → say it is
not installed and offer HTTP Request. Never fabricate a node type.

**Credential missing.** Default to `placeholder()` and tell the user to attach it in the UI. Create
one only if they offer the secret — collect it with `AskUserQuestion` and never echo it back.
`n8n-api` → `credentials create --type <type> --name <name> --data '{…}'`; discover the fields
first with `credentials schema <type>`.

**Two failed correction rounds.** Stop. Show the graph, name the blocker, hand it back. Further
guessing costs tokens and credibility.

**A run failed after creation.** Hand to the `n8n-api` skill: `executions errors --workflow <id>`
returns the failing node and message directly.
