# @jeswr/solid-drawing

RDF vocabulary + TypeScript types for vector drawings / whiteboards — **the data
model for an Excalidraw→Solid fork**.

A drawing scene is a `draw:Scene` *descriptor*: a small RDF document that points —
via `draw:sceneDocument` — at the **byte-exact `.excalidraw` JSON resource**. The
canvas itself is stored as an **opaque JSON blob**, never shredded into triples.
The only RDF is the lightweight metadata needed to list, title, version,
thumbnail and provenance-track a scene without parsing the canvas.

> Experimental — AI-agent-generated; under active development, not
> production-hardened.

## Why a descriptor, not shredded triples

An Excalidraw canvas is a dense, fast-changing JSON document (elements, points,
bindings, app-state). Representing every shape as triples would be lossy, slow,
and would fight Excalidraw's own format on every save. Instead, this model keeps
the canvas as the byte-exact resource the editor reads/writes, and layers a tiny
RDF descriptor over it so the pod, the suite apps, and the federation can still
*find*, *title*, *version*, and *attribute* a drawing as Linked Data.

## The vocabulary

Namespace: **`https://w3id.org/jeswr/drawing#`** (prefix `draw:`).

Exactly **five** terms are minted; everything else is re-used from Dublin Core
Terms, schema.org, and W3C PROV-O (nothing already covered is re-minted).

| Term | Kind | Meaning |
|---|---|---|
| `draw:Scene` | class | A drawing/whiteboard scene. `rdfs:subClassOf schema:CreativeWork`; `gufo:SubKind` of `core:InformationResource`. |
| `draw:sceneDocument` | object property | **Required.** Links a scene to its byte-exact `.excalidraw` JSON resource. |
| `draw:schemaVersion` | datatype property | The Excalidraw scene-format version (a literal). |
| `draw:viewBackgroundColor` | datatype property | The canvas background colour (a literal). |
| `draw:thumbnail` | object property | Links to a thumbnail / preview image resource. |

Re-used (not minted): `dct:title`, `dct:created`, `dct:modified`, `schema:about`,
`prov:wasGeneratedBy`.

`draw:Scene` is rooted into the suite **Core ontology** (`core:InformationResource`,
a `gufo:SubKind`) the same way every other `@jeswr` sector vocab is — see
[`@jeswr/solid-federation-vocab`](https://github.com/jeswr/solid-federation-vocab)
`sectors/media`. The `w3id.org/jeswr/drawing#` alignments there reference these
exact IRIs.

The ontology lives in [`drawing.ttl`](./drawing.ttl); the validation contract in
[`drawing.shacl.ttl`](./drawing.shacl.ttl).

## Install

GitHub-installable now (npm publish is a deferred migration). The built `dist/`
is committed, so no build step runs under `ignore-scripts=true`:

```bash
npm install github:jeswr/solid-drawing#main
```

## Usage

```ts
import {
  buildScene,
  serializeScene,
  parseSceneTtl,
  DRAW_SCENE,            // a typed rdf-js NamedNode
  DRAW_SCENE_DOCUMENT_IRI, // …and the matching IRI string
} from "@jeswr/solid-drawing";
// Node-only helpers (they read the bundled TTL from disk via node:fs) live
// behind the dedicated `/shape` subpath, so the root stays browser-safe:
import { drawingShapeTtl } from "@jeswr/solid-drawing/shape";

const url = "https://alice.example/drawings/diagram.ttl";

// Serialise a scene descriptor to Turtle (via n3.Writer).
const ttl = await serializeScene(url, {
  sceneDocument: "https://alice.example/drawings/diagram.excalidraw",
  title: "System architecture",
  schemaVersion: "2",
  viewBackgroundColor: "#ffffff",
  thumbnail: "https://alice.example/drawings/diagram.png",
});

// Parse one back (via @jeswr/fetch-rdf — Turtle or JSON-LD).
const scene = await parseSceneTtl(url, ttl, "text/turtle");
// → { sceneDocument: "…/diagram.excalidraw", title: "System architecture", … }
```

The typed term constants come in two forms:

- **`NamedNode`** constants (`DRAW_SCENE`, `DRAW_SCENE_DOCUMENT`, …) — feed
  straight into `n3` / `@rdfjs/wrapper`.
- **IRI string** constants (`DRAW_SCENE_IRI`, `DRAW_SCENE_DOCUMENT_IRI`, …) — for
  matching on `.value` or string comparisons.

## RDF discipline (the suite house rule)

This package **serialises with `n3.Writer`** and **parses with
`@jeswr/fetch-rdf`'s `parseRdf`** (the suite's vetted parser). Quads are built
through the rdf-js `DataFactory` / `n3.Store` — **nothing hand-concatenates
triple strings, and there is no bespoke RDF parser.**

## Validation

`drawingShapeTtl()` returns the SHACL shape as a Turtle string; feed it (with
your data graph) to any SHACL engine. The suite uses `rdf-validate-shacl` over a
`@zazuko/env` dataset — see `src/shape.test.ts`. The core invariant: a scene MUST
point at exactly one canvas resource (`draw:sceneDocument`, an IRI).

## Develop

```bash
npm install
npm run gate   # lint + typecheck + test + build + check:dist
```

`dist/` is **committed** and a `check:dist` gate fails if it drifts from a fresh
build — rebuild + commit `dist/` alongside any `src/` change.

## Licence

MIT © Jesse Wright
