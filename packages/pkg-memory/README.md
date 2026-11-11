<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

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
`condition`, `allergy`, `medication`, `relationship`, and `paymentCard`. Use its discriminated
`Fact` type for the value fields. Residence, clinical, product and role identifiers
are explicit entity IRIs. Nested preferences, codes and dose schedules use blank
nodes, canonically skolemized on build. Temporal bounds retain their declared
`date`, `dateTime`, `gYearMonth`, or `gYear` precision.

`paymentCard` records a blank-node `schema:PaymentCard` that the owner
`schema:owns`, with `schema:brand`, the last four digits as a
`schema:PropertyValue` (`propertyID` "last4"), `schema:validThrough` as an
`xsd:gYearMonth` and an optional `schema:address`. It has no field for a full
card number, a security code or a card id, and refuses any extra key. A billing
address IRI may have no query or fragment and at most four digits in all, counted
after percent-decoding and NFKC normalisation. That leaves room for a house
number but not a useful share of a card number; it also refuses UUID and IP
address IRIs, so mint a slug for the address entity or leave it out. One fact
cannot reveal more than its last four digits; splitting a number across many
facts or other templates is outside what this template can check. Each field is read once, so a getter or proxy cannot
change a value after it is checked.

`findCardNumbers` and `containsCardNumber` expose the detector. It flags every
Luhn-valid window of 12 to 19 digits that does not start with 0, in linear time.
Digits can be any Unicode decimal digit or a character that NFKC folds to one
(circled, superscript, parenthesised or full-stop digits). Groups can be split
by whitespace, any punctuation, invisible format characters, combining marks or
`+ = ~ |`. Percent-decode IRIs before scanning them. Ideographic numerals are not
covered.

The batch contract follows `np_builder.py` (snake-case source fields). Claims can
supply a default-graph RDF/JS dataset or a Turtle assertion body using the reference
prefixes (`me:` resolves to the required owner WebID). Turtle bodies are RDF syntax;
use typed templates for untrusted structured tool values. Source hashes are supplied
by the caller; the model performs no filesystem reads or network requests.
Document and email source dates use the same RDFlib date-literal normalization
as assertions, including dropping timezone suffixes without shifting the date.

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
Blank-node labels must satisfy Turtle/TriG's `BLANK_NODE_LABEL` grammar;
unsupported labels throw the exported `UnsupportedBlankNodeLabelError`
(`TypeError`) before assertion hashing, building or serialization. Labels are
validated without rewriting references, including blank-node graph names in
caller-modified datasets.

Nanopub, activity, message-fallback and annotation IDs use the reference UUIDv5
namespace and name construction. Assertion IDs hash RDFlib 7's canonical N-Triples;
its blank-node labels differ from RDFC-1.0. Language-tag spelling is preserved
through hashing, graph storage and TriG parsing: `EN-US`, `en-US` and `en-us`
produce the reference's distinct assertion IDs when used individually.
Within each graph, otherwise identical language statements deduplicate ignoring
tag case, retaining the first statement's spelling and reference assertion ID.
Generation time is injectable. Parsing keeps each nanopub's provenance separate,
even when assertions are shared, and
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
Temporal constraints accept at most three fractional second digits, matching
the evaluator's millisecond precision; finer declared precision denies the read.
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
using only their common graphs, before any Pod write. It validates the joint
correspondence against the accumulated collection and rejects mergers of nodes
that were stored independently, regardless of insertion order. A batch's extra
graphs cannot resolve an ambiguity shared with a different stored batch.
Other cross-resource sharing (such as evidence targets used only in separate
provenance graphs) rejects before any Pod write; local cross-graph sharing remains
supported. Owner-only WAC ACLs are written before creating
containers and data. Existing shared ancestor containers and their ACLs are
preserved; replacement is limited to the store's own `mcp/` ACL and the dedicated
ACLs of nanopub, policy and lock resources. Each nanopub's owner-only ACL is established
conditionally before writing its private bytes, replacing an orphan resource ACL
only when it is proven dedicated to that target. The optional `PodPort.head(url)`
capability must return `{ acl }` from a unique, unanchored server-advertised WAC
Link, including on HTTP 404. Every protected container, policy, lock and nanopub
uses that pod-scoped URL; no `.acl` path is guessed. Missing or unsafe discovery,
ACP, and existing ACLs with shared, unscoped, malformed or unsupported rules fail
closed with `Memory protection unavailable`. All scope values, including legacy
`acl:defaultForNew`, must name only the target; unrelated grants are never dropped.
Existing ACL replacement requires a strong read ETag and `If-Match`; absent ACLs
use `If-None-Match: *`. ACL read/write failures stop the operation.

`new NanopubStore(pod, { allowAclUrl })` and
`discoverWacAcl(pod, target, { allowAclUrl })` accept an optional predicate for
the caller's protected ACL area. A false result or thrown error refuses discovery
before reading or writing the advertised ACL, with no guessed fallback. Store
operations return `Memory protection unavailable`; direct discovery returns
`WAC protection unavailable`. Callers exposing generic pod tools must use this
option to keep every accepted ACL inside their generic-tool exclusion boundary.
solid-mcp derives that boundary from this store's layout (`private/pkg/`) and
refuses ACLs advertised elsewhere in the pod, including `permissions/`.

An empty `/private/pkg/mcp/.write-lock`, created with `If-None-Match: *` after
container protection, coordinates puts across store instances and processes.
Its dedicated owner-only resource ACL is established conditionally before every
acquisition; an orphan ACL is replaced and ACL failures stop the put.
The writer revalidates the collection while holding the lock, then writes its
resources and releases the lock using its strong creation ETag. A competing put
fails with HTTP 412 and can retry after the writer finishes. Lock acquisition,
validation and release failures propagate. A missing/weak lock ETag or an
interrupted writer leaves the lock in place; subsequent puts fail closed until
the owner recovers it. There is no automatic lock expiry or takeover.

The store tries `application/trig` and reads the representation back. An HTTP 415
or changed bytes/media type triggers the sole fallback, `application/octet-stream`,
with exactly the original TriG bytes. Replacing rewritten TriG needs its strong
read-back ETag; a failed byte-preservation check is an error. Authentication,
conflict and other failures do not trigger fallback. These behaviors are covered
by simulated server responses on the memory PodPort; live CSS/sparq validation
has not been run in this fixture-only lane.

`get(id)` verifies the stored media type and nanopub identity. `list()` loads only
immediate UUID resources and ignores nested or off-container listing entries.
It validates the complete collection's correspondence before returning, including
externally written resources and regardless of listing order.
Listing and put validation reject stored resources containing graphs outside
their head, assertion, provenance, publication-info and declared batch source/entity
graphs (including correspondence batches). Undeclared graphs reject even when
their contents match another resource; default and blank-node graphs also reject.
Repeated graphs must match exactly up to blank-node labels, including literal
lexical forms, datatypes and language tags; assertion value normalization does
not apply to this comparison.
`retract(id, { batchId, clientId, generatedAt? })` appends a new Retracted nanopub
with `prov:wasRevisionOf` and `prov:invalidatedAtTime`; original bytes remain
unchanged, and the withdrawal reuses the original assertion graph and IRI,
including skolemized nodes. Later classification recognizes the withdrawal across resources.
For assertions with blank nodes, the withdrawal also retains the original batch's
source/entity graphs and any inherited correspondence context. Envelope-level
`pkg:correspondenceBatch` string values identify these batches for splitting,
matching and listing, so jointly distinguished nodes remain retractable without
changing the assertion or the withdrawal's new batch identity.
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
write/delete behavior. This generic port advertises no access-control model.
Storage fixtures must explicitly add WAC metadata, for example
`{ ...port, async head(target) { return { acl: target + ".acl" }; } }` for a
test server that actually associates those ACL URLs with its resources.

New typed facts use `https://jeswr.org/ns/sectors/health#` and
`https://jeswr.org/ns/core#`. Parsing, hashing and reserializing supplied assertion
graphs preserve their IRIs, including legacy and mixed data, because rewriting an
assertion would invalidate its content-derived identifier. The reference builder's
implicit `health:` and `core:` prefixes in `parseAssertion` stay legacy for the
same reason. Use typed templates or explicitly declare canonical prefixes when
authoring new Turtle assertions. Existing Python fixture identifiers remain valid.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
`readNanopubProvenance(value, np)` is a read-only, graph-scoped projection of
publication time, agent/label, batch, attribution, referenced source metadata and
evidence. It resolves message evidence through the batch sources graph to its parent
conversation, retaining the message IRI, quote, locator, dateSent and sender. Source
records expose kind, title, threadId, model, created and URL where available. Unused
batch sources are excluded; absent metadata stays optional, and ambiguous/wrongly
typed scalar fields throw a fixed error without values. Direct non-message evidence
has no persisted per-evidence timestamp/speaker; these stay absent. This does not
change builder output, parser behavior or hashing. `NanopubStore.ownerWebId` exposes
the explicit construction-time owner identity without I/O for owner-checked consumers.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Tolerant import is opt-in: `parseNanopublications(text, { invalid: "skip", baseIRI? })`
returns the usual dataset/nanopubs plus `skipped: [{ id, errorClass }]`. Existing calls,
including the string baseIRI overload, retain atomic behaviour. Each complete
head/assertion/provenance/pubinfo envelope is validated once per graph; invalid shared
assertions drop every user. Referenced batch source/entity graphs must also validate.
Only graphs referenced by retained nanopubs survive, including their batch graphs.
All-skipped input returns an empty dataset and nanopub list. Malformed TriG, absent
heads and malformed metadata still throw. Reports contain only nanopub IDs and error
class names, never rejected values, datatypes or diagnostic messages. The supported
literal parity set is unchanged (double/dateTimeStamp remain excluded).

`createNanopubProvenanceReader(value)` returns a provenance lookup with a per-invocation
batch graph cache. Use it when projecting many nanopubs; the uncached
`readNanopubProvenance(value, np)` remains available. Neither caches across reads or
changes graph-scoped evidence semantics.
