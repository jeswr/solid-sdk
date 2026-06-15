# Pod Docs

> ⚠️ Experimental — AI-agent-generated (Claude Opus 4.8, @jeswr PSS agent); under active development, not production-hardened.

The typed RDF **data layer** for rich-text documents — with full provenance history —
stored in a [Solid](https://solidproject.org) pod. One concrete app in the `@jeswr`
Solid suite (ADR-0013: every app built in parallel), federation-registry-ready via the
[`fedapp:`](https://w3id.org/jeswr/fed) vocabulary.

This package is the **non-throwaway core**: a typed model over quads, read/write/list against
a Solid pod, type-index registration, and a `clientid.jsonld` that declares the app's
federation metadata. A framework-agnostic **read-only React view** ships as the optional
[`@jeswr/pod-docs/ui`](#optional-react-view-pod-docsui) export; the full editor UI is a
deliberate follow-up (see below).

## What it does

- **A typed document model** (`src/document.ts`). A Pod-Docs document is one pod resource,
  subject `<resource>#it`, typed `pd:Document` (`https://w3id.org/jeswr/pod-docs#Document`):
  `dct:title`, `dct:created` / `dct:modified`, `dct:creator`, and a `pd:body` + `pd:format`
  rich-text body. The body format (`text/html`, `text/markdown`, …) is opaque to this layer —
  the **editor engine** that interprets it is a separate ADR.
- **Provenance history** (W3C PROV-O). Each save materialises a new `prov:Entity` revision
  (`<resource>#rev-<n>`) that `prov:wasRevisionOf` its predecessor, carrying the body+format
  snapshot, `prov:generatedAtTime` and `prov:wasAttributedTo`. The document points at the head
  via `pd:currentRevision`; the whole chain lives in the one resource and is reconstructed
  head-first (with a cycle guard against malformed/hostile data).
- **Pod CRUD + discovery** (`src/store.ts`). One resource per document under `pod-docs/`, the
  container registered in the user's **Type Index** (`solid:instanceContainer`) for cross-app
  discovery (e.g. a Pod Manager's "My data"). Every caller-supplied URL is scope-guarded (a
  confused-deputy defence) and writes are conditional (`If-Match` / `If-None-Match`) so a
  concurrent edit fails loudly instead of clobbering.
- **Federation metadata** (`clientid.jsonld`). The Client Identifier Document publishes the
  `fedapp:` block — `fedapp:App` over the `documents` sector, `fedapp:produces` /
  `fedapp:consumes` the Pod-Docs document class, declaring the app's WAC access footprint —
  so a federation registry can reason about it.

### RDF discipline

All RDF goes through the suite's sanctioned libraries — **never a bespoke parser**:

- [`@jeswr/fetch-rdf`](https://github.com/jeswr/fetch-rdf) to GET + parse (force-revalidated),
- [`@solid/object`](https://github.com/o-development/solid-object) (`ContainerDataset`) to read
  container listings,
- [`@rdfjs/wrapper`](https://github.com/rdfjs/wrapper) typed accessors to extract + build
  (never hand-built quads),
- `n3.Writer` to serialise.

## Install / use

```sh
npm install   # ignore-scripts=true (supply-chain hardening); see .npmrc
npm run gate  # lint + typecheck + coverage (100% lines/stmts/funcs) + build
```

```ts
import { createDocsStore } from "@jeswr/pod-docs";

// In production pass NO fetchImpl — @solid/reactive-authentication patches the
// global fetch, so auth is automatic. Tests inject a fetch.
const store = createDocsStore({ podRoot: "https://alice.pod/", webId });

const { url } = await store.create({ title: "My notes", body: "<p>hello</p>" });
const doc = await store.read(url);                       // { url, etag, data }
await store.save(url, { ...doc!.data, body: "<p>edited</p>",
  priorRevisions: doc!.data.revisions }, doc!.etag);     // appends a prov revision
const all = await store.list();
```

## Optional React view (`@jeswr/pod-docs/ui`)

A **framework-agnostic React** document browser, sitting on top of the data layer. React is an
*optional peer* dependency, so a data-layer-only consumer never pulls it in. It renders only —
all data flows through the data layer (`DocsStore`) — and takes the authenticated `fetch` as an
**injected seam** (omit it and the global fetch that `@solid/reactive-authentication` patches in a
real session is used; the interactive-login wiring is `create-solid-app`-gated). Document bodies
are rendered as **escaped text** (never injected HTML) — the editor *engine* that interprets
`pd:body` for a given format is a separate ADR.

```tsx
import { DocumentBrowser } from "@jeswr/pod-docs/ui";

// In production pass NO fetch — the auth-patched global runs. Tests inject one.
<DocumentBrowser podRoot="https://alice.pod/" webId={webId} />;
```

It lists the documents in the pod's `pod-docs/` container (title + modified), opens any document
read-only (title, format, author, modified, body), and surfaces loading / empty / error /
access-denied (401 login vs 403 permission) states. The `useDocsListing` hook is exported for a
custom view. The lower-level write/edit surface (the editor) is a follow-up.

## Tracked follow-ups

These are the deliberate next steps for Pod Docs — tracked, not bundled into this core:

- **Next.js app shell via `create-solid-app`.** The read-only document browser already ships as
  `@jeswr/pod-docs/ui`; the surrounding app shell (interactive login + the rich-text **editor**
  surface) is built on `create-solid-app` once it lands. This package stays the headless data
  layer + the optional render-only view.
- **Cross-server E2E matrix.** A Playwright matrix exercising the data layer against every
  well-known Solid server — including **prod-solid-server with passkey AND username/password**,
  CSS (WAC + ACP), ESS and NSS — to ratchet real-server behaviour.
- **Coverage-ratchet gate.** Extend the unit coverage gate (here, 100% lines/statements/
  functions) into a CI ratchet that also tracks the cross-server matrix pass rate, so behaviour
  on every server only ever improves.
- **Editor-engine ADR** and a **sector-vocab ADR.** The rich-text editor engine (CRDT / OT /
  plain) that interprets `pd:body` is out of scope for the data layer; and the `documents`
  sector IRI under `https://w3id.org/jeswr/sectors/` is referenced ahead of that namespace
  being frozen.

## License

MIT.

---

_Authored by Claude Opus 4.8 (the `@jeswr` PSS agent). Provenance is tracked for re-review /
upgrade when Fable returns._
