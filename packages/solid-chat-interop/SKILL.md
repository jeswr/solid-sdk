---
name: solid-chat-interop
description: Use when reading or writing canonical Solid chat messages or archived conversations through @jeswr/solid-chat-interop, regenerating its AS2 model, maintaining its facade, or changing chat interop and persistence policy.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# Solid chat interop

The canonical Message (`as:Note`) and stored Conversation (`as:Collection`) models are
generated from `codegen/chat.ontology.ttl`, `codegen/chat.shapes.ttl` and
`codegen/codegen.config.json`. Read the federation-codegen and model-runtime package
skills before changing these inputs. Never edit `src/generated/`; regenerate through
`pnpm run codegen --update-lock` after reviewing input changes. `test/codegen.test.ts`
regenerates all six artifacts byte for byte. Biome excludes `!!src/generated`.

`src/as2.ts` is the canonical message facade; `src/conversation.ts` handles stored
conversation metadata. `As2MessageDoc` is a declaration-only public view over the
generated wrapper (`src/message-view.ts`), with no hand-written scalar accessors.
Preserve all public exports, constructor types, clearing setters and plain-data types.
The esbuild build bundles generated JS and model-runtime; public declarations must
remain self-contained, because mirrorPublish marks the runtime inlined.

Keep the existing HTTPS ActivityStreams namespace exactly. The social sector uses
different IRIs: the generation profile header records mappings and omissions without
inventing aliases. Published `shapes/message.shacl.ttl` and its Node-only `/shape`
reader retain the task-state qualified warning; only that unsupported property shape
is omitted from generation. Keep the facade's co-typed `wf:Task` overlay and closed-wins
state policy. The `pc:` legacy migration stays in `canonical-vocab.ts`.

Chat's IRI policy is lexical: `safeHttpIri` from rdf-serialize filters HTTP(S) and
percent-escapes forbidden characters without normalizing identity. The runtime HTTP
guard normalizes URLs. `canonical-iris.ts` keeps the package policy through one typed
singleton accessor for all eight IRI fields; do not replace it with URL.href or
remove filtering. Subject writes also use the lexical guard before generated build.

Strict generated parsing rejects missing content/timestamp. The public interop parser
preserves incomplete foreign notes by projecting individually guarded generated fields;
this is not SHACL conformance. Write-only `published = now` and media-type defaults,
PROV-O nesting, task policy and original Store/Turtle/JSON order stay in the facade.
README "Exact divergences" and `test/compatibility.test.ts` pin all stricter behavior.

This package is security-critical. Preserve all 410 original tests verbatim, especially
`security-hardening.test.ts`, `iri-filter.test.ts`, `redact.test.ts` and ChatWriter's ACL
tests. Adapters, LongChat, reconciliation, transcripts, redaction, JSON-LD contexts,
owner-only ACL ordering, conditional writes, ID hashing and paging remain their own
policy. No raw triples or concatenated Turtle in production: generated entities,
typed wrapper accessors, and the shared N3-based serializer only.

From the workspace root:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-chat-interop run codegen --update-lock
pnpm exec turbo run lint build typecheck test --filter=...@jeswr/solid-chat-interop
node scripts/check-codegen.mjs
```
