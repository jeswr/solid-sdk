<!-- AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate -->

# @jeswr/federation-client

> **Experimental — AI-agent-generated.** Authored by an AI coding agent (Claude
> Opus 4.8). Under active development; **not production-hardened**. Validate
> against your own data before relying on it.

A typed TypeScript client for the Solid **app-registration / federation
vocabulary** (`fedapp:`) published at
[`https://w3id.org/jeswr/fed#`](https://w3id.org/jeswr/fed) (source:
[`jeswr/solid-federation-vocab`](https://github.com/jeswr/solid-federation-vocab)).

The `fedapp:` vocabulary is the OpenID-Federation-style metadata a Solid app
publishes **in its Client Identifier Document** — describing the data **sectors**
it operates in, the WAC/ACP **access modes** it requests, and the shared **shapes**
it consumes / produces / declares. This SDK reads, validates and builds those
registration documents.

> **Membership is the registry's job, not this SDK's.** `verify()` checks that a
> registration is *well-formed* against the vocabulary. It does **not** assert that
> an app *is a member* of any federation — that requires a signed challenge handled
> by the registry. Never treat a self-asserted registration as a membership claim.

## Install

```sh
npm install @jeswr/federation-client
```

Peer runtime: Node ≥ 24 (a transitive requirement of `@solid/object`), ESM only.

## Surface

Three functions plus a serialiser and the vocabulary constants.

### `verify(input, options?)` — validate a registration

Fetches (Turtle / JSON-LD content-negotiated, via `@jeswr/fetch-rdf`) and
validates an app's registration document against the `fedapp` vocabulary:
exactly one `fedapp:App`, every `fedapp:access` value is a valid `acl:` mode,
every `fedapp:SectorUse` carries a sector and at least one access mode, and the
registration is non-empty.

```ts
import { verify } from "@jeswr/federation-client";

const result = await verify("https://app.example/clientid.jsonld", {
  fetch: authFetch, // optional; defaults to globalThis.fetch
});

if (result.valid) {
  console.log(result.registration?.sectors, result.registration?.access);
} else {
  for (const issue of result.issues) {
    console.warn(issue.code, issue.message, issue.subject);
  }
}
```

Verify an in-hand body without a network round-trip:

```ts
const result = await verify("https://app.example/clientid", {
  body: turtleString,
  bodyContentType: "text/turtle",
});
```

### `list(source, options?)` — discover registrations

Discovers `fedapp:App` registrations from either a **registry resource** (one
document enumerating many apps) or an **LDP app-registry container** (each
`ldp:contains` member fetched + parsed). Each entry is verified.

```ts
import { list } from "@jeswr/federation-client";

// Auto: parse inline Apps; if none, follow ldp:contains members.
const entries = await list("https://registry.example/apps/", { fetch: authFetch });

for (const e of entries) {
  console.log(e.id, e.valid ? "OK" : e.issues.map((i) => i.code));
}
```

`followContainer` is `"auto"` by default (follow members only when the source
declares no inline `fedapp:App`); pass `true` to always follow, `false` to never.

### `selfDescribe(app)` — build a self-description

Builds an app's own `fedapp:App` graph (the
`declaresShape` / `consumes` / `produces` / `sectorUse` graph) for publication in
its Client Identifier Document. Returns the quads and a Turtle serialiser
(`n3.Writer`).

```ts
import { selfDescribe } from "@jeswr/federation-client";

const desc = selfDescribe({
  id: "https://app.example/clientid",
  sectors: ["https://w3id.org/jeswr/sectors/identity"],
  access: ["Read", "Write"],
  declaresShape: ["https://app.example/shapes/Profile#shape"],
  sectorUse: [
    {
      sector: "https://w3id.org/jeswr/sectors/health",
      access: ["Read"],
      consumes: ["https://w3id.org/jeswr/sectors/health#Observation"],
    },
  ],
});

const turtle = await desc.toString(); // text/turtle by default
```

### Vocabulary helpers

```ts
import {
  FEDAPP,                 // "https://w3id.org/jeswr/fed#"
  ACL_MODES,              // { Read, Write, Append, Control } → acl: IRIs
  accessModeName,         // acl: IRI → "Read" | … | undefined
  sectorIri,              // slug → "https://w3id.org/jeswr/sectors/<slug>"
  KNOWN_SECTOR_SLUGS,
  VALID_ACCESS_MODE_IRIS,
} from "@jeswr/federation-client";
```

## RDF discipline

This SDK follows the suite's non-negotiable RDF rules: **parse** with
[`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf), **extract** with
[`@rdfjs/wrapper`](https://www.npmjs.com/package/@rdfjs/wrapper) /
[`@solid/object`](https://www.npmjs.com/package/@solid/object) typed accessors,
**serialise** with `n3.Writer`. There is no bespoke RDF parser, and no
hand-built / hand-concatenated triples — all reads and writes go through the
typed wrappers in [`src/wrappers.ts`](./src/wrappers.ts).

## Linked-Data-API conventions

`verify` and `list` negotiate `text/turtle, application/ld+json;q=0.9` on every
fetch (the `@jeswr/fetch-rdf` default — the two RDF media types the Solid
Protocol requires). `list` follows `ldp:contains` to enumerate an LDP container.

## Development

```sh
npm install
npm run lint        # biome
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # tsc → dist/
```

## License

MIT — Jesse Wright.
