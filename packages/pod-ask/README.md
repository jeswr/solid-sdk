<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
# @jeswr/pod-ask

Pure, dependency-free grounded question answering. No React, SDK imports, network,
credentials, persistence, tools or conversation threads. The caller supplies passages
and owns retrieval, consent and the `AnswerModel` implementation.

- `buildGroundedPrompt(question, passages, opts)` produces separate system/user text
  and the exact retained sources. Budgets count UTF-16 code units, including framing,
  JSON escaping, metadata and question. Defaults: 24,000 total, 3,000 per passage,
  eight sources and a 2,000-character question. Total budget is 1,024–32,000;
  per-passage budget is 1–4,000. Sources are numbered in retained order. Use the
  returned `passages` for citation mapping. Fenced JSON escapes backticks, so source
  text cannot close the fence. Prompt instructions reduce injection risk; they do
  not make a model's output authoritative.
- `parseGroundedAnswer(text, passages)` splits plain text into sentences, maps
  citations to supplied HTTP(S) resources, removes and reports invalid citations,
  and marks sentences without a valid citation as unsupported. A reply that is exactly
  the refusal ("I couldn't find that in your pod", ignoring quotes and end punctuation)
  returns `notFound: true` with no sentences, so callers render a neutral empty state
  rather than an unsupported-sentence warning. It accepts `[1]`,
  adjacent citations and comma-separated citations. A citation is provenance,
  not an entailment check. Render text as text, never HTML or Markdown. Output is
  capped at 16,000 characters. No automatic source URL is inferred from model text.
- `extractiveAnswer(question, passages)` returns up to three matching verbatim
  sentences with citations, ranked deterministically by word overlap. It removes
  source-authored citation markers. When no sentence matches it returns
  `notFound: true` with no sentences. The fallback never generates facts or follows
  source instructions.
- `AnswerModel` is the seam for a grounded completion: `answer(prompt, signal)` receives
  the `GroundedPrompt` from `buildGroundedPrompt`. The prompt may drop sources (unsafe
  URLs, budget) and so renumber them, so a caller must parse the reply against
  `prompt.passages`, never the passages it retrieved, and should show users exactly
  those sources.
- `questionTerms` removes common English question words for lexical retrieval.
  `sourceUrl` validates navigation links without fetching them.

There is no RDF domain model, ontology or generated code in this package: its data
is transient passage and answer DTOs. Suite demo data uses standard vocabulary
through wrapper accessors.

There is no hosted completion. Suite apps reach models only through
`@jeswr/agent-model-gateway` (the agent-layer guard forbids model SDKs elsewhere), and
the gateway has a fixed Reader extraction contract and a tool-enabled Proposer, but no
plain grounded completion: **gateway gap: grounded completion**. Until it gains one,
Ask my pod configures no `AnswerModel` and answers with `extractiveAnswer` only, so
nothing leaves the browser. A future gateway-backed `AnswerModel` plugs into the seam
above.

Run `pnpm --filter @jeswr/pod-ask build`, `typecheck`, `lint` and `test`.
