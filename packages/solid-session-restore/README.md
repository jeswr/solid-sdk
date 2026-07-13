<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-session-restore

Framework-agnostic browser helpers for securely persisting and silently restoring Solid-OIDC
sessions with DPoP-bound refresh tokens.

> Security-sensitive. Use a separate IndexedDB name and remembered-account key for each app.

## Install

```sh
npm install github:jeswr/solid-session-restore#main
```

The package tooling requires Node.js 20 or newer; the runtime API is browser-oriented.

## Minimal usage

```ts
import {
  IndexedDbSessionStore,
  restoreSession,
  toAuthenticatedFetch,
  type PersistedSession,
} from "@jeswr/solid-session-restore";

const issuer = new URL("https://solidcommunity.net/");
const clientId = "https://app.example/client-id.jsonld";
const store = new IndexedDbSessionStore({ dbName: "my-app:sessions" });

// Save the credential produced by your login flow.
declare const loginCredential: Pick<
  PersistedSession,
  "webId" | "refreshToken" | "dpopKey"
>;
await store.put({ issuer: issuer.href, clientId, ...loginCredential });

const restored = await restoreSession({ store, issuer, clientId });
if (restored) {
  const authenticatedFetch = toAuthenticatedFetch(restored, {
    refresh: () => restoreSession({ store, issuer, clientId }),
  });
  const response = await authenticatedFetch("https://alice.example/private/notes.ttl");
}
```

Login code must persist the refresh token and the same non-extractable ES256 key pair. Persist no
access token, and remove the stored credential on explicit logout.

## Key API

- Storage: `IndexedDbSessionStore`, `PersistedSession`, `indexedDbAvailable`, and the
  `SessionStore.get`, `put`, and `delete` contract.
- Account pointer: `RememberedAccount` stores only a WebID and issuer in local storage.
- Restore decisions: `decideSilentRestore`, `shouldDropRememberedPointer`, `webIdsEqual`.
- Session lifecycle: `restoreSession`, `hasPersisted`, `forgetPersisted`, `clearPersisted`.
- Authenticated requests: `toAuthenticatedFetch` adds DPoP authorization and supports one bounded
  refresh retry.

`invalid_grant` clears a dead credential; network, timeout, discovery, and server failures preserve
it so a temporary outage does not force a new login.

## Links

- [Source](https://github.com/jeswr/solid-session-restore)
- [Issues](https://github.com/jeswr/solid-session-restore/issues)
- [Solid-OIDC specification](https://solidproject.org/TR/oidc)
- [RFC 9449: OAuth DPoP](https://www.rfc-editor.org/rfc/rfc9449)

## License

[MIT](./LICENSE) © Jesse Wright
