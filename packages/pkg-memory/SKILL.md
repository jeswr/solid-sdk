---
name: pkg-memory
description: Use when building, serializing, parsing or classifying PKG nanopublications and the eight typed memory fact templates, enforcing purpose policies, or storing memory through PodPort.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

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
