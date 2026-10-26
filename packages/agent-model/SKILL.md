---
name: agent-model
description: Use the channel-neutral agent core, canonical digests, vocabulary and typed pod record RDF mappings.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

The model is pure data and local conversion. Never import bindings, credential stores,
providers or enforcement implementations. `toRdf` and `fromRdf` validate structure;
they do not verify signatures, approvals, mandates or expiry against a clock.
Consumers must verify those through agent-mandate before acting.

Mint terms only in `src/vocab.ts`, and document every term in `docs/vocab.ttl`.
Use Resource subclasses and wrapper accessors for RDF, fetch-rdf for parsing,
and rdf-serialize for Turtle. Preserve lexical timestamps and ordered structured parts.
Only salted handle hashes belong in pod records. Proofs are opaque JSON passthrough;
mandates are references, not credentials issued or verified here.

Run lint, dependency-first build, typecheck and tests. Property tests cover all ten
pod record families with no network. `./testing` exports synthetic fixtures only.
The copied pilot modules remain in personal-agent until a later coordinated migration;
protected identifiers must never be rewritten in place.

Follow ADR-001 D4: Node >=24, ESM exports, workspace dependencies, strict TypeScript,
Biome, and Vitest. Never use live providers or credentials in tests.
Send implementations belong exclusively in channel send subpaths, importable only
by agent-executor and channel tests. Only agent-model-gateway may import OpenAI or
Anthropic SDKs; the gateway must never import agent-audit.
