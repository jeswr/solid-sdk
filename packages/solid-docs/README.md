<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# @jeswr/solid-docs

Browser-safe, generated RDF models for Solid Docs documents, PROV revision history,
Web Annotation comments and immutable version metadata. The Suite app consumes this
package; network requests, ETags, Yjs snapshots, React hooks and editor orchestration
remain in the app.

```ts
import { buildDocument, parseDocument, serializeTurtle } from "@jeswr/solid-docs";

const resource = "https://alice.example/docs/plan.ttl";
const dataset = buildDocument(resource, { title: "Plan", body: "<p>Hello</p>" });
const turtle = await serializeTurtle(dataset);
const document = parseDocument(resource, dataset);
```

## Generated model and facade

`codegen/docs.ontology.ttl`, `codegen/docs.shapes.ttl` and
`codegen/codegen.config.json` generate `src/generated/` through
`@jeswr/federation-codegen`. `@jeswr/model-runtime` supplies the field accessors and
guards. Never edit generated artifacts. There is no docs federation sector to start
from: the profile describes the app's existing IRIs, including its sparse documents.
Constants derive from `@jeswr/suite-vocab`; resource identities and written vocabulary
IRIs remain unchanged, including the untyped comment targets and version metadata.

`src/document.ts` composes generated Document and Revision entities; `src/revision-policy.ts` retains the
existing ten-minute/named revision policy, 100 automatic-revision limit, bigint revision
indexing, cycle guard, defaults, title and word-count errors. `src/comments.ts` uses
generated Annotation/Quote parsing for required fields, nonblank text and closed
motivation/version-kind enums. It retains motivation-dependent anchor checks,
quote/position bounds and Unicode context truncation. `src/versions.ts` uses generated
Revision accessors without marking the historically untyped metadata. No new classes
or type assertions are added to stored data.

Generator gaps retained inside this package:

- Shared `pd:body` / `pd:format` legacy aliases cannot be declared for both Document
  and Revision: closed admission rejects shared canonical predicates with aliases.
  `src/views.ts` adds only this typed alias bridge to the generated wrappers, preferring
  canonical values and clearing legacy values on replacement. Other aliases are generated.
- Conditional comment targets (root versus reply), untyped target/version nodes and
  arbitrary cyclic revision chains cannot be represented by a single finite composite.
  Facades compose generated flat entities/accessors and apply the existing domain policy.
  Closed admission also lacks `sh:maxLength`; UTF-16 quote/position bounds remain in the
  facade, alongside Unicode context truncation. Untyped versions share the sparse
  Revision view, so their required-field presence check remains in the version facade.
  Root optional fields normally drop malformed terms; versions must retain their old
  whole-entry rejection for a mistyped optional creator. A vetted mapper
  preflight check preserves that contract before returning generated values.
- Generic Type Index views need blank-node subjects and both singleton and live-set
  views of each predicate. Generated wrappers require named subjects and one projection
  per path. `src/type-index.ts` preserves these minimal typed compatibility views;
  Type Index fetching, access checks and bootstrap remain in the Suite app.

Text sanitization is explicitly disabled in the generation config to preserve rich-text
content and existing user strings. No scheme normalization is added to field IRIs.
The root and `/document`, `/comments`, `/versions`, `/vocab`, `/layout`, `/type-index`
entries contain no Node built-ins. `codegen/` and `dist/` ship in the publishable package.
There is no mirror repository configured for this new package.

## Exact divergences

Pinned in `test/compatibility.test.ts` under `Exact divergences`:

- `drops ambiguous, mistyped and language-tagged scalar fields...`: generated scalar
  getters drop multiple values, wrong term kinds/datatypes and language-tagged strings,
  rather than taking the first lexical value or throwing. Negative/non-integer word
  counts and date-only stamps drop. Document defaults still apply.
- `drops malformed dateTimes...`: invalid optional dateTimes drop; a malformed revision
  timestamp now uses the existing epoch default instead of failing ISO conversion.
  `drops an invalid supplied creation date...` also pins dropped invalid write dates.
- `recognises annotation and quote types...`: type membership accepts the expected type
  among additional assertions, rather than inspecting only the first assertion.
- `mark migrates the legacy document class...`: marking an existing legacy document
  removes its legacy class instead of retaining both spellings; other types and content
  remain intact.
- `recognises document subclasses...`: data-graph `rdfs:subClassOf` membership also
  recognises a document, using the runtime's bounded traversal.
- `rejects unsafe or relative document and revision subjects`: generated constructors,
  subjects and builders throw `TypeError` (including blank-node subjects); document parsing returns `undefined` for an
  unsafe resource URL. `drops unsafe field IRI writes` pins dropped unsafe field values.
- `drops a mistyped comment or version scalar...`: exact generated datatype/cardinality
  checks also apply to comment and version fields; malformed required metadata fails the
  existing facade validation and is isolated by the app's listing boundary.
  `drops a nonliteral version label...` pins dropping an IRI label instead of returning
  its lexical IRI as the name.

The copied `test/document.test.ts`, `test/model.test.ts` and `test/vocab.test.ts` are the
app's original oracle tests with only import paths changed. Additional compatibility
tests pin unchanged alias, content, comment and untyped-version behavior. The app's
original tests remain unchanged and continue through compatibility re-export modules.

## Development

From the workspace root, with Node 24 on PATH:

```sh
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-docs run codegen --update-lock
pnpm exec turbo run lint build typecheck test --filter=@jeswr/solid-docs --filter=@jeswr/app-suite
pnpm run lint:root
```

A drift test runs `pnpm run codegen --out <tmp>` and compares every generated file,
including the lockfile, byte for byte. Builds copy the generated JavaScript and
precise declarations into `dist/generated/`; `dist/` is never committed.
