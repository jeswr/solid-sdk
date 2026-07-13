<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-drawing

RDF vocabulary and typed helpers for describing an Excalidraw-compatible scene stored in a Solid pod.

The RDF descriptor holds metadata and points to the byte-exact `.excalidraw` JSON resource; it does
not split the canvas into triples.

> Experimental. Review the model before using it for long-lived data.

## Install

```sh
npm install github:jeswr/solid-drawing#main @rdfjs/types
```

Requires Node.js 20 or newer.

## Minimal usage

```ts
import { parseSceneTtl, serializeScene } from "@jeswr/solid-drawing";

const sceneUrl = "https://alice.example/drawings/diagram.ttl";
const turtle = await serializeScene(sceneUrl, {
  sceneDocument: "https://alice.example/drawings/diagram.excalidraw",
  title: "System architecture",
  schemaVersion: "2",
  thumbnail: "https://alice.example/drawings/diagram.png",
});

const scene = await parseSceneTtl(sceneUrl, turtle, "text/turtle");
```

## Key API

- Scene data: `buildScene`, `serializeScene`, `parseSceneTtl`.
- Vocabulary constants: `DRAW_SCENE`, `DRAW_SCENE_DOCUMENT`, and matching `*_IRI` strings.
- Node-only assets: `drawingShapeTtl` and `drawingOntologyTtl` from `@jeswr/solid-drawing/shape`.
- Bundled files: `drawing.ttl` and `drawing.shacl.ttl` subpath exports.

## Links

- [Source](https://github.com/jeswr/solid-drawing)
- [Issues](https://github.com/jeswr/solid-drawing/issues)
- [Vocabulary](./drawing.ttl)
- [SHACL shape](./drawing.shacl.ttl)

## License

[MIT](./LICENSE) © Jesse Wright
