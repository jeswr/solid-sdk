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

## IRI-safety helpers

`n3.Writer` emits an IRI **verbatim** between angle brackets — it does not
escape it. So an IRI value that itself contains a `>` (or a space, `<`, `"`,
`{`, `}`, `|`, `^`, backtick, backslash, or a C0 control) **breaks out of the
brackets and injects arbitrary triples** whenever that value came from untrusted
input (parsed RDF re-read as a string, a JSON/API field, a user-supplied URL, an
HTTP header). A bare `startsWith("http")` / `new URL()` check is **not enough**:

```
http://evil/> <https://evil/s> <https://evil/o> .
```

passes `new URL()` yet still injects. This package exports the **single
canonical, audited** IRI-safety helper set so every `@jeswr` RDF-writing package
consumes one implementation instead of a hand-copied variant. All of them return
the **escaped LEXICAL value** — never `new URL().href` — because RDF identity is
lexical: dropping `:443`, lower-casing the host, or collapsing dot-segments
changes the IRI's identity (a different `NamedNode`) and must never happen
silently to data.

#### `escapeIri(value: string): string`

A **purely lexical** percent-encoder of the full Turtle `IRIREF`-forbidden set:
the whole C0 control range U+0000–U+001F, SPACE, and `< > " { } | ^ ` (backtick)
`\`. It does **no** URL parsing and **no** canonicalisation — it iterates the
string by code point and replaces only those forbidden characters with their
uppercase `%XX` form. It never touches `%` (so there is no double-encoding), and
astral characters and all IRI-legal punctuation pass through byte-for-byte.

#### `safeHttpIri(value: unknown): string | undefined`

The **definitive http(s)-only guard** for untrusted input (the 6-clause contract
distilled from ~40 cumulative adversarial review rounds). It returns `undefined`
unless, in order: `value` is a string; it has no leading/trailing C0-control or
space; the escape-first result parses (`new URL`); its scheme is `http:`/`https:`;
and it has a **non-empty lexical authority** (so authority-less `https:example.com`
and empty-authority `https:///foo` / `http:////foo` / `https://?x` are rejected).
On success it returns the escaped lexical value byte-identical (`:443`, host-case
and dot-segments survive).

#### `safeIri(value: unknown): string | undefined`

The **scheme-agnostic** sibling of `safeHttpIri`: same escape-first +
leading/trailing-control/space rejection, but it accepts **any absolute
`scheme:` IRI** (`urn:`, `did:`, `mailto:`, `http:`, …) and does not require an
authority, returning the escaped lexical value. A schemeless / relative
reference (`/foo`, `foo/bar`, `#frag`) yields `undefined`.

#### `isHttpIri(value: unknown): value is string`

A lexical **safety predicate** (type-narrowing): `true` iff `value` is a string,
an absolute `http:`/`https:` URL, and contains **no** raw `IRIREF`-forbidden
character. It deliberately accepts benign canonicalisation differences (a missing
trailing slash, an upper-case host) — it does **not** require
`value === safeHttpIri(value)`.

### When to use each

| Field | Helper |
|---|---|
| An **http(s)** resource / WebID / URL field from untrusted input | `safeHttpIri(v)` — drop the field when it returns `undefined` |
| A **scheme-agnostic object IRI** (may be `urn:` / `did:` / `mailto:`) | `safeIri(v)` |
| A **subject / id you have already validated** as the right scheme and just need injection-safe | `escapeIri(v)` |
| An **exact-match evaluation** field where lexical identity matters (e.g. comparing a policy target) | reject when `safeHttpIri(v) !== v` |
| A cheap **guard / type-narrow** ("is this already a safe http(s) IRI?") | `isHttpIri(v)` |

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
