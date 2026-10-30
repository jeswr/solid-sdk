<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/rdf-serialize

The shared RDF serialiser for the `@jeswr` Solid suite: `n3.Writer` for Turtle-family formats,
and plain JSON objects for expanded, context-free JSON-LD.

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

`serialize` defaults to Turtle. Pass `format` for N-Triples, N-Quads, TriG, or
`application/ld+json`, and set
`emptyAsEmptyString: false` if an empty graph should retain its prefix preamble.

JSON-LD always returns an array (`[]` for an empty dataset), ignoring prefixes and
`emptyAsEmptyString`. Named graphs use `@id`/`@graph`; blank nodes receive stable document-local
`_:bN` labels. Lists stay as RDF first/rest triples. Literal values remain strings: `xsd:string`
uses `@value`, language strings add `@language`, and other datatypes add `@type`.
Named-node `rdf:type` objects use `@type`. There is no context option, no emitted `@context`,
and no network access. Malformed terms, relative or forbidden-character IRIs, language tags
inconsistent with `rdf:langString`, and directional literals (including `rdf:dirLangString`)
reject with `TypeError` rather than losing information.

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
