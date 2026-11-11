---
name: pod-auth
description: Use when integrating @jeswr/pod-auth login, multi-account managers, bounded auth.fetch, restore, React sessions, Node agents, CSS self-registration or Client Identifier Documents, or migrating deprecated suite client authentication.
---
<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Work with `@jeswr/pod-auth`

Use this package for new suite client authentication. It owns session policy over the imported
`@jeswr/reactive-authentication` protocol engine. It supersedes the current-integration guidance in
[`skills/solid-reactive-authentication`](../../skills/solid-reactive-authentication/SKILL.md), which
routes existing integrations to the current packages and historical references.
Read [README.md](./README.md) and `src/types.ts` for the implemented API; do not infer APIs from the
published 0.1.x package or copy its providers into applications. This workspace package remains
private and experimental pending conformance.

`@jeswr/pod-auth/node` also exports `createNodeOidcClient` for server-side brokers (mcp-oauth's
pod sessions). It delegates split server authorization to reactive-authentication. Its sensitive
state and original private JWK envelope belong only in an encrypted server vault with callback consume,
refresh CAS and durable retirement. Signing keys are imported non-extractable; browser key storage is unchanged.

## Quick reference

| Entry point | Use |
| --- | --- |
| `@jeswr/pod-auth` | `createPodAuth`, credential-bounded fetch, UI hooks and session lifecycle |
| `@jeswr/pod-auth/react` | Optional `PodAuthProvider` / `usePodAuth` lifecycle mirror |
| `@jeswr/pod-auth/accounts` | `createAccountManager`, independent account sessions, local switching and restore |
| `@jeswr/pod-auth/node` | `forClientCredentials` and `forCid` agent factories; `createNodeOidcClient` and `storageDescriptionRoots` (LWS realm checks) for server brokers |
| `@jeswr/pod-auth/testing` | Node-only mock OP, mock LWS AS and memory store |
| `@jeswr/pod-auth/directory` | Provider metadata, WebID/provider address resolution and recent providers |
| `@jeswr/pod-auth/registration` | CSS v7 self-registration, previews, progress and typed partial failures |

```ts
import { createPodAuth, type PodAuthOptions } from '@jeswr/pod-auth';

// Supply application UI that returns the complete callback URL and honors cancellation.
declare const ui: PodAuthOptions['ui'];

const auth = createPodAuth({
  clientId: 'https://suite.example/.well-known/solid-client-id.jsonld',
  redirectUri: 'https://suite.example/auth/callback.html',
  boundary: { roots: ['https://pod.example/alice/'] },
  ui,
});

await auth.restore();
await auth.login({ webId: 'https://id.example/alice#me' });
const response = await auth.fetch('https://pod.example/alice/private');
const identity = await auth.identity();
```

For a cancel button, pass `auth.login(hint, { signal })`. Aborting aborts `ui.getCode` and the
attempt's requests; the call rejects once the attempt has wound down. Stored sessions stay unless a
grant had already arrived, which pod-auth then discards with a full `logout()`. Don't call `logout()`
yourself to cancel, since it purges every stored session.

Pass `auth.fetch` to [storage-client](../storage-client/SKILL.md),
[storage-capabilities](../storage-capabilities/SKILL.md) and
[pod-notifications](../pod-notifications/SKILL.md). Read the
[LWS differences](../../skills/lws-vs-solid/SKILL.md) for storage and grant semantics.

Construct one core per application session. `ui.getCode` must return the complete callback URL,
including `state`, `code` and `iss`, honor cancellation and own popup/redirect cleanup. Choose among
advertised issuers explicitly; omitting the chooser for multiple issuers throws `AmbiguousIssuerError`.
Same-hint concurrent login is single-flight; different hints reject while login is pending. Log out
before switching accounts on the same core, or use the account manager below. `identity()` reads claims only; it never refreshes, contacts an issuer or
returns credentials. Public profile reads are not proof of authentication.

Use the pure `./directory` entry point for shared sign-in address handling. `KNOWN_PROVIDERS` is deeply
frozen; `providersFromConfig` returns copies from comma-separated HTTPS URLs or a fallback directory.
`classifyLoginInput` checks URL shape without network; `resolveLoginTarget` tries both interpretations
using only the supplied pristine public fetch, honors abort, and caps responses at 1 MiB. It throws
`InvalidLoginAddressError` (a `TypeError`) for invalid URLs or `NotALoginAddressError` for failed probes.

```ts
import type { PodAuth } from '@jeswr/pod-auth';
import { resolveLoginTarget } from '@jeswr/pod-auth/directory';

declare const auth: PodAuth;
declare const address: string; // What the user typed.
declare const publicFetch: typeof fetch; // A pristine, credential-free fetch.

const target = await resolveLoginTarget(address, { fetch: publicFetch });
const hint = target.kind === 'webid'
  ? { webId: target.webId }
  : { issuer: target.issuer };
await auth.login(hint);
```

`createRecentProvidersStore(storage)` keeps at most five public HTTPS issuers, deduped and most recent
first; storage failures are harmless. Providers use monograms by default; host-supplied `label` and
`iconUrl` are opt-in. Re-verify default provider and sign-up addresses live before release.

## Preserve the credential boundary

- Use the unbound `auth.fetch` throughout the SDK. Preserve global fetch; never call `registerGlobally`.
  Construct auth after installing the intended pristine transport in tests. Protocol discovery,
  registration, token and refresh HTTP must never recurse through a credential-attaching wrapper.
- Keep the engine's `verifyWebId: true`: before storing a Solid session or reporting its identity,
  it requires the returned WebID's profile to list the issuer as `solid:oidcIssuer`, compared with
  `sameIssuer`, through the non-reactive protocol transport. An unlisted issuer throws the engine's
  `IssuerNotAuthorizedError` (`webId`, `issuer`), re-exported unchanged by pod-auth and propagated from
  `login()`. Profile fetch and parse failures keep their existing errors. Issuer-only login reads the
  profile once; WebID hints retain discovery and claim-equality checks. Do not duplicate the engine check.
- Credentials attach only within configured static roots or authenticated WebID-profile storage roots.
  `boundary.automatic: false` selects static-only behavior. `boundary.eligible` restricts both kinds.
  `boundary.storageEndpoints` names exact (or trailing-`/` prefix) paths on each verified storage's
  origin, for server APIs outside the pod folder; they share that storage's grant and stay out of
  `Identity.storages`. Use it only for endpoints of the server that hosts the storage.
- `auth.fetch` buffers bodies for replay after a 401; bodies over `maxReplayBodyBytes` (default
  16 MiB) reject after being read. A `Blob`/`File` body is replayed as it is and never buffered,
  so upload files as a `File` instead of raising the limit. Node agents
  (`forClientCredentials`, `forCid`) keep the default.
  Do not trust an origin merely because it hosts the issuer/WebID or returned a 401. Excluded or
  public resources must not prompt; unverified 401s remain 401s.
- Automatic roots load on login/restore from `pim:storage` assertions naming the exact authenticated
  WebID, optionally through its linked LWS/Solid description. Call login/restore first when there are
  no static roots. Identities without WebIDs, including CID agents, need configured storage roots.
  Never use `AutomaticCredentialBoundary` to authorize response-asserted roots: a target's type Link,
  storage Link/description, ancestor HEADs, challenge realm/AS or redirect destination is not a grant.
- Apply the boundary's explicit AS-origin policy to UMA and both LWS discovery forms, including CID
  composition. Exchange endpoints must also use granted origins and reject redirects. LWS audiences
  must stay inside an existing grant, directly or through a description rooted within it; metadata
  can only narrow authority. Refuse before sending claim/subject tokens to untrusted endpoints.
- Keep authenticated fetch's manual redirects and per-hop credential checks. Clear automatic roots
  on logout/session supersession, fence pending identity discovery, and reload profile roots on restore.
- Keep provider composition in `src/providers.ts`, ordered Solid-OIDC, UMA, then LWS. Share the Solid
  session and its fence with UMA and the LWS OIDC source. Keep protocol logic in the engine, including
  PKCE S256, state/nonce, DPoP binding, nonce retry limits and verified RFC 9728 / legacy LWS discovery.
- Require HTTPS for the production client ID. `{ dynamicRegistration: true }` is limited to a loopback
  callback outside production. `allowInsecureLoopback` permits only explicit development HTTP and is
  checked on every protocol hop. Browser callback origins must match the application origin.
- Native applications may explicitly set `nativeRedirect: true` with a private-use scheme callback
  such as `org.jeswr.suite:/oauth/callback`. This mode requires a lowercase reverse-domain scheme
  (suite-native's grammar); reserved schemes, authority (including empty `//`), credentials, relative
  paths, queries, fragments and URL normalization are rejected. HTTP(S) callbacks are rejected in
  native mode; omitting the opt-in retains the browser policy. Supply an HTTPS Client ID Document
  URL with `application_type: native` and the exact redirect registered; dynamic registration and
  `allowInsecureLoopback: true` are forbidden. Only the scheme callback skips the WebView-origin
  check (`capacitor://localhost` or `https://localhost` may host the app). `ui.getCode` still returns
  the complete callback URL with `code`, `state` and `iss`, and owns native cancellation/cleanup.
  The scheme URI stays in OAuth authorization/token parameters and the configuration namespace,
  never in a resource Request, boundary root or storage context. Without known roots, login uses
  `/.well-known/pod-auth/native-bootstrap` on the Client ID Document's HTTPS origin for its synthetic
  upgrade/context; that URL is never fetched or implicitly trusted. Verified storage roots alone
  gain resource access, and the first inherits the bootstrap session as in browser login.
- Fence login, refresh, restore, persistence and logout against stale work after each awaited boundary.
  Do not expose identity until credentials and refresh rotation are durable.

## Session lifecycle

`createAccountManager(options)` from `./accounts` owns one fresh core per account. Its synchronous
`accounts()` / `active()` snapshots contain public Identity values only. `add(hint?, { signal }?)`
uses a fresh session scope, DPoP key and boundary; failed/cancelled adds preserve existing state.
Duplicate WebIDs replace only their old scope and retain ordering. `switchTo(webId)` persists
the active WebID without network/navigation; `fetch` resolves the current active core at call time,
while `fetchFor(webId)` stays bound to that account. Unknown WebIDs throw `UnknownAccountError`.

`remove(webId)` uses `logout({ scope: 'session' })` on a core with a public `sessionScope`; never
use an unscoped core's all-sessions logout to remove one account. Each scope isolates credentials,
keys, restore locks and logout fences; metadata/capability caches may be shared by storage ID.
`restoreAll()` verifies each remembered pointer through its core's locked refresh/key validation,
isolates failures, and chooses the persisted active account or first restored. The pointer list is
not credential authority. `on('change', handler)` observes manager changes; `on('expired', webId => …)`
identifies the expired account. `authFor(webId)` exposes the real core; null supplies the anonymous
adapter. `dispose()` cancels work/releases cores without removing persisted credentials.
Match remembered pointers by WebID **and scope**, including stale removal and restore. Check durable
presence before cached credentials leave the core; missing pointers count as expiry for established
durable sessions. Fence asynchronous expiry checks against current identity and lifecycle generations.
Track every owned core through pending add, retirement and restore. Disposal closes their listeners
and cancels revocation deadlines immediately, preserving remembered credentials.

Use suite-sdk's `AccountsProvider` / `useAccounts` for React consumers to follow the active core
through the existing PodAuthProvider. One account is simply a manager with one account; no
single-session fallback is needed. Existing PodAuthProvider integrations remain supported.

`restore()` reads a last-active pointer and redeems the refresh token under a Web Lock. Node's keyed
FIFO fallback coordinates only the current realm, not workers/processes; browsers without Web Locks
fail closed. Restore permits one `prompt=none` attempt through `ui.getCode` only after definitive
`invalid_grant`, never interactive fallback or an iframe. Initial interactive login requests consent.

Persist only refresh records beside the matching non-extractable ES256 private key and exportable
public key, scoped by issuer/WebID/actual client ID and DPoP public key inside an application namespace.
Independent grants retain separate credentials and refresh locks even for the same account; refresh
rotation updates only its matching grant. Superseded grants stay discoverable for logout across reloads.
Discard unloadable, extractable, mismatched or non-ES256 keys before redemption.
Access/ID tokens and registrations remain
in memory. Preserve credentials/pointers on transient network/discovery/refresh failures; propagate
storage errors. Retain the verbatim ported `decideSilentRestore` decision and tests with attribution.

`remembered()` reads only public last-active metadata and currently returns zero or one records. It
does not load credentials or contact the network. `logout()` revokes when advertised, purges stored
sessions/keys and the pointer across reloads, fences in-flight work, and emits `logout` even on failure.
Await cleanup; errors reject after cleanup attempts and notification. Clear application capability
caches on `logout`. Local logout does not sign out the OP browser session.

`on('login' | 'restore' | 'logout' | 'expired' | 'challenge', handler)` returns an idempotent
unsubscribe function. Events carry identity snapshots and timestamps; observers cannot interrupt auth.
React consumers mount one `PodAuthProvider` with `auth` or `config` and read `usePodAuth()`. Restore
once across StrictMode replay, mirror core lifecycle events, fence late restore results against newer
events, and remove subscriptions on unmount. Keep action/fetch handles stable and React optional.
Use identity presence for authentication; agent identities may have no WebID.

## Node agents

`forClientCredentials` establishes a DPoP service session; `forCid` resolves an existing LWS CID and
signs its self-issued subject JWT. Both require non-empty explicit static boundary roots and keep
credentials in memory. They establish identity before returning. Client credentials report their
configured client identifier as subject; never infer a WebID from an opaque token.

CID mode, also available through core `lws.subject.cid`, requires a caller-owned non-extractable
ES256 private key. Resolve without credentials/redirects, authorize the exact same-document
`JsonWebKey` authentication method and controller, and prove the supplied key matches before exposing
identity or releasing credentials. Missing, unresolved, unauthorized or mismatched keys fail closed;
never generate a key implicitly or fall back to OIDC. The caller owns provisioning and retention.

## Client Identifier Document

Run `node scripts/client-id.mjs <config.json> <public-directory>` from the workspace root. Use the
[README config recipe](./README.md#generate-the-suite-client-identifier-document): required HTTPS
`origin`, `name`, non-empty same-origin `redirectUris`, and `fedapp.sectors`; optional `logo`,
`fedapp.access`, `consumes`, `produces` and `declaresShape`. The generator embeds the federation
package's canonical mappings, fixes public-client scope/auth/DPoP metadata and fails on unknown or
unsafe config. Redirects remain exact; production generation has no HTTP exception or environment
fallback. HTTP federation IRIs identify terms, not HTTP transport endpoints.

Serve `<public-directory>/.well-known/solid-client-id.jsonld` at exactly the generated `client_id`,
with `application/ld+json`; include all permitted popup and full-page callbacks and keep the file fixed
per Vercel deploy. Hosting/route/header wiring belongs to the consuming app. This OAuth Client
Identifier Document does not provision the LWS agent CID's authentication key or replace `forCid`'s
document-resolution checks.

## Migrate the deprecated client packages

| Deprecated package | Current direction |
| --- | --- |
| `@jeswr/solid-dpop` | Suite sessions use pod-auth; agent grants use `pod-auth/node`; proof internals stay in the protocol engine |
| `@jeswr/solid-openid-client` | Move session ownership to pod-auth; use core UI hooks for user authorization and `/node` for agent factories |
| `@jeswr/solid-session-restore` | Use core `restore()`, `remembered()` and `logout()`; persistence is owned by pod-auth |
| `@jeswr/solid-auth-core` | Replace `createSolidAuth` with `createPodAuth`, and `/react` with `PodAuthProvider` / `usePodAuth` |

These are migration directions, not drop-in export aliases. In particular `/node` exports the two agent
factories, not the old `OidcSession`/`createSolidOidcClient` API or proof helpers. Do not publish legacy
credentials into `Identity` or reproduce provider logic to preserve an old signature. Leave deprecated
code, exports and mirror pins available for existing consumers; migrate apps in their own tasks.
`auth-solid`, server verifiers and `solid-webauthn-reauth` are outside these four deprecations.

## Validate changes

Before changing authentication policy, read SDK core ADR-001 D4 and ADR-004 in
`solid-suite-planning/specs/sdk-core/`, alongside the repository's `AGENTS.md`.
This package is security-critical: preserve 100% coverage thresholds and add behavioral/adversarial
tests for changes. Use `./testing` over the real engine for boundary exclusions, callback and hint
validation, cancellation, provider routing, cross-account/stale-operation fences, key rejection,
rotation, storage failures and logout/restore races. Never log tokens, authorization codes or keys.

Build reactive-authentication before pod-auth, then run `lint`, `build`, `typecheck`, `test` and the
root gate. Generator regressions live in `test/client-id.test.mjs` under `pnpm run test:root`, with
offline OIDC schema/JSON-LD checks. Keep development tool versions aligned with root; pnpm 10.4.1
with `ignore-scripts` requires local tool declarations for filtered scripts.

## CSS self-registration

Read README's `./registration` contract and `src/registration.ts` before changing this surface.
`createRegistration({ accountApi, podHost?, podAuth, fetch?, allowInsecureLoopback? })` uses the
existing auth core, never another session. Null disables availability. Keep `methods` password-only.
Public index controls are account.create/password.login; scoped password.create/account.pod/account.webId
exist only after account creation. Follow only these controls, same-origin HTTPS, no URL credentials,
queries/fragments, cookies or redirects. Reuse guarded-fetch's refusal and bounded document reads.
Capture a pristine protocol transport; never send account requests through PodAuth.fetch.

Keep local username validation before any network, and HEAD's exact 404 available / 2xx taken /
401,403 unknown / error split. Never report 401/403 as taken: CSS denies missing children too.
A 400 from password enrollment is `username-taken` (duplicate derived login ID), never
`weak-password`; that code is only for the local pre-network policy check. Keep the order
account → password → pod: CSS 7 rejects pod creation on an account without a login method.
The username-only password ID is `<username>@registration.invalid`; expose it as public loginId,
never pretend it is a recovery email. Do not retain passwords/account tokens or raw error causes.
Snapshot inputs before awaits. Report account/password/pod/webid/profile/sign-in with frozen prior
progress, and preserve confirmed results in every typed RegistrationError. Whole-flow retries are
not idempotent; never hide partial creation or retain credential-bearing recovery state.

CSS links a freshly created WebID automatically. Verify the link; POST the advertised WebID control
only when absent. Request linkStorage on pod creation. For the protected profile, establish OIDC with
the existing auth.login, require the exact new WebID/issuer, then write only its profile through
auth.fetch. Build names with wrapper/n3, preserving server assertions; the final login returns the
established Identity. Keep passwords/account tokens outside OIDC/UI hooks and persistent storage.

Keep new-file thresholds at 100% and exercise the real protocol engine as well as fake account APIs.
`tools/storage-conformance/integration/registration.test.ts` is the real CSS 7.2.0 lane; run with
`pnpm --filter @jeswr/storage-conformance run test:registration` after dependency-first builds.
No socket/CI skip switches: integration lives separately from the offline gate per ADR-009.
