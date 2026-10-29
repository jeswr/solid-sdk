<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/pkg-memory

> Experimental — AI-agent-generated. Private workspace package; not published.

Build and read personal knowledge nanopublications with UUIDv5 identifiers,
shared canonical assertion graphs, epistemic and validity statuses, DPV categories,
and Web Annotation quote evidence. Requires Node >=24.

```ts
import {
  buildNanopublications, createFactAssertion,
  serializeNanopublications, parseNanopublications,
} from "@jeswr/pkg-memory";

const owner = "https://example.org/people/avery#me";
const result = await buildNanopublications({
  batch_id: "example-001",
  worker: { agent_id: "https://example.org/agents/client", agent_label: "Example client" },
  sources: [{ id: "chat", kind: "document", url: "https://example.org/chats/one" }],
  claims: [{
    id: "email", epistemic: "SelfReportedExplicit", categories: ["pd:EmailAddress"],
    assertion: createFactAssertion(owner, { template: "email", value: "avery@example.org" }),
    evidence: [{ source: "chat", quote: "My email is avery@example.org." }],
  }],
}, { owner });
const trig = await serializeNanopublications(result);
const parsed = await parseNanopublications(trig);
```

`createFactAssertion` supports `address`, `email`, `phone`, `preference`,
`condition`, `allergy`, `medication`, and `relationship`. Use its discriminated
`Fact` type for the value fields. Residence, clinical, product and role identifiers
are explicit entity IRIs. Nested preferences, codes and dose schedules use blank
nodes, canonically skolemized on build. Temporal bounds retain their declared
`date`, `dateTime`, `gYearMonth`, or `gYear` precision.

The batch contract follows `np_builder.py` (snake-case source fields). Claims can
supply a default-graph RDF/JS dataset or a Turtle assertion body using the reference
prefixes (`me:` resolves to the required owner WebID). Turtle bodies are RDF syntax;
use typed templates for untrusted structured tool values. Source hashes are supplied
by the caller; the model performs no filesystem reads or network requests.

`claims: []` is valid: the builder returns an empty `nanopubs` list alongside the
batch's worker, activity, source, entity and `skipped_sensitive` audit graphs.
These metadata-only results can be serialized as TriG. `parseNanopublications`
continues to require at least one nanopub head; use an RDF parser to read an
audit-only dataset.

Literal datatypes are limited to `xsd:string` (including plain strings),
`rdf:langString`, `xsd:integer`, `xsd:decimal`, `xsd:boolean`, `xsd:dateTime`,
`xsd:date`, `xsd:gYear` and `xsd:gYearMonth`. The four temporal types retain their
RDFlib 7.1.4 normalization. Other allowed types require canonical lexical forms
and are never coerced. Strings retain their contents; language strings retain
their contents and tag spelling. Integers use `0` or an optional minus sign with
unpadded nonzero digits. Decimals use unpadded fixed-point notation, retaining
fractional scale and signed zero (`2.00`, `-0`, `-0.00` are supported). Booleans
use exactly `true` or `false`. Whitespace, plus signs, integer negative zero,
exponents, shorthand fractions, `1`/`0` booleans and invalid scalar values throw
the exported `UnsupportedLiteralLexicalFormError` (a `TypeError` with a `datatype`
IRI property). These are RDFlib's stable scalar spellings, including its decimal
scale, rather than coercions of additional lexical forms.

All other literal datatypes, including derived integer
types, floating-point types, `xsd:time`, `xsd:duration`, `xsd:token`, binary types
and custom datatypes, throw the exported `UnsupportedLiteralDatatypeError`
(a `TypeError` with a `datatype` IRI property).

Literals containing U+2028, U+2029, U+0085, U+000B, U+000C or U+001C–U+001E
throw the exported `UnsupportedLiteralCharacterError` (a `TypeError` with the
numeric `codePoint` property). These characters are rejected before normalization
or hashing because Python's line splitting changes the reference hash input.
Ordinary newlines, carriage returns and tabs remain supported. Literal validation
applies to raw RDF/JS assertions, Turtle parsing, templates, batch metadata, TriG
parsing and serialization, including caller-modified datasets. Serialization also
checks every subject, predicate, object, graph name and literal datatype against
the builder's IRI and language-tag guards before invoking the Writer.

Nanopub, activity, message-fallback and annotation IDs use the reference UUIDv5
namespace and name construction. Assertion IDs hash RDFlib 7's canonical N-Triples;
its blank-node labels differ from RDFC-1.0. Language-tag spelling is preserved
through hashing, graph storage and TriG parsing: `EN-US`, `en-US` and `en-us`
produce the reference's distinct assertion IDs. Generation time is injectable. Parsing
keeps each nanopub's provenance separate, even when assertions are shared, and
rejects malformed skeletons, missing graphs, duplicate scalar fields and unknown
statuses. It returns graph identifiers, statuses, evidence, attribution, categories,
revision links and a complete dataset; it does not infer template inputs from RDF.

This is not the KG SHACL validator. The model preserves the builder's optional
evidence/category fields; consumers enforce their own provenance requirements.
No owner identity or data access is implicit.

`classifyNanopublications(result)` returns a derived view with `belief` equal to
`definitely`, `might`, `mentioned`, or `past`, distinct-nanopub `corroboration`
counts, and `replacedBy` nanopub IDs. Past validity, provenance invalidation and
explicit revisions take precedence regardless of extraction/publication order.
Current Documented facts are definite; current
explicit/summary facts need no unresolved contradiction in either direction.
Other live claims are `might`, except `Mentioned`. Retired contradictory claims
do not block current explicit facts. The source dataset is never modified.
Consumers acting on a fact must additionally require `validity === "Current"`.

`purposeFilter(policy, purpose, clientId)` returns an array-filter predicate over
nanopub metadata. Purpose is the closed `ServiceProvision | Personalisation` enum;
each category is an ODRL read target, evaluated against that DPV purpose and the
client ID. Every category must be permitted; missing categories, unmatched rules
and outstanding duties deny. Both full category IRIs and `pd:` names are supported.
Policies declaring profiles or delegation deny on every read, including direct
calls: this filter cannot interpret profile semantics or verify delegation authority.
`createDefaultPolicy(id, owner)` permits contact/address/preferences for these
purposes, including contact data used for scheduling; health/genetics/mental
health/finance deny for all clients until the owner edits the policy. The spec
does not name a category for other scheduling data, so none is invented.
`isSpecialCategory(category)` recognizes the local DPV-PD special-category list,
including health and biometric descendants; financial data is separately denied
by the default policy. No vocabulary fetching or implicit subclass inference
occurs. Unknown categories require an explicit policy permit.

Offline fixtures contain only fictional identities. See
[test/fixtures/README.md](test/fixtures/README.md) for the independent Python oracle.
`@jeswr/pkg-memory/testing` exposes fixed fictional build options for consumer tests.

The parity contract is checked against the five synthetic Python facts and the
committed canonicalization edge cases. RDFlib 7.1.4 itself can choose different
canonical IDs across runs on some highly symmetric regular blank-node graphs;
byte parity on those graphs is not a stable reference contract. Templates use
plain-string literals (RDF/JS merges plain strings and explicit `xsd:string`).

Belief tests cover the KG §4.1 status matrix and the independent synthetic builder
oracle. The supplied snapshot omits `pipeline/queries/*.rq` and the private pilot;
exact query/pilot parity has not been verified.

`new NanopubStore(pod)` accepts the structural MCP `PodPort` interface without a
runtime dependency on the MCP server. `put(result)` splits batches into one
`/private/pkg/mcp/<uuid>.trig` resource per nanopub, retaining its four graphs and
shared batch source/entity graphs. Writes are create-only; malformed input is
rejected before mutations. A blank node shared across resources must occur in a
common assertion, sources, or entities graph in every resource that uses it.
Structural refinement across those common graphs must distinguish every shared
blank node without tie-breaking search. Unresolved ties, including symmetric
authors, reject before any Pod write, including single-resource puts whose graphs
may recur in later calls. Listing older or externally written copies with such
ties also rejects. Symmetry confined to private graphs in one resource remains
supported. Each put also checks incoming resources against existing copies,
using only their common graphs, before any Pod write. A batch's extra graphs
cannot resolve an ambiguity shared with a different stored batch.
Other cross-resource sharing (such as evidence targets used only in separate
provenance graphs) rejects before any Pod write; local cross-graph sharing remains
supported. Owner-only WAC ACLs are written before creating
containers and data. Existing shared ancestor containers and their ACLs are
preserved; replacement is limited to the store's own `mcp/` ACL and the dedicated
ACLs of nanopub and policy resources. Each nanopub's owner-only ACL is established
conditionally before writing its private bytes, replacing any orphan resource ACL
that would override the container default. The adapter must support the spec's
`.acl` convention; ACL failures stop the operation. Existing ACL replacement needs
a strong ETag.

The store tries `application/trig` and reads the representation back. An HTTP 415
or changed bytes/media type triggers the sole fallback, `application/octet-stream`,
with exactly the original TriG bytes. Replacing rewritten TriG needs its strong
read-back ETag; a failed byte-preservation check is an error. Authentication,
conflict and other failures do not trigger fallback. These behaviors are covered
by simulated server responses on the memory PodPort; live CSS/sparq validation
has not been run in this fixture-only lane.

`get(id)` verifies the stored media type and nanopub identity. `list()` loads only
immediate UUID resources and ignores nested or off-container listing entries.
Repeated graphs must match exactly up to blank-node labels, including literal
lexical forms, datatypes and language tags; assertion value normalization does
not apply to this comparison.
`retract(id, { batchId, clientId, generatedAt? })` appends a new Retracted nanopub
with `prov:wasRevisionOf` and `prov:invalidatedAtTime`; original bytes remain
unchanged, and the withdrawal reuses the original assertion graph and IRI,
including skolemized nodes. Later classification recognizes the withdrawal across resources.
The withdrawal's provenance also identifies the revised nanopub envelope. That
target takes precedence over the shared assertion revision link, so a later batch
can reassert identical facts as Current without changing assertion deduplication.
Assertion-only revisions retain their existing assertion-wide semantics.
`writeDefaultPolicy()` writes `/private/pkg/mcp-policy.ttl` only if absent and
preserves owner edits, including concurrent first-run creation. Consumers apply
the purpose predicate to their reads and own the special-category read audit.
Existing policies must use the evaluator's supported core ODRL terms. The store
rejects unsupported fields (including profiles and delegation), malformed duties
or constraints, ambiguous scalar fields, and additional policy graphs before
returning a policy for authorization. Restrictions are never silently discarded.

For offline storage tests, `@jeswr/pkg-memory/testing` exports
`createMemoryPodPort({ root, webId })` with byte copies, ETags, and conditional
write/delete behavior.
