<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/pod-auth

> **Experimental — AI-agent-generated.** T-031 authentication core; private pending conformance.

Suite policy over `@jeswr/reactive-authentication`, following SDK core ADR-004 D2/D3.
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
Account changes require a new instance until the logout lifecycle is implemented in T-032.

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

`on` returns an idempotent unsubscribe function. `login` fires once when an identity is established,
including reactive authentication; `challenge` fires when a provider accepts an authorized 401.
Each event contains `type`, an identity snapshot and `timestamp`; challenge events also have `url`.
Observer exceptions do not interrupt authentication. Event names `restore`, `logout` and `expired`
are reserved for the T-032 session lifecycle. Identity snapshots include the current boundary roots.

T-032 supplies restore/logout/remembered-account policy. React and Node subpaths remain empty for their
own tasks. CID agent mode currently rejects: `{ documentUrl, keyId }` does not supply a signing key;
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
