<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/solid-health

Generated health-sector observation model for device and application imports. Experimental,
AI-authored. This package is not securityCritical. The generator and model-runtime own the
accessors, RDF datatype guards, cardinalities and linked-node class checks.

```ts
import { buildObservation, HEALTH, loincCode, monthlyDocumentPath, parseObservations } from '@jeswr/solid-health';
const at = new Date('2026-06-01T00:00:00Z');
const path = monthlyDocumentPath('steps', at); // health/observations/steps/2026-06.ttl
const store = buildObservation(`https://pod.example/${path}#import-2026-06-01`, {
  type: HEALTH.Steps,
  ...loincCode('55423-8', 'Steps'),
  measuredValue: 1000,
  unitCode: '1',
  dateTime: at,
});
const observations = parseObservations(store);
```

`code(value, display?)` makes a source code without a scheme. `loincCode(value, display?)`
adds the real scheme `http://loinc.org`. Source field names must never become scheme IRIs.
QUDT units are limited to M, SEC and BEAT-PER-MIN from the sector's imported slims,
plus NUM used by the existing Health/Garmin importers;
UCUM strings cover other quantities. Heart rate, steps and sleep default to their sector
units, whose required membership is checked by the generated subtype models. Generic
observations permit a UCUM unit without a QUDT IRI.

The generation input in `codegen/health.shapes.ttl` is a strict write subset of the
federation health profile. Its header lists every narrowing and omission. Only the
measurement branches are projected. Values are decimal, links are singleton IRIs,
codes require nonblank values, and the patient is a document-local `#subject` typed
`core:Person`. Importing an account establishes no link to the pod owner's WebID.
Daily step/sleep summaries use an instant; stage/window details remain source notes.

The timestamp path is `time:inXSDDateTimeStamp` with `sh:datatype xsd:dateTime`, matching
the existing suite Health app and Garmin output. The generator cannot map
`xsd:dateTimeStamp`; the facade additionally requires an explicit `Z` or `+/-hh:mm`
timezone and validates the original lexical form before converting it. The vendored
OWL-Time property's original `xsd:dateTimeStamp` range remains in the generation input;
admission accepts this reviewed profile. This is an application write profile, not a
claim of full OWL datatype-range conformance.

`buildObservation(id, data)` writes a deterministic fragment plus `<id>-code`,
`<id>-time` and the document's `#subject`, and parses the result through the generated
composite before returning it. The exported HealthObservation, HealthCode and
HealthInstant constructors are aliases of generated per-node wrappers. A read-only
focus adapter lets the composite's fixed `#it` entry point query arbitrary observation
IDs: it delegates match queries to the original subject and returns original quads
unchanged. All cross-node guards see the original terms, including malformed or
ambiguous links. There is no handwritten model manifest or accessor implementation.

`parseObservations(dataset, maxObservations?)` scans explicitly typed Observations and
returns valid projections with `id`; invalid records are omitted. It throws before
returning partial results if the document exceeds 100,000 quads or 5,000 candidates
(the caller may lower the candidate cap). Runtime graph traversal has its own bounds.
It never fetches linked nodes. Generated optional root fields retain the runtime's
policy of dropping invalid optional values. Use the facade for validated writes;
raw generated setters may drop invalid values and do not establish graph conformance.

Garmin compatibility: monthly paths, observation/helper identifiers, clinical types,
code values, optional schemes, UCUM/QUDT units, metadata predicates and timezone-bearing
`xsd:dateTime` timestamps are preserved. Measured values now use `xsd:decimal` instead
of the old `xsd:double`; strict reads reject the legacy datatype until that observation
is rewritten. Both behaviors are pinned in tests. Malformed JSON entries are now
omitted in their entirety rather than retaining already-yielded rows. Complete entries
are staged under the existing archive/row/observation budgets before any Pod write;
a later decoder failure leaves no earlier data writes. Transport failures during the
final write phase still propagate. Monthly shards retain the established layout for
interop; hosts discover containers through the connector's Type Index registration.
The suite Health charts still read their own native shards and do not automatically
discover connector metric directories.

Run `pnpm run codegen` after reviewed input changes (`--update-lock` when needed).
`test/codegen.test.ts` regenerates every artifact and compares bytes, including the
lockfile. Generated files are never edited by hand. Build copies the generated JS and
declarations into dist; workspace glob registration and suite.json include this package.
