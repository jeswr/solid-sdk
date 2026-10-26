<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

### Eliminating the per-resource 401-dance (proactive token attach)

The foreign-origin section above is the **don't-attach-across-the-boundary** half of the credential
boundary; this is the **DO-attach-eagerly-INSIDE-the-boundary** half. `ReactiveFetchManager` is
purely **reactive**: it fetches every resource **bare first** (no `Authorization`/`DPoP`), waits for
the resource server's `401`, finds a matching provider, upgrades, and **retries** — *per resource,
with no origin/storage cache of "this host needs auth"*. So every distinct URL pays a **wasted
unauthenticated round-trip**, and the cost **scales with resource count**: a container listing that
fans out to N private children does N extra 401s on top of the N real reads (the "401-dance"). On a
high-latency link this is the dominant cost of opening a data-heavy view.

The fix is to **proactively attach** the DPoP-bound token on the **first** request to an **allowed**
origin, instead of waiting for each resource's `401`. A shared `installProactiveAuthFetch` helper
patches `globalThis.fetch` so that a request to an allowed origin gets the token attached up front,
with **one bounded `401` re-upgrade** retained as a fallback (token rotated/expired mid-flight). This
collapses the N-extra-round-trips to **one** auth round-trip per storage root. (Cited: the
proactive-fetch rollout across the pod-mail/pod-money/pod-photos/pod-docs/pod-chat + Pod-Manager
suite, 2026-06; the helper now lives in
[`@jeswr/solid-elements/auth`](../../../packages/solid-elements/README.md) as `installProactiveAuthFetch`.)

**The credential boundary is load-bearing security — get the allowed-origin set right.** Proactive
attach means the token goes on *before* any `401` tells you the host wants it, so the allow-set is the
only thing standing between your pod credential and a foreign host. Rules (fail-closed throughout):

- **`https:` origins only.** A loopback **`http:`** origin (local CSS dev/test) is allowed **only**
  under an explicit dev/test opt-in flag — never in a production build.
- **Empty allow-set ⇒ attach to NOTHING** (fail-closed). A misconfigured/empty set must not
  degrade to "attach everywhere"; it degrades to "attach nowhere" (back to the reactive path).
- **Resource-server origins ONLY — and the issuer is NOT one.** Derive the allowed origins from the
  authenticated identity, but restrict the set to **proven Solid resource origins**: the
  **pod-root/storage origin(s)**, plus the **WebID-document origin only when the WebID is served by the
  pod** (i.e. it IS a resource server). **Do NOT put the OIDC issuer origin in the proactive
  allow-set** — a pod *access* token has no audience at the issuer's token/JWKS endpoints, and
  attaching it there both leaks a resource credential to a non-resource origin and **collides with the
  `customFetch` rule below** (issuer HTTP must stay on the pristine, unpatched fetch). The issuer is
  reached only via the pinned `customFetch`, never via the proactive boundary.
- **Never a foreign origin.** A WebID index, `matrix.org`, a Discourse forum, any non-pod public API
  is **out of set** (this is the same boundary the foreign-origin section protects from the other
  direction).

**The `customFetch` re-entrancy pin — a gotcha that DEADLOCKS login.** When you patch the global
`fetch` to attach tokens, the OIDC machinery itself uses `fetch` to talk to the issuer (token
endpoint, JWKS). If those internal requests go through *your* patched fetch, they re-enter the
attach path — which needs a token it is in the middle of minting — and **login deadlocks**. So you
MUST pin `oauth4webapi`'s **`customFetch`** option (and any other internal OIDC HTTP) to the
**pristine, unpatched** `fetch` captured before `installProactiveAuthFetch` ran — the same pristine
reference the foreign-origin section captures. Add an **adversarial test** that drives a login with
the pin in place (passes) and **without** it (must hang/deadlock or fail) so the pin can't silently
regress.

> **The general principle (applies to ANY proactive global-`fetch` patch, not just the proactive-attach
> helper).** The moment your app monkey-patches `globalThis.fetch` to transparently attach Solid auth,
> the **OIDC library makes its own internal `fetch` calls** — discovery, JWKS, the token-endpoint
> exchange, the refresh grant — and if *those* go through the patched global, the wrapper wrongly
> intercepts the library's own bootstrap requests: it recurses into the attach path (needs a token it
> is mid-mint of → deadlock), or attaches a DPoP proof bound to the *wrong* `htu` (the issuer, not a
> resource). The fix is the same two-part reflex everywhere: (1) capture a **pristine reference to the
> original `fetch` BEFORE patching** (a module-load snapshot, the "MODULE_PRISTINE_FETCH" pattern), and
> (2) hand that pristine fetch to the auth library so its internal HTTP **bypasses the global patch** —
> for `oauth4webapi`-based libraries that is its **`customFetch`** option (exported as a `unique symbol`,
> used as `[customFetch]`; this is exactly the seam `@jeswr/auth-solid`'s `[customFetch]: dpopFetch` and
> `@jeswr/solid-openid-client`'s `[oidc.customFetch]` set). The token then only ever reaches a vetted
> **resource** origin, never the issuer's endpoints. *(Architectural variant — the same invariant, no
> `customFetch` needed.* The [Solid browser extension](https://github.com/jeswr/solid-browser-extension)
> hand-rolls its OIDC flow in the MV3 **service worker** (`jose` + raw `fetch`) and keeps the
> token-attaching path in a **separate realm** from the OIDC HTTP: the SW's
> [`service-worker.ts`](https://github.com/jeswr/solid-browser-extension/blob/main/src/background/service-worker.ts)
> documents the rule as `RE-ENTRANCY: discovery / token / refresh / profile fetches use the RAW fetch,
> never the authenticatedFetch path`, while the popup's `MODULE_PRISTINE_FETCH` snapshot — captured at
> module load *before* anything could patch the global — backs its credential-free public/foreign-origin
> reads. Whether you pin `customFetch` or segregate by realm, the invariant is identical: **the auth
> library's own bootstrap HTTP must run on a fetch that is NOT your token-attaching wrapper.*)

#### Deterministic repro: the discovery-stage circular-await deadlock

The general recursion rule above has a sharper, easy-to-miss special case: pinning `customFetch`
for *some* oauth4webapi calls but not others still deadlocks — and it deadlocks **silently, with
no thrown error**, which makes it easy to ship. Reproduce it on demand rather than waiting to spot
it live (same discipline as the 401-budget test below — drive the REAL login path over a mock OP,
never a fetch-mock that hides the re-entrancy):

1. Stand up a minimal mock OP (a discovery document + `/authorize` + `/token` endpoints — any
   static/mock HTTP server suffices, no real Solid pod needed) and a token provider pointed at it.
2. Install a proactive-fetch-style wrapper on `globalThis.fetch` whose credential-boundary
   allow-set includes the mock OP's **origin** — this is the load-bearing precondition; without it
   the discovery request has nothing to re-enter.
3. Pin only the WebID **`profileFetch`** (leave `oauthFetch`/`customFetch` unpinned, i.e. the bug
   state) and drive an interactive login end-to-end.
4. **Expected failure (unpinned):** the login promise never settles — no `/authorize` popup ever
   opens, and nothing throws or rejects. `discoveryRequest` re-enters the patched fetch, which
   calls `provider.upgrade()`, which finds the in-flight `#authenticate()` promise for this issuer
   and single-flights onto it — the very promise that is still awaiting the `discoveryRequest` it
   just issued. Wrap the login call in a bounded timeout (e.g. 2s) so "hangs forever" becomes a
   deterministic, assertable test failure rather than a suite that never completes.
5. **Expected pass (pinned):** thread ONE `oauthFetch` reference (defaulting to the same
   construction-time pristine snapshot as `profileFetch`) through a single shared
   `#httpOptions()`-style chokepoint used by *every* oauth4webapi call — `discoveryRequest`,
   dynamic client registration, and the authorization-code token grant alike — as
   `[oauth.customFetch]`. The login promise now resolves (or rejects on a genuine auth error) well
   inside the timeout.

Keep the negative case (step 4) in the regression suite alongside the positive one: a test that
only ever exercises the already-pinned path can't catch a future oauth4webapi call site added
without the pin. (Root-caused fixing a real interactive-login stall in the **AccessRadar** app —
`jeswr/product`, branch `fix/login-stall-8575`, commit `7a5461a` — bead `suite-tracker-8575`, 2026-07.
`login-stall.test.ts` on that branch is the deterministic repro: pre-fix both cases fail with an
explicit LOGIN STALL race error, post-fix the login completes and no issuer-origin request rides
the patched global.)

**The armed-then-fail FAIL-OPEN gap — a real roborev-HIGH.** A wiring fault can throw **after** the
boundary has been armed AND the token pinned, but **before** the UI commits to logged-in. That
leaves the *provider able to authenticate* (boundary armed, token live) while the *UI falls back to
logged-out* — a fail-OPEN split: the app looks logged out but the patched fetch still attaches the
credential. So on **every** failure path — interactive login, autologin teardown, and the
silent-restore **wiring-fault `catch`** — you must **FAIL-CLOSED**: `provider.reset()` **and** clear
the boundary (disarm + unpin), not merely return to the login screen. Treat "armed boundary + no
committed session" as an invariant violation and tear both down together.

**Ordering — persist the credential BEFORE publishing the logged-in UI (b7p).** Symmetric with the
logout delete-before-publish rule: a tab closed in the persist race window must not miss the durable
write. **Note which providers persist internally during `upgrade()`** — if the provider already wrote
the DPoP credential to durable storage as part of `upgrade()`, the ordering constraint is *already*
satisfied and an extra explicit persist is redundant; if it does not, persist explicitly before you
publish. Document the provider's behaviour rather than assuming.

**Per-app deltas to CHECK (each bit the proactive-fetch rollout):**

- **`resolvedIssuer()` (and the resolved pod/storage origin) shape varies.** Some providers expose the
  resolved value as a **sync string**, others as an **async `URL`** — the allow-set derivation (which
  reads the provider/profile to find the **pod-root/storage** origins, NOT to add the issuer) has to
  handle both; a hard-coded `.then`/`await` on the wrong one throws (and a missing storage origin
  silently shrinks the allow-set, re-introducing the 401-dance).
- **Where silent-restore lives changes the wiring.** If silent-restore runs **inline as a
  `SessionProvider` callback**, arm the boundary inline at the same point. If it's a **module-level
  function**, you must **thread `armBoundary` / `clearBoundary` closures** into it — it has no access
  to the provider's arming hooks otherwise, and forgetting this leaves restore green but the boundary
  un-armed (back to reactive).
- **`@jeswr/solid-elements/auth` STATICALLY imports `@jeswr/solid-session-restore`.** That dependency
  is therefore **required at install/build time even for an app that does not use session-restore** —
  importing `/auth` for `installProactiveAuthFetch` alone still drags it in. Either install it, or (in
  a bundler-constrained app) vendor only the boundary helpers (see the import-vs-vendor tradeoff below).
- **Namespace-scheme seed gotcha.** A data layer pinned to a specific namespace **scheme** — e.g.
  `https://schema.org/` (vs `http://schema.org/`), or a w3id / Activity Streams namespace — means e2e
  **seed RDF must use the EXACT scheme**, or the resources **parse fine but never match** the query and
  the view comes up empty (and a 401-budget test seeded this way can pass *vacuously* — see below).

**Import vs. vendor (the consolidated tradeoff).** The vite pod-apps **import** `@jeswr/solid-elements/auth`
cleanly and get `installProactiveAuthFetch` (plus the static `@jeswr/solid-session-restore` dep) for
free. **PM / Next.js VENDORED** the dependency-free boundary helpers instead, because importing
`/auth` dragged a **duplicate `@solid/reactive-authentication`** into the Next.js bundle (the helper's
transitive dep collided with the app's own copy). The boundary logic itself has no runtime deps, so a
small vendored copy is a legitimate escape hatch where the import bloats or duplicates the bundle —
keep it byte-for-byte equivalent to the package and note the upstream source so it can be re-synced.

#### The 401-budget Playwright test — assert the dance is gone AND can't creep back

A regression guard for the 401-dance has to prove **two** things: (a) at most one resource-server
`401` per storage root, and (b) the 401 count **does NOT scale with resource count** (the actual
regression — a reactive fallback re-introduces a per-resource 401 that an N=1 fixture would never
catch). Pattern:

- **Intercept RESPONSES** (not requests) and **tally `401`s whose URL is under the resource-server /
  storage root** — bucket per storage root. (Tally responses so you count what the *server* actually
  challenged, not what the client attempted.)
- **Seed N private resources and assert N is plural** (e.g. N ≥ 3 across more than one storage root),
  then assert `401s-per-root ≤ 1` **and** that the total does not grow with N. An N=1 fixture makes
  the "doesn't scale" half un-testable.
- **Assert the seeded resources are actually private first** (an anon `GET` → `401`/`403`), so the
  budget guard **cannot pass vacuously** — if the seed RDF didn't match (the namespace-scheme gotcha
  above) or the resources were public, a "0 unexpected 401s" result is meaningless.
- **Run against a LOCAL CSS and PIN the exact version** (e.g. `@solid/community-server@7.1.9`) — CSS's
  challenge behaviour (when it emits `401` + `WWW-Authenticate`) shifts across versions, so an unpinned
  CSS makes the budget non-deterministic.
- **A non-completing login is a HARD failure**, not a skip — a login that silently never finishes
  would let the test pass with zero authenticated reads (and thus zero 401s) vacuously. Make "logged
  in" an assertion; allow an explicit, opt-in skip only.

(Cited: the 401-budget guard added across the pod-mail/pod-money/pod-photos/pod-docs/pod-chat
e2e suites + Pod-Manager, 2026-06.)
