<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
# @jeswr/shacl-forms

> **Experimental, AI-agent-generated.** Security-critical runtime in the
> [Solid SDK workspace](https://github.com/jeswr/solid-sdk). API and admission
> policy may change before a stable release. No mirror repository is configured.

Interprets a SHACL NodeShape at runtime, without code generation, network access,
or `node:*` imports. This is the generic P2 interpreter from
[ADR 003](../../decisions/0003-domain-model-codegen.md), not a hand-written domain
model. Domain packages still use federation-codegen. Solid-components adoption
and generated RDFa rendering are separate work.

```ts
import { compileForm, validate, build, parse, serialize, formToShapes } from '@jeswr/shacl-forms';

const form = compileForm(shapesDataset, 'https://example.org/SurveyShape');
const result = validate(form, { Title: 'A response' });
if (result.valid) {
  const data = build(form, 'https://pod.example/responses/1#it', { Title: 'A response' });
  const turtle = await serialize(data);
  const values = parse(form, 'https://pod.example/responses/1#it', data);
}
const editableShapes = formToShapes(form);
```

## Public API

- `compileForm(shapes: DatasetCore, shapeIri: string): FormModel` snapshots the graph,
  admits it, and returns deeply frozen descriptors. A root and every `sh:node`
  reference must be named, explicitly declared `sh:NodeShape`s. Anonymous property
  shapes and RDF lists are supported; name an anonymous root before compiling it.
- `validate(form, values: FormValues): ValidationResult` reports `{ valid, issues }`.
  Each issue has `key`, predicate `path`, `message`, and `severity`. Only violations
  make `valid` false. Nested keys use `parent.child` / `parent[index].child`.
- `build(form, subject, values): Store` throws on any violation; invalid advisory
  scalar values are omitted. It writes via `@rdfjs/wrapper`, using model-runtime
  datatype mappers, `applyScalarGuards`, and `sanitizeText`. Class-constrained IRI
  values are explicitly typed on writes. Nested subjects are minted in the response
  document from the subject's own fragment (`doc#r1` mints `doc#r1-form-node-1`; a
  fragment-less subject mints `doc#form-node-1`), skipping the subject and supplied IRI
  identities, so sibling responses in one document never share children.
- `parse(form, subject, data: DatasetCore): FormValues` never throws. It drops invalid
  raw values, checks exact literal datatypes/lexical forms and raw cardinality, and
  retains valid siblings. Below a minimum, or above a maximum, the field drops.
  A nested node must satisfy all present constraints and every minimum, independent
  of severity, matching model-runtime's strict `sh:node` policy. Actual link targets
  are followed, and `sh:targetClass` does not require a child type assertion.
- `serialize(store: Store): Promise<string>` uses `n3.Writer` and the reviewed
  model-runtime term and serialization round-trip checks.
- `formToShapes(form: FormModel): Store` emits the descriptor's SHACL graph, then
  readmits it. Plain designer descriptors are accepted; unknown keys and
  inconsistent `key`/`kind` projections throw. Values APIs readmit plain descriptors
  too. Generated property/list node identities are incidental; descriptors round trip.
- `FormAdmissionError` exposes `construct` and `shape` and names both in its message.
  Descriptor interfaces, `FormValue`, `FormValues`, `FormIssue` and `ValidationResult`
  are exported as types.

`FormValue` is `string | number | boolean | Date | FormValues`;
`FormValues` maps keys to one value or an array. Number and boolean inputs are typed
JS values, and dates are valid `Date`s. `maxCount: 1` parses as a scalar; other fields
parse as arrays, including unbounded fields. Duplicate scalar inputs count by their
emitted RDF identity. Missing values use an absent key or an empty array. Extra
value keys are ignored (SHACL shapes are open).

`FormModel` has `shape`, optional `targetClass`, `label`, `description`, `fields`,
`groups`, and optional `prefixes`. Fields have the brief's path/key, display metadata,
kind/datatype/options, cardinalities, minimum length, inclusive numeric bounds,
severity and optional nested `form`. Group descriptors have `iri`, `label`, `order`.
Keys derive from `sh:name` or the predicate local name and get `_2`, `_3`, … suffixes
in displayed order. Fields/groups sort by `sh:order`, retaining declaration order
for ties and putting unspecified orders last.

The following descriptor additions preserve constraints during designer edits:
`name` retains original `sh:name` independently of `key` and display `label`;
`pattern` is the reviewed closed union `"^https?://" | "^https://" | "\\S"`;
`message` preserves `sh:message`; `hasClass` preserves `sh:class`.
For new descriptors without `name`, a custom `key` supplies `sh:name`.
When editing a retained `name`, keep it consistent with the derived `key`. `prefixes` preserves SHACL
`sh:declare [ sh:prefix "ex"; sh:namespace "https://example.org/"^^xsd:anyURI ]`
declarations from the input graph. RDF/JS DatasetCore does not retain Turtle parser
prefixes. Prefixes accompany stores returned by build/formToShapes in memory;
copying a store loses that association. For unrelated stores, serialization has no
prefix declarations.

## Admission table

| Construct | Admission / projection |
|---|---|
| `sh:property`, direct IRI `sh:path` | Unique predicates per node; `rdf:type` reserved |
| `sh:datatype` | Only model-runtime `VALIDATED_DATATYPES`; exact mappers reused |
| String family, anyURI, duration | `text`; reviewed lexical restrictions retained |
| `xsd:string` + `dash:singleLine false` | `multiline` |
| Text field + `dash:singleLine true` | `singleLine: true`; values containing CR or LF fail on write (graded by severity) and drop on read |
| Integer family / decimal, double, float | `integer` / `decimal`, including datatype value-space checks |
| Boolean / date / dateTime | `boolean` / `date` / `dateTime` |
| `sh:nodeKind sh:IRI`, `sh:class` | `iri`; class uses bounded data-graph subclass membership |
| `sh:in` | `choice`, nonempty bounded well-formed list, HTTP(S) IRI options, exact term identity; literal members must match the datatype and its canonical writer |
| `sh:node` | `node`, named references, four NodeShapes including the root; cycles rejected |
| `minCount`, `maxCount`, `minLength` | Nonnegative xsd:integer parameters; impossible cardinalities rejected; length counts code points |
| `minInclusive`, `maxInclusive` | Finite numeric bounds on numeric fields only; precision loss rejected |
| `sh:pattern` | Exactly `^https?://`, `^https://` on IRIs, or `\S` on string projections; imported scalar guards check the original spelling |
| `sh:severity` | One of Violation (default), Warning, Info |
| `rdfs:label`, `sh:name`, `description`, `order`, `group`, `message` | Display metadata and issue messages; groups require `sh:PropertyGroup`. Labels and other text parameters must be plain `xsd:string`; language-tagged labels are rejected |
| Field keys (`sh:name`, else predicate local name) | Must not contain `.`, `[` or `]` (issue-key separators) or be a prototype key |
| Non-SHACL predicates | Shapes, property shapes and groups admit only `rdf:type`, `rdfs:label`, `rdfs:comment` (plus `dash:singleLine` on property shapes); prefix declarations admit only `rdf:type`. Every other predicate, including other `dash:*` and `owl:imports`, is rejected |
| Other `sh:*`, implicit class targets, complex paths, inline node shapes | Rejected, including orphan unsupported constraints |

Parity is with the reviewed **constraint subset**, not the generator's ontology
admission/configuration pipeline. Forms have no ontology to resolve G5 aliases, so
multiple target classes and all complex paths (including alternativePath) are
rejected. HTTP(S)-only response subjects and IRI values are mandatory form policy;
other safe absolute IRIs may identify shapes, predicates, classes and datatypes.
IRI enums retain lexical identity. Plain IRI values use model-runtime normalization.
Nested forms and UI metadata supply the form-specific projections.

**Parity gap:** `sh:maxLength` is not admitted by federation-codegen today and is
rejected here too. There is no `maxLength` descriptor. Multiline comes only from
`dash:singleLine false`. Admitting maximum length in both requires a separate
reviewed generator change. Arbitrary regexes, `sh:hasValue`, boolean combinations,
qualified constraints and unknown components fail closed.

## Resource limits and development

Limits: 10,000 shapes quads, 512 Ki UTF-16 graph characters, 256 projected fields
across nesting, 1,024 enum members, four NodeShapes per branch, 65,536 UTF-16
characters per response scalar, 10,000 values per operation, and 100,000
`rdf:type`/`rdfs:subClassOf` reads shared by every class walk in one `compileForm` or
`parse` call (each walk also keeps model-runtime's 10,000-read cap). An exhausted class
budget rejects the shapes graph during compilation and stops recognising class-checked
values during parsing. Reads over budget
return an empty result; write/validation budget failures are violations. These caps
bound untrusted input in addition to the shared guards. A supplied DatasetCore's
own eager `match()` allocation cannot be bounded by a consumer; n3 Stores use lazy
`readQuads` to stop scans early. Parsing does not fetch remote data or mutate input.

Tests cover admission, all reviewed datatypes, constraints, severities, nested
conformance, generated-runtime scalar parity, hostile inputs, serialization,
designer round trips and a copied solid-components contact fixture.

```bash
export PATH=/opt/node24/bin:$PATH
pnpm exec turbo run lint build typecheck test --filter=@jeswr/shacl-forms
pnpm run lint:root
```

MIT © Jesse Wright
