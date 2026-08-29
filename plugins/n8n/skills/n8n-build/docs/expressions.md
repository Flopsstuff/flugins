# Expressions and the Code node

Read when writing any expression or Code node.
Reference: https://docs.n8n.io/build/work-with-data/transform-data/expression-reference/root

## Form

An expression is JavaScript inside `{{ }}`, in a string field that begins with `=` in the JSON:

```json
"text": "=Order {{ $json.body.id }} for {{ $json.body.customer.name }}"
```

The whole field is one string; `{{ }}` may appear several times. To send a whole JSON body, wrap
the **entire object** in one `{{ }}`, not each field separately.

Multi-statement logic needs an IIFE — there is no `;` sequencing at top level:

```
{{ (() => { const t = $json.total; return t > 100 ? 'big' : 'small'; })() }}
```

## The variables that exist

`$json` · `$binary` · `$input` · `$('Node Name')` · `$itemIndex` · `$runIndex` · `$prevNode` ·
`$parameter` · `$execution` · `$workflow` · `$vars` · `$secrets` · `$now` · `$today` ·
`$fromAI()` · `$if()` · `$ifEmpty()` · `$jmespath()` · `$max()` · `$min()` · `$nodeVersion` ·
`$pageCount` · `$request` · `$response`

**`$node["Name"]` and `$items()` are legacy** and absent from the current reference. Write
`$('Name')`.

## Referencing another node

```
{{ $('Fetch orders').item.json.id }}      // the item linked to this one
{{ $('Fetch orders').first().json.id }}   // first item of that node's output
{{ $('Fetch orders').last().json.id }}
{{ $('Fetch orders').all()[2].json.id }}
{{ $('Fetch orders').params.url }}        // its configured parameters
{{ $('Fetch orders').isExecuted }}        // guard before reading
```

- **`branchIndex` defaults to the output that connects that node to *this* one**, not to 0.
  `$('IF').all(1, 0)` reads the false branch, run 0.
- **`.item` throws "Multiple matching items" after Merge, Aggregate or Summarize** — item linking is
  ambiguous there. Use `.first()`, `.last()` or `.all()[i]`.
- **"Referenced node is unexecuted"** means the branch never ran. Guard with `$('X').isExecuted`.
- Binary is an object keyed by property name: `$('HTTP Request').item.binary.data.fileName`.

## Webhook data

A Webhook node outputs **one item shaped `{ headers, params, query, body }`**:

```
{{ $json.body.city }}      ✅
{{ $json.city }}           ❌ — undefined, and it fails silently in string concatenation
{{ $json.query.page }}     query string
{{ $json.headers['x-signature'] }}
```

Same for Form Trigger (`$json.<Field Name>` — the *field name*, not its label).

## Sub-nodes see item 0 only

Root nodes (Agent, Chain, HTTP Request…) iterate over every input item. **AI sub-nodes — chat
model, memory, output parser, tools — resolve their expressions against item 0 and only item 0.**
An expression in a tool description that reads `{{ $json.userId }}` returns the first item's value
for every invocation.

## Dates

`$now` and `$today` are Luxon `DateTime`, in the workflow timezone (`settings.timezone`, else the
instance's, else `America/New_York`).

```
{{ $now.minus({ days: 7 }).toISO() }}
{{ $now.toFormat('yyyy-MM-dd') }}
{{ DateTime.fromISO($json.created).diffNow('hours').hours }}
```

## Credentials accept expressions

Credential fields are evaluated per execution against that run's data — useful for per-tenant
tokens, and a hazard if the referenced node has not run.

## Code node

Two modes, and they behave differently:

| Mode | `$input` | Returns |
|---|---|---|
| Run Once for All Items | `$input.all()` — every item | an array of items |
| Run Once for Each Item | `$input.item` — one item | a single item |

The return shape is always `{ json: {...} }` per item, optionally with `binary`:

```javascript
// Run Once for All Items
const rows = $input.all().map(i => i.json);
return rows.filter(r => r.total > 100).map(r => ({ json: { id: r.id, total: r.total } }));
```

```javascript
// Run Once for Each Item
return { json: { ...$input.item.json, flagged: $input.item.json.total > 100 } };
```

- Returning a bare object or array of plain objects **works but drops item linking** — downstream
  `.item` then fails. Prefer explicit `{ json: … }`.
- In the Code node, `$('Node').itemMatching(i)` replaces `.item`.
- No `require`, no network in Python mode, and JavaScript is the better-supported option — the
  Python mode ships without external libraries.
- `$helpers.httpRequest(...)` is available in JS for ad-hoc calls, but a real HTTP Request node is
  easier to debug and retry.

## Where expressions do not go

Node **names**, connection targets, and workflow settings are literal. An expression in a Schedule
Trigger cron is evaluated **only when the workflow is published**, not on each run.

## Common failures

| Symptom | Cause |
|---|---|
| Value is `undefined`, no error | Read a webhook field without `.body` |
| "Multiple matching items" | `.item` after Merge/Aggregate |
| "Referenced node is unexecuted" | The branch did not run this execution |
| Expression appears literally in the output | The field is missing its leading `=` in JSON |
| Works on the first item, wrong afterwards | Expression evaluated in a sub-node (item 0 only) |
