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
| Image | `#it` | `schema:ImageObject` | name, description, contentUrl (required IRI), encodingFormat, width, height (integer, at least 1), contentSize, dateCreated (dateTime), keywords (set), thumbnail, creator, prov:wasGeneratedBy, prov:wasDerivedFrom (set), schema:isBasedOn (set) |
| Video | `#it` | `schema:VideoObject` | the Image set plus duration (`xsd:duration`, such as `PT5.5S`) |
| 3D model | `#it` | `schema:3DModel` | the Image set without width and height; mesh and splat differ by encodingFormat |
| Thumbnail | `#thumbnail` | `schema:ImageObject` | contentUrl, width, height, encodingFormat |
| Run | `#run` | `prov:Activity` | startedAtTime, endedAtTime, prov:used (set: prompt, source assets, settings), prov:wasAssociatedWith (set: model, user WebID) |
| Prompt | `#prompt` | `schema:CreativeWork` and `prov:Entity` | text |
| Model | `#model` | `schema:SoftwareApplication` and `prov:SoftwareAgent` | name, identifier, softwareVersion, provider (IRI) |
| Setting | `#setting-<n>` | `schema:PropertyValue` | propertyID, value (a string, because a 64-bit seed does not fit a JS number) |
| Project document | `#it` | `schema:CreativeWork` | name, contentUrl, encodingFormat, schemaVersion, additionalType, hasPart (set), dateCreated, dateModified, creator |
| Collection | `#it` | `schema:Collection` | name, hasPart (set), dateCreated |

The two second types (`prov:Entity`, `prov:SoftwareAgent`) are added through the generated
wrapper's `types`, as `solid-sheets` does; they are written and survive a round trip, but the
SHACL profile does not state or check them. Width and height must be integers of at least 1.

**The library asset is always `<doc#it>`.** `#thumbnail` is a second `schema:ImageObject` in the
same document (the object of `schema:thumbnail`); it is not a library item. A reader that lists
by type must skip nodes that are the object of `schema:thumbnail`, or it counts each asset twice.
The type of a node is also not a trust boundary: the runtime follows `rdfs:subClassOf` asserted
in pod data, so a document can make a node read as a video by declaring a subclass.

The generated field for `schema:value` is `settingValue` because `value` is a reserved
accessor name in the runtime; the facade exposes it as `value`.

The facade follows a link (`schema:thumbnail`, `prov:wasGeneratedBy`, `prov:used`,
`prov:wasAssociatedWith`) only to the conventional hash node of the same document. A link to
another document is never fetched, and is not carried through a parse.

## Document URLs

`documentUrl` accepts only an `http(s)` URL in normalised form (`new URL(x).href === x`) with no
userinfo and no fragment: a non-ASCII path must be percent-encoded, the host lower-case, and
default ports and dot segments absent. The generated writer normalises link values, so the node
subjects must already share that spelling or the links would not meet their nodes. Builds also
re-read the finished document and throw if any node the caller supplied (thumbnail, run,
prompt, model, each setting) is missing, so a build never returns a disconnected graph.

## Compatibility with pod-photos

`apps/pod-photos` shows `schema:ImageObject` documents as photos (and finds containers registered
for `schema:ImageObject` in the Type Index), alongside `schema:Photograph`, which it still writes.
It reads the `<doc#it>` node, so each asset appears once and the `#thumbnail`, `#run`, `#prompt`,
`#model` and `#setting-n` nodes are ignored. These documents are read-only there: Pod Photos refuses
to update or delete a document whose `#it` is not a `schema:Photograph`. Its tests
(`apps/pod-photos/test/image-object.test.ts`) use this package's `serializeAssetDocument` output
copied verbatim as fixtures. An import-based interop test that calls `serializeAssetDocument`
inside the app is still pending: it needs this package as a `workspace:*` devDependency of
`apps/pod-photos` (`check:sdk-layers` allows that edge), which is a manifest and lockfile edit.

`test/photograph.test.ts` here mirrors the old reader's accessors and can drift from the real
`parsePhoto`; the app's tests are the real check.

## Generated, not hand-written

`codegen/creative-assets.ontology.ttl` (generator input only, not published; its properties
state `rdfs:Resource` domains and ranges so it asserts nothing about schema.org),
`creative-assets.shacl.ttl` (the SHACL profile; its
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
kind are filtered. A document with more than 256 settings, or one whose parse budget runs out,
parses to `undefined` rather than a partial description. Setting nodes are only the fragments
`#setting-0` to `#setting-999` with no leading zeros; any other IRI in `prov:used` is an
ordinary used IRI. Links are followed only to the conventional hash node of the same document.

Writes are fail-closed for every supplied value, not only required ones. A value the generated
writer drops (a non-integer or zero width, an invalid date, a non-http(s) IRI, a bad set member)
throws a `TypeError` naming the field, as does a missing required value (`contentUrl`, a
setting's `propertyID` or `value`, a prompt's text, a project's `contentUrl`, a collection's
`name`), an unknown `kind`, more than 256 settings, and a caller IRI in `usedAssets`,
`associatedWith`, `wasDerivedFrom` or `isBasedOn` that names this document's own `#it`, `#run`,
`#prompt`, `#model`, `#thumbnail` or `#setting-<n>`. Only the keys of the declared types are
copied; anything else on the input object is ignored.

### What `parse(build(x))` normalises, and what a rebuild loses

`parse(build(x))` equals `x` except for these normalisations, each pinned in
`src/hardening.test.ts`:

- `contentUrl` and every other IRI come back in URL form (`HTTPS://Pod.Example/a b` becomes
  `https://pod.example/a%20b`).
- `keywords` are trimmed, de-duplicated and sorted; blank keywords and an empty list vanish.
- The other sets (`wasDerivedFrom`, `isBasedOn`, `usedAssets`, `associatedWith`, `hasPart`) are
  de-duplicated.
- Control characters are stripped from text, including a prompt.
- `xsd:duration` is validated: week forms such as `P1W` are rejected.

Parse-then-rebuild also loses what the facade does not follow: a `schema:thumbnail` or
`prov:wasGeneratedBy` that points outside the document is not returned and so not rewritten, a
second `prov:wasGeneratedBy` value makes the whole generation disappear, and a `prov:used` or
`prov:wasAssociatedWith` link to a missing node is dropped. An app that edits and rewrites a
document written by another tool will delete that tool's links.

Reading with legacy `http://schema.org/` class IRIs works; serialising writes the canonical
`https://schema.org/` class. Legacy `http://schema.org/` **predicates** are not read, only
classes: this is a known generator gap (gap 1) to be fixed in the generator, not a choice of
this package. `documentToTurtle` throws rather than write a document that still holds legacy
predicates, so a canonically typed but unreadable document is never produced.

## Generator gaps

Each item is a limit of `@jeswr/federation-codegen` that shaped the model; none is worked
around with hand-written accessors. Paths are under `packages/federation-codegen/src`.

1. **No `http://schema.org/` predicate aliases.** A predicate alias is accepted only when no
   other shape uses the same canonical predicate (`shapes.ts:529-540` rejects an alias that
   overlaps another field's predicate or alias, and `sharedAliasPredicates`, `shapes.ts:148`,
   enforced at `admission.ts:94` and `compile.ts:501`, rejects a canonical predicate shared by
   two shapes when either carries an alias). `schema:name`, `contentUrl` and the rest are
   shared by several shapes, so only the class aliases (multiple `sh:targetClass`) are
   declared. A document with legacy predicates parses to `undefined` (pinned in a test). The
   fix belongs in the generator and runtime: allow a shared canonical predicate when every
   owner declares the identical alias list.
2. **One canonical `rdf:type` per generated entity.** `compile.ts:301` and `:486` emit
   `typeIris: [targetClass]`; extra `sh:targetClass` values become read-only aliases. The
   prompt's `prov:Entity` and the model's `prov:SoftwareAgent` are therefore added by the facade
   through the generated wrapper's `types`, not stated or checked by the profile.
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
7. **Provider is an IRI only.** A nested `schema:Organization` node would be one more
   flat entity and fragment; the model's `name` and `identifier` identify the model and
   `provider` takes an IRI.

## Licence

MIT © Jesse Wright
