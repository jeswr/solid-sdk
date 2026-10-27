<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/guarded-fetch

A `fetch`-compatible SSRF, DNS-rebinding, redirect, timeout, and response-size guard for
attacker-influenced URLs.

> Experimental and security-critical. Prefer the DNS-pinning Node.js entry for server-side fetches.

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

The default entry is browser-safe and applies URL policy without importing `node:*`. The
`@jeswr/guarded-fetch/node` entry additionally pins validated DNS results to the connection.

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

Private, loopback, link-local, metadata, malformed, and disallowed redirect targets are rejected.
Loopback HTTP access is an explicit development-only option.

Fetch wrappers share `snapshotFetchInput` to capture Request inputs before inspecting their
URLs and preserve their body and request policies, including init overrides and referrer fields.
Native URL getters ignore shadowed properties; other implementations and realms use their
Request prototype's constructor/getter or a single string conversion before validation.
A fully caller-defined Request class is only as trustworthy as the transport it is passed to,
the same as on main.
`RedirectRefusedError` accepts both
`(message, { url, status, location?, cause? })` and the legacy `(url, status)` constructor
used by unstorage-solid's identical `SolidRedirectError` alias. The legacy form retains
the `SolidRedirectError` name and message; shared refusals retain `RedirectRefusedError`.

## Links

- [Source](https://github.com/jeswr/guarded-fetch)
- [Issues](https://github.com/jeswr/guarded-fetch/issues)
- [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

## License

MIT © Jesse Wright
