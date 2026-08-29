# Best-practice techniques — which to fetch, which to skip

`get_workflow_best_practices` returns opinionated guidance (recommended nodes, patterns, pitfalls)
for one technique per call, ~700–1300 words each. **Call at most two per build**, and never
`technique="list"` — the list is here.

## The 17 keys

| Technique | Documented? | Fetch it when |
|---|---|---|
| `scheduling` | ✅ | Anything cron/interval-driven |
| `chatbot` | ✅ | Chat over Telegram/Slack/Discord/web, session memory |
| `form_input` | ✅ | Form Trigger collecting user input |
| `scraping_and_research` | ✅ | Fetching and distilling web content |
| `triage` | ✅ | Classify-and-route incoming items |
| `content_generation` | ✅ | Drafting text/images from a brief |
| `document_processing` | ✅ | PDFs, attachments, OCR, extraction from files |
| `data_extraction` | ✅ | Structured fields out of unstructured text |
| `data_transformation` | ✅ | Reshaping between systems |
| `data_persistence` | ✅ | Data tables, databases, dedup, upserts |
| `notification` | ✅ | Alerting a human or channel |
| `web_app` | ✅ | Serving a UI from a webhook (returns a full worked example) |
| `monitoring` | ❌ empty | — use the skeleton below |
| `enrichment` | ❌ empty | — |
| `data_analysis` | ❌ empty | — |
| `knowledge_base` | ❌ empty | — |
| `human_in_the_loop` | ❌ empty | — |

The five marked empty return a stub. **Do not spend a call on them.**

## Request → technique

| The user says | Fetch |
|---|---|
| "every morning / hourly / on a schedule" | `scheduling` |
| "a bot that answers in Telegram" | `chatbot` |
| "collect requests from a form" | `form_input` |
| "read this site and summarise" | `scraping_and_research` |
| "sort incoming email / tickets" | `triage` |
| "write posts / draft replies" | `content_generation` |
| "process invoices / PDFs" | `document_processing` |
| "pull the fields out of this text" | `data_extraction` |
| "move data from X to Y" | `data_transformation` |
| "remember what we already saw" | `data_persistence` |
| "tell me when it happens" | `notification` |
| "a small dashboard / web page" | `web_app` |

Two techniques is the ceiling. A "scheduled digest to Telegram" is `scheduling` +
`notification` — not four calls.

## Skeletons for the five undocumented ones

Use these instead of a wasted call.

**`monitoring`** — Schedule Trigger → probe (HTTP Request / DB query) → IF threshold →
notification. Keep last-state in a Data Table so it alerts on *transitions*, not on every run.
Set `errorWorkflow` — a monitor that dies silently is worse than none.

**`enrichment`** — Trigger → for each record: lookup in the enrichment source → Merge (combine by
position or key) → write back. Rate-limit with `splitInBatches` plus a Wait node; set
`retryOnFail` on the lookup. Cache into a Data Table keyed by the lookup input to avoid paying twice
for the same record.

**`data_analysis`** — Fetch → normalise in Code (Run Once for All Items) → aggregate → format.
Do arithmetic in the Code node, not in expressions spread across nodes: one place to test, one
place to fix. For anything over a few thousand rows, aggregate in SQL and let n8n move the result.

**`knowledge_base`** — Ingestion workflow (source → document loader → text splitter → embeddings →
vector store) kept separate from the query workflow (agent or retrieval chain → vector-store tool).
Re-ingesting is a rebuild; version the collection name so a bad ingest is revertible.

**`human_in_the_loop`** — Split the run in two around the human: workflow A does the work and posts
an approval request carrying a resume URL; a Wait node in "resume on webhook" mode holds the
execution; the approval click resumes it. Always pair with a timeout branch — an execution waiting
forever on a human is an execution nobody sees. Gate every destructive tool this way.
