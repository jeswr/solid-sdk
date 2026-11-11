---
name: guarded-fetch
description: Use when guarding attacker-influenced fetch URLs, enforcing DNS pinning or pod scope, composing redirect policies, or maintaining guarded-fetch browser and Node transports.
---

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Guarded fetch

Read [README.md](README.md) for the public API. This package is security-critical.

The root `createGuardedFetch()` and `guardedFetch()` require DNS pinning by default
for Node hostname requests. Their built-in transport lazily loads undici, pins the
validated DNS answers into a per-hop Agent lookup, and overrides any request dispatcher.
Both entries share the same internal transport,
body normalization and lookup callback contract; the Node entry retains its fresh
connect-time resolution and validation policy.
Validate every address, keep TLS verification against the original hostname, and revalidate
and repin every redirect. Never silently fall back when the pinning transport is unavailable.
Bun (`process.versions.bun`) and Deno (`globalThis.Deno`) cannot use the built-in pinning
transport; refuse hostname requests unless explicitly opted out or supplied a `pinningFetch`.
Refuse hostname responses if the pinned lookup was never invoked.

A caller-supplied `fetch` cannot prove that it honours a dispatcher. Require the explicit
`pinningFetch` attestation for Node hostname requests, or an explicit
`requireDnsPinning: false` with a comment explaining why the weaker validation/connect
posture is necessary. Do not brand an arbitrary authenticated fetch as pinning.
The built-in transport must refuse proxy environment variables (HTTP_PROXY, HTTPS_PROXY,
ALL_PROXY and lowercase forms), NODE_USE_ENV_PROXY=1 / --use-env-proxy, and non-default global
undici dispatchers, including ProxyAgent and custom CA/TLS/connect options. Apply the same
configuration refusal to Node IP literals. A direct Agent must not silently bypass egress
policy; CONNECT proxies cannot pin the upstream destination. Tell callers to use the root
entry with `requireDnsPinning: false`, or provide their own attested `pinningFetch`.
A pristine default-configured Agent is accepted; unknown dispatcher shapes fail closed.
Use the Node entry's explicit `ca` option for private trust. Keep multipart uploads replayable:
copy foreign FormData into undici's realm without changing caller headers or stream/duplex rules.

`allowUnresolvedHosts` never opts Node requests out of pinning; forcing `dnsLookup: null`
on a Node server also requires a pinned transport or the explicit weaker opt-out.

Keep undici and Node builtins out of the static root module graph. Lazy imports use opaque
specifiers so browser bundlers need no Node polyfills. Browser and other DNS-less edge policy
remains unchanged: syntactic browser checks, explicit `allowUnresolvedHosts` elsewhere.
The Node entry supplies `createNodeGuardedFetch`, `nodeGuardedFetch`, and the standalone
`createPinningDispatcher`; it also supports a connect-time resolver and private CA options.

`assertSafeUrl` performs validation only; it cannot pin an independent later fetch.
Skip transport/pinning gates on this path, even with custom-fetch options, but retain every
URL/address and DNS-less policy check.
Scope/redirect/snapshot helpers do not inherit the DNS policy. Run `beforeDispatch`
synchronously after all awaited DNS/transport preparation and immediately before dispatch.
Retain the response cap, whole-operation timeout, abort handling and sanitised errors.

Before changing runtime defaults, audit all guarded-fetch imports across `packages/`,
`apps/` and `tools/`, including re-exports and bundled consumers. The current audit and
explicit exceptions are in [docs/dns-pinning-callers.md](docs/dns-pinning-callers.md).
Use offline rebinding regressions plus real connector tests where socket binding is allowed.
Test the default pin, explicit weaker opt-out, custom-fetch refusal, every redirect,
dispatcher override and browser/edge bundle isolation.
