# AI agents, chains and their sub-nodes

Read when the request mentions an agent, chatbot, LLM, RAG or tools.
Wire names and the direction rule live in `workflow-json.md` — not repeated here.

## Pick the root node first

| Need | Node |
|---|---|
| One prompt in, one answer out, no tools | `@n8n/n8n-nodes-langchain.chainLlm` (Basic LLM Chain) |
| The model must choose and call tools | `@n8n/n8n-nodes-langchain.agent` (AI Agent) |
| Answer from documents | Vector Store + `chainRetrievalQa`, or an agent with a vector-store tool |
| Classify into fixed buckets | `@n8n/n8n-nodes-langchain.textClassifier` |
| Pull fields out of text | `@n8n/n8n-nodes-langchain.informationExtractor` |

A chain with no tools is cheaper and far more predictable than an agent. Reach for the agent only
when tool selection is the point.

## The cluster

A root node plus sub-nodes attached by `ai_*` connections. In the SDK they go in `config.subnodes`;
in JSON each sub-node gets its own `connections` entry pointing at the root.

```
lmChatOpenAi ──ai_languageModel──▶ agent ◀──ai_tool── toolWorkflow
memoryBufferWindow ──ai_memory──▶ agent ◀──ai_tool── toolHttpRequest
```

**Requirements that will otherwise bite:**
- An Agent needs **at least one tool**. Zero tools is a configuration error.
- The agent-type setting is deprecated (everything is a Tools Agent); v1 of the node is removed in
  n8n 3.0 — use the current `typeVersion` from `search_nodes`.
- Exactly one chat model per root node.

## Prompt source

Default is "Take from previous node automatically", which reads a field named **exactly
`chatInput`**. If the upstream item has no such field the node fails with "No prompt specified".

Two fixes: set `promptType: 'define'` and pass `text` explicitly (preferred when the trigger is not
a chat), or add a Set node producing `chatInput`.

## Tools

| Tool node | Use for |
|---|---|
| `toolWorkflow` | Call another workflow — the reusable, testable option |
| `toolHttpRequest` | A single REST call |
| `toolCode` | Deterministic computation, written by you |
| `toolCalculator`, `toolWikipedia`, `toolSerpApi` | Stock utilities |
| `toolVectorStore` | Retrieval over an indexed corpus |

The **tool description is the prompt** the model reads to decide when to call it. Write it for the
model, not for a human: what it does, what it needs, when *not* to use it.

`$fromAI('key', 'description', 'type')` lets the model fill a parameter at call time — key accepts
letters, digits, underscore and hyphen; type is one of `string|number|boolean|json|date|datetime`:

```
"toolParameters": { "recipient": "={{ $fromAI('recipient', 'Email address to send to', 'string') }}" }
```

## Memory

`memoryBufferWindow` (in-process, resets on restart), `memoryPostgresChat`, `memoryRedisChat`,
`memoryMongoChatMemory` for durable history.

The **session key** decides who shares a conversation. Derive it from the platform's chat id, never
leave it static across users:

```
={{ $('Telegram Trigger').item.json.message.chat.id }}
```

If a Chat Trigger has "Load Previous Session" enabled, the trigger and the agent must point at the
**same memory sub-node**.

## Structured output

Attach `outputParserStructured` via `ai_outputParser`. Two constraints:

- **`$ref` is not supported** in the JSON Schema — inline every definition.
- "Generate from JSON example" marks **every** field required. Hand-write the schema when some
  fields are optional.

The parsed result arrives on `output`. A parse failure fails the node — set `onError` if a
malformed answer should not stop the run.

## Chat Trigger

- Every message is one execution.
- The reply is taken from a field named **`output`** or **`text`**. Any other name and the caller
  receives the whole object.
- Response modes: when the last node finishes, via Respond nodes, or streaming.
- A Chat Trigger must connect to an agent or chain root node.

## Multi-agent

`toolAiAgent` attaches one agent to another as a tool. **The orchestrator does not pass full
execution context by default** — the sub-agent sees only what the tool call carries, so put
everything it needs into the tool parameters.

## Cost and failure

- Agents loop: one user turn can be many model calls. Cap with the agent's `maxIterations`.
- Model nodes fail on rate limits like any HTTP node — `retryOnFail: true` with
  `waitBetweenTries: 2000` is the standard remedy.
- A tool that throws stops the agent unless the tool node sets `onError: continueRegularOutput`,
  which hands the model an error string to reason about instead.
