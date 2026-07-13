<!-- AUTHORED-BY Codex GPT-5 -->

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
