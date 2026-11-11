<!-- AUTHORED-BY Codex GPT-5 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/solid-auth-core

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

> **Deprecated — use `@jeswr/pod-auth`.** See the [pod-auth migration guide](../pod-auth/SKILL.md).
> This package remains available for existing consumers and pinned mirrors; the API below is legacy.

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
mode is derived only when credential headers survive Request construction; fallback
sources keep the caller's policy. Credential-free redirects are handled by the transport
under that policy. Neither wrapper attaches SDK tokens to `mode: "no-cors"` requests,
and direct `upgrade()` calls leave them unchanged. Browser-filtered caller credential
headers do not force manual redirects; these requests retain the caller's policy.

After token refresh and DPoP proof signing, credential attachment rechecks that the same
session is live and the request origin is still allowed. Logout, account switching, or
origin revocation during either operation returns the original request without adding
SDK credentials, retaining the caller's redirect policy.

Derived requests preserve the caller's referrer, referrer policy, mode, credentials,
cache, integrity, keepalive, abort signal, and priority where supported, on passthrough,
fallback, credential attachment, and every followed hop. Only the URL, redirect policy,
credential headers, and method/body/content headers change as described here. Inherited
`mode: "navigate"` becomes `"same-origin"` when deriving a Request, following Fetch's
constructor rule for a non-empty init (including service-worker navigation requests).

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
of being followed. Direct `WebIdDPoPTokenProvider.upgrade()` calls that attach credentials
also return Requests with manual redirect mode; the fetch wrappers own the hop loop.

## Key API

- `createSolidAuth`: login, restore, logout, fetches, allowed-origin re-arming, and recent accounts.
- `WebIdDPoPTokenProvider`: lower-level provider used by the factory.
- `authenticatedFetch` and `publicFetch`: explicit credential boundary.
- `reArmAllowedOrigins`, `rememberAccount`, `dropLiveSession`, `recentAccounts`.
- React: `SessionProvider` and `useSolidSession` from `@jeswr/solid-auth-core/react`.

## Proactive resource origins

`deriveProactiveAllowedOrigins({ podRoot, webId, issuer })` includes the pod/storage origin
and the WebID origin by default. Set `includeWebIdOrigin: false` when the WebID document is
not served by the pod. The issuer origin is excluded unless `includeIssuerOrigin: true`
explicitly opts in. A pod on the issuer origin stays allowed through `podRoot`.

`computeAllowedOrigins` keeps its separate default of including the issuer origin. See the
[proactive API behavior report](./etc/proactive-fetch.api.md) for the helper's contract.

After an asynchronous profile read, bind origin enrichment to the identity captured before
the read:

```ts
const expectedWebId = auth.webId;
if (expectedWebId) {
  const storageOrigins = await readStorageOrigins(expectedWebId);
  const covered = auth.reArmAllowedOrigins(storageOrigins, { expectedWebId });
}
```

`reArmAllowedOrigins(origins, options?)` widens only the live session, without a token grant.
Every entry must be HTTPS (or HTTP loopback with `allowInsecureLoopback`). Any invalid entry,
missing session, or `expectedWebId` mismatch returns `false` and leaves the boundary unchanged.
Successful calls return `true` and add all origins. Omitting `expectedWebId` targets the session
live at call time; the next login/restore resets additions.

`rememberAccount(webId, displayName?, avatarUrl?)` merges credential-free display metadata into
the recent-accounts list. An invalid WebID makes the call a no-op: WebIDs must be absolute HTTPS
URLs, or HTTP loopback URLs with `allowInsecureLoopback`. The exported
`MAX_DISPLAY_NAME_LENGTH` is 256 Unicode code points; newly stored display labels, including
WebID fallback labels, are truncated without splitting surrogate pairs. The full WebID stays
intact. Avatars must be absolute HTTP(S) URLs; other schemes and relative URLs are dropped.
Omitted names/avatars preserve existing metadata, and an unsafe avatar does not replace a
previously stored safe one. Storage failures are non-fatal.

## Links

- [Source](https://github.com/jeswr/solid-auth-core)
- [Issues](https://github.com/jeswr/solid-auth-core/issues)
- [Solid-OIDC](https://solidproject.org/TR/oidc)
- [RFC 9449: OAuth DPoP](https://www.rfc-editor.org/rfc/rfc9449)

## License

[MIT](./LICENSE) © Jesse Wright
