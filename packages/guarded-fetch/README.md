<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/guarded-fetch

A `fetch`-compatible SSRF, DNS-rebinding, redirect, timeout, and response-size guard for
attacker-influenced URLs.

> Experimental and security-critical. Node hostname requests require DNS pinning by default.

## Install

```sh
npm install github:jeswr/guarded-fetch#main
```

The Node.js DNS-pinning entry requires Node.js 22 or newer.

## Minimal usage

```ts
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";

const guardedFetch = createNodeGuardedFetch({
  maxBytes: 256 * 1024,
  timeoutMs: 8_000,
});

const response = await guardedFetch("https://registry.example/catalog.json");
```

The root entry (`createGuardedFetch()` / `guardedFetch()`) is browser-safe with no
top-level `node:*` or undici imports. On Node, hostname requests now default to
`requireDnsPinning: true`: the guard lazily loads its existing undici dependency,
validates every DNS answer, and connects through a per-hop dispatcher pinned to those
answers. The socket never resolves the hostname again. Redirects receive fresh validation
and a fresh pin; TLS still verifies the original hostname. A caller-provided dispatcher
cannot replace the pin, and a missing undici transport fails closed. The separate
`@jeswr/guarded-fetch/node` entry remains available for a connect-time validating
dispatcher, custom resolver and private CA options.

For authenticated/custom transports, supply `pinningFetch` only when that transport
actually pins DNS. A plain `fetch` option cannot establish that property and is refused
for Node hostname requests by default. This is a breaking change for Node callers that
previously injected an unpinned fetch. The explicit weaker-posture opt-out is
`requireDnsPinning: false`:

```ts
const weakerFetch = createGuardedFetch({
  fetch: customFetch,
  // This transport cannot pin DNS. Accept the validation/connect DNS-rebinding window.
  requireDnsPinning: false,
});
```

This opt-out restores separate validation/connect DNS lookups; private answers at
validation time are still refused, but a rebinding answer at connect time can bypass
that check. `allowUnresolvedHosts` does not disable Node pinning; forcing `dnsLookup: null`
on a Node server also requires a pinning transport or the explicit weaker opt-out.
The built-in transport refuses configured proxy environment variables (`HTTP_PROXY`,
`HTTPS_PROXY`, `ALL_PROXY` and their lowercase forms), `NODE_USE_ENV_PROXY=1`,
`--use-env-proxy` (including in `NODE_OPTIONS`), and non-default undici global dispatchers
such as `ProxyAgent`, `EnvHttpProxyAgent` or an Agent with custom CA/TLS/connect settings.
A direct pinned Agent would bypass that configuration; a CONNECT proxy resolves the
upstream hostname itself, so this transport cannot pin that destination. This refusal
also applies to IP literals, consistently in both entries. A pristine default-configured
Agent is accepted; unrecognised dispatcher configurations fail closed. To preserve a
proxy or custom dispatcher, use the root entry with the explicit
`requireDnsPinning: false` opt-out, or supply a `pinningFetch` that implements the required
egress and destination policy itself. The Node entry always pins; its `ca` option supplies
private trust without relying on a global dispatcher.

Bun (`process.versions.bun`) and Deno (`globalThis.Deno`) cannot use the built-in pinning
transport: hostname requests fail closed even when Node compatibility DNS APIs exist.
Use an explicitly attested `pinningFetch` or opt out with `requireDnsPinning: false`.
A hostname response returned without invoking the pinned lookup is also refused.
IP-literal requests need no DNS lookup. Browser and other DNS-less edge defaults are unchanged:
browsers use syntactic checks; other DNS-less runtimes require `allowUnresolvedHosts`.
`assertSafeUrl` only validates a URL and does not create a dispatcher or protect a later
independent fetch. It skips transport/pinning requirements, including when passed the same
options as a custom fetch guard, while retaining URL, address and DNS-less validation policy.
The shared built-in transport accepts Node-global and npm-undici FormData, preserving multipart
boundaries, filenames, duplicate fields, caller content-type headers and redirect replay.
Blob, URLSearchParams and stream bodies retain their Fetch semantics (streams require duplex).
See the [workspace caller audit](docs/dns-pinning-callers.md).

`beforeDispatch?: () => void` is an optional synchronous authority fence on guard
construction. It runs after each awaited destination/DNS check, immediately before
calling the underlying fetch, without an intervening await. A thrown refusal is
propagated unchanged and that hop is never dispatched. For request-specific authority,
construct a separate guard for each request; never share mutable authority state across
requests. The Node entry forwards this option to its inner destination guard.

## Key API

- General guard: `createGuardedFetch`, `guardedFetch`, `assertSafeUrl`.
- Node.js DNS pinning: `createNodeGuardedFetch`, `nodeGuardedFetch`,
  `createPinningDispatcher`.
- Pod boundaries: `assertWithinPodScope`, `isWithinPodScope`, `podScopedUrl`,
  `createPodScopedFetch`.
- Credentialed fetches: `refuseRedirects` rejects every redirect instead of following it.
- Input capture: `snapshotFetchInput(input, init)` returns the target string and the
  matching string or Request snapshot to validate and forward; `snapshotRequest` remains
  available for native Request snapshots.
- Errors: `SsrfError`, `GuardError`, `PodScopeError`, `RedirectRefusedError`.

Private, loopback, link-local, metadata, malformed, and disallowed redirect targets are
rejected when they can be classified. Without a DNS resolver, public-looking hostnames
are allowed in positively identified browsers, or with `allowUnresolvedHosts: true` in
other runtimes; their resolved addresses cannot be checked there. Private IP literals
and denied hostnames remain blocked. Loopback HTTP access is an explicit development-only
option.

The SSRF and pod-scope fetches honour the captured `Request`/init `redirect` mode:
`follow` (the default) re-validates each hop, `manual` returns the first redirect, and
`error` rejects it with `SsrfError`/`PodScopeError`. Manual SSRF responses still have
their body size and total deadline enforced. Compositions such as
`createPodScopedFetch(base, { fetch: createGuardedFetch(opts) })` let the outer scope
guard check every hop; `refuseRedirects(nodeGuardedFetch)` sees and refuses the first
redirect. Underlying transports must honour `redirect: "manual"`.

An absent or undefined init `redirect` inherits the captured Request's mode.
Guard-generated transport and DNS errors keep sanitised message diagnostics and discard
raw causes, which can contain credentials in their stacks or custom properties.

`maxBytes` and `maxRedirects` must be finite non-negative integers; `timeoutMs` must be
finite and positive. Invalid limits throw `TypeError` at construction.
The bare `createPinningDispatcher` accepts `PinningDispatcherOptions`: only
`allowLoopback`, `resolveAll`, and `ca`. Existing `NodePinningOptions` values remain
assignable, but any defined unsupported option throws `TypeError`. Use
`createNodeGuardedFetch` for guard limits and a whole-operation deadline.

Fetch wrappers share `snapshotFetchInput` to capture Request inputs before inspecting their
URLs. The SSRF, pod-scope, and Node guards forward a URL string plus init: they inherit
method, headers, credentials, redirect, signal, and body (with duplex), then overlay the
explicit init. Other policies are carried only when supplied in init. `refuseRedirects`
forwards a snapshot of the caller's Request class, retaining its request policies.
Forward mode requires `initSemantics: "spread" | "direct"` alongside `forward: true`.
Use `spread` where the boundary previously spread init; use `direct` where it passed init
to Fetch or Request. Direct capture reads each known RequestInit member once, including
inherited and non-enumerable options and undici's `dispatcher`. Both modes return the
captured options as `snapshot.init`; forward that object so accessors are never reread
and the body sent matches the body-replacement decision. `snapshotRequest` uses direct capture.
The URL+init guards capture metadata with `snapshotFetchInput(input, init, { metadataOnly: true })`.
An own enumerable body override (including null/undefined) uses an empty byte placeholder for body-capable
inputs, leaving the discarded input body untouched even if already consumed or locked.
The placeholder body and duplex are never inherited; the caller's replacement goes directly
to the transport. Without a replacement, capture retains the existing body-transfer behavior.
Forward mode instead follows Fetch's non-null body-replacement rule, using its captured init.
Native URL getters ignore shadowed properties; other implementations and realms use their
Request prototype's constructor/getter or a single string conversion before validation.
A fully caller-defined Request class is only as trustworthy as the transport it is passed to,
the same as on main.
`RedirectRefusedError` accepts both
`(message, { url, status, location?, cause? })` and the legacy `(url, status)` constructor
used by unstorage-solid's identical `SolidRedirectError` alias. The legacy form retains
the `SolidRedirectError` name; shared refusals retain `RedirectRefusedError`.
Diagnostic URLs, including `.url` and `.location` on redirect refusals, omit userinfo,
query strings and fragments. Relative redirect locations are resolved against the
request URL in messages; the `.location` field preserves relative paths for constructor
compatibility. Unparseable values use a constant placeholder.

## Links

- [Source](https://github.com/jeswr/guarded-fetch)
- [Issues](https://github.com/jeswr/guarded-fetch/issues)
- [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

## License

MIT © Jesse Wright
