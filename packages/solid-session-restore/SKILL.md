---
name: solid-session-restore
description: Use when persisting and silently restoring browser Solid-OIDC sessions with @jeswr/solid-session-restore, including WebID/issuer-scoped IndexedDB credentials, remembered-account pointers, DPoP-bound refresh grants, authenticated fetch restoration, and logout cleanup.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Work with `@jeswr/solid-session-restore`

Use this package as the audited core. Keep application wiring thin; do not duplicate refresh-token storage, DPoP-key persistence, or restore-decision logic per app.

## Core flow

```ts
import {
  IndexedDbSessionStore,
  RememberedAccount,
  decideSilentRestore,
  restoreSession,
  toAuthenticatedFetch,
} from "@jeswr/solid-session-restore";

const store = new IndexedDbSessionStore({ dbName: "my-app:sessions" });
const remembered = new RememberedAccount("my-app:remembered-account");
const restored = await restoreSession({ store, issuer, clientId });
const fetch = restored ? toAuthenticatedFetch(restored, { refresh }) : undefined;
```

## Security invariants

- Scope the remembered WebID, issuer-keyed credential, and restore decision together. Never restore one account through another account's pointer.
- Persist the DPoP-bound refresh token and the same ES256 keypair. Keep the private key non-extractable in IndexedDB; the public key must remain exportable for proof JWK generation.
- Persist no access token. Never log refresh tokens, client secrets, or keys.
- Clear a credential only for intentional logout or a definitive `invalid_grant`. Preserve it on network, timeout, abort, discovery, and server failures.
- Fail closed on WebID mismatch, missing issuer, unsupported client authentication, or a confidential method without a secret.
- Keep per-app database and pointer names so applications sharing an origin do not share sessions.
- Await IndexedDB transaction completion before treating a credential as durable.
- Adopt and persist refresh-token rotation before exposing the restored session.
- Keep DPoP nonce and token-refresh retries bounded. Drop an old authenticated fetch on logout or account switch.
- Pin restore HTTP to a known pristine fetch when the application patches global fetch.

Use `decideSilentRestore` and `shouldDropRememberedPointer` for the pure branch decisions. Use `toAuthenticatedFetch` only after successful restore; returning a WebID without an authenticated, refresh-capable fetch is incomplete restoration.

Changes require exhaustive unit tests for cross-account isolation, key extractability, invalid-grant versus transient behavior, client-auth selection, rotation, logout races, and retry bounds, followed by the full workspace gate.
