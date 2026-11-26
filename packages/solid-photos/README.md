<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
<!-- AUTHORED-BY Codex GPT-6.2-Astra -->
<!-- AUTHORED-BY Claude Opus 5.5 -->
# @jeswr/solid-photos

Generated RDF models for photographs, videos, EXIF metadata, ordered albums and trash
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
`/photograph`, `/duration`, `/album`, `/exif`, `/trash`, `/validation` and `/vocab`.
`PhotographDoc`, `ImageGalleryDoc`, `ListItemDoc`, `RestoreReceipt` and `TrashDoc`
retain the app's typed accessor API. Reusable namespace constants come from
`@jeswr/suite-vocab`; only the standard EXIF base is defined locally.

Set `Photo.kind` to `"video"` to write a `schema:VideoObject` (`VIDEO_CLASS`).
Omitting `kind` writes a `schema:Photograph`. Both use the same descriptive,
dimension, date, EXIF and location fields. A video needs a usable `schema:contentUrl`
to appear in `parsePhoto`, `parseStoredPhoto` or a mixed `parsePhotos` result.
If a subject has both video and still-image types, the video rule applies.

Behaviour changes from the Suite's hand-written video model (#676), each pinned in
`test/video.test.ts`: a video whose `schema:contentUrl` is not an http(s) IRI is skipped
(the hand-written model listed it with that URL), and strict `parsePhoto` and
`PhotographDoc.durationSeconds` drop a repeated `schema:duration` instead of reading the
first value. The Suite's write-back reads (`parseStoredPhoto`, tolerant `parsePhotos`)
still take the first typed value, as before.

`Photo.durationSeconds` and `PhotographDoc.durationSeconds` expose an optional
number. The generated field validates `schema:duration` as an `xsd:duration` literal.
The facade's `parseDuration` accepts unsigned days, hours, minutes and seconds,
including fractional seconds. Calendar years and months, malformed values and
durations above `Number.MAX_SAFE_INTEGER` seconds drop on read. `formatDuration(62.5)`
returns `"PT62.5S"`, which the generated writer stores as `"PT62.5S"^^xsd:duration`.
The formatter uses seconds only and throws on negative, non-finite or out-of-range
input. Both helpers are available at the root and at `/duration`. The reader also
preserves explicit durations on photographs and imported images.

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
sector conformance or minting replacement data IRIs. The omitted CreativeWork and
Track shapes use `media:durationSeconds` with `xsd:decimal`. The photos profile
projects `schema:duration` independently on Photograph, ImageObject and VideoObject.
Each class has its own generated projection, so accessor edits preserve its type.

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
with only import paths changed. The Suite video tests exercise the package through
its public exports, and `test/video.test.ts` preserves their model-level assertions.
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
- **Write-back keeps what the strict reads drop:** editing or trashing a photo rebuilds
  the whole document, so the Suite reads through `parseStoredPhoto` /
  `parsePhotos(url, dataset, { tolerant: true })`, and albums through `parseStoredAlbum`
  (name, description, `dateCreated` and cover fall back the same way, so adding a photo
  to an album from another tool keeps its language-tagged name and `xsd:date`;
  `parseAlbum` stays strict). Lenient numbers must be finite, non-empty, and whole for
  integer fields (ISO, orientation, width, height); a zoneless dateTime reads as UTC. When the strict generated reader
  drops a field, these fall back to the first literal's lexical value (language-tagged
  text, decimal numbers, `xsd:date`, the first value of a repeated singleton, every
  literal keyword), as the hand-written model did. For a repeated duration, the
  first object must itself be a fixed-length `xsd:duration` literal.
  IRIs and blank nodes never become
  text or numbers. `parsePhoto` stays strict. Still lost on rebuild, as before the
  port: the second and later values of a repeated singleton, language tags (written
  back as plain strings), numbers written back as `xsd:integer`/`xsd:double`, `xsd:date`
  written back as `xsd:dateTime`, and predicates the model does not know
  (`test/tolerant-read.test.ts`).
- **http(s)-only IRIs on read:** `contentUrl`, `thumbnailUrl` and an album's cover read
  as absent unless they are http(s) IRIs without credentials, so `javascript:`/`data:`
  values from a pod never reach a UI (`test/tolerant-read.test.ts`).
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
