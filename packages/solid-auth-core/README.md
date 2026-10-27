<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/solid-auth-core

Framework-independent browser Solid authentication with WebID-first login, DPoP, silent restore,
and safe fetch boundaries.

Use this package instead of copying token-provider, restore, recent-account, or React session code
into an app.

> Security-critical. Capture pristine fetch before authentication and keep authenticated requests
> restricted to explicitly allowed Solid resource origins.

## Install

```sh
npm install github:jeswr/solid-auth-core#main
```

Install `react` only when using `@jeswr/solid-auth-core/react`. Requires Node.js 20.12 or newer for
tooling and a modern browser at runtime.

## Minimal usage

```ts
import { createSolidAuth } from "@jeswr/solid-auth-core";

const auth = createSolidAuth({
  callbackUri: `${location.origin}/callback.html`,
  clientId: `${location.origin}/clientid.jsonld`,
  authFlow: { getCode },
  patchGlobalFetch: true,
});

await auth.restore();
await auth.login("https://alice.example/profile/card#me");
const response = await auth.authenticatedFetch(podResourceUrl);
const publicResponse = await auth.publicFetch(foreignUrl);
await auth.logout();
```

Call `dropLiveSession()` for transient failures that should preserve the durable refresh credential.
Call `logout()` for intentional sign-out or a definitive invalid grant.

## Credentialed redirects

Credentialed requests always use `redirect: "manual"`, overriding the caller's redirect
policy. The controller and proactive fetch wrapper follow visible 301/302/303/307/308
redirects only when each destination passes the same live allowed-origin check as the
initial request. Each hop receives a fresh DPoP proof for its URL and method, bound to
the attached access token. Resource-server nonces are cached only for the checked hop's
origin. Redirects outside the allowlist are returned unchanged without contacting the
destination. Credential-free passthrough and fallback requests retain the caller's
original redirect policy (`follow`, `error`, or `manual`), including when an upgrade
is superseded before credentials attach or a retry loses its live session. Manual
mode is derived only when credentials are attached; fallback sources keep the caller's
policy. Credential-free redirects are handled by the transport under that policy.

Derived requests preserve the caller's referrer, referrer policy, mode, credentials,
cache, integrity, keepalive, abort signal, and priority where supported, on passthrough,
fallback, credential attachment, and every followed hop. Only the URL, redirect policy,
credential headers, and method/body/content headers change as described here.

Passthrough and fallback requests carrying caller-owned `Authorization`, `DPoP`, or
`Proxy-Authorization` headers also use manual mode, whether supplied through `init.headers`
or a Request. Their redirects are always returned unfollowed, including same-origin redirects:
the SDK cannot mint fresh proofs for those credentials. On SDK-authenticated redirects,
an origin change strips `Cookie`, `Cookie2`, `Proxy-Authorization`, `Authorization`, and
caller `DPoP` headers before attaching freshly scoped SDK credentials. Same-origin hops
preserve those headers before the SDK replaces its authorization and proof.
The `authenticatedFetch` handle retains this boundary before login and after logout;
`publicFetch` remains the explicit pristine transport.

POST requests become GET on 301/302; 303 changes methods other than GET/HEAD to GET.
These rewrites discard the body and its content headers, including Content-Length.
Other redirects preserve the method and replay bodies supplied through `init.body` as
text, bytes, Blob, URLSearchParams, or FormData, buffered before sending. Buffering checks
the request's abort signal before
reading and races each read against cancellation. An abort cancels the reader and rejects
with the signal's reason (an AbortError by default), without waiting for buffering or
source cancellation to finish. ReadableStream bodies and bodies supplied through a
Request are treated as streams: redirects requiring their replay are returned unfollowed.
Following more than 20 hops throws a TypeError.

Browsers hide manual redirect details behind an `opaqueredirect` response. This response
is returned as-is, so credentialed redirects in browsers surface to the caller instead
of being followed. Direct `WebIdDPoPTokenProvider.upgrade()` calls also return Requests
with manual redirect mode; the fetch wrappers own the hop loop.

## Key API

- `createSolidAuth`: login, restore, logout, fetches, allowed-origin re-arming, and recent accounts.
- `WebIdDPoPTokenProvider`: lower-level provider used by the factory.
- `authenticatedFetch` and `publicFetch`: explicit credential boundary.
- `reArmAllowedOrigins`, `rememberAccount`, `dropLiveSession`, `recentAccounts`.
- React: `SessionProvider` and `useSolidSession` from `@jeswr/solid-auth-core/react`.

## Links

- [Source](https://github.com/jeswr/solid-auth-core)
- [Issues](https://github.com/jeswr/solid-auth-core/issues)
- [Solid-OIDC](https://solidproject.org/TR/oidc)
- [RFC 9449: OAuth DPoP](https://www.rfc-editor.org/rfc/rfc9449)

## License

[MIT](./LICENSE) © Jesse Wright
