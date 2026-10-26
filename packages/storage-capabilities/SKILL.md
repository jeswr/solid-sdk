---
name: storage-capabilities
description: Work on @jeswr/storage-capabilities, the storage description discovery and feature flags package in the Solid SDK workspace.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/storage-capabilities

T-010 implements the ADR-002 vocabulary and type contracts, plus internal Link/probe-header parsers.
T-011 adds `parseLwsDescription(json, storageUrl, requestUrl)` and `CapabilitiesError` at the root.
T-012 adds the internal Solid description dataset mapper in `src/solid-description.ts`.
The root entry point also exports types; `./vocab` exports vocabulary objects (`LWS.Storage`,
`SOLID.storageDescription`, and the other ADR-002 IRIs). `./testing` exports the representative
`sparqLwsCid` example; `./cache` remains reserved.

Before implementation, read SDK core ADR-001 D4 and `ADR-002-capabilities.md` in
`solid-suite-planning/specs/sdk-core/`, alongside this repository's `AGENTS.md`.

The CID parser consumes decoded compact JSON by shape, independent of Content-Type, without
remote context processing. It checks URL-normalised id equality, Storage typing, exactly one
StorageRoot, and same scheme/authority for the description/root and request. It preserves unknown
types/extras and expands bare LWS type/subscriptionType terms; verification method crypto types
stay verbatim. Only JWK-backed verification methods enter the public contract. The resolver must
apply response cache metadata, injected clocks, and the response-size limit; parser defaults are
`Date.now()`, null ETag, and one-hour TTL. Do not introduce fetching into the parser.

Reuse `src/link.ts` for Link parsing. Its output retains the resolved `context` from `anchor`;
callers must check that context before treating a link as metadata about the response resource.
`src/probe-headers.ts` converts supplied response headers into `ProbeResult` without fetching.
Pass ordered raw header pairs when response evidence order matters; a `Headers` instance may
already have sorted/combined the fields. Network probing belongs to the resolver task.

`parseSolidDescription(dataset, rootUrl)` implements ADR-002 step 5c and returns only
`{ services, capabilities }`. Parse RDF bytes with `@jeswr/fetch-rdf`'s `parseRdf` first,
using the description URL as `baseIRI`; remote JSON-LD contexts need an explicit loader.
The tests supply the notifications context offline. The mapper finds `notify:subscription`
on any subject, but reads `did:service`, `lws:capability`, and ACQ endpoints only on `rootUrl`.
HTTP metadata and origin validation remain the resolver's responsibility.

Extras use expanded predicate keys. IRIs and literal lexical values are strings; singleton
values are scalars and repeated values are arrays. Notification features are always arrays.
Nested blank nodes become property objects with an `@id` matching later references;
callers can find a shared node's mapped properties by matching that identifier.
Repeated/cyclic references and nesting beyond 32 nodes become `{ "@id": "_:<label>" }`
references. Named service/capability nodes retain
their IRI as `id`; blank-node entries omit `id`. Unknown types survive the mapping.

Keep development tool versions aligned with the root manifest. The pinned pnpm 10.4.1 with
`ignore-scripts` requires local tool declarations for filtered scripts.

Validate changes with this package's `lint`, `build`, `typecheck`, and `test` scripts.
