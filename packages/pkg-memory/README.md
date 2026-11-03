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
`condition`, `allergy`, `medication`, `relationship`, `paymentCard`, `observation`,
`immunization`, and `encounter`. Use its discriminated
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

`observation` records a measurement or lab result as `health:Observation`, with
an explicit entity `id`, a `code: HealthCode`, exactly one numeric or string
`value`, an `effective: HealthTemporalValue`, optional UCUM `unitCode` and optional
`kind` (`measurement` or `lab`, stored as `schema:category`). Finite numbers use the
package's canonical `xsd:decimal` spelling, expanding exponent notation. To retain
clinical scale, pass `value: { decimal: "1.10" }`: the lexical form is validated
against the package's decimal policy (optional minus, no leading zeroes except
zero itself, optional fractional digits, no exponent or whitespace) and kept
verbatim. Plain strings remain `xsd:string`. `health:hasCode` links the explicitly
identified `health:CodeableConcept`, also typed `core:Identifier` as the ontology
defines it. Both `HealthCode.code` (`core:value`) and `system` (`core:inScheme`)
are required by the combined health and Core shapes. The system is typed
`core:IdentifierScheme`; optional `display` becomes `schema:name`.

`immunization` records `health:Immunization` with an explicit `id`, `vaccine` and
`occurrence: HealthTemporalValue`. The shape requires `health:medication` to
reference a `health:MedicinalProduct`, so `vaccine.id` identifies that product.
Its optional `display` becomes `schema:name`; when coding is supplied, both
`code` and `system` are required and a nested blank-node `health:CodeableConcept`
is linked through `core:identifiedBy`. An uncoded vaccine product is accepted.
Occurrence uses `core:atTime` because the health profile has no occurrence property.

`encounter` records `health:Encounter` with an explicit `id`, a required
`period: { start: HealthTemporalValue; end?: HealthTemporalValue }` and optional
`serviceProvider` IRI. The period is an OWL-Time interval linked through
`core:atTime`, with `time:hasBeginning` and optional `time:hasEnd` instants; these
describe occurrence, not assertion validity. The provider is linked through
`health:careProvider`, without asserting a Core Organization whose required
identifier this template cannot supply. The template does not assume that a
custodial provider also performed the encounter (`health:recordedBy`, a SHOULD).

Vocabulary gaps: the health ontology and alignments define no lot/batch-number
predicate and no encounter-type predicate. The templates therefore omit and
reject `lotNumber` and encounter `type`; `schema:lotNumber` is not a schema.org
term and `schema:additionalType` requires a class IRI rather than a coded instance.

All three health templates mirror `condition`'s entry-to-owner `health:patient`
link, with no reverse link. They explicitly type the owner as `core:Person`
and time nodes as `time:TemporalEntity`, satisfying MUST class constraints
without an ontology reasoner. `HealthTemporalValue` accepts only `date` and
`dateTime`; dates use `time:inXSDDate`, date-times `time:inXSDDateTime`. Year 0000
is refused and every date-time must carry `Z` or a valid ±hh:mm timezone.
Date-times retain the package's microsecond normalization. Encounter endpoints
are compared as UTC instants at that precision. A date-only bound denotes the
whole UTC calendar day: its earliest instant is used for a start and its latest
instant for an end. An end before the earliest possible start is refused; mixed
precision on the same UTC day is accepted. Nested times and vaccine codes are
blank nodes, skolemized on build.

Every input field is read once from its own properties into a snapshot; inherited
fields are ignored. Unknown keys, wrong types, invalid times, non-finite numbers
and detected card numbers in free text are refused. Entity IRIs must be unchanged
HTTP(S) IRIs accepted by `safeHttpIri`; all entity, concept, vaccine, coding-system
and provider identifiers must differ from each other and from the owner. IRIs are
percent-decoded up to four rounds and NFKC-normalized before card-number scanning;
malformed or residual percent escapes are refused. Snapshot refusals use fixed
messages (`Invalid observation`, `Invalid immunization`, `Invalid encounter`);
programming errors during graph construction surface unchanged. Tests resolve the
vocabulary through its package, compose the health and imported Core shapes using
the fixture gate's local `owl:imports` traversal, assert zero MUST Violations for
complete and minimal variants, and check the Encounter `recordedBy` SHOULD Warning.

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
conditionally before writing its private bytes, replacing any orphan resource ACL
that would override the container default. The adapter must support the spec's
`.acl` convention; ACL failures stop the operation. Existing ACL replacement needs
a strong ETag.

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
write/delete behavior.

New typed facts use `https://jeswr.org/ns/sectors/health#` and
`https://jeswr.org/ns/core#`. Parsing, hashing and reserializing supplied assertion
graphs preserve their IRIs, including legacy and mixed data, because rewriting an
assertion would invalidate its content-derived identifier. The reference builder's
implicit `health:` and `core:` prefixes in `parseAssertion` stay legacy for the
same reason. Use typed templates or explicitly declare canonical prefixes when
authoring new Turtle assertions. Existing Python fixture identifiers remain valid.
