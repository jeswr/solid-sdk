<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-auth

> **Experimental — AI-agent-generated.** Authentication and session lifecycle; private pending conformance.

Suite policy over `@jeswr/reactive-authentication`, following SDK core ADR-004 D2/D3/D5.
Requires Node.js >=24.5 for the protocol engine, or a browser with WebCrypto and IndexedDB.

```ts
import { createPodAuth } from '@jeswr/pod-auth';

const auth = createPodAuth({
  clientId: 'https://app.example/.well-known/solid-client-id.jsonld',
  redirectUri: 'https://app.example/auth/callback.html',
  boundary: { roots: ['https://pod.example/alice/'] },
  ui: {
    getWebId: async () => shell.askWebId(),
    chooseIssuer: async issuers => shell.chooseIssuer(issuers),
    getCode: async (authorizationUrl, signal) => shell.authorize(authorizationUrl, signal),
  },
});

const unsubscribe = auth.on('login', event => shell.showIdentity(event.identity));
await auth.login({ webId: 'https://id.example/alice#me' });
const response = await auth.fetch('https://pod.example/alice/private');
const identity = await auth.identity(); // claims only; no network, refresh, UI or token material
unsubscribe();
```

`ui.getCode` returns the complete callback URL, including its `state`, `code` and `iss` parameters.
The UI hook owns popup/redirect cleanup and must honor its abort signal. Protocol validation, PKCE,
DPoP proofs, refresh machinery and discovery stay in the protocol engine. A missing issuer chooser
throws `AmbiguousIssuerError` when a profile lists several issuers; a chooser must return a listed URL.
Explicit WebID and issuer hints must agree with the profile and the authenticated identity.
Concurrent logins with the same hint share one promise; different hints reject while login is pending.
Call `logout()` before switching accounts on the same instance.

`auth.fetch` is the manager's unbound fetch function. Global fetch is preserved and captured for all
protocol requests. Providers are ordered Solid-OIDC, UMA, then LWS; UMA and the default LWS ID-token
source share the Solid session and its fence. LWS-specific Bearer challenges bypass the broad Solid
matcher. Credentials only attach within static roots or automatically verified storage roots.
Set `boundary.automatic: false` for a static-only boundary. `boundary.eligible` restricts both static
and discovered roots. Public and excluded resources never prompt; unverified 401s remain 401s.

Client Identifier Documents require HTTPS. `{ dynamicRegistration: true }` is permitted only with a
loopback callback outside production. Plain HTTP additionally requires `allowInsecureLoopback: true`;
it is checked on every protocol hop and never authorizes non-loopback HTTP. Browser callback origins
must match the current application origin. Loopback includes localhost, 127.0.0.0/8 and ::1.

Optional `storage.sessions` and `storage.caches` accept structural async key-value stores, namespaced
by client configuration. Metadata and refresh-only session records use separate stores; access/ID
tokens and client registrations stay in memory. Browser defaults use `createBrowserCaches` with
IndexedDB and a shared fence; Node defaults use memory. Storage failures propagate. `clock` supplies
event timestamps; protocol expiry validation remains in the engine.

`restore()` reads the last-active account pointer and attempts a DPoP refresh grant without opening
interactive authorization. The same non-extractable ES256 private key and exportable public key are
persisted beside the refresh token under `(issuer, WebID, actual client_id)`, within the app namespace.
An unloadable, extractable, mismatched or non-ES256 key discards the credential before redemption.
Access and ID tokens stay in memory. Rotation is persisted before an identity or restore event is exposed.
Web Locks serialize refreshes across tabs; Node falls back to keyed FIFO locks within the current realm
when Web Locks are unavailable. The fallback does not coordinate separate workers or processes.
Browsers without Web Locks fail closed.

A definitive `invalid_grant` deletes the dead credential, then permits one `prompt=none` authorization
through `ui.getCode`. That hook must honor `prompt=none`; restore never falls back to an interactive
attempt and never creates an iframe. Initial login requests consent directly. Transient refresh,
network and discovery failures return `null` and retain the credential/pointer for a later retry.
Storage failures reject. `remembered()` reads only the last-active public pointer and returns zero or one
`{ webId, issuer }` records, without loading credentials, contacting the issuer or invoking UI.
The pure `decideSilentRestore` decision and its tests are ported verbatim from solid-session-restore
(the test import path is relocated); they remain internal to pod-auth.

`logout()` revokes stored refresh tokens through the engine when the issuer advertises RFC 7009,
fences in-flight work, purges all sessions/keys and the remembered pointer for this client configuration,
and emits `logout`. It also works on a fresh instance without redeeming the stored token. Revocation
and storage failures reject after cleanup has been attempted and the event emitted. Caller-owned data
outside the auth namespace is preserved. Local logout does not sign out the OP browser session.
Listen for `logout` to clear application capability caches. A subsequent login can select another account.

`on` returns an idempotent unsubscribe function. `login` fires once when an identity is established,
including reactive authentication; `challenge` fires when a provider accepts an authorized 401.
Each event contains `type`, an identity snapshot and `timestamp`; challenge events also have `url`.
Observer exceptions do not interrupt authentication. `restore` fires when a remembered session is rebuilt; `expired` fires when its credential is gone;
`logout` fires after cleanup, including failed revocation. Identity snapshots include the current boundary roots.

React and Node subpaths remain empty for their own tasks. CID agent mode currently rejects: `{ documentUrl, keyId }` does not supply a signing key;
T-034 owns the Node key configuration. No keys are silently generated for an existing CID document.

The Node-only `@jeswr/pod-auth/testing` subpath exports `createMockOp` and `createMemoryStore`.
The mock OP ports the imported protocol test helpers to an injected HTTPS transport, checking actual
PKCE, state/nonce, DPoP signatures/binding/replay and LWS ID-token exchange. It also supplies a fake
`getCode` UI hook. Install its fetch as the pristine transport **before** constructing auth in tests.

```sh
pnpm --filter @jeswr/reactive-authentication run build
pnpm --filter @jeswr/pod-auth run lint
pnpm --filter @jeswr/pod-auth run build
pnpm --filter @jeswr/pod-auth run typecheck
pnpm --filter @jeswr/pod-auth run test
```

Tests enforce 100% branch, function, line and statement coverage, including adversarial behavior.
