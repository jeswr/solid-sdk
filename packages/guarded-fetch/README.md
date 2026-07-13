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
- Errors: `SsrfError`, `GuardError`, `PodScopeError`, `RedirectRefusedError`.

Private, loopback, link-local, metadata, malformed, and disallowed redirect targets are rejected.
Loopback HTTP access is an explicit development-only option.

## Links

- [Source](https://github.com/jeswr/guarded-fetch)
- [Issues](https://github.com/jeswr/guarded-fetch/issues)
- [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

## License

MIT © Jesse Wright
