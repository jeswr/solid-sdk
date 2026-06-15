# Pod Drive

> ⚠️ Experimental — AI-agent-generated (Claude Opus 4.8, @jeswr PSS agent); under active
> development, not production-hardened.

A file/folder browser for [Solid](https://solidproject.org) pods — browse, read, and organise the
LDP containers and binary resources in your pod the way you would a cloud drive, with the pod (not
a vendor) as the source of truth.

This repository currently ships the **non-throwaway data-layer core**: a typed RDF model over LDP
containers + binary resources, built to a high quality bar (100 % unit-test coverage). The Next.js
UI, the cross-server end-to-end matrix, and the coverage ratchet against every well-known server
are deliberate, tracked follow-ups (see [Roadmap](#roadmap)).

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

The data layer above is intended to survive; the following are the tracked per-app follow-ups:

- **Next.js UI** scaffolded via `create-solid-app` once it lands — the drive browser surface, login
  (incl. Pod Drive's static `clientid.jsonld`), and pages. Not hand-rolled as a throwaway app.
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
