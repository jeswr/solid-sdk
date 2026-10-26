<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

### Testing proactive refresh with fake timers

If you build a **proactive token-refresh** provider — one that schedules a refresh before
expiry rather than waiting for a `401` — testing it with vitest fake timers is racy (lesson
from a prod-solid-server consumer). A refresh cycle awaits real **WebCrypto** (oauth4webapi
DPoP-proof signing + ES256 sign/verify), which runs on the libuv threadpool and settles on the
**real** macrotask queue, not the fake clock — so draining with a fixed count of
`advanceTimersByTimeAsync(0)` rounds is non-deterministic (under load the crypto isn't done
when assertions run). Instead:

- Expose **observable seams** on the provider, both production no-ops (undefined unless
  injected): `onProactiveCycleStarted` at the top of the single cycle method *all* trigger
  paths funnel through (timer fire, backoff retry, visibility-resume), and
  `onProactiveCycleSettled` in a `finally` once refresh + persist + reschedule has settled.
- Count STARTED vs SETTLED and **wait on the settled seam, not a time budget**: positive
  assertions poll for the expected settled count; "nothing more happens" assertions drain
  until quiescent. Between checks, yield to a `setTimeout` captured *before* `useFakeTimers`
  so threadpool crypto can settle, bounded by a real wall-clock deadline (pre-captured
  `Date.now`) that throws with context on overrun. Reset counters per-test.
- **Pitfall:** count STARTED at the *provider* level, not in the timer wrapper — a
  resume-triggered cycle that bypasses the timer fires SETTLED without a matching STARTED, and
  `settle()` then wrongly treats an in-flight refresh as quiescent.

### Detecting login: prove a per-attempt token, never infer from an HTTP status

A tempting "did login succeed?" check is to probe a resource and read the status. **Every
status-based shortcut is wrong** (each was a real bug, found over three review rounds building
`create-solid-app`'s auth provider):

- **`401`/`403` ≠ definitive failure.** Treating only non-401/403 as success, then setting the
  session, is the first trap.
- **A public `2xx` ≠ success.** Once you reject 401/403, *any* 2xx authenticates — so probing a
  **public** resource (or a `/` fallback) returns 200 with **no token attached** and falsely marks
  the user logged in.
- **A sticky "session established" flag ≠ this attempt.** A provider-level boolean set the first
  time any `upgrade()` attached a token stays set forever — so a later attempt whose probe got a
  public 200 (after a prior rejected probe, or logout→re-login) is wrongly accepted.

The correct signal is **whether a token was attached to *this* login attempt's request**. Have the
token provider expose a **monotonic count** of tokens it has actually minted+attached (incremented
inside `upgrade()` only after the `Authorization`/`DPoP` headers are set); the UI snapshots the
count **before** the probe and reads it **after** — a strictly higher count proves an attachment
*during this attempt* (a prior session's attachments are already in the "before" baseline, so
nothing stale leaks in). Decision: `2xx + count increased → logged in`; `2xx + no increase →
public/not logged in`; `401/403 → rejected`; other → error. Keep the decision in a **pure,
dependency-free function** so it's unit-testable in isolation. (Learned: `jeswr/create-solid-app`,
3 roborev rounds.)

### Correlating the probe correctly — the re-wrap, CORS, and concurrency constraints

The per-attempt token count above tells you *whether* a token was minted; a standalone login shell
also has to correlate "the probe I just fired" with *this* `upgrade()` call inside a custom
`TokenProvider`. Four constraints make the obvious approaches wrong (each a real bug, driven to zero
roborev findings over four rounds building a login host shell — cited:
[`jeswr/pod-docs@283134b`](https://github.com/jeswr/pod-docs/commit/283134b),
[`jeswr/create-solid-app@adb85e6`](https://github.com/jeswr/create-solid-app/commit/adb85e6)):

- **The manager re-wraps the request — per-request side channels do not survive.** `ReactiveFetchManager`'s
  patched fetch does `new Request(input, init)` **before** calling `provider.upgrade(request)`. So a
  `WeakMap<Request, …>` keyed on object identity, or an expando/symbol property on the Request, is
  **dropped** by the copy — only `url` / `method` / `headers` survive. (Confirm at runtime:
  `new Request(orig) !== orig`.) Anything you need the provider to read must live on those three.
- **Don't tag the probe with a custom HEADER — it breaks cross-origin login.** A custom request header
  (`x-…-probe-id`) makes a cross-origin pod request "non-simple", so the browser sends a **CORS
  preflight** that many Solid pods reject — the probe fails before the 401/upgrade path ever runs, and
  login is broken in production. A fetch-mock test harness hides this entirely (no real preflight).
- **Correlate with an unforgeable URL FRAGMENT, and strip it from the DPoP `htu`.** A `#probe-<uuid>`
  fragment **survives** the re-wrap (it's on `.url`), is **never sent on the wire** (RFC 3986 §3.5 —
  client-side only, so no preflight), and an unrelated same-base-URL request can't carry it. **But**
  the `dpop` package uses its `htu` argument verbatim while a server computes `htu` from the
  query/fragment-stripped request URI (RFC 9449 §4.2) — so compute the DPoP `htu` from
  **scheme+authority+path only** (strip query *and* fragment), while keeping the full fragment-bearing
  URL for in-process correlation. Forget this and every probe fails `invalid_dpop_proof` on `htu`.
- **Single-flight `login()`, keyed on the requested WebID.** Without it a double-clicked or concurrent
  login opens overlapping probes that overwrite each other's correlation or duplicate popups. Share the
  one in-flight promise on a **same-WebID** re-entry; a **different-WebID** concurrent login must
  **reject cleanly** (never resolve as the wrong identity).

### `reset()` / logout must generation-fence ALL in-flight async — re-checked AFTER every await

Logout (and starting a new login) clears cached provider state, but async already in flight —
issuer resolution, the session `upgrade()`, `DPoP.generateProof()` — can settle **later** and write
`#issuer` / `#sessions` / `#authenticatedWebId` / the token count for a **stale** identity, silently
re-authenticating as the just-logged-out user. Fix: a monotonic **generation/epoch** that `reset()`
advances; every async op **captures the generation up front AND re-checks it immediately after each
await**, before mutating any provider state — a superseded op writes nothing (reject with a typed
reset error). The re-check must be **after** the await, not only before it (that's the half that bites
— a check before a 300 ms crypto await is stale by the time the await resolves). (Same commits.)

### StrictMode: idempotent global patch + a module-level popup holder

React StrictMode double-mounts, which breaks two login-shell assumptions:

- **`registerGlobally()` must be idempotent.** Capture the **pristine** `fetch` exactly once in a
  module-level singleton — a second mount must not snapshot the **already-patched** fetch as "pristine"
  (logout would then restore a patched fetch) and must not stack a second patch.
- **Read the `<authorization-code-flow>` element through a module-level holder updated on EVERY mount** —
  never close over the first mount's element. StrictMode immediately unmounts that first element, so a
  captured reference points at a dead node and the popup never opens. Update the holder in each mount's
  effect; the flow reads the current one.

### Cross-account DPoP-token leak: a per-login `globalThis.fetch` patch with NO teardown reuses the PREVIOUS account's token

The single sharpest auth bug found across the suite build: **constructing a fresh
`ReactiveFetchManager` (or a fresh provider) per login and calling `registerGlobally()` each time,
with no teardown, leaks one account's DPoP token to the next.** The patch stacks: after
**logout → re-login as a *different* WebID**, the new patch sits on top of (or re-uses a provider
that still holds) the **previous** account's session/token, so the *first* request as the new user
is upgraded-and-retried with the **prior** account's DPoP-bound credential — a cross-account
confidential-data leak (read or write to account B's pod with account A's token). It is invisible in
a single-account test and in any fetch-mock harness; it only surfaces on a real logout→switch.

This is the same family as the StrictMode "snapshot the pristine fetch once" rule and the
generation-fence below, but the failure here is **account isolation**, so the fix is a stricter
lifecycle than idempotency alone:

- **One singleton manager for the app's whole lifetime — never one per login.** Capture the
  **pristine** `globalThis.fetch` exactly once (module-level), and `registerGlobally()` exactly once;
  **keep the wrapper installed for the app's whole lifetime.** The wrapper is harmless without an
  armed session (with no live token it falls through to the pristine fetch), so the lifecycle is:
  *patch once, never restore-on-logout* — **logout clears/disarms the provider's SESSION STATE, not
  the fetch patch.** (Restoring the pristine fetch on logout is the *other* coherent design, but then
  the next login must explicitly, idempotently re-arm it — and that re-arm is the easy place to
  re-introduce the stacking bug, so prefer "patch stays, session state is what's torn down".) Do not
  `new ReactiveFetchManager(...)` + `registerGlobally()` again per login — that is what stacks patches
  and orphans the old provider's live token.
- **Rebuild the provider with CLEARED sessions on logout AND before each login.** A provider caches
  resolved issuer + minted sessions/tokens keyed by identity; reusing it across an account switch is
  exactly the leak. Tear it down (or `reset()` it to an empty session set) on logout, and again
  **before** starting a new login, so a login can never inherit a prior account's session — belt and
  braces, because the logout might have raced or been skipped.
- **Login-generation fence.** A monotonic login epoch that **logout AND a newer login both advance**;
  an in-flight login captures the epoch up front and re-checks it **after every await** (issuer
  resolution, the popup, the token exchange) — a superseded login writes **no** session/token and
  resolves to nothing, so a slow login-as-A cannot resurrect account A after the user has moved on to
  log in as B (or logged out). This is the same epoch discipline as `reset()`/logout below, applied to
  the *login* path specifically.
- **Ownership-guarded teardown via session-ids.** Stamp each session with a unique id at creation;
  teardown (logout, or a failed/superseded login's cleanup) revokes **only the session whose id it
  owns**. The trap it prevents: an **older** login's late error (or its `finally`) firing **after** a
  **newer** valid login has already established session B — an unguarded "clear the current session"
  teardown then revokes B, logging out the legitimately-logged-in newer user. Compare the id before
  revoking; an older owner that no longer owns the current session is a no-op.

The unifying rule: **the fetch patch and the provider's session state are app-lifetime singletons
whose ownership is fenced by a login epoch + per-session ids — never per-login objects.** Test it
adversarially with a **real account switch**: log in as A, do one authenticated read, log out, log
in as B, and assert B's first request carries **B's** token (or no token), never A's — and that an
artificially-delayed login-as-A completing after the switch establishes **nothing**. (Cited: the
@jeswr money-making-portfolio build — AccessRadar/Keystone/CapNote/Provena/Furlong, 2026-06.)

### Foreign-origin fetch — the global patch upgrades-and-retries, so capture native `fetch` BEFORE `registerGlobally()`

`registerGlobally()` **replaces `globalThis.fetch`** with a wrapper that, on a `401`, **re-issues
the request with the user's Solid DPoP/bearer credentials** when a token provider matches the
request's host. That is correct for the user's own pod — but **wrong and unsafe for THIRD-PARTY /
foreign origins**: a public WebID index, `matrix.org`, a Solid forum/Discourse, any non-pod public
API. The app must never risk attaching a pod credential to a foreign host, nor pay the wrapper's
extra unauthenticated round-trip. The trap (it bit the Pod Manager twice): **`credentials:"omit"`
alone does NOT prevent the upgrade-and-retry** — the wrapper acts at the **global-fetch layer,
above** the per-request `credentials` flag, so `fetch(url, { credentials: "omit" })` still goes
through the patched wrapper and can still trigger the 401→attach-token→retry path.

The fix: capture a snapshot of `globalThis.fetch` **before** `registerGlobally()` patches it, and
use that pristine reference (bound to the global, with `credentials:"omit"`) for every
foreign-origin request. Two equivalent capture strategies — use both, belt-and-braces; the
idempotent boot hook is the more robust:

- A **module-evaluation-time** snapshot in a module imported eagerly from the app root, so it
  evaluates **before** the session provider's runtime effect calls `registerGlobally()` (an ES
  module's top-level code runs the first time it is imported). Expose it as a `nativeFetch` const.
- An **idempotent `captureNativeFetch()` boot hook** (first-call-wins) invoked at the very top of
  the app root/layout, before the session provider mounts; consumers read it via a
  `getNativeFetch()` accessor. First-call-wins matters: a later call that happens to run *after*
  the patch can then never overwrite the good reference.

Both should resolve to the **same backing reference** — never two uncoordinated snapshots. The
runtime hazard this defeats is real and code-splitting makes it sharp: the patch is installed
inside a React `useEffect` in the session provider (after an async dynamic import), and a route
chunk that needs the native fetch (e.g. a community-feeds client) loads lazily **after** the
patch — so reading `globalThis.fetch` at that point would get the **patched** one.

This is the same "snapshot the pristine fetch once" reflex as the StrictMode singleton above, but
for a different reason (foreign-origin safety, not logout-restore). Cited: the Pod Manager's
unified `src/lib/native-fetch.ts` — a single captured reference backing both a `nativeFetch` const
and `captureNativeFetch()`/`getNativeFetch()` — used by the WebID people-search client AND the
community-feeds client ([`jeswr/solid-pod-manager`](../../../apps/pod-manager/README.md),
the native-fetch unification on `main`).
