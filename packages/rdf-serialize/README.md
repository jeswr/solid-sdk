# @jeswr/rdf-serialize

> The single sanctioned `n3.Writer` RDF serialiser for the `@jeswr` suite.

Serialise a `readonly Quad[]` to Turtle / N-Triples / N-Quads / TriG via
[`n3`](https://github.com/rdfjs/N3.js)'s `Writer` — **never** hand-concatenated
RDF. This package consolidates the five near-identical `src/serialize.ts` copies
that previously lived in:

- [`@jeswr/solid-vc`](https://github.com/jeswr/solid-vc)
- [`@jeswr/solid-odrl`](https://github.com/jeswr/solid-odrl)
- [`@jeswr/solid-a2a`](https://github.com/jeswr/solid-a2a)
- [`@jeswr/federation-client`](https://github.com/jeswr/federation-client)
- [`@jeswr/solid-agent-card`](https://github.com/jeswr/solid-agent-card)

It is deliberately **vocab-agnostic**: there is no baked-in default prefix map.
Each caller passes its own prefix set, so consolidating the copies does not
couple them to one vocabulary.

## Install

It installs directly from GitHub under `ignore-scripts=true` — the built `dist/`
is committed, and the only dependencies (`n3`, `@rdfjs/types`) are npm-published,
so there is no build step on install:

```bash
npm install github:jeswr/rdf-serialize#main
```

## Usage

```ts
import { serialize } from "@jeswr/rdf-serialize";

const ttl = await serialize(quads, {
  prefixes: { schema: "https://schema.org/" },
});
```

### API

#### `serialize(quads, options?): Promise<string>`

The canonical API. Serialises `quads` (a `readonly Quad[]`, passed verbatim to
`Writer.addQuads`) and resolves with the serialised string, or rejects with the
error `n3.Writer` reports.

`options` is `SerializeOptions`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `format` | `string` | `"text/turtle"` | RDF media type passed to `n3.Writer` (`text/turtle`, `application/n-triples`, `application/n-quads`, `application/trig`, …). An **unrecognised** type falls back to Turtle — this is `n3.Writer`'s own behaviour. |
| `prefixes` | `Readonly<Record<string, string>>` | `{}` | Prefix declarations (label → namespace IRI). Affects Turtle/TriG readability; ignored by N-Triples/N-Quads. |
| `emptyAsEmptyString` | `boolean` | `true` | When `true`, a zero-quad input short-circuits to `""`. Set `false` to let `n3.Writer` emit its bare prefix preamble (see the divergence note below). |

#### `legacySerialize(quads, format?, prefixes?, emptyAsEmptyString?): Promise<string>`

A backward-compatible **positional** helper matching the call shape the five
copies exposed (`serialize(quads, format)`). It exists so the Phase-2 consumer
rewire is frictionless — a consumer keeps its existing
`serialize(quads, format)` signature by re-exporting a thin local wrapper:

```ts
// A consumer's thin local wrapper preserving its own public surface:
import { legacySerialize } from "@jeswr/rdf-serialize";
import type { Quad } from "@rdfjs/types";
import { PREFIXES } from "./vocab.js";

export function serialize(quads: readonly Quad[], format = "text/turtle"): Promise<string> {
  return legacySerialize(quads, format, PREFIXES);
}
```

#### `DEFAULT_FORMAT`

The string `"text/turtle"` — the default media type.

#### `SerializeOptions`

The options interface for `serialize` (re-exported as a type).

## The two divergences this consolidates

The five copies were identical except for two things, both now options:

1. **Empty-graph behaviour (4-of-5 majority vs federation-client).**
   `solid-vc`, `solid-odrl`, `solid-a2a` and `solid-agent-card` all
   **short-circuit** a zero-quad input to `""` (so an empty graph round-trips as
   truly empty rather than a content-free prefix preamble). `federation-client`
   does **not** — it lets `n3.Writer` emit the bare preamble (a non-empty
   string). Reproduce the majority behaviour with the default
   `emptyAsEmptyString: true`; reproduce federation-client with
   `emptyAsEmptyString: false`.

2. **Prefix map (different per consumer).** Each copy hard-coded a different
   prefix map. There is no default here — every caller supplies its own
   `prefixes` (typically its own vocab prefix constant).

## RDF discipline

This package only ever serialises through `n3.Writer`. It never hand-builds or
concatenates triples. If a needed serialisation capability is missing, raise it
for upstreaming to `n3` / the suite RDF libraries rather than rolling your own.

## Development

```bash
npm install
npm run gate   # lint + typecheck + test + build + check:dist
```

The committed `dist/` is a plain `tsc` build (no esbuild inlining — the deps are
all npm-published). `npm run check:dist` fails if the committed `dist/` drifts
from a fresh build of the committed `src/`; rebuild + commit `dist/` alongside
any `src/` change.

## License

MIT © Jesse Wright
