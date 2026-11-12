<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

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
The UI hook owns popup/redirect cleanup and must honor its abort signal. To let the user cancel a
sign-in, pass `auth.login(hint, { signal })`: on abort the popup's signal and the attempt's requests
abort, and the call rejects once the attempt has wound down, with stored sessions left alone. If a
grant had already arrived when the abort was seen, pod-auth discards it with a full `logout()` first. Protocol validation, PKCE,
DPoP proofs, refresh machinery and discovery stay in the protocol engine. A missing issuer chooser
throws `AmbiguousIssuerError` when a profile lists several issuers; a chooser must return a listed URL.
Explicit WebID and issuer hints must agree with the profile and the authenticated identity.
Concurrent logins with the same hint share one promise; different hints reject while login is pending.
Call `logout()` before switching accounts on the same instance.

For an issuer-only Solid login, the returned WebID must list that issuer as `solid:oidcIssuer`.
The protocol engine enforces this binding with `verifyWebId: true` before storing a session or reporting
an identity. An unlisted issuer rejects `login()` with `IssuerNotAuthorizedError`, re-exported from
pod-auth with `webId` and `issuer` fields. Profile fetch and parse failures keep their existing errors.
Issuer-only login reads the profile once; WebID hints retain profile discovery and claim-equality checks.

`auth.fetch` is the manager's unbound fetch function. Global fetch is preserved and captured for all
protocol requests. Providers are ordered Solid-OIDC, UMA, then LWS; UMA and the default LWS ID-token
source share the Solid session and its fence. LWS-specific Bearer challenges bypass the broad Solid
matcher. Credentials only attach within static roots or automatically verified storage roots.
Set `boundary.automatic: false` for a static-only boundary. `boundary.eligible` restricts both static
and discovered roots. Public and excluded resources never prompt; unverified 401s remain 401s.
`boundary.storageEndpoints` (absolute paths such as `"/account/domains"` or `"/.notifications/"`)
extends each verified profile storage to those server APIs on the same origin; they reuse the
storage's grant and are not reported in `Identity.storages`. A path ending in `/` covers its
descendants; any other path matches exactly. A path that is itself a verified storage or a static
root stays a storage with its own grant.

`auth.fetch` buffers request bodies so it can replay them after a 401. Bodies larger than
`maxReplayBodyBytes` (default 16 MiB) reject; the size is checked after the body is read, so it
limits requests, not peak memory. A `Blob` or `File` passed as the body is replayed as it is,
without buffering, so pass uploads as a `File` rather than raising the limit.

Credential roots come exclusively from `boundary.roots` (including explicit application/user grants)
or the authenticated WebID profile's `pim:storage` statements about that exact WebID. Automatic roots
load during `login()` and `restore()`; call one before fetching when no static roots are configured.
Without a WebID, configure roots explicitly. Neither the WebID document's origin nor the OIDC issuer's
origin is implicitly a resource grant. Profile-linked non-container storage identifiers may resolve to
LWS descriptions (`id`, `Storage`, `StorageRoot.serviceEndpoint`) or Solid descriptions (`pim:Storage`).
An advertised root must be a container on the storage identifier's origin and confirm itself through
an unauthenticated, non-redirected HEAD: a Solid `pim:Storage` type Link or exactly one LWS storage Link
back to that identifier. This includes roots above the identifier; an unconfirmed broader same-origin
root grants nothing. Invalid, foreign-origin and non-container roots are silently dropped.
Description requests omit credentials and reject redirects. Profile redirects locate the public
document; assertions must still name the original WebID. Invalid assertions grant nothing.

A target's `Link` headers, `pim:Storage` type, ancestor responses, storage description, or
`WWW-Authenticate` challenge never adds a credential root. UMA authorization servers must be on the
requested storage's origin or an explicitly configured root's origin (`boundary.roots`); a storage
learned from the WebID never authorizes its AS for another storage. UMA RPTs
are cached per storage and account selection, including after `restore()` reuses one OIDC session
across storages. LWS authorization servers and exchange endpoints must use an already granted storage
origin or an explicitly configured AS origin; configure such an AS using `boundary.roots`.
LWS realms must fit a grant, or identify a description whose root
contains the resource within that grant. A challenge cannot expand the token audience beyond it.
These checks apply to both OIDC ID-token and CID subject-token exchanges. An untrusted target receives
no SDK Authorization header, token-bound DPoP proof, UMA claim token, or LWS subject token.

Credentialed fetch attempts use manual redirects. Each visible hop rechecks the same boundary and
creates credentials only for an authorized destination; foreign hops receive no SDK credentials.
Browser `opaqueredirect` responses remain opaque. Exchange requests reject redirects. Logout and
session supersession clear automatic roots and fence pending profile discovery; restore reloads roots
from the profile rather than trusting remembered resource URLs or cached response hints.

Client Identifier Documents require HTTPS. `{ dynamicRegistration: true }` is permitted only with a
loopback callback outside production. Plain HTTP additionally requires `allowInsecureLoopback: true`;
it is checked on every protocol hop and never authorizes non-loopback HTTP. Browser callback origins
must match the current application origin. Loopback includes localhost, 127.0.0.0/8 and ::1.

Native apps explicitly set `nativeRedirect: true` and a callback such as
`redirectUri: "org.jeswr.suite:/oauth/callback"`. This requires a lowercase reverse-domain private-use
scheme, an absolute path, and no authority, credentials, query, fragment or URL normalization. Supply
an HTTPS Client ID Document URL with `application_type: "native"` and the exact callback registered.
Dynamic registration, `allowInsecureLoopback: true` and HTTP(S) callbacks are forbidden in this mode.
Only the native callback bypasses the application-origin check; protocol and resource transport
policies still apply. The scheme URI is preserved in authorization and token requests. Login without
known storage roots uses an unfetched synthetic HTTPS URL on the client document's origin as its
session context; neither that URL nor the callback grants resource access. `ui.getCode` still returns
the complete callback URL with `code`, `state` and `iss` and honors cancellation.

## Provider directory and sign-in addresses

`@jeswr/pod-auth/directory` exports the deeply frozen `KNOWN_PROVIDERS`, `SolidProvider` metadata,
`providersFromConfig` for comma-separated HTTPS provider URLs, `classifyLoginInput` for immediate URL
validation, and `resolveLoginTarget` to check a WebID or provider address. Pass a pristine public fetch
as `publicFetch`, captured before any authentication wrapper; never pass `auth.fetch`.

```ts
import { resolveLoginTarget } from '@jeswr/pod-auth/directory';
const target = await resolveLoginTarget(address, { fetch: publicFetch });
const hint = target.kind === 'webid'
  ? { webId: target.webId }
  : { issuer: target.issuer };
await auth.login(hint);
```

Resolution tries both interpretations, requires discovery to name the supplied issuer, honors an
optional abort signal, and caps each response at 1 MiB. Invalid URLs throw `InvalidLoginAddressError`
(a `TypeError`); an address answering as neither kind throws `NotALoginAddressError`. HTTP is allowed
only on loopback with `allowInsecureLoopback: true`. The directory has no auth state or DOM dependency.

`createRecentProvidersStore(storage)` remembers at most five public HTTPS issuer addresses, most
recent first. It tolerates corrupt or unavailable storage and stores no credentials. Default providers
use monograms; `label` and `iconUrl` are optional host configuration. Re-verify the provider directory
and sign-up links live before release.

## Self-registration (`./registration`, SDK-APP-05)

```ts
import { createRegistration, RegistrationError } from '@jeswr/pod-auth/registration';

const registration = createRegistration({
  accountApi: 'https://provider.example/.account/', // null disables registration
  podAuth: auth, // the application's existing core; owns OIDC UI and the resulting session
  // podHost: 'https://pods.example/', // defaults to the CSS issuer above the account index
});

if (await registration.available()) {
  const { pod, webId } = registration.previewUrls('alice');
  const availability = await registration.checkUsername('alice', { signal });
  const identity = await registration.register(
    { username: 'alice', displayName: 'Alice', password },
    { signal, onStep: (step, created) => renderProgress(step, created) },
  );
  await auth.fetch(pod); // Identity contains public claims; fetch belongs to PodAuth.
}
```

`available({ signal? })` GETs the CSS v7 JSON index and requires public `account.create` and
`password.login` controls. Scoped password/pod/WebID controls are checked after account creation,
when CSS can advertise them. Missing controls return false; transport/HTTP/parse failures reject.
`methods` is frozen `['password']`; passkeys are not implemented or inferred.

Usernames are 3–30 lowercase ASCII letters, digits or hyphens. Invalid names return `invalid`
without network; HEAD on the predicted pod gives `available` for 404, `taken` for 2xx, and
`unknown` for 401/403 (CSS also denies missing children of a non-public root, so a denial does
not prove the name is used). `register` proceeds on `unknown`. A name registered before then
fails at password enrollment, because its derived login ID exists: CSS answers 400 and `register`
reports `username-taken` at step `password` (`weak-password` comes only from the local policy
check, before any request). CSS 7 needs a login method before pod creation and removes the
login-less account this leaves after 30 minutes. If only the pod name is taken, CSS's 400
pod-name conflict becomes `username-taken` unless a re-probe sees 404.
Other statuses, redirects and network failures throw. `previewUrls` is pure and returns
`{ pod: '<podHost>/<name>/', webId: '<pod>profile/card#me' }`; invalid names throw.

CSS requires an email-shaped password login ID. With this username-only contract, it is
`<username>@registration.invalid`, exposed as `created.loginId` in progress/errors. Show that
identifier when the user needs to sign in through CSS's password form. It is a reserved identifier,
not a verified email or password-recovery destination; email enrollment is outside this API.
Passwords require at least eight characters and no leading/trailing whitespace (CSS trims them).
Display names must be nonblank and exclude control characters other than tab/newline/CR.

`register` reports `account`, `password`, `pod`, `webid`, `profile`, `sign-in` before each step.
It creates the account, adds and authenticates its password, creates the named pod with
`linkStorage: true`, and verifies CSS's automatically linked WebID (linking it if absent).
It then establishes OIDC via `auth.login({ issuer })`, verifies the exact new WebID/issuer,
and PATCHes only that WebID's profile document through `auth.fetch`. The names are built with
`@rdfjs/wrapper` and serialized by n3 into a SPARQL INSERT, preserving issuer/storage and other
profile statements. Finally `login({ issuer })` returns the established Identity without a
second authorization prompt. An unrelated existing identity fails before the profile write.

Only index controls supply account-operation URLs. They must be same-origin with `accountApi`,
HTTPS, and free of URL credentials, queries and fragments. Every request refuses redirects;
account requests use a captured pristine transport, `credentials: 'omit'`, and per-call
`CSS-Account-Token` authorization. Cookies are neither read nor stored. `fetch?` injects that
pristine transport; never supply `auth.fetch`. HTTP requires `allowInsecureLoopback: true` and
a loopback host outside production. Passwords/account tokens are never cached, logged, returned,
included in URLs/errors/causes, or retained by the client after the call. The resulting OIDC
session remains owned by PodAuth's normal credential lifecycle.

Failures throw `RegistrationError` with `code`, `step` and frozen `created` public progress.
Codes include `username-taken`, `weak-password`, `registration-closed`, `invalid-username`,
`invalid-display-name`, `unsafe-control`, `invalid-response`, `identity-mismatch`,
`registration-in-progress`, and `registration-failed` (including cancellation/network failures).
Progress records confirmed `account`, `password`, `podUrl`, `webId`, `profile`, `loginId`, and
`signInHint: { issuer }`. A successful account/password HTTP response remains recorded even
if its JSON is corrupt. Ambiguous transport failures can have server-side effects; do not
blindly retry the whole registration. Use progress to explain recovery/sign-in to the user.
Concurrent registrations on one client reject; no credential-bearing resume state is stored.

The shell adapter can map `webId` to `accountId`, retain `podUrl`/`signInHint`, and group these
steps into its existing pod/account-ID/sign-in UI. This change does not wire application flows.

The socket-based integration lane reuses in-process CSS 7.2.0 from storage-conformance:

```sh
pnpm exec turbo run build --filter=@jeswr/storage-conformance... --concurrency=2
pnpm --filter @jeswr/storage-conformance run test:registration
```

It exercises real password/OIDC consent, RDF names, and a private-pod read. It has no skip flag
and runs separately from the offline unit gate per ADR-009. Unit coverage for registration is 100%.

## Generate the suite Client Identifier Document

From the workspace root, generate the static document required by ADR-004 D7:

```sh
node scripts/client-id.mjs client-id.config.json path/to/public
```

The JSON config describes one HTTPS suite origin and every permitted popup or full-page callback:

```json
{
  "origin": "https://suite.example",
  "name": "Solid Suite",
  "logo": "https://suite.example/logo.svg",
  "redirectUris": [
    "https://suite.example/auth/callback.html",
    "https://suite.example/drive/auth/callback.html"
  ],
  "fedapp": {
    "sectors": ["https://jeswr.org/ns/sectors/scheduling#sector"],
    "access": ["http://www.w3.org/ns/auth/acl#Read"],
    "consumes": ["http://www.w3.org/2005/01/wf/flow#Task"],
    "produces": ["http://www.w3.org/2005/01/wf/flow#Task"],
    "declaresShape": ["https://suite.example/shapes#TaskShape"]
  }
}
```

`origin`, `name`, a non-empty `redirectUris`, and `fedapp.sectors` are required. `logo` and the other
federation arrays are optional. Federation values are absolute HTTP(S) IRIs; `access` accepts only
the canonical `http://www.w3.org/ns/auth/acl#Read`, `Write`, `Append`, or `Control` mode IRIs.
`consumes`/`produces` reference shapes or shared classes; `declaresShape` claims authorship of a SHACL
shape, so include it only when the app defines that shape. This generator supports flat app-level
declarations. It does not infer per-sector permissions.

The generator writes `path/to/public/.well-known/solid-client-id.jsonld`. It fixes the client ID to
the configured origin plus that path, requests `openid webid offline_access`, declares a public
client (`none`) and DPoP-bound access tokens, and embeds canonical federation mappings from
`packages/solid-federation-vocab/context.jsonld`. It never fetches contexts or reads environment
variables. Unknown fields, credentials in URLs, non-HTTPS deployment URLs, cross-origin callbacks,
fragments in callbacks, and URLs requiring silent normalization fail before any output is written.
Redirect URLs remain byte-for-byte intact; exact duplicates are removed in first-seen order.
HTTP federation IRIs are identifiers, not transport destinations.

Serve the generated resource at exactly `https://suite.example/.well-known/solid-client-id.jsonld`
with `Content-Type: application/ld+json`, and use that URL as pod-auth's `clientId`. Include the
artifact in each Vercel deploy; keep its contents fixed for that deploy. The script generates the
file only; the hosting application configures the route and headers. It does not change app builds
or publish a deployment.

## Session lifecycle

Optional `storage.sessions` and `storage.caches` accept structural async key-value stores, namespaced
by client configuration. Metadata and refresh-only session records use separate stores; access/ID
tokens and client registrations stay in memory. Browser defaults use `createBrowserCaches` with
IndexedDB and a shared fence; Node defaults use memory. Storage failures propagate. `clock` supplies
event timestamps; protocol expiry validation remains in the engine.

`restore()` reads the last-active account pointer and attempts a DPoP refresh grant without opening
interactive authorization. The same non-extractable ES256 private key and exportable public key are
persisted beside the refresh token under `(issuer, WebID, actual client_id, DPoP public key)`, within
the app namespace. Separate grants for the same account keep their own credentials and refresh locks;
rotation updates only the matching grant. Superseded grants remain available for logout across reloads.
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

LWS supports both RFC 9728 `resource_metadata` and legacy Bearer `as_uri`/`realm` challenges.
The default `oidc-id-token` subject reuses the selected Solid session; no second OP login is needed in
that credential context. Discovery bindings are verified before acquiring a subject credential.

Node agents use `@jeswr/pod-auth/node`:

```ts
import { forClientCredentials, forCid } from '@jeswr/pod-auth/node';

const service = await forClientCredentials({
  issuer: 'https://op.example/', clientId, clientSecret,
  boundary: ['https://pod.example/agent/'],
});
const agent = await forCid({
  documentUrl: 'https://agent.example/id', keyId: 'https://agent.example/id#key-1',
  privateKey, // caller-provisioned, non-extractable ES256 CryptoKey
  boundary: ['https://storage.example/agent/'],
});
```

Node factories accept an optional trusted `fetch`, captured at construction without changing
`globalThis.fetch`. Protocol endpoint and loopback checks still apply on every hop.

The same Node entry exports `createNodeOidcClient`, `ServerAuthorizationState`,
`exportServerDpopKey`, `importServerDpopKey` and `SERVER_MAX_REPLAY_BODY_BYTES` for trusted
server login brokers. This split callback protocol delegates to reactive-authentication's
server OIDC client, with S256, state, nonce, ID-token signatures and bounded DPoP nonce retries.
Its caller must encrypt pending state and the private JWK envelope, consume callbacks once,
claim refresh ownership atomically, persist rotation before use, and scope every resource fetch.
The envelope retains the original private JWK for JSON-only encrypted server vaults; signing
keys are imported as non-extractable. Browser persistence continues to store CryptoKeys only.
It also exports `storageDescriptionRoots(storage, { fetch }, { signal, allowInsecureLoopback? })`,
the storage-description reader behind the LWS realm rule: it returns the roots an LWS or Solid
description advertises (no credentials, no redirects, `[]` on any failure). The roots are claims;
a broker must still require each one to lie inside the session's stored roots.

Both factories establish an identity before returning. Client credentials use a DPoP grant and report
the configured client identifier as the subject, with no inferred WebID. CID mode signs short-lived,
AS-audience JWTs with `sub = iss = client_id = documentUrl`, exchanged for storage Bearer tokens.
Before exposing a CID identity or signing a subject token, pod-auth dereferences the CID document
without credentials or redirects, requires the exact `JsonWebKey` method, controller and
`authentication` authorization, and proves that its public key matches the supplied private key.
An unresolved, unauthorized or mismatched method rejects; there is no OIDC fallback or implicit key generation.

The equivalent core configuration is
`lws: { subject: { cid: { documentUrl, keyId, privateKey } } }`. CID mode is an agent identity,
so UI hooks are unused; configuration without a signing key fails closed. CID URLs require HTTPS and
`keyId` must be an absolute fragment URL in the same document. ES256 is the supported agent algorithm.
Agent credentials, access tokens and keys stay in memory. `restore()` returns an existing live identity
or null; `remembered()` is empty. Logout fences outstanding work, clears token caches, and requires
CID resolution again on the next login. The caller owns provisioning and retention of the signing key.
Node factories require explicit static roots. Core CID mode also needs configured roots for authenticated
resource access: a CID subject does not implicitly authorize storage origins.

React consumers mount one provider and read `usePodAuth()` from `@jeswr/pod-auth/react`:

```tsx
<PodAuthProvider auth={auth}><App /></PodAuthProvider>
// Or provide config={options} to construct the core once.
const { status, identity, webId, fetch, login, logout, error } = usePodAuth();
```

The provider silently restores once on mount, including StrictMode effect replay, and reports
`restoring`, `unauthenticated` or `authenticated`. Authentication depends on identity rather than
WebID presence, so CID and client-credentials agents work too. Login/restore/logout/expired events
from the same core instance update React even when initiated elsewhere. Late restore results cannot
overwrite a newer lifecycle event; unmount removes subscriptions and ignores delayed work.
Fetch and action handles remain stable across renders. Login takes the core's optional `{ webId, issuer }`
hint; action failures reject and populate `error`, while aborted login is suppressed. The next action
clears the error. React is an optional peer and is imported only through the React subpath.


The Node-only `@jeswr/pod-auth/testing` subpath exports `createMockOp`, `createMockLwsAs` and `createMemoryStore`.
The mock OP ports the imported protocol test helpers to an injected HTTPS transport, checking actual
PKCE, state/nonce, DPoP signatures/binding/replay and LWS ID-token exchange. It also supplies a fake
`getCode` UI hook. The separate mock LWS AS supports both challenge forms and validates signed OIDC/CID subjects, audiences and CID replay. Install its fetch as the pristine transport **before** constructing auth in tests.

```sh
pnpm --filter @jeswr/reactive-authentication run build
pnpm --filter @jeswr/pod-auth run lint
pnpm --filter @jeswr/pod-auth run build
pnpm --filter @jeswr/pod-auth run typecheck
pnpm --filter @jeswr/pod-auth run test
```

Tests enforce 100% branch, function, line and statement coverage, including adversarial behavior.
