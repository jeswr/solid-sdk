# Pod Drive

> ⚠️ Experimental — AI-agent-generated (Claude Opus 4.8, @jeswr PSS agent); under active
> development, not production-hardened.

A file/folder browser for [Solid](https://solidproject.org) pods — browse, read, and organise the
LDP containers and binary resources in your pod the way you would a cloud drive, with the pod (not
a vendor) as the source of truth.

This repository ships the **non-throwaway data-layer core** (a typed RDF model over LDP containers +
binary resources, built to a high quality bar — 100 % unit-test coverage) **plus a
framework-agnostic React file-browser view** (`@jeswr/pod-drive/ui`) on top of it. The view lists a
container's folders + files with name / kind / size / modified, navigates into sub-containers via a
breadcrumb, and renders empty / loading / error / access-denied states. The full Next.js app shell
(login + pages, scaffolded via `create-solid-app`), the cross-server end-to-end matrix, and the
coverage ratchet against every well-known server remain deliberate, tracked follow-ups (see
[Roadmap](#roadmap)).

## What the data layer does

`@jeswr/pod-drive` (the package in `src/`) is a pure, auth-agnostic data layer:

- **Read** a pod's containers and their children as a typed model — `listContainer(url)` returns a
  `DriveContainer` whose `entries` are folder-first, name-sorted `DriveResource`s, each exposing
  `size` (`posix:size`), `modifiedAt` (`dcterms:modified`, falling back to a `posix:mtime`
  epoch), `contentType` (`dcterms:format`), `isContainer`, and `name`.
- **WAC-aware**: a `401`/`403` from the pod is surfaced as a typed `DriveAccessError` (prompt
  login / show "no access") rather than a raw fetch error; a `404` is re-thrown unchanged so the
  caller can create the resource.
- **Type-index integration** for discovery: `findDriveRoots(index)` reads the user's drive-root
  containers from a fetched type index, and `buildDriveRootRegistration(...)` /
  `buildDriveRootMarker(...)` produce the quads to register the app's primary class
  (`poddrive:DriveRoot`) so peers can find a user's drives without guessing paths.
- **Writes** are serialised with `n3.Writer` (`quadsToTurtle`) — the HTTP `PUT`/`PATCH` (with
  `If-Match: <etag>`) is the UI layer's job, keeping this module trivially testable.

### Library invariants (suite house rules)

- The RDF stack is **`@jeswr/fetch-rdf`** (fetch + parse) → **`@solid/object`** / **`@rdfjs/wrapper`**
  (typed accessors) → **`n3.Writer`** (serialise). There is **no bespoke RDF parser** and triples
  are **never hand-concatenated** — every quad goes through the n3 `DataFactory` and every read
  through a typed accessor.
- The model **builds on `@solid/object`'s `Resource` / `Container` / `ContainerDataset`** rather
  than reinventing container reading, extending them only for the Pod-Drive-specific reads
  (`dcterms:format` content type, a `posix:mtime` integer fallback, `poddrive:DriveRoot`).
- The data layer never imports an auth library: pass the authenticated `fetch` (e.g. the one
  `@solid/reactive-authentication` patches onto `globalThis.fetch`) into `listContainer`, or omit
  it to use the ambient global. The layer is issuer-agnostic.

## What the view does (`@jeswr/pod-drive/ui`)

`@jeswr/pod-drive/ui` is an OPTIONAL, React-only surface on top of the data-layer core. React is a
**peer dependency**, so a data-layer-only consumer never pulls it in.

- **`<FileBrowser rootUrl fetch? title? />`** — a framework-agnostic React component (no Next.js
  import) that renders a container as a cloud-drive listing: folders first then files, each with
  name / kind / size / modified; click a folder to descend, a breadcrumb to climb back. It renders
  only and never touches RDF or `fetch` directly — all data flows through `useDriveListing`, which
  calls `listContainer`. Styling is via plain `pod-drive-*` class names so the host app's CSS owns
  the look. It drops straight into the `create-solid-app` Next.js shell's `components/` (like the
  template's `ProfileCard`).
- **`useDriveListing(rootUrl, { fetch? })`** — the data hook: owns the current-container + loading /
  error / access-error state and the navigation stack, delegating every GET+parse to the data layer
  (it never re-implements LDP/RDF reading). A stale-response guard ensures a slow earlier load can
  never overwrite a newer navigation.
- **Auth is an injectable seam.** The `fetch` prop/option is the authenticated fetch; omit it and
  the ambient global is used. In production that global is the one
  `@solid/reactive-authentication`'s `registerGlobally()` patches (wired once in the
  `create-solid-app` shell's `<SolidAuthProvider>`), so a plain fetch upgrades on a 401 with a DPoP
  token. That wiring is **#18-gated** (`create-solid-app` S2;
  [reactive-authentication#18](https://github.com/solid-contrib/reactive-authentication/issues/18)).
  The view is deliberately unaware of it: it works **today** against a stubbed fetch in unit tests
  and later against the real session **with no code change** — there is no hard-wired login flow.

## Federation registry readiness

`public/clientid.jsonld` is a Solid-OIDC Client Identifier Document that also publishes the
[`fedapp:`](https://w3id.org/jeswr/fed) block (from `jeswr/solid-federation-vocab`): the app is a
`fedapp:App` operating in the `documents` sector, requesting `acl:Read`/`Write`/`Append`, and
declaring it `fedapp:declaresShape poddrive:DriveRoot` and consumes/produces LDP `Container` /
`Resource`. This makes the app discoverable to a federation registry once that lands — membership
itself is asserted by the registry after a signed challenge, never self-asserted here.

## Develop

```sh
npm install        # ignore-scripts=true (supply-chain hardening): no lifecycle hooks run
npm run gate       # lint (biome) → typecheck (tsc) → test+coverage (vitest, 100 % thresholds) → build
```

Individual gate steps: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## Roadmap

The data layer + the React view above are intended to survive; the following are the tracked
per-app follow-ups:

- **Next.js app shell** scaffolded via `create-solid-app` once it lands — hosting the existing
  `<FileBrowser>` view, wiring login (incl. Pod Drive's static `clientid.jsonld`) so the authed
  `fetch` flows into the view's seam, and adding pages. Not hand-rolled as a throwaway app.
- **Offline-first cache** — the suite's service-worker offline-first layer (`@jeswr/solid-offline` +
  WebSocketChannel2023 invalidation) wired in at the shell level; the view consumes the cached
  fetch transparently through its existing seam.
- **Cross-server E2E matrix** — the data layer exercised against every well-known server (CSS WAC +
  ACP, ESS, NSS, and **prod-solid-server with both passkey and username/password** auth).
- **Coverage-ratchet gate** — a CI gate that holds the data-layer coverage at 100 % and ratchets
  the cross-server matrix pass-rate, so no server regresses silently.
- **Sector-vocab ADR** — the `documents` sector IRI (`https://w3id.org/jeswr/sectors/documents`) is
  not yet defined in `full-solid-ecosystem`; an interim slug is used in `clientid.jsonld`. The
  sector ontology (and whether Pod Drive's data is "documents" vs a dedicated "drive" sector) needs
  an ADR + the ontology added before federation membership is real.

## Licence

MIT. See [`LICENSE`](./LICENSE).
