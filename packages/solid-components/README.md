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

## Phase 1 — read components + binding + CEM

The read layer. (The **write path + editable forms** are Phase 2 — see the
[Phase 2 section](#phase-2--the-write-path--editable-forms) below: `DataWriter`,
`<jeswr-shacl-form>`, and the per-class `*-form` elements.)

This layer adds, on top of the foundation (`DataController` + `<jeswr-shacl-view>`):

- **Per-class read elements**, each binding a data model through the `DataController`
  and the model's typed accessors: `<jeswr-task-list>` (`wf:Task`),
  `<jeswr-contact-list>` (`vcard:Individual`), `<jeswr-profile-card>` (a WebID profile,
  via `@solid/object`'s `Agent`), `<jeswr-bookmark-list>` (`book:Bookmark`), and
  `<jeswr-collection>` (a generic LDP container listing + a type-index labelling seam).
- **`<solid-view>`** — the composition element: point it at a resource, it reads the
  `rdf:type`, resolves the matching element, and mounts it.
- **`resolveComponent` + a committed static resolver map** (`targetClass → element`),
  consistent with the generated Custom Elements Manifest.
- **The Custom Elements Manifest pipeline** (`custom-elements.json` + a `check:manifest`
  gate), reused from `@jeswr/solid-elements` Phase 0, with the suite `@solid-*` JSDoc
  binding tags on each element so the manifest is an accurate codegen contract.

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

### 3. Per-class read elements

Each element is driven by a `src` URL + the injectable fetch seam (or a pre-parsed
`store` for the no-network / codegen / test path), reads through the `DataController`,
and renders the model's **typed accessors**. The only direct quad read in any of them
is the `rdf:type` subject scan (which subjects are of the bound class) — every field is
read through the data model's wrapper; no triple is ever hand-built.

```ts
import "@jeswr/solid-components"; // registers all elements

const tasks = document.createElement("jeswr-task-list");
tasks.fetch = session.fetch;
tasks.src = "https://alice.example/tasks/";   // lists every wf:Task in the graph
document.body.append(tasks);

// …or render a graph you already hold, with no fetch:
const card = document.createElement("jeswr-profile-card");
card.src = "https://alice.example/profile/card#me";
card.store = alreadyParsedStore;              // the codegen/test seam
```

| Element | Binds | Model | Renders |
|---|---|---|---|
| `<jeswr-task-list>` | `wf:Task` | `@jeswr/solid-task-model` `Task` | title, open/closed state, assignee, priority, due date |
| `<jeswr-contact-list>` | `vcard:Individual` | `@jeswr/solid-task-model/contacts` `Contact` | name, org, emails (`mailto:`), phones (`tel:`), WebID, note |
| `<jeswr-profile-card>` | a WebID profile | `@solid/object` `Agent` | name, photo, org/role, homepage, WebID, OIDC issuer (one, not a list) |
| `<jeswr-bookmark-list>` | `book:Bookmark` | `@jeswr/solid-bookmark` `Bookmark` | title→url link, description, tags, archived |
| `<jeswr-message-list>` | `as:Note` | `@jeswr/solid-chat-interop` `CanonicalMessage` | author (WebID), body (escaped text), timestamp, reply edge — sorted chronologically |
| `<jeswr-collection>` | `ldp:Container` | `DataController.listContainer` | the `ldp:contains` children (+ a type-index label seam) |

Each element renders into the **light DOM** (so an app can `::part`-style its output)
and exposes `idle` / `loading` / `ready` / `error` slots + parts. Untrusted literals
reach the DOM only through escaped Lit text interpolation; every IRI bound to an `href`
/ `src` is http(s)-filtered (a `javascript:`/`data:` url is dropped or rendered as
text). The bookmark list drops a bookmark whose `schema:url` is not http(s) (matching
the model's `parseBookmark`); the profile card reads `@solid/object`'s `Agent`
accessors defensively (a single malformed field never aborts the card — the suite's
"drop the field, never abort" rule, with a tolerant graph fallback for fields whose
predicate/term-type the Agent's pinned accessor does not match).

`<jeswr-message-list>` LISTS A CONTAINER: a chat is normally an LDP container whose
messages are **separate resources** linked by `ldp:contains` (the suite's pod-chat
per-resource layout), so the element walks the container — it lists the children (via
`DataController.listContainer`, exactly how `<jeswr-collection>` walks a container),
fetches each child through the **same credential seam** (concurrency-bounded; a
failed/denied child is **dropped**, never aborting the list), parses each child's
`as:Note` via the model's `parseAs2Message`, and merges them sorted by `published`. It
**also** renders the **inline** single-document case (every `as:Note` in one doc — a
thread document or a single message resource). (It carries no `@solid-shape`: the
chat-interop SHACL shape is an anonymous `sh:NodeShape` with `sh:targetClass as:Note`,
so there is no canonical shape IRI to advertise — the `@solid-class` target class is
the resolver binding key.)

### 4. `<solid-view>` — the composition element + `resolveComponent`

Point `<solid-view>` at a resource and it picks the right element for you: it reads the
resource's `rdf:type` (`collectTypes` — a direct `rdf:type` scan), consults the
committed `resolveComponent` static map, lazy-imports + mounts the matching element, and
forwards the fetch seam + `src`. An untyped LDP container falls back to
`<jeswr-collection>`; an unbound type shows a neutral "no typed view" state.

```ts
import "@jeswr/solid-components";

const v = document.createElement("solid-view");
v.fetch = session.fetch;
v.src = "https://alice.example/contacts/";   // probes rdf:type → mounts <jeswr-contact-list>
document.body.append(v);

// Pinned class IRI skips the network probe (the "I already know the class" path):
v.classIri = "http://www.w3.org/2005/01/wf/flow#Task";
```

The **selection logic is extracted from Pod-Manager's** `selectTypedViewer`
(`src/lib/typed-views/select.ts`), thinned over a static map: among the entries whose
`targetClass` is in the resource's type set, take the highest `priority`; ties break by
earliest registration; no match ⇒ `undefined` (the caller falls back). `<solid-view>`
is a thin driver over this one resolver — it does **not** stand up a parallel
typed-views registry.

`resolveComponent(types, { mode })` and `resolveComponentForClass(classIri, { mode })`
are exported for direct use (codegen). `RESOLVER_ENTRIES` is the committed
`{ targetClass, tagName, importSpec, mode, priority }` map — the **runtime source of
truth** (zero network). The optional `solidcomp:` RDF projection of the map is deferred.

### 5. The Custom Elements Manifest — the codegen contract

`custom-elements.json` is **committed** (like `dist/`) so an LLM codegen tool can read
the element ↔ RDF-class binding straight from a GitHub install with no build step. It is
generated by `@custom-elements-manifest/analyzer` with the **reused** `@jeswr/solid-elements`
Phase-0 `solidBindingPlugin` (no divergent CEM setup): the plugin lifts the suite
`@solid-class` / `@solid-mode` / `@solid-cardinality` JSDoc tags off each element into a
`solid` block, strips Lit `state: true` internal props, and excludes `export type`
re-exports from the `kind: js` export list. A `check:manifest` gate (mirroring
`check:dist`) fails if the committed manifest drifts from a fresh run, and a test asserts
the manifest's `@solid-class` edges agree with `RESOLVER_ENTRIES` and that every
`kind: js` export is a real `dist` runtime export.

## Phase 2 — the write path + editable forms

Phase 2 adds the **write** surface, with the same dependency-injectable seam +
fail-closed discipline as the read path:

### `DataWriter` — the injectable write seam (conditional + scope-guarded)

```ts
import { DataWriter } from "@jeswr/solid-components";

const dw = new DataWriter({
  fetch: session.fetch,                 // the OWN-ORIGIN authenticated fetch (no public write)
  base: "https://alice.example/tasks/", // the scope guard: every write must stay under this
});

// §10 MERGE-NOT-REPLACE save: load the existing graph (keep its ETag) → apply the
// delta through the model's typed accessors → conditional If-Match PUT of the MERGED
// graph. Never a naive toRDF()→PUT (which would drop untouched triples + break the
// dual-predicate contract).
await dw.saveMerged(resourceUrl, (existingGraph, url) => {
  // apply the edited values via the model's TYPED setters on the loaded graph …
});
```

Three load-bearing invariants:

- **Conditional writes (the lost-update guard).** An update of an existing,
  ETag-bearing resource is a conditional `If-Match: <etag>` PUT — never an
  unconditional overwrite. `DataWriter` **refuses** an unconditional overwrite of an
  existing resource (`UnconditionalOverwriteError`, fail-closed). A 404 pre-read → a
  create-only `If-None-Match: "*"` write. A 412/409/428 → `WriteConflictError`.
- **§10 merge-not-replace (the correctness invariant).** `saveMerged` loads the
  existing resource graph, applies the form's delta through the **model's typed
  accessors**, preserves every untouched triple, then conditionally PUTs. So editing
  one field never drops an unrelated triple, and the dual-predicate federation compat
  (a task writes BOTH `wf:description` + `dct:description`) is preserved.
- **Scope guard (fail-closed, before any fetch).** A write outside the configured
  base — a different origin, a path-escape (a sibling-prefix trick), a non-http(s)
  scheme, or embedded credentials — throws a `WriteScopeError` before any network.

### `<jeswr-shacl-form>` — the editable SHACL form

The write-path sibling of `<jeswr-shacl-view>`. It wraps the SAME
`@ulb-darmstadt/shacl-form` in **edit mode** (the only difference from the view: no
`data-view`), and **reuses the EXACT §9 SSRF hardening** — both elements call ONE
shared `resolveAndHarden` pipeline (empty-shapes fail-close + values-graph
neutralisation + no-network-RDF-types-only + no `*-url` attr), so the edit form can
never drift from the view's guarantees. Its `save()` reads the edited graph from
shacl-form's `toRDF()` and delegates the actual write to a `mergeSave` callback (the
§10 merge); it surfaces an optimistic saving/saved/error state and reverts on
failure. **Client SHACL validation is advisory** (UX, not authz — the server's WAC +
SHACL are authoritative): a failing validation warns but never blocks the save.

### Per-class editable forms

```ts
const el = document.createElement("jeswr-task-form");
el.fetch = session.fetch;
el.src = "https://alice.example/tasks/1";   // the resource to edit
document.body.append(el);
await el.save();                            // §10 conditional merge write
```

`<jeswr-task-form>` (`wf:Task`), `<jeswr-contact-form>` (`vcard:Individual`) and
`<jeswr-bookmark-form>` (`book:Bookmark`) each render the editable form bound to their
model's shape + the resource at `src`, and wire the §10 merge through the model's
typed setters. They carry `@solid-mode edit` in the manifest and add `mode: "edit"`
entries to `resolveComponent`, so `resolveComponent(types, { mode: "edit" })` selects
the form for a class. **Filter-on-write**: a security-surface IRI (a bookmark `url`, a
task `assignee` WebID) is dropped if it is not http(s) before the typed setter — the
model setters do not filter, and client SHACL is advisory, so this code-level filter
is the real guard.

## Installation — GitHub-installable now (buildless, `ignore-scripts=true`)

```sh
npm install github:jeswr/solid-components#main
```

The committed `dist/` is **self-contained**: `@ulb-darmstadt/shacl-form` + `n3` +
`shacl-engine` (+ shacl-form's required peers `@ro-kit/ui-widgets`, `uuid`) + the
canonical `@jeswr/fetch-rdf` parser + `lit` + the data-model bindings
(`@jeswr/solid-task-model`, `@jeswr/solid-bookmark`, `@solid/object`, `@rdfjs/wrapper`)
are **esbuild-inlined** into it, so the package imports with no build step under the
suite's `ignore-scripts=true` invariant — a consumer installs NO data-model dep by hand.
The optional shacl-form widget peers (`jsonld`, `rdfxml-streaming-parser`, `leaflet`)
are deliberately **stubbed out** of the base — the view always passes inline Turtle,
so their code paths are unreachable. `@jeswr/guarded-fetch` is an optional peer loaded
by dynamic import only for a `remote` source. A `packaged-dist` smoke test proves the
committed artifact imports + registers every element with only those allowed externals.

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

// §9 shared resolve+harden pipeline (the view AND the edit form call it)
export async function resolveAndHarden(shapes, values, seam, options?): Promise<HardenedGraphs>
export type HardenedGraphs = { kind: "ready"; shapesTurtle; valuesTurtle } | { kind: "empty-shapes"; message } | { kind: "error"; message }

// Phase-2 write seam (conditional + §10 merge-not-replace + scope-guarded)
export class DataWriter { /* saveMerged, putTurtle, delete; base scope guard */ }
export interface WriteSeam { fetch?; base? }                 // OWN-ORIGIN authed fetch only (no public write)
export type ShapedNodeMutator = (graph, url) => MutatorResult | Promise<MutatorResult>
export interface ConditionalWriteOptions { ifMatch?; ifNoneMatch?; signal?; headers? }
export interface SaveMergedOptions { signal?; createIfAbsent? }
export interface WriteResult { url; etag? }
export type SaveStatus = "idle" | "saving" | "saved" | "error"
export class WriteScopeError / UnconditionalOverwriteError / WriteConflictError / WriteFailedError

// Phase-2 editable elements
export class JeswrShaclForm   extends LitElement // <jeswr-shacl-form> editable (mergeSave callback)
export type MergeSaveCallback = (formGraph) => Promise<void>
export class JeswrTaskForm    extends LitElement // <jeswr-task-form>    wf:Task          (mode edit)
export class JeswrContactForm extends LitElement // <jeswr-contact-form> vcard:Individual (mode edit)
export class JeswrBookmarkForm extends LitElement // <jeswr-bookmark-form> book:Bookmark   (mode edit)
export class AbstractFormElement extends LitElement // the shared editable-form base

// Per-class read elements (light-DOM Lit; src | store + the fetch seam)
export class JeswrTaskList     extends LitElement // <jeswr-task-list>     wf:Task
export class JeswrContactList  extends LitElement // <jeswr-contact-list>  vcard:Individual
export class JeswrProfileCard  extends LitElement // <jeswr-profile-card>  a WebID profile
export class JeswrBookmarkList extends LitElement // <jeswr-bookmark-list> book:Bookmark
export class JeswrCollection   extends LitElement // <jeswr-collection>    ldp:Container (+ typeIndex seam)
export interface TypeIndexEntry { class; instanceContainer }
export class AbstractReadElement extends LitElement // the shared read-element base
export function safeHref / safeMailto / safeTel / stripScheme / formatDate // DOM-boundary helpers

// Composition + resolver
export class SolidView extends LitElement // <solid-view> (src | class-iri + the seam)
export const RESOLVER_ENTRIES: readonly ComponentEntry[] // the committed static map
export interface ComponentEntry { targetClass; tagName; importSpec; mode; priority }
export type ComponentMode = "view" | "edit"
export function resolveComponent(types, { mode? }): ComponentEntry | undefined
export function resolveComponentForClass(classIri, { mode? }): ComponentEntry | undefined
export function collectTypes(dataset, subject?): Set<string> // the rdf:type scan
// The bound class IRIs (resolver-map keys):
export const TASK_CLASS / VCARD_INDIVIDUAL / VCARD_ADDRESS_BOOK / BOOKMARK_CLASS / LDP_CONTAINER / …
```

A `./react` subexport currently re-exports the element classes + the `DataController`
(all usable from React today via a ref / `createComponent`); the auto-generated
`@lit/react` wrappers are a follow-up.

## Development

```sh
npm run lint           # Biome
npm run typecheck      # tsc --noEmit
npm test               # vitest (incl. the packaged-dist smoke + CEM-accuracy + §9 tests)
npm run build          # esbuild bundle + inline → dist/, tsc → .d.ts
npm run check:dist     # fails if committed dist/ drifts from a fresh build
npm run manifest       # regenerate custom-elements.json
npm run check:manifest # fails if the committed manifest drifts from a fresh run
npm run gate           # all of the above
```

`dist/` **and** `custom-elements.json` are **committed** (not gitignored) — the
GitHub-installable + codegen-contract artifacts. Rebuild + regenerate + commit both
alongside any `src/` change; `check:dist` / `check:manifest` guard the drift.

## Out of scope (this phase)

Explicitly **not** in this release (deferred to later phases / separate beads):

- A **richer per-class editor** — the Phase-2 forms edit the core shape-covered fields
  (and the contact form edits the flat string fields, preserving the structured
  email/phone nodes untouched); a full email/phone/relationship editor + a task
  state/tracker editor are documented follow-ups.
- **A multi-level / recursive container walk for `<jeswr-message-list>`** — the walk is
  one level deep (the container's direct `ldp:contains` message resources, capped); a
  nested sub-container is listed but NOT recursed into (recursing unbounded is a
  resource-exhaustion surface). A consumer windows a large room by pointing `src` at a
  sub-container (the pod-chat per-day/-month layout). Deeper paging is a follow-up.
- **`create-solid-app` integration** — wiring these elements into the scaffolder's
  template is a follow-up.
- **Auto-generated `@lit/react` wrappers** from the CEM (the `./react` subexport
  currently re-exports the element classes for manual `createComponent`).
- The **`solidcomp:` RDF projection** of the resolver map (the committed static map is
  the runtime source of truth; the RDF projection is optional/deferred).

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

- **UPSTREAM (`@solid/object`): `Agent` accessors pin a fixed term type + predicate.**
  `Agent.organization` / `role` / `title` read their `vcard:*` predicate as a
  **NamedNode** and throw `TermTypeError` when a pod stores the value as a **string
  literal** (a common, valid shape); `photoUrl` reads ONLY `vcard:hasPhoto` (not
  `foaf:img` / `foaf:depiction` / `schema:image`), and `website`/`homepage` read a
  **literal** where many pods store an IRI. `<jeswr-profile-card>` works around this with
  a `tryRead` guard (drop the field, don't abort) + a tolerant graph fallback that
  accepts either a literal or a NamedNode across the common image/homepage/name/org
  predicates. The durable fix is upstream: the `Agent` accessors should tolerate either
  term type and cover the common predicate synonyms. **A candidate `@solid/object` PR.**

- **`@jeswr/fetch-rdf`'s JSON-LD parse path is not SSRF-safe.** `parseRdf` builds
  `jsonld-streaming-parser` with no `documentLoader`, so a remote `@context` IRI in
  a JSON-LD body is resolved via the default `FetchDocumentLoader` (an unguarded
  `globalThis.fetch`). This wrapper therefore refuses JSON-LD/RDF-XML for **all**
  source kinds (Turtle-only). The durable fix is an SSRF-safe `documentLoader`
  option on `parseRdf` upstream (`jeswr/fetch-rdf`) — at which point `trusted`
  JSON-LD could be re-enabled here.

## License

MIT
