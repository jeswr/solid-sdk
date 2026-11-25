<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# @jeswr/solid-photos

Generated RDF models for photographs, EXIF metadata, ordered albums and trash
provenance. The Suite photos app consumes this shared package through
`workspace:*`. The package is browser-safe and performs no storage or image I/O.

```ts
import { buildPhoto, parsePhoto, serializePhotos } from "@jeswr/solid-photos";

const url = "https://alice.example/photos/items/1.ttl";
const dataset = buildPhoto(url, {
  name: "Sunset", contentUrl: "https://alice.example/photos/originals/1.jpg",
  keywords: ["bay"], exif: {},
});
const turtle = await serializePhotos(dataset);
const photo = parsePhoto(url, dataset);
```

The root exports `Photo`, `Album`, `ExifMetadata`, `TrashRecord`, their build/parse
helpers, `parsePhotos` for multi-subject connector documents, keyword and membership
helpers, EXIF normalization, URL validation, vocabulary constants and
`serializePhotos` (the shared serializer backed by `n3.Writer`). Focused entries are
`/photograph`, `/album`, `/exif`, `/trash`, `/validation` and `/vocab`.
`PhotographDoc`, `ImageGalleryDoc`, `ListItemDoc`, `RestoreReceipt` and `TrashDoc`
retain the app's typed accessor API. Reusable namespace constants come from
`@jeswr/suite-vocab`; only the standard EXIF base is defined locally.

## Generated core and facade

`codegen/photos.ontology.ttl`, `codegen/photos.shapes.ttl` and
`codegen/codegen.config.json` are the inputs. `@jeswr/federation-codegen` generates
all six committed artifacts in `src/generated/`; `@jeswr/model-runtime` supplies
all named-node field access, datatype/cardinality guards, builds and parses.
Builds copy generated JS/declarations into `dist/generated/`. Never edit generated
artifacts or commit `dist/`. Biome excludes `!!src/generated`.

The media-sector profile was inspected first. It describes music, playback and
licensing, with no photographs, EXIF, WGS84 capture points, schema.org galleries or
PROV trash records. The input header lists every omitted sector shape and field;
the package profile preserves the existing photo wire contract without changing
sector conformance or minting replacement data IRIs. New photos remain
`https://schema.org/Photograph`; imported `schema:ImageObject` data has a separate
generated read projection, so accessor edits preserve its type.

The facades retain EXIF normalization, paired-coordinate policy, ISO strings,
case-insensitive keyword deduplication, ordered unique membership and the trash
record's required fields/state checks. These policies supplement generated fields.
The `#it`, `#geo`, `#member-N` and `#trash` subjects, literal datatypes, serialized
property order and all written IRIs match the original model. Golden fixtures in
`test/fixtures/` were captured from that implementation and pin exact Turtle bytes.

Generator gaps are limited to `src/views.ts`:

- `schema:geo` and `schema:itemListElement` can reference blank or named nodes.
  Closed admission lacks `BlankNodeOrIRI`, and generated wrapper constructors
  require named subjects. Minimal typed term views retain the original terms.
- Album membership repeats any number of ListItem children; generated composites
  project a single child per link. Named ListItem fields and all new writes are
  generated; the facade orders and deduplicates the resulting member values.
- Imported coordinates accept different numeric RDF datatypes. Datatype unions
  are outside closed admission, so the tiny capture-point view retains that read
  policy, with existing finite/range/pair checks in `normaliseExif`. New coordinates
  are built by the generated GeoPoint entity as `xsd:double`.

Storage/ETags, upload preparation, image decoding/encoding, timeline grouping,
trash/restore/purge orchestration, hooks and UI remain in `apps/suite`. Its former
model module paths are compatibility re-exports, with no RDF accessor classes.

## Exact divergences

The original photograph, album and EXIF tests are copied verbatim into `test/`
with only import paths changed. All existing Suite tests remain unchanged.
Additional differences outside that oracle are pinned in
`test/compatibility.test.ts`:

- **Ambiguous singleton fields:** drop instead of returning the first RDF value
  (`drops ambiguous singleton fields instead of selecting the first RDF value`).
  Photo/album names still default to empty strings; a missing trash field or
  ListItem item/position still triggers the facade's validation error. Present
  malformed or ambiguous trash state/receipt values reject the record, preserving
  its recovery fence rather than treating them as absent legacy metadata
  (`rejects present invalid or ambiguous trash recovery metadata…`).
- **Literal datatypes:** language-tagged and non-string text drops; numeric/date
  fields require the exact datatype written by this model and valid XSD lexical
  forms. This includes decimal dimensions, decimal `exif:fNumber`, whitespace in
  integers, `xsd:date` timestamps and rolled-over dates (`drops language-tagged…`,
  `requires the written numeric and date datatypes…`). Capture-point reads and
  blank ListItem reads retain their original datatype handling as documented above.
- **Wrong RDF term kinds:** optional IRI fields and invalid members of the legacy
  IRI set drop rather than throwing (`drops wrong-term IRI fields…`).
- **Subclass recognition:** the generated parsers recognize Photograph, ImageObject,
  ImageGallery and PROV Entity types through bounded data-graph `rdfs:subClassOf`
  traversal (`recognizes Photograph, ImageObject and ImageGallery…` and the trash
  compatibility pin).
- **Direct generated accessors:** invalid integer writes drop, unsafe/relative or
  non-NamedNode subjects throw, and direct ListItem positions are read strictly as
  integers (`drops invalid integer writes…`). The documented blank-node adapters
  remain available for existing memberships and capture points.

Text sanitization is explicitly disabled in config to preserve the original text
write policy. URL validation preserves lexical identity and rejects credentials;
IRIs are not normalized by the generated runtime. Compatibility tests pin these
policies and receipt-only tombstones, alongside the divergences.

## Development

Use Node 24 and the workspace's existing tooling:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm --filter @jeswr/federation-codegen... run build
pnpm --filter @jeswr/solid-photos run codegen --update-lock
pnpm exec turbo run lint build typecheck test --filter=@jeswr/solid-photos --filter=@jeswr/app-suite
pnpm run lint:root
```

Review input changes before accepting an updated lock. `test/codegen.test.ts`
regenerates into a temporary directory and compares every artifact byte for byte,
including `codegen.lock.json`. No mirror repository is configured for this package.

MIT © Jesse Wright
