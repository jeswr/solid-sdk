<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-model-gateway

Private Node >=24 gateway for Anthropic and OpenAI (DESIGN §6, A-011).

```ts
const gateway = createGateway({
  provider: "openai", model, maxTokens: 2048,
  tokens: providerTokenProvider, account: "openai",
});
const { data, calls } = await gateway.reader.extract(message, schema);
const { proposals, calls: proposalCalls } = await gateway.proposer.propose(turns, {
  pod, memoryRecall, instructions: "Prepare drafts for review.",
});
```

Keys come exclusively from the injected agent-credentials `TokenProvider.read(account)`;
use a provider-specific instance. No environment API key or default credential store is read.
The only accepted `baseURL` values are the selected provider's HTTPS origin, with an optional
trailing slash: `https://api.anthropic.com` or `https://api.openai.com`. The default HTTP transport
uses guarded-fetch with no redirects, a response size limit and a deadline; injected transports
must honor the same contract. Optional fetch, clock, retry budget, timeout and turn limit
support deterministic tests.
Retries default to zero; HTTP retries cover only 429 and 5xx responses, at most three times.

Reader has no tools. It runs legacy-bridge structured metadata extraction, then the pilot's
unchanged low-confidence triage rules. Object schemas may request `interpretations` and the
baseline fields (`primary`, `primaryRule`, `urgency`, `urgencyRule`, `needsReply`, `confidence`).
These names are the conservative deterministic mapping; arbitrary field names are not guessed.
If the schema accepts the deterministic result, no credentials or provider are consulted.
Otherwise the model extracts missing fields from a JSON-quoted data block. Deterministic fields
are retained and the complete result is validated against the caller's Zod schema. Confidence
and metadata remain suggestions with their original reliability labels; they grant no authority.
Anthropic Reader uses Messages; OpenAI uses Responses with `store: false`.

Proposer uses the Claude Agent SDK for Anthropic and a bounded Responses loop for OpenAI.
It exposes exactly `pod_read`, `pod_search` (the Solid MCP registry's read-only tools),
`memory_recall` (injected until agent-memory is implemented), and `propose`. The SDK has no
built-in tools, external MCP configuration, inherited credentials, project settings or persisted
session. Its home and working directory are temporary and removed after the run.
`propose` advertises and validates the agent-model ActionProposal fields with state `proposed`,
excluding `wasGeneratedBy`, and returns the proposal locally. The gateway supplies
`wasGeneratedBy` using the producing model-call UUID IRI. The runtime
must persist that provenance and the proposals, and enforce mandates and approvals.
The gateway has no send tool, pod mutation tool or audit writer.

Both contexts return call records with local UUID IRI, context, configured provider/model,
`tokens: { input, output }` (also `inputTokens`/`outputTokens`), tool-call count, latency and
retry count. SDK fragments sharing a provider message ID produce one record; its aggregate
result is not counted again. Partial SDK events supply final output counts per message ID,
replacing assistant-message placeholders. A result total can fill one missing output count;
multiple missing counts fail closed rather than guessing their distribution.
HTTP retries share one record. `GatewayError.calls` preserves
completed/failed-request counters without provider error text, prompts or secrets. The caller
owns audit persistence. Latency includes transport and local tool time between SDK responses;
SDK retry counts come from `api_retry` events; the gateway aborts when that budget is exceeded.
Tool exceptions are redacted before they reach the SDK.

`./testing` exports a scripted fake fetch that never falls through to the network.
Tests use only synthetic credentials, fake fetch/SDK sessions and an in-memory PodPort.
Run lint, dependency-first build, typecheck and test; test enforces 100% coverage in every metric.
