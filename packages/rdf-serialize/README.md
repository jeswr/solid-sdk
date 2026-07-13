<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/rdf-serialize

The shared `n3.Writer` wrapper for serialising RDF quads across the `@jeswr` Solid suite.

## Install

```sh
npm install github:jeswr/rdf-serialize#main n3
```

Requires Node.js 24 or newer. Install `n3` directly when importing its `DataFactory`, as below.

## Minimal usage

```ts
import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory } from "n3";

const { literal, namedNode, quad } = DataFactory;
const turtle = await serialize(
  [
    quad(
      namedNode("https://example.com/alice"),
      namedNode("https://schema.org/name"),
      literal("Alice"),
    ),
  ],
  { prefixes: { schema: "https://schema.org/" } },
);
```

`serialize` defaults to Turtle. Pass `format` for N-Triples, N-Quads, or TriG, and set
`emptyAsEmptyString: false` if an empty graph should retain its prefix preamble.

## Key API

- `serialize(quads, options?)` is the options-based API.
- `legacySerialize(quads, format?, prefixes?, emptyAsEmptyString?)` preserves the older positional
  call shape.
- `DEFAULT_FORMAT` is `text/turtle`; `SerializeOptions` describes the options object.
- `safeHttpIri`, `safeIri`, `isHttpIri`, and `escapeIri` validate or escape untrusted IRI values
  before they reach an RDF writer.

Do not concatenate RDF strings by hand. Use `safeHttpIri` for untrusted HTTP(S) resource IRIs and
drop the field when it returns `undefined`.

## Links

- [Source](https://github.com/jeswr/rdf-serialize)
- [Issues](https://github.com/jeswr/rdf-serialize/issues)
- [N3.js](https://github.com/rdfjs/N3.js)

## License

[MIT](./LICENSE) © Jesse Wright
