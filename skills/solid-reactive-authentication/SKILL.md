---
name: solid-reactive-authentication
description: Use when maintaining code that directly integrates the external @solid/reactive-authentication package, its authorization-code-flow element, global fetch patch, or legacy token-provider lifecycle. Prefer @jeswr/solid-auth-core for new suite applications.
---

## Quick reference

<!-- AUTHORED-BY Codex GPT-5 -->

**Maintain reactive-authentication integrations**

`@solid/reactive-authentication` is external to this workspace. New suite code should use `@jeswr/solid-auth-core`, which centralizes the provider, pristine-fetch pin, session restore, proactive auth, and React glue.

For existing direct consumers, treat `ReactiveFetchManager` as an app-lifetime singleton. Register its global patch once; logout clears provider session state rather than stacking another manager or wrapper on the next login.

### Load-bearing rules

- Capture a pristine fetch before global patching. Use it for OIDC discovery/token HTTP and every foreign-origin request.
- Do not rely on `credentials: "omit"` to bypass a patched global; the wrapper can still upgrade a 401.
- Keep provider login, restore, refresh, and reset generation-fenced. Re-check the generation after every await before writing state.
- Single-flight same-WebID login and reject simultaneous different-WebID login.
- Tear down only the session ID owned by the stale operation so an old failure cannot log out a newer session.
- Detect successful login by a token attached during that attempt, not by a public `2xx` response or a sticky historical flag.
- Do not correlate probes with custom headers; cross-origin headers can trigger rejected CORS preflights. Keep DPoP `htu` free of query and fragment.
- Lazy-read methods from dynamically defined custom elements; an eager `.getCode.bind(...)` can run before upgrade.
- Fail closed when UI state is unauthenticated but the auth boundary was armed.
- Restore must produce an authenticated, refresh-capable fetch, not only a WebID.
- Keep proactive token attachment restricted to proven resource origins. Never include a foreign service or issuer solely because it returned a 401.

Do not fork token-provider or session-provider files into another app. When touching an existing fork, migrate it toward `@jeswr/solid-auth-core` and keep cross-account, stale-operation, pristine-fetch, and login-stall tests adversarial.

### Agent persona

When this work is delegated to a sub-agent, spawn the `solid-frontend-dev` persona from
[`.claude/agents/solid-frontend-dev.md`](../../.claude/agents/solid-frontend-dev.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

The source version notes below describe the published legacy integration. New suite code
uses [solid-auth-core](../../packages/solid-auth-core/SKILL.md); use its package skill
for the current API, and these details when maintaining existing direct consumers.

# @solid/reactive-authentication — auth via a patched fetch

Mental model first (companion guide: [`AGENTS.md`](../../AGENTS.md) §Authentication): there is
**no session object and no authenticated-fetch wrapper**. `ReactiveFetchManager` patches
`globalThis.fetch` when you call `registerGlobally()` (the constructor alone does **not** patch
it in 0.1.3); afterwards every plain `fetch()` (including inside `@jeswr/fetch-rdf`) transparently
upgrades on `401` — find a matching provider, attach a DPoP-bound token, retry.

```sh
npm install @solid/reactive-authentication   # deps oauth4webapi + dpop come with it
```

Pure ESM, browser-only (custom elements, popups). In Next.js, import it **client-side only** —
the unguarded top-level `customElements.define` breaks `next build` otherwise; the mounting
recipe is in `AGENTS.md` §Mounting in Next.js.

## Published API (v0.1.2 — trust this over repo demos)

```ts
import {
  ReactiveFetchManager,          // new ReactiveFetchManager(providers: Iterable<TokenProvider>)
  DPoPTokenProvider,             // new DPoPTokenProvider(callbackUri, getCodeCallback) — 2 args
  BearerTokenProvider,           // demo-grade
  ClientCredentialsTokenProvider,// server-to-server (clientId, clientSecret)
  AuthorizationCodeFlow,         // the <authorization-code-flow> element class
  ReactiveFetchWorkerManager,    // service-worker variant — not production-ready in 0.1.x
  CodeRequestCancelledError, ReactiveFetchError,
} from "@solid/reactive-authentication";
import type { GetCodeCallback } from "@solid/reactive-authentication";
// GetCodeCallback = (authorizationUri: URL, signal: AbortSignal) => Promise<string>
```

Setup (full version with typing notes in `AGENTS.md`):

```ts
const ui = document.querySelector<AuthorizationCodeFlow>("authorization-code-flow")!;
const manager = new ReactiveFetchManager([
  new DPoPTokenProvider(new URL("/callback.html", location.href).toString(), ui.getCode.bind(ui)),
]);
manager.registerGlobally(); // 0.1.3: the constructor does NOT patch globalThis.fetch — this does
```

`/callback.html` (in `public/` for Next.js) contains the line
`<script>opener.postMessage(location.href)</script>`.

**Do not write code against** `IdpPicker`, `issuerFrom`, `GetIssuerCallback`, a 3-argument
`DPoPTokenProvider`, `registerElements`, or `AuthorizationCodeFlowUI` — these appear in the
repo/demos but are **not in the published 0.1.2**.

## Issuer resolution today

The published provider resolves the OIDC issuer **internally** from the resource URL's host:
`localhost:3000`, `*.solidcommunity.net`, `storage.inrupt.com` (PodSpaces), `*.solidweb.org`,
`*.solidweb.app`, `teamid.live`, `datapod.igrant.io`. Any other host **throws `Unknown
issuer`** — that error means the pod's host is outside the built-in map, not that your code is
wrong. A configurable issuer callback exists upstream and is expected in the next release.

⚠️ **Local CSS login is broken in 0.1.2** despite `localhost:3000` being on the list: the
issuer is hard-coded as `http://localhost:3000` and `oauth4webapi` refuses non-HTTPS issuers
(`OperationProcessingError: only requests to HTTPS are allowed`) with no app-level
`allowInsecureRequests` hook — and HTTPS-ing CSS doesn't help because the issuer URL is fixed.
Test interactive login against solidcommunity.net; use client-credentials DPoP tokens from the
CSS account API for local authenticated test traffic.



## Lifecycle and security references

- Read when persisting or restoring a DPoP-bound session. [session-restore.md](references/session-restore.md).
- Read for token-endpoint client auth or full-page autologin. [client-auth-and-autologin.md](references/client-auth-and-autologin.md).
- Read for login probes, fake-timer refresh tests, logout races, StrictMode, and pristine fetch capture. [login-lifecycle.md](references/login-lifecycle.md).
- Read for proactive token attachment, OIDC re-entrancy, and non-vacuous 401-budget tests. [proactive-auth.md](references/proactive-auth.md).

### A dynamic-import-defined custom element is not upgraded at first mount — never eager-bind its methods

When the `<authorization-code-flow>` element's **defining module** (`@solid/reactive-authentication`,
whose top-level `customElements.define("authorization-code-flow", …)` upgrades the element) is
**code-split behind a dynamic `import()`** — the right thing to do in Next.js / a host shell, so the
auth chunk doesn't block the bundle — then on a **cold first mount** `define(…)` has not run yet, the
element is **not upgraded**, and `ui.getCode` is `undefined`. So `ui.getCode.bind(ui)` (or any eager
read of `.getCode`) at mount time **throws** and breaks first-load login. A fetch-mock test harness
hides this completely — there's no real dynamic import to race. Fix: publish a **lazy accessor** to the
holder — `(...args) => ui.getCode(...args)` reads the method at **call** time (login time, after the
import has resolved and the element is upgraded), preserving the element as `this`. As belt-and-braces
for a very-early login racing the import, `await customElements.whenDefined("authorization-code-flow")`
before the call if `ui.getCode` is still not a function (`whenDefined` resolves immediately once
registered). **Never access `.getCode` at mount** — only at call time. (Cited:
[`jeswr/pod-docs@6e589ca`](https://github.com/jeswr/pod-docs/commit/6e589ca).)

## The login stack is a shared library, not a per-app fork

Two consolidation lessons that generalize past any single bug fix — learned auditing the login
code across the `@jeswr` Solid app suite (cross-repo duplication review, 2026-07):

### The WebID/DPoP token provider belongs in a LIBRARY, not copied per app

`webid-token-provider.ts` (the reference implementation this skill bundles, below) was found
hand-forked as an **app-local source file in 21 separate places** across the suite, sizes ranging
**547–2,308 lines**, with almost every copy's hash different from every other — these are forks,
not copies. That divergence is not cosmetic: it is exactly why the pristine-`oauthFetch`-pinning
fix documented above was independently *missing* (or independently rediscovered and re-fixed) in
more than half of them — a fix applied to one fork does not reach the other twenty. **Treat the
copy bundled with this skill as reading material for the internals, not a template to fork into
`src/lib/`.** The durable home for this logic is a shared package —
[`@jeswr/solid-auth-core`](../../packages/solid-auth-core/README.md) (in extraction from the
`@jeswr/solid-elements` auth controller as of 2026-07), whose `WebIdDPoPTokenProvider` /
`createSolidAuth()` factory bakes the pristine-fetch pin in as non-optional, unconditional wiring
— import it rather than copying this file. Until it ships, at minimum port the `oauthFetch`
pinning fix above into any existing fork before shipping it.

### Login consistency via a shared component

The same fork-and-diverge pattern hit the React glue wrapping the provider: `SessionProvider.tsx`
/ `auth-context.tsx` copies across a dozen-plus apps were found differing by **over 1,200 lines**
between the two most divergent siblings, each independently (and inconsistently) re-deriving the
restoring/authenticated/login-state machine, StrictMode double-mount safety, and teardown ordering
this skill documents throughout. **Do not hand-roll a login page or session-glue module.** Mount a
shared component instead:

- **`jeswr-login-panel`** ([`@jeswr/solid-elements`](../../packages/solid-elements/README.md)) — a
  web component for a non-React or mixed stack.
- **`SessionProvider` / `useSolidSession()`** (`@jeswr/solid-auth-core/react`, in extraction) — for
  a React/Next.js app.

Both are built to already enforce the suite invariants documented in this skill — silent session
restore on load, fail-closed restore, credential-free public fetch for profile reads, WebID-scoped
IndexedDB persistence cleared on logout — so an app consuming one gets those invariants for free
instead of re-deriving (and re-getting subtly wrong) its own version of each.

## Letting users pick their Solid server — behaviour spec + tested code

How should login *feel*? The reference behaviour comes from the Solid browser extension
([theodi/solid-browser-extension](https://github.com/theodi/solid-browser-extension)), which
implements the same reactive model. Two layers of **tested reference code** are bundled with
this skill **as reading material for the internals** — per the lesson just above, a production app
should import a shared provider/component rather than copying these files:

1. **[`webid-token-provider.ts`](references/webid-token-provider.ts.md)** — `WebIdDPoPTokenProvider`, a
   complete custom `TokenProvider` (a port of the published `DPoPTokenProvider` flow) whose
   issuer comes from the user's WebID: `getWebId` callback (a native-`<dialog>` reference
   implementation `promptWebIdDialog` is included) → profile dereference → `solid:oidcIssuer`
   resolution → `chooseIssuer` when several (default **throws** `AmbiguousIssuerError`, never
   silently first). Its `allowInsecureLoopback` option also makes **interactive login against
   local CSS work** — the one thing the published provider cannot do. **E2E-verified**: a
   headless Playwright run drives the full popup login (WebID dialog → CSS login → consent →
   authenticated read) against a live local CSS, 3/3 stable — see
   [`webid-token-provider.e2e.md`](references/webid-token-provider.e2e.md) for the verification record. Its
   token-endpoint client-authentication helpers (`buildClientAuth` / `isEssNoUrlEncodeIssuer` /
   `isSupportedTokenEndpointAuthMethod`) are exercised adversarially by the vitest suite
   [`webid-token-provider.test.ts`](references/webid-token-provider.test.ts.md) (20 tests — the exact-host-spoof
   and fail-closed-auth-method cases; see the security section above).
   ```ts
   const manager = new ReactiveFetchManager([
     new WebIdDPoPTokenProvider(callbackUri, ui.getCode.bind(ui), promptWebIdDialog,
       { allowInsecureLoopback: true }),  // loopback-only; remote issuers stay HTTPS-strict
   ]);
   manager.registerGlobally(); // 0.1.3: required to patch globalThis.fetch
   ```
2. **[`login-ux.ts`](references/login-ux.ts.md)** (vitest suite [`login-ux.test.ts`](references/login-ux.test.ts.md),
   9 tests) — the UX helpers the provider composes with: `validateWebId`, `resolveIssuers`,
   `fetchLoginCandidate` (WebID → issuers + display name + avatar in one read), and
   `RecentAccounts` (most-recent-first, deduplicated, corruption-safe, remembers the chosen
   issuer and storage per account).

Prefer `@jeswr/solid-auth-core` / `jeswr-login-panel` (see "The login stack is a shared library"
above) once available; where no shared package exists yet for your stack, copy both into
`src/lib/` and build your UI on them — but track that copy against the shared package so it isn't
a permanent fork. The behaviour to implement:

1. **WebID-first entry.** The login surface asks for one thing: the user's **WebID** (a URL
   input). No identity-provider dropdown, no server list — users know their WebID, not their
   IdP's OIDC URL.
2. **Recent accounts.** Remember previously used accounts as `{ webId, displayName, avatar }`,
   most recent first, de-duplicated by WebID. Returning users see avatar buttons (photo or
   initials) and tap one to re-login; an **"Add account"** affordance reveals the WebID input.
   Keep this list on logout (logout clears the session, not the account memory).
3. **WebID → issuer.** Dereference the WebID and read `solid:oidcIssuer` from the profile —
   through `@jeswr/fetch-rdf` + `WebIdDataset`, **never** by regex-scraping Turtle (a known
   fragility of the extension's first implementation: it misses prefixed and multi-line forms).
   - **No issuer** → actionable error: "This WebID can't be used for Solid login — its profile
     has no `solid:oidcIssuer`."
   - **Multiple issuers** → let the user choose; do not take the first.
4. **Run the flow.** Trigger the authorization-code flow against the chosen issuer (the
   `<authorization-code-flow>` popup handles user interaction). Validate errors into clear UI
   states: malformed WebID, unreachable profile, cancelled popup (`CodeRequestCancelledError`).
5. **After login.** Fetch the profile and render the account (name/avatar via the
   `ProfileAgent` reference class in the `solid-object` skill); append it to recent accounts.
6. **Storage selection.** When the profile advertises more than one `pim:storage`, **ask the
   user which storage to use** — never pick one silently. Remember the choice per account.

## Integrating Solid-OIDC DPoP into an auth framework (Auth.js / next-auth v5)

Everything above is the **reactive-fetch** model (a `globalThis.fetch` patch you own). The other
common case is an app built on an **auth framework that runs the OAuth/OIDC flow itself** — Auth.js
(next-auth v5 / `@auth/core`). Auth.js owns the authorization-code/callback orchestration and has
**no DPoP support**, but Solid-OIDC tokens are **mandatorily DPoP-bound (RFC 9449)** — so you can't
just point Auth.js at a Solid issuer. The worked reference for this is
[`@jeswr/auth-solid`](../../packages/auth-solid/README.md) (composes
[`@jeswr/solid-dpop`](../../packages/solid-dpop/README.md) for the proof primitives — no hand-rolled
crypto); the load-bearing constraints:

- **The seam is the provider's `customFetch` symbol.** Auth.js routes *all* OAuth endpoint HTTP
  (discovery, JWKS, token, userinfo) through the [`customFetch`](https://authjs.dev/reference/core#customfetch)
  override on the provider config. That is the single integration point: install a fetch that
  **discriminates the token-endpoint leg** (a POST with a form-urlencoded grant body) and attaches a
  DPoP proof to it, passing every other leg straight through. Don't try to bolt DPoP on anywhere
  else — Auth.js does the rest of the flow.
- **The token-endpoint proof carries NO `ath`.** `ath` (the access-token hash) only belongs on the
  **resource leg** (pod requests), where an access token is being *presented* — at the token
  endpoint there is no access token yet, so the proof binds only `htu`/`htm` (RFC 9449 §4.2).
  (This is the inverse of the common server-side `ath`-compat gotcha: clients must *omit* `ath` here,
  not add it.) Handle the RFC 9449 §8 **`use_dpop_nonce` 401 retry exactly once** (a single retry,
  not a loop) at the token endpoint — the OP may demand a server-chosen nonce on the first attempt.
- **Map ONLY the verified `webid` claim to the user.** Read the WebID from the **verified ID-token
  claims** the framework passes to `profile()` (oauth4webapi validates the ID-token signature +
  `iss`/`aud`/`nonce` first) — **fail-closed: a login with no resolvable `webid` throws.** Never
  trust a `webid` field from the *unverified* access token.
- **The DPoP keypair must persist across the auth-code → callback → refresh lifecycle — document the
  tradeoff.** Pod requests after login (and the DPoP-`jkt`-bound refresh-token redemption after a
  restart) need the **same** DPoP private key that minted the grant's proofs. One option is to store
  the DPoP private JWK in the **JWT session** alongside the tokens (`@jeswr/auth-solid`'s default):
  Auth.js encrypts the JWT (A256GCM) with `AUTH_SECRET`, so set a strong secret — the cost is JWT
  size and the key living in the session cookie/store. The alternative is a **server-side key store**
  (a database session row holding `dpopKeyJwk` + tokens). Either way it is secret material — never
  log it, never surface it to the client (expose only the WebID on the session).
- **The packaging gotcha — `@auth/core`'s `customFetch` named export only exists from `0.37.0`.**
  npm's `latest` dist-tag for `@auth/core` can lag (observed `0.34.3`), and that version does **not**
  export `customFetch` — a bare `npm install @auth/core` then breaks the import with
  `does not provide an export named 'customFetch'`. Pin a peer floor `>=0.37` (install
  `@auth/core@^0.37`), or install `next-auth@^5` (its bundled `@auth/core` is recent and re-exports
  `customFetch`).

(Cited: [`@jeswr/auth-solid`](../../packages/auth-solid/README.md) — `Solid(config)` returns an
Auth.js `OIDCConfig` with the DPoP-injecting `customFetch`; composes `@jeswr/solid-dpop` for the
RFC 9449 proofs; verified-WebID-only, fail-closed; ships a `solidDpopFetch` for authed pod requests
from the persisted session.)

## Gotchas

| Gotcha | Detail |
|---|---|
| Construct + `registerGlobally()` **once, early** | The constructor does NOT patch `globalThis.fetch` in 0.1.3 — `registerGlobally()` does; do it before any library captures a `fetch` reference, or those calls bypass auth |
| Untyped `querySelector` fails to compile | The library doesn't augment `HTMLElementTagNameMap` — use `querySelector<AuthorizationCodeFlow>(…)` |
| `Unknown issuer` | Host outside the 0.1.2 built-in map — see above |
| `only requests to HTTPS are allowed` on local login | The 0.1.2 HTTP-issuer wall — use the bundled `WebIdDPoPTokenProvider` with `allowInsecureLoopback: true` for local CSS |
| CSS-only auth failure `iat is not recent enough` | A *second* auth layer sending ms-unit DPoP `iat`; this library is correct — remove the other layer |
| Worker mode | `ReactiveFetchWorkerManager` registers a repo-relative worker path; treat as not production-ready in 0.1.x |
| Probe correlation lost in the provider | The manager does `new Request(input, init)` before `upgrade()` — a `WeakMap<Request>`/expando/symbol is dropped; only `url`/`method`/`headers` survive |
| Cross-origin login breaks (prod only, mock-green) | A custom probe **header** triggers a CORS preflight pods reject — correlate with a `#probe-<uuid>` URL **fragment** (never sent on the wire) instead |
| Every probe fails `invalid_dpop_proof` on `htu` | `dpop` uses `htu` verbatim but the server strips query+fragment (RFC 9449 §4.2) — compute `htu` from scheme+authority+path only; keep the fragment URL only for in-process correlation |
| Concurrent / double-click login | Single-flight `login()` keyed on requested WebID: same-WebID shares the in-flight promise; different-WebID must reject, never resolve as the wrong identity |
| Logout re-authenticates as the old user | In-flight async settles after `reset()` and writes stale identity — generation-fence: capture an epoch up front, re-check it **after every await** before mutating state |
| New login carries the PREVIOUS account's DPoP token (cross-account leak) | A fresh manager/provider + `registerGlobally()` **per login** with no teardown stacks the patch and reuses account A's session for account B's first request. Use **one app-lifetime singleton** (patch once; **logout clears the provider's session state, not the fetch patch** — the wrapper is harmless with no armed session), **rebuild the provider with cleared sessions on logout AND before each login**, **login-generation-fence** the login path, and revoke only the **session-id you own** so an older login's late error can't log out a newer valid session. Test with a real logout→login-as-different-WebID switch |
| StrictMode double-patches fetch / dead popup | `registerGlobally()` must snapshot the pristine fetch **once** (a singleton); read the `<authorization-code-flow>` element via a module-level holder updated every mount, not a closed-over first-mount ref |
| A foreign-origin fetch carries (or risks) the pod credential | The global patch upgrades-and-retries any `401` — **`credentials:"omit"` alone does NOT stop it** (the patch is above the per-request flag). Capture `globalThis.fetch` **before** `registerGlobally()` (eager module-eval snapshot + an idempotent first-wins `captureNativeFetch()` boot hook) and use that pristine ref for third-party hosts (WebID index / matrix.org / forum) |
| First-load login throws on `ui.getCode` (mock-green) | The auth element's defining module is dynamic-`import()`ed and not upgraded at cold first mount, so `.getCode` is `undefined` — publish a **lazy accessor** `(...a) => ui.getCode(...a)` (read at call time), not `ui.getCode.bind(ui)`; `await customElements.whenDefined(…)` as belt-and-braces |
| `#autologin/<webid>` deep link does nothing | A popup auto-opened on load has no user gesture and is blocked — use a **full-page** redirect; persist DPoP JWK + PKCE verifier + state + nonce to `sessionStorage` across it; register **both** `/callback.html` and `/` in the client-id `redirect_uris` |
| Deep-link autologin logs in as the WRONG WebID | A live IdP cookie session for another account satisfies `prompt=none` — **enforce** that the ID-token WebID `webIdsEqual` the requested one and **throw before writing any session/issuer state** on mismatch; validate `state` on the error/abort return too |
| Silent restore breaks with `"key is not extractable"` | The DPoP **public** key must be `extractable: true` (oauth4webapi serialises it into the proof JWK, RFC 9449 §4.2) while the **private** key stays non-extractable. `generateKey(…, false, …)` gets this right; the full-page-redirect export/re-import must re-import private `false` / public `true` (NOT both `true`). Test: public exports to JWK, private `exportKey` rejects |
| Hand-rolled per-app session restore | Use the shared, audited **[`@jeswr/solid-session-restore`](../../packages/solid-session-restore/README.md)** (WebID-scoped IndexedDB store + pure `decideSilentRestore` + DPoP-bound `restoreSession`) — apps do thin wiring (confirm-then-persist, ordered awaited logout, `shouldDropRememberedPointer` reconciliation), never their own crypto/persistence |
| A token-provider fix landed in one app but not its siblings | `webid-token-provider.ts` is hand-forked per app (21 divergent copies found, 547–2,308 lines) — a fix (e.g. the `oauthFetch` pin above) applied to one copy never reaches the others. Import a shared provider (`@jeswr/solid-auth-core`, in extraction) instead of forking this skill's reference file into `src/lib/` |
| Every app's login page / session glue looks and behaves slightly differently | `SessionProvider.tsx` copies were found diverging by **1,200+ lines** between siblings, each re-deriving the restore/auth/login state machine independently. Mount `jeswr-login-panel` (`@jeswr/solid-elements`) or `SessionProvider`/`useSolidSession()` (`@jeswr/solid-auth-core/react`) rather than hand-rolling one per app |
| Restore succeeds but the first pod read still 401s | Restore must yield an **authenticated** fetch, not just a WebID — arm the singleton manager's provider with the restored session (and/or the proactive boundary) so the global patch attaches the token; mounting on a bare/unpatched fetch leaves pod requests unauthenticated. Make it **refresh-capable**: on a 401/expiry re-mint via the refresh credential through the **default/pristine** fetch (never the expired restored one) and retry **once** |
| Per-resource 401-dance (an extra round-trip per URL, scales with resource count) | `ReactiveFetchManager` is reactive (bare → `401` → upgrade → retry, **per resource, no origin cache**). Proactively attach the token on the **first** request to an **allowed** origin via `installProactiveAuthFetch` (`@jeswr/solid-elements/auth`), keeping one bounded `401` re-upgrade — collapses N extra round-trips to one auth round-trip per storage root |
| Proactive attach leaks a token to a foreign (or issuer) origin | The allow-set is the whole boundary (the token goes on before any `401`): **`https:`-only**, loopback-`http:` only under an explicit dev/test opt-in, **empty set ⇒ attach to nothing** (fail-closed), **resource origins only**. Derive it from the **pod-root/storage origin(s)** (+ the WebID-document origin only when the pod serves it) — **NOT the OIDC issuer origin** (a pod token has no audience there, and issuer HTTP must stay on the pinned `customFetch`) |
| Patching fetch to attach tokens DEADLOCKS login | Internal OIDC HTTP (token endpoint, JWKS) re-enters the attach path. Pin `oauth4webapi`'s **`customFetch`** (and any internal OIDC fetch) to the **pristine/unpatched** fetch captured before `installProactiveAuthFetch`. Add an adversarial test that hangs/fails **without** the pin |
| ANY proactive global-`fetch` patch lets the OIDC library's own calls recurse | The general rule behind the deadlock above: a wrapper that attaches auth to `globalThis.fetch` also intercepts the OIDC library's **own** discovery/JWKS/token/refresh fetches (→ recursion, or a DPoP proof bound to the issuer's `htu` not a resource). **Capture a PRISTINE `fetch` BEFORE patching** (module-load snapshot — the `MODULE_PRISTINE_FETCH` pattern) and route the library's internal HTTP through it: pin `oauth4webapi`'s **`customFetch`** (`unique symbol`, set as `[customFetch]` — see `@jeswr/auth-solid`/`@jeswr/solid-openid-client`), **or** keep the OIDC flow in a separate realm on the raw fetch (the [browser extension](https://github.com/jeswr/solid-browser-extension)'s SW: `discovery / token / refresh / profile fetches use the RAW fetch, never the authenticatedFetch path`). Invariant either way: the auth library's bootstrap HTTP must NOT run on your token-attaching wrapper |
| Login hangs silently AFTER the WebID profile read, BEFORE any `/authorize` hop or popup | Pinning only the WebID **`profileFetch`** to the pristine fetch is NOT enough when the proactive boundary's credential origin set also covers the issuer: `discoveryRequest`, dynamic client registration, **and** the authorization-code token grant are separate `oauth4webapi` calls the login flow makes, and each one independently re-enters the patched global fetch if not pinned. The re-entrant discovery call single-flights onto the very `#authenticate` promise that issued it → circular await → discovery never resolves → no `/authorize` popup ever opens, with **no thrown error** (the symptom that distinguishes it from the DEADLOCK gotcha above, which usually surfaces as a hang or rejection at the token-endpoint leg instead). Fix: don't pin call-sites piecemeal — thread ONE `oauthFetch` reference (defaulting to the pristine/profile fetch) through a single shared `httpOptions`-style chokepoint that every `oauth4webapi` call in the login flow goes through, so discovery/DCR/token-grant can't silently miss the pin. (Root-caused fixing exactly this interactive-login stall in the **AccessRadar** app — `jeswr/product`, branch `fix/login-stall-8575`, commit `7a5461a` — bead `suite-tracker-8575`, 2026-07.) |
| Armed boundary + logged-out UI (fail-OPEN split) | A wiring fault throwing **after** the boundary armed + token pinned leaves the provider able to authenticate while the UI shows logged-out. On **every** failure path (login, autologin teardown, silent-restore wiring-fault `catch`) **FAIL-CLOSED**: `provider.reset()` **and** clear the boundary, not just return to login |
| Resolved issuer/storage shape varies (sync string vs async URL) | The allow-set derivation reads the provider/profile for the **pod-root/storage** origins (NOT to add the issuer) and must handle both forms — a wrong `await`/`.then` throws, and a missing storage origin silently shrinks the allow-set back into the 401-dance |
| Silent-restore as a module fn can't arm the boundary | Inline `SessionProvider`-callback restore arms the boundary inline; a **module-level** restore fn must have `armBoundary`/`clearBoundary` **closures threaded in** — otherwise restore is green but the boundary stays un-armed (reactive) |
| `@jeswr/solid-elements/auth` drags in `@jeswr/solid-session-restore` | The `/auth` subexport **statically imports** session-restore — that dep is required even for an app that doesn't use restore. In a bundler-constrained app (Next.js), importing `/auth` can duplicate `@solid/reactive-authentication`; **vendoring** the dependency-free boundary helpers is the escape hatch (keep it byte-equal + note the source) |
| 401-budget test passes vacuously | Assert the seeded resources are actually private first (anon `GET` → `401`/`403`), seed **N ≥ plural** across >1 storage root and assert the 401 count **doesn't scale with N**, pin the exact local CSS version, and make a non-completing login a **hard** failure (opt-in skip only). Tally **responses** under the storage root. Watch the namespace-**scheme** seed gotcha (`https://` vs `http://` schema.org) — wrong scheme ⇒ resources parse but don't match ⇒ guard passes on an empty view |
| Spoofable ESS host gate (substring `includes`) | Keying a per-vendor token-endpoint workaround on `issuer.includes("login.inrupt.com")` sends the bespoke (non-URL-encoded Basic) `client_secret` to a lookalike host (`login.inrupt.com.attacker.example`, `evil.example/login.inrupt.com/…`). Match the **EXACT hostname** — `new URL(issuer).hostname === "login.inrupt.com"` (unparseable → `false`) — never a substring |
| Client-auth method silently downgraded to `none` | `if (method === "client_secret_basic") {…} else None()` mis-authenticates a confidential client that declares `client_secret_jwt`/`private_key_jwt`/`tls_client_auth` (and succeeds-as-public on servers that allow it). **FAIL CLOSED**: throw on an unsupported method and on a confidential method with no secret. OMITTED method defaults to `client_secret_basic` **iff** a secret is present (else `none`); a PRESENT-but-invalid value (`null`) must compare **`=== undefined`** (never `?? "none"`) so it fails closed, not coalesces to public |
| Auth.js (next-auth v5) can't talk to a Solid issuer | Auth.js runs the OAuth flow itself with **no DPoP**, but Solid-OIDC tokens are mandatorily DPoP-bound. Inject the RFC 9449 proof through the provider's **`customFetch`** seam (it routes all OAuth HTTP), discriminating the **token-endpoint leg** only. See the Auth.js section + [`@jeswr/auth-solid`](../../packages/auth-solid/README.md) |
| Token-endpoint DPoP proof has `ath` (wrong) | `ath` (access-token hash) belongs **only on the resource leg** (pod requests presenting a token). At the token endpoint there is no access token yet — the proof binds `htu`/`htm` only (RFC 9449 §4.2). Handle the §8 `use_dpop_nonce` retry **exactly once** there |
| `does not provide an export named 'customFetch'` | `@auth/core`'s `customFetch` is a named export only from **0.37.0**, but npm's `latest` can lag (observed `0.34.3`). Pin `@auth/core@^0.37` (peer floor `>=0.37`) or install `next-auth@^5` (recent bundled `@auth/core` re-exports it) |
