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

## The AI node families

n8n models LangChain as **cluster nodes**: one root node plus sub-nodes.
https://docs.n8n.io/build/integrate-ai/langchain-in-n8n

| Category | Kind | Examples |
|---|---|---|
| Chain | **root** | Basic LLM Chain, Question and Answer Chain, Summarization Chain |
| Agent | **root** | AI Agent |
| Vector store | **root** | Pinecone, Qdrant, Simple Vector Store |
| Language model | sub | OpenAI Chat Model, Anthropic Chat Model, Ollama Chat Model |
| Memory | sub | Simple Memory, Postgres Chat Memory, Redis Chat Memory |
| Tool | sub | Call n8n Workflow Tool, Code Tool, Wikipedia, HTTP Request Tool |
| Retriever | sub | Vector Store Retriever, Workflow Retriever |
| Embeddings | sub | Embeddings OpenAI, Embeddings Cohere |
| Document loader | sub | Default Data Loader, GitHub Document Loader |
| Output parser | sub | Structured Output Parser (Auto-fixing is deprecated) |
| Text splitter | sub | Recursive Character Text Splitter, Token Splitter |

Two more that sit outside the table: **Chat Trigger** starts a workflow from a chat message, and
**LangChain Code** can be wired as an app node, a root node or a sub-node depending on which
connectors you configure — the escape hatch when no dedicated node exists.

A vector store is a *root* node, but in mode `retrieve` it becomes a sub-node for a chain, and in
mode `retrieve-as-tool` it becomes a tool for an agent. That mode switch is how RAG is wired.

The lists above are not exhaustive — the instance is the authority. `search_nodes` with
`usage: "agentTool"` returns exactly what can attach to an agent on *this* instance.

## The cluster

A root node plus sub-nodes attached by `ai_*` connections. In the SDK they go in `config.subnodes`;
in JSON each sub-node gets its own `connections` entry pointing at the root.

```
lmChatOpenAi ──ai_languageModel──▶ agent ◀──ai_tool── toolWorkflow
memoryBufferWindow ──ai_memory──▶ agent ◀──ai_tool── toolHttpRequest
```

**Give the agent a system message.** Put standing instructions in
`options.systemMessage`, not in the per-run prompt — the validator flags an agent without one
(`AGENT_NO_SYSTEM_MESSAGE`). The prompt carries the request; the system message carries the role,
the constraints and the output contract.

**Requirements that will otherwise bite:**
- An Agent needs **a chat model** — that is the sub-node the docs call out as mandatory, and its
  absence is the error you will actually hit.
- Tools are not formally required, but an agent without them is just a chain with extra latency:
  use `chainLlm` instead.
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
| `toolHttpRequest`, or `httpRequestTool` | A single REST call. Confirm which exists on the instance with `search_nodes(usage: "agentTool")` |
| `toolCode` | Deterministic computation, written by you |
| `toolCalculator`, `toolWikipedia`, `toolSerpApi` | Stock utilities |
| `toolVectorStore` | Retrieval over an indexed corpus |
| a vector store in mode `retrieve-as-tool` | The canonical RAG wiring — plug it into `subnodes.tools` |
| `@n8n/mcp-registry.*` | When the service has an MCP-registry node, prefer it over the plain action node for agent tools |

The **tool description is the prompt** the model reads to decide when to call it. Write it for the
model, not for a human: what it does, what it needs, when *not* to use it.

`$fromAI('key', 'description', 'type')` lets the model fill a parameter at call time — key accepts
letters, digits, underscore and hyphen; type is one of `string|number|boolean|json|date|datetime`:

```
"toolParameters": { "recipient": "={{ $fromAI('recipient', 'Email address to send to', 'string') }}" }
```

## Memory

`memoryBufferWindow` ("Simple Memory", in-process, resets on restart), `memoryPostgresChat`
`memoryRedisChat` and `memoryMongoChat` for durable history.

**Memory attaches to the AI Agent only.** No n8n chain node supports memory — if the workflow
must remember earlier turns, the root node has to be an agent.

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
- `options.responseMode` decides how the reply is delivered:
  - `streaming` — the agent streams straight to the widget. Simplest, and the recommended default.
  - `lastNode` — the **last executed node must output `{ output: '<reply>' }`**. Ending the chain
    with a Data Table insert, an HTTP Request or any other side-effect node fails: put logging and
    persistence on a parallel branch, or append a Set node that reshapes the output.
  - `responseNodes` — emit replies mid-flow with `@n8n/n8n-nodes-langchain.chat` nodes.
- `mode` picks the surface: `hostedChat` (page served by n8n) or `webhook` (embedded widget).
- A Chat Trigger must connect to an agent or chain root node.
- For human approval inside an agent, `@n8n/n8n-nodes-langchain.chatHitlTool` asks the user before a
  tool runs (needs `responseMode: 'responseNodes'`).

## Multi-agent

`@n8n/n8n-nodes-langchain.agentTool` attaches one agent to another as a tool. **The orchestrator
does not pass full execution context by default** — the sub-agent sees only what the tool call carries, so put
everything it needs into the tool parameters.

## Cost and failure

- Agents loop: one user turn can be many model calls. Cap with the agent's `maxIterations`.
- Model nodes fail on rate limits like any HTTP node — `retryOnFail: true` with
  `waitBetweenTries: 2000` is the standard remedy.
- A tool that throws stops the agent unless the tool node sets `onError: continueRegularOutput`,
  which hands the model an error string to reason about instead.
