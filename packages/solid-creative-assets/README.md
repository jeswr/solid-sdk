<!-- AUTHORED-BY Claude Sonnet 5.5 -->

# @jeswr/solid-creative-assets

A generated, typed model for AI-generated creative assets saved to a Solid pod by apps such as
ArtCraft: images, video, 3D models (mesh or gaussian splat), project documents and
collections, with PROV-O provenance of how each asset was produced.

Only real vocabularies are used and nothing is minted: `schema:` is `https://schema.org/`
(written form; the legacy `http://schema.org/` classes are read aliases) and `prov:` is
`http://www.w3.org/ns/prov#`.

## Usage

```ts
import {
  parseAssetDocumentTtl,
  serializeAssetDocument,
  type AssetDescription,
} from "@jeswr/solid-creative-assets";

const doc = "https://alice.example/creative/assets/fox"; // no fragment
const description: AssetDescription = {
  kind: "image", // "image" | "video" | "model3d"
  asset: {
    name: "Sunset fox",
    contentUrl: "https://alice.example/creative/files/fox.png",
    encodingFormat: "image/png",
    width: 1024,
    height: 768,
    keywords: ["fox"],
    creator: "https://alice.example/profile/card#me",
  },
  thumbnail: { contentUrl: "https://alice.example/creative/files/fox-t.webp", width: 128, height: 96 },
  generation: {
    prompt: "a red fox at sunset",
    model: { name: "Flux Pro", identifier: "flux-pro-1.1", provider: "https://bfl.ai/" },
    settings: [{ propertyID: "seed", value: "18446744073709551615" }],
  },
};

const turtle = await serializeAssetDocument(doc, description); // then PUT it
const back = await parseAssetDocumentTtl(doc, turtle); // typed AssetDescription | undefined
```

`buildAssetDocument` returns the n3 `Store` and `parseAssetDocument(doc, dataset)` reads a
dataset you already hold. `buildProjectDocument` / `parseProjectDocument` and
`buildCollection` / `parseCollection` do the same for the other two document kinds, each with
`serialize…` and `parse…Ttl` forms (Turtle or JSON-LD through `@jeswr/fetch-rdf`).

## Document layout

One description document per asset. The asset is `<doc#it>`; the other nodes are hash IRIs in
the same document, never blank nodes. A node exists only when its data was given.

| Node | IRI | rdf:type | Properties |
|---|---|---|---|
| Image | `#it` | `schema:ImageObject` | name, description, contentUrl (required IRI), encodingFormat, width, height (integer), contentSize, dateCreated (dateTime), keywords (set), thumbnail, creator, prov:wasGeneratedBy, prov:wasDerivedFrom (set), schema:isBasedOn (set) |
| Video | `#it` | `schema:VideoObject` | the Image set plus duration (ISO 8601 string) |
| 3D model | `#it` | `schema:3DModel` | the Image set without width and height; mesh and splat differ by encodingFormat |
| Thumbnail | `#thumbnail` | `schema:ImageObject` | contentUrl, width, height, encodingFormat |
| Run | `#run` | `prov:Activity` | startedAtTime, endedAtTime, prov:used (set: prompt, source assets, settings), prov:wasAssociatedWith (set: model, user WebID) |
| Prompt | `#prompt` | `schema:CreativeWork` | text |
| Model | `#model` | `schema:SoftwareApplication` | name, identifier, softwareVersion, provider (IRI) |
| Setting | `#setting-<n>` | `schema:PropertyValue` | propertyID, value (a string, because a 64-bit seed does not fit a JS number) |
| Project document | `#it` | `schema:CreativeWork` | name, contentUrl, encodingFormat, schemaVersion, additionalType, hasPart (set), dateCreated, dateModified, creator |
| Collection | `#it` | `schema:Collection` | name, hasPart (set), dateCreated |

The generated field for `schema:value` is `settingValue` because `value` is a reserved
accessor name in the runtime; the facade exposes it as `value`.

The facade follows a link (`schema:thumbnail`, `prov:wasGeneratedBy`, `prov:used`,
`prov:wasAssociatedWith`) only to the conventional hash node of the same document. A link to
another document is never fetched, and is not carried through a parse.

## Compatibility with pod-photos

`apps/pod-photos` reads `schema:Photograph` documents with `https://schema.org/` predicates.
An image written here, with its `rdf:type` replaced by `schema:Photograph`, is read in full:
name, description, contentUrl as an IRI, keywords, integer width and height, and a dateTime
dateCreated (`test/photograph.test.ts`). The compatibility is property-level; the type is the
only difference.

## Generated, not hand-written

`creative-assets.ttl` (ontology input), `creative-assets.shacl.ttl` (the SHACL profile; its
header states what it covers and omits) and `codegen.config.json` drive
`@jeswr/federation-codegen`, which writes `src/generated/`. Never edit `src/generated/`.
`src/assets.ts` and `src/documents.ts` are the facade: they choose fragments, link nodes,
and refuse a write whose required value the generated guards dropped. All RDF goes through
the generated entities, `@jeswr/fetch-rdf` and the runtime's `n3.Writer` boundary.

```sh
pnpm turbo run build --filter "@jeswr/solid-creative-assets..."
pnpm --filter @jeswr/solid-creative-assets run codegen
# after an intentional change to the profile, ontology or config:
pnpm --filter @jeswr/solid-creative-assets run codegen --update-lock
```

`test/codegen.test.ts` regenerates into a temporary directory and compares every file
byte for byte; `check:codegen` at the root requires it. `creative-assets.shacl.ttl` is also
used to validate everything the package writes (`test/shape.test.ts`), which is what catches a
wrongly typed literal such as an `xsd:date` where a dateTime is required.

## Behaviour on malformed data

Reads are fail-closed per the runtime. A document with no `contentUrl`, a literal where an IRI
is expected, or a non-http(s) IRI parses to `undefined`. An optional field with the wrong
datatype (`schema:width "wide"`, a decimal height, an `xsd:date` for `dateCreated`) is skipped
and the asset still parses. A singleton with two values is dropped. Set members of the wrong
kind are filtered. Writes throw a `TypeError` when `contentUrl`, a setting's `propertyID` or
`value`, a prompt's text, or a project's `contentUrl` is missing or invalid, instead of
writing a typed shell. The document URL must be absolute with no fragment.

Reading with legacy `http://schema.org/` class IRIs works; serialising writes the canonical
`https://schema.org/` class.

## Generator gaps

Each item is a limit of `@jeswr/federation-codegen` that shaped the model; none is worked
around with hand-written accessors. Paths are under `packages/federation-codegen/src`.

1. **No `http://schema.org/` predicate aliases.** A predicate alias is accepted only when no
   other shape uses the same canonical predicate (`shapes.ts:529-540` rejects an alias that
   overlaps another field's predicate or alias, and `sharedAliasPredicates`, `shapes.ts:148`,
   enforced at `admission.ts:94` and `compile.ts:501`, rejects a canonical predicate shared by
   two shapes when either carries an alias). `schema:name`, `contentUrl` and the rest are
   shared by several shapes, so only the class aliases (multiple `sh:targetClass`) are
   declared. A document with legacy predicates parses to `undefined` (pinned in a test).
2. **One written `rdf:type` per node.** `compile.ts:301` and `:486` emit
   `typeIris: [targetClass]`; extra `sh:targetClass` values become read-only aliases. The
   prompt is therefore only `schema:CreativeWork` (no `prov:Entity`) and the model only
   `schema:SoftwareApplication` (no `prov:SoftwareAgent`).
3. **One NodeShape per class.** `shapes.ts:411` rejects two shapes for one canonical class.
   The project document and the prompt are both `schema:CreativeWork`, so they share one shape
   with every property optional. The facade requires `contentUrl` for a project and `text`
   for a prompt.
4. **Composite entities cannot express the document.** A composite requires a distinct class
   per node (`compile.ts:337`), claims each class exclusively across composites
   (`compile.ts:535-536`), fixes each node's fragment in config (`compile.ts:488`; no
   `#setting-<n>`), allows only single-valued nested links (`compile.ts:415`), rejects
   aliases on links (`compile.ts:401`), and so cannot reuse run/prompt/model nodes across
   image, video and 3D, nor type a thumbnail with the root's class. The model is instead one
   flat entity per class with `subject.convention: "self"` (`manifest.ts:651` offers only
   `hash-it` and `self`), and the facade passes each node's own fragment IRI.
5. **No class check on IRI links.** `sh:class` on a flat property needs a composite link
   (`admission.ts:267`; only advisory hints are dropped). Links are plain http(s) IRIs, so the
   run, thumbnail and prompt classes are checked by following the link in the facade, not by
   the generated guards.
6. **`schema:value` as a field name.** `value` is reserved by the runtime
   (`model-runtime/src/manifest.ts:190-212`), so the SHACL `sh:name` is `settingValue`.
7. **`schema:duration` is a string.** The validated datatypes do not check an ISO 8601
   duration; it is an `xsd:string` with no pattern.
8. **Provider is an IRI only.** A nested `schema:Organization` node would be one more
   flat entity and fragment; the model's `name` and `identifier` identify the model and
   `provider` takes an IRI.

A possible way past 1 without generator changes is one profile and generated directory per
asset kind; that departs from the one-`src/generated` layout `check:codegen` assumes, so it is
not done here.

## Licence

MIT © Jesse Wright
