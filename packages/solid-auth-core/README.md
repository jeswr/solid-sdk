<!-- AUTHORED-BY Claude Fable 5 -->
# @jeswr/solid-auth-core

The **shared, framework-free Solid login/auth core** for the `@jeswr` app suite — the one
library apps call instead of hand-rolling a WebID/DPoP token provider and React session
glue. Extracted from `@jeswr/solid-elements`' adversarially-reviewed auth controller
(shared-logic upstreaming review, P0.3), it is the permanent home of the fix for the
suite-wide **login-stall bug** — and it makes that bug class **unrepresentable by
construction**, not merely fixed.

> **Status:** under active development. Security-critical (`securityCritical: true`) —
> changes go through exhaustive tests + adversarial review.

## Install

```bash
# GitHub-installable today (committed, self-contained dist/ — works under ignore-scripts=true):
npm install github:jeswr/solid-auth-core#main
# npm publish is a deferred migration.
```

The off-npm `@jeswr/solid-session-restore` is **inlined into the committed `dist/`** — you
do not install it. Everything else (`oauth4webapi`, `dpop`, `n3`, `@jeswr/fetch-rdf`,
`@solid/object`) resolves from npm as regular dependencies. `react` is an **optional**
peer, needed only for the `/react` subexport.

## Quick start

```ts
import { createSolidAuth } from "@jeswr/solid-auth-core";

const auth = createSolidAuth({
  callbackUri: `${location.origin}/callback.html`,
  clientId: `${location.origin}/clientid.jsonld`, // your Client Identifier Document
  authFlow: { getCode },                          // your popup driver (e.g. <authorization-code-flow>)
  patchGlobalFetch: true,                         // optional: bare fetch() callers get the token too
});

await auth.restore();                 // silent restore on load (fail-closed; never a popup)
await auth.login("https://me.example/profile/card#me"); // interactive when needed
const res = await auth.authenticatedFetch(podUrl);      // DPoP-bound, allowed-origins only
const pub = await auth.publicFetch(foreignUrl);         // pristine, credential-free
await auth.logout();                  // clears the persisted credential; fail-closed
```

**Two teardowns — call the right one** (the silent-session-restore availability
invariant): `logout()` is the DEFINITIVE teardown (an intentional sign-out, or a proven
`invalid_grant`/401-revoked refresh token) — it deletes the persisted credential and the
restore pointer. `dropSession()` is the TRANSIENT teardown — it drops the live in-memory
session (webId null, pristine fetch again, logged-out session-change) but **keeps** the
persisted credential + restore pointer, so the next page load silently restores. Use it
when a post-restore read fails for any transient reason (network blip / 5xx / timeout):
calling `logout()` there permanently deletes a still-valid credential and forces a manual
re-login. (The engine's own restore/refresh grants already keep the credential on
transient failures and clear it only on a definitive `invalid_grant`; `dropSession()`
extends that distinction to the teardown the app performs around its own reads.)

React apps use the `/react` subexport instead of a hand-rolled `SessionProvider.tsx`:

```tsx
import { SessionProvider, useSolidSession } from "@jeswr/solid-auth-core/react";

<SessionProvider config={{ callbackUri, clientId, authFlow }}>
  <App />
</SessionProvider>;

function App() {
  const { status, webId, fetch, login, logout, error } = useSolidSession();
  // status: "restoring" → "authenticated" | "unauthenticated"
}
```

## Why the login stall is impossible here (the design)

**The bug class** (bead `suite-tracker-8575`; latent in 9+ of the 21 hand-forked
`webid-token-provider.ts` copies): an app patches `globalThis.fetch` with a proactive
authed wrapper whose credential boundary deliberately includes the **issuer's origin**. A
token provider whose own OIDC traffic (discovery, client registration, token grants)
defaults to the global then **re-enters the patch** → `provider.upgrade(discoveryRequest)`
→ which single-flights onto the very pending login promise that issued the discovery
request. A circular await: interactive login hangs forever, after the profile read and
before the popup ever opens.

**This package removes the bug by construction, three layers deep:**

1. **Pristine capture FIRST, pinned everywhere.** The pristine native `fetch` is
   snapshotted at **module load** (before this package could have patched anything) and
   the engine anchors on it at **construction**. Every OIDC hop — discovery, dynamic
   client registration, the authorization-code and refresh-token grants (via
   `[oauth.customFetch]`), and the silent-restore grant — is pinned to that pristine
   fetch. **There is no `oauthFetch` config knob and no code path that reads the live
   global**: the safe wiring is the only wiring. (`profileFetch` exists as a test seam,
   but the OIDC hops never ride it either.)
2. **Brand-unwrapping closes the recapture residual.** Every fetch wrapper this package
   installs is *branded* (a `Symbol.for` marker pointing at its pristine base).
   `resolvePristineFetch` unwraps the chain — so even if this module is loaded **after**
   one of its own wrappers patched the global (a second bundle copy, a late dynamic
   import), or a caller mistakenly passes the patched global back in as `publicFetch`,
   the engine recovers the **true** pristine fetch instead of recapturing a patch. A
   *foreign* pre-load patch is not ours, so our provider can never re-enter our own
   wrapper — the self-deadlock cannot be assembled; for that exotic case the documented
   `publicFetch` injection seam remains.
3. **The engine-owned fetches never chain the global.** `authenticatedFetch` and the
   `patchGlobalFetch: true` wrapper both run over the captured pristine base — never a
   live `globalThis.fetch` read — with a fail-closed allowed-origins credential boundary
   (https-only; loopback http behind an explicit dev opt-in), proactive token attach,
   RFC 9449 §8 DPoP-nonce handling, and one bounded 401 retry.

The **flagship regression test** (`test/login-stall.test.ts`, ported from the AccessRadar
reproduction) rebuilds the deadlock topology — a re-entrant patched global whose boundary
includes the issuer — against a mock OP with the **real** oauth4webapi/dpop/fetch-rdf
stack, races login against a deadline, and asserts the OIDC hops ride **only** the
pristine fetch while the pod probe is the **only** request through the patch.

## What's in the box

| Export | What it is |
|---|---|
| `createSolidAuth(config)` → `SolidAuth` | The keystone factory: WebID→issuer resolution (via `@jeswr/fetch-rdf` + `@solid/object`, never regex), interactive auth-code + PKCE(S256) + DPoP login (oauth4webapi; DPoP-only, `dpop_jkt` binding), silent restore + proactive refresh (via the inlined `@jeswr/solid-session-restore`; IndexedDB, WebID-scoped, fail-closed), logout/credential-revoke sequencing plus the credential-keeping `dropSession()` transient teardown, recent-accounts, `onSessionChange`, and the two-fetch boundary (`authenticatedFetch` / `publicFetch`) |
| `WebIdDPoPTokenProvider` | THE token provider (successor to the 21 app-local copies): DPoP proofs via the audited `dpop` package, per-origin RS nonce cache, fail-closed origin gate, proactive refresh — constructed/wired by the factory |
| `installProactiveAuthFetch` + `proactiveAuthenticatedFetch` + `deriveProactiveAllowedOrigins` | The proactive authenticated-fetch wrapper, **moved here from `@jeswr/solid-elements`** (which will re-export). For apps that keep their own provider |
| `@jeswr/solid-auth-core/react` | `SessionProvider` + `useSolidSession()` — the one React session glue (replaces the 14 divergent app copies); injectable-`auth` seam so it tests with a fake, no server |
| Pure seams | `computeAllowedOrigins`, `isOriginAllowed`, `htuOf`, `isUseDpopNonceChallenge`, `parseWwwAuthenticate`, `validateWebId`, `sameWebId`, `resolvePristineFetch`/`brandFetchWrapper`/`PRISTINE_BASE` |

Security posture inherited from the solid-elements controller (all regression-tested, 168
tests): generation-fenced login/restore/logout (no cross-account clobbering), serialized +
generation-guarded persistence (rotation writes can't undo a logout), drain-before-bump
refresh-token lifecycle, cross-account refresh guard, DPoP-only token acceptance,
cleartext-origin rejection, fail-closed WebID validation, and the foreign-origin
credential boundary.

## Migrating the 21 forks (the plan of record)

Per the shared-logic upstreaming review (§3.2), each app deletes its local copies of
`webid-token-provider.ts`, `SessionProvider.tsx` / `auth-context.tsx`,
`restore-session.ts`, `autologin-plan.ts`, `login-ux.ts`, `single-flight.ts` and replaces
them with:

```ts
const auth = createSolidAuth({ callbackUri, clientId, authFlow, ... });
```

plus (React apps) the `/react` `SessionProvider`. Migration rings: the
`create-solid-app` template + the `solid-ai-coding` skill first (the propagation vectors),
then the 9 vite pod-apps, then Issues/PM/the Next.js products, then the forks
(elk/excalidraw/miniflux). `@jeswr/solid-elements`' `createReactiveAuthController` becomes
a thin re-export over this package (separate task — solid-elements is untouched by this
extraction). Autologin/deep-link SSO and login-UX helpers land here as follow-ups before
ring 2.

## Development

```bash
npm install
npm run lint        # biome + lockfile-transport guard
npm run typecheck   # tsc --noEmit
npm test            # vitest (168 tests incl. the flagship stall regression)
npm run build       # esbuild bundle (session-restore inlined) + tsc d.ts → dist/
npm run check:dist  # committed dist/ matches a fresh build + d.ts self-containment
```

`dist/` is **committed** so the package installs from a GitHub branch with no build step
under `ignore-scripts=true`; `check:dist` fails the gate if it drifts from `src/`.

## License

MIT © Jesse Wright
