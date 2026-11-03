---
name: pkg-memory
description: Use when building, serializing, parsing or classifying PKG nanopublications and the nine typed memory fact templates (including the payment-card template that never stores a card number), enforcing purpose policies, or storing memory through PodPort.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# PKG nanopublications

Use `createFactAssertion` for structured facts, `buildNanopublications` for batches,
`serializeNanopublications` for TriG, and `parseNanopublications` to read it back.
The owner WebID is mandatory; never default to a real person's identity.

RDF writes use `@rdfjs/wrapper`, reads use graph-scoped typed accessors, parsing uses
`@jeswr/fetch-rdf`, and serialization uses `@jeswr/rdf-serialize`. Keep assertion
canonicalization compatible with RDFlib 7's builder; RDFC-1.0 labels are different.

Use only fictional `example.org` identities in fixtures. The five synthetic claims
and Python-generated expected outputs in `test/fixtures` replace private pilot data.
Supply source digests explicitly; this data-model package never reads source files.

Use `classifyNanopublications` for derived belief views; acting on a fact also
requires Current validity. Preserve graph-scoped provenance when assertions are
shared. Past/revised claims stay in history; Mentioned is never an inference input.

The `paymentCard` template stores only the brand, the last four ASCII digits, the
expiry month (`gYearMonth`) and an optional billing-address IRI. It never stores a
full card number (PAN) or security code. The card is a blank node, so there is no
caller-chosen id. Extra keys are refused. A billing-address IRI with a query, a
fragment, or more than six digits once percent-decoded and NFKC-normalised is
refused. Each field is read once into a snapshot, so getters and proxies cannot
swap values after the check. Refusals never echo the value. Ask the user for the
full number each time a form needs it. The template does not scan other templates
or Turtle bodies; run `containsCardNumber` on untrusted text (percent-decoded
first) before storing it. `findCardNumbers` returns UTF-16 spans for redaction.

Use `purposeFilter(policy, purpose, clientId)` on every personal-data read. It
requires an ODRL permit for every category and denies uncategorized data and
outstanding duties. `isSpecialCategory` uses a local list; it does not fetch DPV
or infer arbitrary subclasses. The two purpose tokens are ServiceProvision and
Personalisation. Never expose rejected values in a denial message.

Use `NanopubStore` for one-resource-per-nanopub persistence over the structural
PodPort seam. Its default-policy writer preserves owner edits. ACL writes must
succeed before any private data is written; no public ACL fallback is allowed.
TriG rejection (HTTP 415) or rewriting permits only the same bytes stored as
octet-stream. Strong ETags are required for replacements. Never use a Turtle or
flattened-graph fallback. Retraction appends a revising nanopub; it does not edit
or delete the original. Use the exported memory PodPort for offline tests.

New templates write canonical `https://jeswr.org/ns/sectors/health#` and
`https://jeswr.org/ns/core#` terms. Keep supplied assertion graphs and the
reference parser's implicit legacy prefixes unchanged: they are hash inputs.
For new Turtle bodies, declare canonical prefixes explicitly. Read legacy and
mixed graphs without rewriting the terms or their content-derived identifiers.
