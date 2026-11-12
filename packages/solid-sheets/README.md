<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# @jeswr/solid-sheets

Generated RDF models for Solid spreadsheet workbooks, CSV download metadata and expanded
JSON-LD column descriptors. The Suite app consumes this package through `workspace:*`.
The package is publishable; no standalone mirror is configured.

```ts
import { serializeWorkbook, parseWorkbook } from "@jeswr/solid-sheets";

const container = "https://pod.example/sheets/budget/";
const turtle = await serializeWorkbook(container, {
  title: "Budget",
  created: new Date("2026-10-24T10:00:00Z"),
  modified: new Date("2026-10-25T10:00:00Z"),
  creator: "https://pod.example/profile/card#me",
  sheets: [{ number: 1, name: "Income" }],
});
const workbook = await parseWorkbook(container, turtle);
```

`codegen/sheets.ontology.ttl`, `sheets.shapes.ttl` and `codegen.config.json` generate
`src/generated/` through `@jeswr/federation-codegen` and `@jeswr/model-runtime`. No matching
federation sector exists. All written IRIs remain the original HTTPS schema.org and
DCT/XSD/Solid terms; namespace constants come from `@jeswr/suite-vocab`.

The four generated entities are Workbook (`schema:SpreadsheetDigitalDocument`), Download
(`schema:DataDownload`), Descriptor (`schema:Dataset`) and Column (`schema:PropertyValue`).
`src/workbook.ts` and `src/descriptor.ts` compose their generated build/parse operations.
The facade preserves the second workbook `schema:Dataset` type, arbitrary-size lists,
exact layout identity, unique sheet numbers, contiguous column positions, and correlated
column datatypes/formats. Dataset descriptor fields are optional in SHACL because workbooks
also carry that type; the descriptor facade requires them. Snapshot encoding remains optional
and unchecked on reads, as before. Parsing uses `@jeswr/fetch-rdf`, Turtle serialization uses
`@jeswr/rdf-serialize`/`n3.Writer`, and expanded JSON-LD uses the existing streaming serializer.
Descriptors reject every `@context` before parsing. CSV I/O, snapshots, hooks and storage
orchestration remain in the app. Column types, validation and descriptor inference are shared.

Public functions retain the app's names: `workbookLayout`, `httpIri`, `workbookDataset`,
`readWorkbookDataset`, `serializeWorkbook`, `parseWorkbook`, `descriptorDataset`,
`serializeDescriptor`, `parseDescriptor`, `inferDescriptor`, plus tabular metadata types,
validation and inference. `SheetResource` remains a minimal arbitrary-predicate compatibility
view for the existing comment/Type Index callers and frozen oracle. Its original accessors
preserve arbitrary predicates, blank-node registrations and legacy datatype reads; the generator
only exposes static vocabulary fields on NamedNode subjects. Core workbook/descriptor builders
and parsers never use that view. `sheetRegistrations` keeps the original typed DatasetWrapper
enumeration of Type Index registrations beside this compatibility view.

## Generator gaps

- Composite links cannot project repeated children. Flat generated Download and Column
  entities cover every field; the facade traverses their generated IRI sets and validates
  each record. No hand-written vocabulary accessor is needed for these collections.
- A flat entity has one canonical type; `sh:targetClass` alternatives are read aliases.
  The facade adds/checks the simultaneous `schema:Dataset` workbook type through the
  generated wrapper's `types` set.
- Dataset is shared by workbook and descriptor roots. Closed admission has no conditional
  class profile (`sh:or`); Dataset fields remain optional and the descriptor facade enforces
  their presence.
- Static generation cannot describe arbitrary predicate parameters or blank-node subjects
  on the public `SheetResource` view. Its original accessors stay inside this package for
  compatibility, separately from the generated model core. Dataset-wide registration
  enumeration also uses a minimal DatasetWrapper adapter; generated entities operate on
  one known subject at a time.

## Exact divergences

Pinned in `test/compatibility.test.ts`:

- Generated singleton fields reject ambiguous values and require the profile's exact
  datatype: text is `xsd:string`, dates are lexically valid `xsd:dateTime`, and positions
  are lossless `xsd:integer`. The old accessors took the first literal and accepted its
  lexical text/date/number independently of its datatype. Malformed required workbook,
  download or column metadata rejects the read; malformed descriptor fields become absent
  and the facade rejects them. Invalid collection members also reject rather than being lost.
- Generated builders strip C0/C1 control characters from text (tab/newline/CR survive).
  Ordinary text, every resource IRI and both workbook types are preserved.
- Generated Download/Descriptor/Column parsing recognises data-graph subclasses of their
  target class. Workbook parsing retains its original requirement for both explicit types.

The public `SheetResource` view retains the original generic accessor behavior, including
blank-node registrations and permissive literal reads, pinned separately in the same test.

## Development

With Node 24 on PATH, from the workspace root:

```sh
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-sheets run codegen --update-lock
pnpm exec turbo run lint build typecheck test --filter=@jeswr/solid-sheets --filter=@jeswr/app-suite
pnpm run lint:root
```

Never edit `src/generated/`. The drift test regenerates into a temporary directory and compares
all six artifacts byte for byte, including the lock. The original app RDF oracle is copied
into `test/rdf.test.ts` with import-path changes only. All original app tests remain unchanged.
Builds copy the generated JS/declarations to `dist/generated/`; `dist/` is never committed.
