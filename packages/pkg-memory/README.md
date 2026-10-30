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

This is a model/parser, not the KG SHACL validator. It preserves the builder's
optional evidence/category fields; consumers must enforce their own provenance
and purpose requirements. Belief classification, purpose policy, and pod storage
are MCP-05. No owner identity or data access is implicit.

Offline fixtures contain only fictional identities. See
[test/fixtures/README.md](test/fixtures/README.md) for the independent Python oracle.
`@jeswr/pkg-memory/testing` exposes fixed fictional build options for consumer tests.

The parity contract is checked against the five synthetic Python facts and the
committed canonicalization edge cases. RDFlib 7.1.4 itself can choose different
canonical IDs across runs on some highly symmetric regular blank-node graphs;
byte parity on those graphs is not a stable reference contract. Templates use
plain-string literals (RDF/JS merges plain strings and explicit `xsd:string`).

New typed facts use `https://jeswr.org/ns/sectors/health#` and
`https://jeswr.org/ns/core#`. Parsing, hashing and reserializing supplied assertion
graphs preserve their IRIs, including legacy and mixed data, because rewriting an
assertion would invalidate its content-derived identifier. The reference builder's
implicit `health:` and `core:` prefixes in `parseAssertion` stay legacy for the
same reason. Use typed templates or explicitly declare canonical prefixes when
authoring new Turtle assertions. Existing Python fixture identifiers remain valid.
