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
For imported exports, use `parseNanopublicationsTolerant(text, { baseIRI? })` for an
explicit `Promise<TolerantNanopublications>` return type. The existing
`parseNanopublications(text, { invalid: "skip", baseIRI? })` overload stays compatible.
Both add a value-free `skipped: [{ id, errorClass }]` report and `affected: string[]`,
and retain only whole valid envelopes and batch graphs needed by kept nanopubs,
including typed `pkg:correspondenceBatch` context on retractions. Envelopes whose
graph names include skipped IDs are dropped transitively (`SharedGraphWithSkipped`)
to prevent incomplete heads surviving sharing. Falsy or non-Error validation names
are reported as `Error`. Default calls remain atomic;
syntax and metadata errors still throw. Do not widen the literal parity set during
projection work. Use `createNanopubProvenanceReader(value)` for per-projection batch
source graph caching, with no cache surviving into another read.
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
Keep `affected` through filtering/projection: it contains retained nanopub IDs
targeted by IRI revision/contradiction objects in skipped head/provenance/pubinfo
graphs. Contradictions always count; revisions naming kept envelopes affect only those
envelopes, otherwise their assertion targets. Never read literals as update targets.
Past claims never change; `definitely` drops to `might`; non-past affected claims get
`affectedBySkipped: true`; a UI can say “a later update to this could not be read”.
This context is not persisted in RDF and is lost when only retained graphs are serialized.

The `paymentCard` template stores only the brand, the last four ASCII digits, the
expiry month (`gYearMonth`) and an optional billing-address IRI. It never stores a
full card number (PAN) or security code. The card is a blank node, so there is no
caller-chosen id. Extra keys are refused. A billing-address IRI with a query, a
fragment, or more than four digits once percent-decoded and NFKC-normalised is
refused, so mint a slug for the address entity. Each field is read once into a snapshot, so getters and proxies cannot
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
succeed before any private data is written. Require optional `head(url)` to expose
the unique, unanchored server-advertised WAC `{ acl }` even on 404; never guess
an ACL path. Missing discovery, off-pod links and ACP fail closed with
`Memory protection unavailable`. Before replacing an existing ACL, use the shared
`validateDedicatedWacAcl` typed rule checks: all authorizations must be scoped only
to the target, including `defaultForNew`. Shared, unscoped, malformed and unknown
rules refuse replacement; preserve unrelated grants by leaving the ACL untouched.
Read strong ETags and use `If-Match` / `If-None-Match: *` for ACL writes.
Give generic memory test ports explicit WAC metadata when testing private writes.
Use `WacDiscoveryOptions.allowAclUrl` in NanopubStore's second constructor argument
and discoverWacAcl's third argument when the caller has a protected ACL area.
False or thrown predicate results fail closed before ACL access, without fallback;
the store retains `Memory protection unavailable`. Do not hard-code consumer paths
in pkg-memory. solid-mcp supplies a predicate derived from the memory layout so
every accepted ACL lies inside its generic-tool boundary; other in-pod ACLs are
refused. The consumer also protects its in-pod WebID profile from generic tools
while retaining policy-enforced Contact reads and internal discovery.
TriG rejection (HTTP 415) or rewriting permits only the same bytes stored as
octet-stream. Strong ETags are required for replacements. Never use a Turtle or
flattened-graph fallback. Retraction appends a revising nanopub; it does not edit
or delete the original. Use the exported memory PodPort for offline tests.

New templates write canonical `https://jeswr.org/ns/sectors/health#` and
`https://jeswr.org/ns/core#` terms. Keep supplied assertion graphs and the
reference parser's implicit legacy prefixes unchanged: they are hash inputs.
For new Turtle bodies, declare canonical prefixes explicitly. Read legacy and
mixed graphs without rewriting the terms or their content-derived identifiers.
