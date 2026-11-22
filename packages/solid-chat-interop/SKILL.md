---
name: solid-chat-interop
description: Use when reading or writing canonical Solid chat messages or archived conversations through @jeswr/solid-chat-interop, regenerating its AS2 model, maintaining its facade, or changing chat interop, persistence, transcript export, redaction, or AS2/LongChat conversion.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

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

## Chat persistence and redaction

Read [README.md](README.md) and conversation archive decision
[0005](../../decisions/0005-conversation-archive.md) before changing persistence.
Keep RDF access through existing typed wrappers and serialization through n3.Writer.

`ChatWriter.save` redacts before deriving IDs or making any write. Preserve ACL-first,
owner-only, create-only writes. `renderTranscript` repeats redaction for legacy records.
Neither path logs input or errors containing credentials.

The 10 November value-only decision preserves assignment names, operators, quotes and
surrounding code. Use `[REDACTED]` for values and boundary pieces; retain existing
per-field PEM/token/header markers. Reuse the detectors in `src/redact.ts`.

Normalization strips variation selectors U+FE00–U+FE0F and U+E0100–U+E01EF except
FE0E/FE0F on an emoji base/modifier or in a complete keycap. A selector following a
bare digit is removed. It also strips lone surrogates (Cs), C0/C1 controls except
tab/CR/LF, then every Unicode General_Category=Cf character except:

- U+200D between two Extended_Pictographic characters, with optional U+FE0E/U+FE0F
  and/or an emoji modifier following each pictograph (either modifier/selector order).
- Subdivision flags: U+1F3F4, exactly two tag lowercase letters (U+E0061–U+E007A),
  then 1–4 tag lowercase letters or digits (U+E0030–U+E0039), then U+E007F.
  England/Scotland/Wales survive. Strip all other U+E0000–U+E007F tags and other Cf;
  a black flag cannot carry an arbitrary hidden ASCII instruction.

`redactSecretFields` takes fields in persistence order: title, messages, or source chunks.
`redactConversation` is the shared title/messages mapping used by save, transcript export
and capture; preserve all other conversation/message metadata and do not mutate input.
Its optional `{ chunks }` takes one readonly chunk array per message in message order;
refuse a length mismatch. Check raw chunks together, join each message with newlines
and trim, then check the assembled conversation again. Empty chunk arrays produce empty
text. Export importers must use this helper rather than maintain their own field mapping.
After per-field redaction it inspects each adjacent 512-code-unit suffix/prefix with no
separator, snapping edges inward to code-point boundaries. Replace only values covered
by detections whose full context spans the join (including a URL password's trailing `@`,
even when its value is wholly on the left). A right-hand `@` cannot extend a left
authority already containing a userinfo `@`. A host:port-looking suffix without an
authority delimiter is ambiguous: a following field's `@` establishes userinfo,
including numeric passwords wholly on the left or continued on the right. Redact
these conservatively even if the right field could be an @mention. Unambiguous
host:port URLs ending in `/` or followed by whitespace or a path stay intact.
It also checks normalized
source windows, because an earlier per-field marker can hide a token prefix.
Carry source ranges through existing replacements; never reconstruct plaintext from an
already-redacted value. Collect all boundary ranges before applying them.
Ignore zero-width boundary spans. Preserve existing markers byte-for-byte, including
when a span lies entirely inside/on one; absorb touching newly exposed fragments into
their coverage rather than rewriting or duplicating markers. Appending a neighbour must
not change a fully detected message's text or its derived ID. A closing quote at the
field boundary completes a shell word; preserve its quotes instead of treating the
next field as word continuation. Redacting a conversation prefix must match its
fields in the whole result, except that later context completing an unresolved
secret may add redaction, never remove existing coverage. Require F(F(fields)) = F(fields).
A marker-only left value ends boundary continuation, so replay cannot advance the
512-unit window through the next field. Original source windows still cover fragments.
Recheck edited fields with the per-field detectors: removing a boundary fragment can
expose an assignment formerly hidden inside another detector's syntax.

Redact orphan private-key END lines from the field start through the last END delimiter,
even without a previous field. Apply this conservative rule only to whole fields,
never to a boundary window's left suffix. Keep following text after END. Both PEM
rules accept an optional ` BLOCK`, including PGP private keys. Once a BEGIN header
is recognized (whole or across one join), carry redaction through all subsequent
fields until its first END or the conversation end. Bodies are not window-limited;
BEGIN and END delimiters still require one field or one bounded join.

Apply this to a complete capture/import conversation before queueing, filtering, or
splitting into one-message saves or batches. Retain source chunks until these checks
finish. Repeating only per-field redaction loses the context needed by the next field.
Existing stored records remain create-only; transcript export supplies legacy protection.

Keep work linear in input size plus field count. Never join whole conversation prefixes
or scan beyond the fixed windows for ordinary detectors. PEM continuation scans each
whole field once and keeps only open/closed state plus a bounded delimiter suffix.
Use lazy Int32Array offset maps in boundary windows; never allocate objects per code unit.
The bounded, adjacent-pair policy does not detect credentials requiring three fields
or context farther than 512 code units from a join, except recognized PEM-body continuation.
Separator-free detection is conservative: a token at a field's end may consume the first
word of the next field. Ordinary joins without a detector match remain unchanged.

Test every token split position, assignment/code preservation, normalization before
storage/export, admitted emoji byte preservation, queue replay and import batch joins.
Use count-based bounds for work and marker growth, with injected pod transports.
