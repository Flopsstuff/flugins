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
`$('Name')`. `$getPairedItem` is removed in n8n 3.0.

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
- **Loop state** lives on `.context`: `{{ $('Loop Over Items').context['noItemsLeft'] }}` tells you
  the loop is finished, `context['currentRunIndex']` which pass you are on.

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

`$now` and `$today` are Luxon `DateTime`. `$now` uses the **workflow** timezone; `$today` uses the
**instance** timezone unless the workflow overrides it. Both fall back workflow → instance →
`America/New_York`.

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
- **No credentials.** `$getCredentials` does not exist in a Code node. Put the secret in a
  credential and let a real node use it, or use an expression in a credential field.
- **Expressions are single-line.** Multi-statement logic needs the IIFE above.
- **n8n's custom helpers do not exist in the Code node** — `$if()`, `$ifEmpty()`, `$jmespath()`,
  and Luxon conveniences like `DateTime.format()` / `.plus(amount, unit)` are expression-only.
  Write plain JavaScript instead.
- **The sandbox has no network access.** `fetch()`, `axios`, `XMLHttpRequest` and `require` of any
  http module are unavailable and fail at runtime. Never make an HTTP call from a Code node — use
  an HTTP Request node and process its output.
- **`require` is blocked** unless a self-hosted instance opts in via `NODE_FUNCTION_ALLOW_BUILTIN` /
  `NODE_FUNCTION_ALLOW_EXTERNAL`; n8n Cloud exposes only `crypto` and `moment`.
- **Python is native now** (task runners; the old Pyodide mode is gone in n8n 2): only `_items` in
  all-items mode and `_item` per item, bracket access notation only, and no libraries on Cloud.
  JavaScript remains the better-supported choice.
- Reach for the Code node **last**. It is sandboxed and slower than native nodes, and most of what
  people write in it has a dedicated node: `set` (reshape fields), `filter` (drop items), `if` /
  `switch` (route), `splitOut` (array → items), `aggregate` (items → one), `summarize` (pivot),
  `removeDuplicates`, `limit`, `dateTime`. Keep it for genuinely multi-step algorithms.

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
