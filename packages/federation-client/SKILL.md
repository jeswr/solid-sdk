---
name: federation-client
description: Use when verifying or listing Solid app registrations, discovering federation registry memberships or storage spec versions, or maintaining federation-client entry points and bundles.
---

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Federation client

The root `@jeswr/federation-client` entry provides `verify`, `verifyDataset`, `list`,
`selfDescribe`, `serialize`, `discoverFromRegistry`, and `resolveStorageSpecVersion`.
App registration is self-description; registry membership is a separate assertion.

For attacker-controlled URLs, pass a guarded fetch to `verify` and `list`. Import
`createGuardedFetch`, `guardedFetch`, `isLoopbackAddress`, `isPublicAddress`,
`classifyIpLiteral`, and `refuseRedirects` from `@jeswr/guarded-fetch`. These six helpers
are no longer exported from federation-client's root (breaking change).

The root retains `SsrfError`, `RedirectRefusedError`, and the `DnsLookup`, `GuardOptions`,
and `ResolvedAddress` types for callers of its own functions. The separate
`@jeswr/federation-client/node` entry provides `createNodeGuardedFetch`, `nodeGuardedFetch`,
`createPinningDispatcher`, and `createValidatingLookup`, with types from
`@jeswr/guarded-fetch/node`. Prefer the Node guarded fetch for server-side DNS pinning;
the bare dispatcher rejects an explicit `timeoutMs`.

Registry reads use guarded-fetch's DNS-pinned Node default. Custom Node hostname
transports require `guard.pinningFetch`, or an explicit `guard.requireDnsPinning: false`
with a reason for accepting the rebinding window. Browser and DNS-less edge policy is
unchanged. Offline guard tests attest inert transports with `pinningFetch`; registry
fixtures explicitly opt out because they open no sockets.

The build bundles both entries together and shares guarded-fetch in a private chunk to
preserve error-class identity. Keep every emitted chunk in `dist/`; mirrors ship that
directory, while this workspace never commits it. Node helpers must import guarded-fetch
directly and must not depend on helper exports from federation-client's public root.
Keep undici and static Node imports out of the browser-safe root's module graph.

After building, regenerate both API reports with
`pnpm --filter @jeswr/federation-client run api:report`. The built-artifact regression in
`test/node-dist.test.ts` checks native ESM loading, removed root exports, and guarded calls
with injected DNS and refused targets, without production network requests.

Follow the workspace RDF discipline: parse with `@jeswr/fetch-rdf`, access data through
`@solid/object` / `@rdfjs/wrapper` typed accessors, and serialize with `n3.Writer` or
`@jeswr/rdf-serialize`. Never hand-build triples in code, tests, or examples.
