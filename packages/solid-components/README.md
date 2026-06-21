# @jeswr/solid-components

> AUTHORED-BY Claude Opus 4.8 — experimental, AI-agent-generated. Part of the
> `@jeswr` Solid app suite. **Under active development.**

Codegen-friendly, framework-agnostic **Solid Web Components** (Lit 3). This package
is the declarative, LLM-codegen-oriented component layer of the suite: an app (or a
code generator) wires up a couple of injectable seams and renders Solid data
without hand-rolling the read plumbing or the SHACL view machinery.

It **complements** [`@jeswr/solid-elements`](https://github.com/jeswr/solid-elements)
(the chrome + auth web components). `solid-elements` owns login + theme + account
chrome; `solid-components` owns the **data** surface (read controller + SHACL view).

## Phase 1 — the foundation (this release)

Two pieces, both READ-ONLY. The write path + an editable form are Phase 2.

### 1. `DataController` — the injectable read seam

The read-path plumbing every suite pod-app hand-rolls, consolidated once. It mirrors
`@jeswr/solid-elements`' `LoginController`: a small dependency-injectable seam plus a
concrete default, so an element / app drives reads through it and a test injects a
mock without standing up a pod.

```ts
import { DataController, NotFoundError, AccessDeniedError } from "@jeswr/solid-components";

const dc = new DataController({
  fetch: session.fetch,        // the user's authenticated (DPoP-bound) fetch
  publicFetch: pristineFetch,  // the credential-free fetch for foreign/public reads
});

// Typed RDF read → an n3 Store, with a conditional GET (ETag).
const { dataset, etag } = await dc.read("https://alice.example/profile/card");

// Re-read conditionally — a 304 short-circuits with no fresh dataset.
const next = await dc.read("https://alice.example/profile/card", { etag });
if (next.notModified) { /* keep the cached dataset */ }

// List an LDP container (ldp:contains children, each flagged isContainer).
const { children } = await dc.listContainer("https://alice.example/c/");

// Foreign / public read uses the credential-free fetch (no token leak cross-origin).
const pub = await dc.read("https://foreign.example/data", { public: true });
```

**Credential boundary (fail-closed).** `{ public: true }` reads use `publicFetch`,
which has **no default and no fallback**: a public read REQUIRES an injected
credential-free fetch and **throws** otherwise — it never silently uses the
authenticated fetch, and never a (possibly auth-patched) `globalThis.fetch`, so the
session's DPoP-bound token can't leak to a foreign origin. Reads parse against the
**final URL after redirects** so relative IRIs (and a trailing-slash container
redirect's children) resolve correctly. `listContainer` takes `ListOptions` (no
`etag`) since a listing always needs the body.

**The 4-class error taxonomy.** Every read resolves OR throws exactly one of these,
so a UI branches on the **class** (`instanceof`) rather than string-matching a status:

| Class | When |
|---|---|
| `NotFoundError` | 404 / 410 — the resource does not exist |
| `AccessDeniedError` | 401 / 403 — auth required or forbidden |
| `NetworkError` | transport failure / abort / any other non-2xx |
| `DataFormatError` | a 2xx body that could not be parsed as RDF |

All four extend `DataControllerError` (`instanceof DataControllerError` catches the
whole taxonomy); each carries the request `url`, the HTTP `status` (when known) and
an upstream `cause`.

**RDF discipline.** Parsing goes through `@jeswr/fetch-rdf`'s `parseRdf` (the suite
canonical parser — never a hand-rolled parser); the container listing reads
`ldp:contains` quads off the parsed n3 `Store` directly (a read-only quad query — no
triple is ever hand-**built**). Serialisation (used by the SHACL view) goes through
`n3.Writer` (`serializeTurtle`).

### 2. `<jeswr-shacl-view>` — a read-only, SSRF-disciplined SHACL view

A Lit element wrapping [`@ulb-darmstadt/shacl-form`](https://github.com/ULB-Darmstadt/shacl-form)
in **view mode**. It renders a SHACL shape + a data graph as a human-readable view.

```ts
import "@jeswr/solid-components"; // registers <jeswr-shacl-view>

const el = document.createElement("jeswr-shacl-view");
el.fetch = session.fetch;        // for trusted+auth sources
el.publicFetch = pristineFetch;  // for trusted+public sources
el.shapes = { kind: "inline", text: shapesTurtle };
el.values = { kind: "trusted", url: resourceUrl, seam: "auth" };
document.body.append(el);
```

A graph source is one of:

- `{ kind: "inline", text }` — Turtle (or JSON-LD) you already hold. **No fetch.**
- `{ kind: "trusted", url, seam: "auth" | "public" }` — a URL the **app** chose;
  fetched with the injected seam (`auth` ⇒ the session fetch, `public` ⇒ the
  credential-free fetch). `seam: "public"` is **fail-closed**: if `.publicFetch` is
  not set, the view errors rather than fall back to the authenticated fetch.
- `{ kind: "remote", url }` — a **user-configured / untrusted** URL; fetched **only**
  through [`@jeswr/guarded-fetch`](https://github.com/jeswr/guarded-fetch) (https-only,
  private/loopback/link-local/metadata blocked, size cap + timeout, no auto-redirect
  across origins with credentials). Loaded by dynamic `import()` so the guard stays
  out of the base bundle. A remote source is fetched **Turtle-only** and a non-Turtle
  body (JSON-LD / RDF-XML) is **rejected** — a JSON-LD `@context` or an RDF-XML import
  could otherwise trigger a second, *unguarded* network fetch inside the parser.

#### §9 SSRF discipline (load-bearing — the whole reason this wrapper exists)

`@ulb-darmstadt/shacl-form` can fetch its shapes/data itself from `data-shapes-url` /
`data-values-url` attributes (and can follow `owl:imports` to fetch remote
ontologies). That fetch is a **bare, unguarded `fetch`** on whatever origin the URL
names — an SSRF surface. This wrapper refuses to expose it:

- it **NEVER** sets `data-shapes-url` / `data-values-url` (or any `*-url` attribute);
- it **ALWAYS** sets `data-ignore-owl-imports` (no remote-ontology fetch);
- it **ALWAYS** sets `data-view` (forces shacl-form's read-only view mode);
- it **pre-fetches** the shape + data itself — through the auth seam for trusted URLs
  and through `@jeswr/guarded-fetch` for remote URLs — re-serialises to Turtle, and
  hands shacl-form **inline** `data-shapes` / `data-values` strings;
- a defence-in-depth `updated()` hook strips any `*-url` dataset key off the inner
  `<shacl-form>` after every render;
- untrusted RDF literals reach the DOM only as shacl-form's text content; this
  element's own error display uses escaped Lit text interpolation, never `innerHTML`.

**shacl-form has a SECOND fetch path `data-ignore-owl-imports` does NOT cover** —
its `loadGraphs()` auto-derives a values subject from the **data** graph (any
subject with `dct:conformsTo`) and, when the loaded **shapes** graph is **empty**,
issues an **unguarded** `fetch` to every http(s) IRI that subject points at via
`rdf:type` / `dct:conformsTo` (including prefix-expanded IRIs). The wrapper closes
it with three independent measures:

- **fail-closed on an empty shapes graph** — a shapes graph that parses to zero
  triples is refused and **no `<shacl-form>` is mounted** (removes the
  empty-shapes precondition);
- **neutralises the untrusted data graph** — drops every `rdf:type` /
  `dct:conformsTo` quad whose object is an http(s) IRI before inlining (removes the
  import targets **and** the `dct:conformsTo` auto-derivation source);
- it therefore does **not** auto-derive a fetchable subject; it deliberately does
  not pin a foreign `data-values-subject` sentinel, which would blank the view.

**No-network RDF types only, in every mode.** A JSON-LD / RDF-XML body is **refused**
for `inline`, `trusted` **and** `remote` sources — only Turtle / N-Triples /
N-Quads / TriG are accepted. The canonical parser's JSON-LD path
(`jsonld-streaming-parser`) uses a default `FetchDocumentLoader` that resolves a
remote `@context` IRI through an **unguarded** `fetch`, so JSON-LD is never parsed
here regardless of how trusted the URL is.

Tests assert no `*-url` attribute is ever set on the inner `<shacl-form>`, that no
un-guarded fetch leaves the wrapper for a remote source, and — calling shacl-form's
**real** `loadGraphs()` — that a hostile data graph fires the auto-import fetch on
raw input but **zero** fetches after neutralisation, plus that an empty shapes
graph fails closed.

## Installation — GitHub-installable now (buildless, `ignore-scripts=true`)

```sh
npm install github:jeswr/solid-components#main
```

The committed `dist/` is **self-contained**: `@ulb-darmstadt/shacl-form` + `n3` +
`shacl-engine` (+ shacl-form's required peers `@ro-kit/ui-widgets`, `uuid`) + the
canonical `@jeswr/fetch-rdf` parser + `lit` are **esbuild-inlined** into it, so the
package imports with no build step under the suite's `ignore-scripts=true` invariant.
The optional shacl-form widget peers (`jsonld`, `rdfxml-streaming-parser`, `leaflet`)
are deliberately **stubbed out** of the base — the view always passes inline Turtle,
so their code paths are unreachable. `@jeswr/guarded-fetch` is an optional peer loaded
by dynamic import only for a `remote` source.

npm publish is a deferred migration; consume via the GitHub install for now.

## API

```ts
// Data read seam
export class DataController { /* read, listContainer, fetch, publicFetch */ }
export interface DataSeam { fetch?; publicFetch? }
export interface ReadOptions { public?; etag?; signal?; headers? }
export type ListOptions = Omit<ReadOptions, "etag"> // listing always needs the body
export interface ReadResult { url; dataset?; etag?; notModified } // url = FINAL (post-redirect)
export interface ContainerChild { url; isContainer }
export interface ContainerListing { url; children; etag?; dataset }

// Error taxonomy
export abstract class DataControllerError extends Error { url; status? }
export class NotFoundError / AccessDeniedError / NetworkError / DataFormatError
export function classifyReadError(url, error, hints?): DataControllerError

// SHACL view element + its sources
export class JeswrShaclView extends LitElement // <jeswr-shacl-view>
export type GraphSource = inline | trusted | remote   // Turtle/N-Triples/N-Quads/TriG only
export interface FetchSeam { fetch; publicFetch }
export interface ResolveOptions { signal?; loadGuardedFetch?; maxBytes?; timeoutMs? }
export async function resolveGraphToTurtle(source, seam, options?): Promise<string>
// §9 SSRF helpers (also used internally by the element):
export async function neutraliseValuesTurtle(turtle): Promise<string> // drop rdf:type/conformsTo→http(s)
export async function countTurtleQuads(turtle): Promise<number>       // 0 ⇒ fail-closed on shapes
export const VALUES_SUBJECT_SENTINEL: string                          // for an empty/placeholder view

// Serialiser (n3.Writer-based)
export function serializeTurtle(quads): Promise<string>
```

A `./react` subexport is a **Phase-1 placeholder** that re-exports the element class
+ the `DataController` (both usable from React today); typed `@lit/react` wrappers
land alongside the first per-class components in a later phase.

## Development

```sh
npm run lint        # Biome
npm run typecheck   # tsc --noEmit
npm test            # vitest (incl. the packaged-dist smoke test + the §9 no-url test)
npm run build       # esbuild bundle + inline → dist/, tsc → .d.ts
npm run check:dist  # fails if committed dist/ drifts from a fresh build
npm run gate        # all of the above
```

`dist/` is **committed** (not gitignored) — the GitHub-installable contract. Rebuild
+ commit `dist/` alongside any `src/` change; `check:dist` guards the drift.

## Out of scope (Phase 1)

Explicitly **not** in this foundation (deferred to later phases):

- The Custom Elements Manifest / analyzer plugin — reused from the in-flight
  `@jeswr/solid-elements` Phase 0, not re-set-up here (no divergent CEM).
- The **write path** / editable SHACL form (Phase 2).
- Per-class components beyond the one read-only view above.

## Follow-ups / notes

- **`@jeswr/fetch-rdf` published-type lag.** The published `@jeswr/fetch-rdf@0.1.0`
  types `parseRdf(body: string)` returning `DatasetCore` (its README/types lag the
  source, which accepts a stream + returns an n3 `Store`). `src/rdf.ts` normalises
  this once: it materialises a stream body to text and constructs a real n3 `Store`
  from the parsed dataset. Candidate for an upstream type fix (`jeswr/fetch-rdf`).

- **UPSTREAM (`@ulb-darmstadt/shacl-form`): `data-ignore-owl-imports` does NOT
  cover the `dct:conformsTo` / `rdf:type` auto-import.** `shacl-form`'s
  `loadGraphs()` auto-derives a values subject from the **data** graph
  (`findConformsToValuesSubject`) and, when the loaded **shapes** graph is empty
  (`countQuads(loadedShapes) === 0`), fetches that subject's `rdf:type` /
  `dct:conformsTo` http(s) IRIs with a **bare, unguarded `fetch`** — even with
  `data-ignore-owl-imports` set (that flag only guards the `owl:imports` predicate
  in `importRDF`, a different code path). This is execution-proven by our
  `loadGraphs` test (raw hostile graph → real fetches to `169.254.169.254` /
  `192.168.x`; neutralised graph → zero). We mitigate it locally (fail-closed on
  empty shapes + neutralise the data graph); the durable fix is upstream: the
  auto-import should be gated behind `loadOwlImports` (or its own opt-in flag) and
  should not run against an untrusted data graph by default. **A real upstream gap
  to file** against `@ulb-darmstadt/shacl-form`.

- **`@jeswr/fetch-rdf`'s JSON-LD parse path is not SSRF-safe.** `parseRdf` builds
  `jsonld-streaming-parser` with no `documentLoader`, so a remote `@context` IRI in
  a JSON-LD body is resolved via the default `FetchDocumentLoader` (an unguarded
  `globalThis.fetch`). This wrapper therefore refuses JSON-LD/RDF-XML for **all**
  source kinds (Turtle-only). The durable fix is an SSRF-safe `documentLoader`
  option on `parseRdf` upstream (`jeswr/fetch-rdf`) — at which point `trusted`
  JSON-LD could be re-enabled here.

## License

MIT
