<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Sessions, reloads, silent re-auth

Tokens live **in memory only**. A hard reload drops them; the next `401` re-runs the flow with
`prompt=none` first, so while the IdP cookie session lives, re-auth completes silently (no
popup). Prefer client-side navigation so the page (and its tokens) survive between views — and do
not roll your own *access*-token cache (it expires fast and the in-memory + `prompt=none` path
already covers in-session recovery).

### Reload-restore: persist the DPoP refresh token, restore via a refresh grant

`prompt=none` only restores silently **while the IdP cookie session is still alive**. For genuine
session *restore* — closing the tab (without logging out) and reopening later, after the IdP cookie
has expired or in a browser that drops third-party/IdP cookies (Safari ITP, privacy modes) — that
path fails and the user is bounced to login, which feels broken. The fix (a suite-wide UX invariant,
learned across prod-solid-server + jeswr/solid-pod-manager) is to persist the **DPoP-bound refresh
token**, not the access token, and restore from it on load:

- On login, store the **refresh token** in **IndexedDB**, keyed/scoped to the **WebID** (never
  `localStorage` — it is synchronous, size-capped, and readable by any same-origin script). The
  refresh token is DPoP-**bound**, so a leaked copy is useless without the matching private key.
- **Persist the matching DPoP key too — this is mandatory, not optional.** A DPoP-bound refresh
  token can only be redeemed with the **same DPoP key** it was bound to; if the private key is
  memory-only it dies with the tab and reload-restore fails (`invalid_dpop_proof`). Store the key as
  a **non-extractable `CryptoKey`** (`crypto.subtle.generateKey(..., /*extractable*/ false, ...)`)
  in the same IndexedDB store, scoped with the refresh token — IndexedDB can structured-clone a
  non-extractable `CryptoKey`, so the private-key bytes never become readable by script. Generate
  the keypair once, reuse it for the original grant and every later refresh, and delete it with the
  refresh token on logout. (If you instead rely on the library/provider to hold the token, it must
  supply stable key persistence before this pattern works at all.)
- On load, before showing a login screen, attempt a silent **refresh-grant fetch** (an
  `oauth4webapi` refresh-token grant with a fresh DPoP proof) to mint new tokens — **no redirect, no
  hidden iframe.** Show a brief "restoring…" state; fall back to interactive login only on a genuine
  refresh failure (revoked/expired refresh token). Land back on the actual page, not the home screen.
- **Clear the persisted refresh token on logout** (and on a hard refresh failure), and keep it
  scoped per WebID so switching accounts can't cross the streams.
- Schedule a **proactive** refresh before access-token expiry (and re-check on `visibilitychange`
  resume) rather than waiting for a `401` — see the proactive-refresh testing subsection above for
  how to test that deterministically.

This is what upstream issue [reactive-authentication#15](https://github.com/solid-contrib/reactive-authentication/issues/15)
("optional `SessionStore` so reloads restore via a refresh grant") tracks. Until the library ships
it, **don't hand-roll the store per app** — use the shared, audited package below. (Cited:
prod-solid-server auth architecture + the Pod-Manager / suite "silent session restore on load" UX
invariant, jeswr/solid-pod-manager.)

### Silent session restore is a SHARED, AUDITED package — not a per-app copy

The reload-restore mechanics above are **easy to get subtly, silently wrong** (a missed guard
leaks a credential across accounts, or a logout race re-authenticates the just-logged-out user),
so the security invariants belong in tests at **one** package boundary, not re-derived in every
app. That package is **[`@jeswr/solid-session-restore`](../../../packages/solid-session-restore/README.md)**
(`pnpm add @jeswr/solid-session-restore@workspace:*` — built `dist/`, ESM). It owns three
things and apps do **thin wiring only**, never their own crypto/persistence:

```ts
import {
  IndexedDbSessionStore,   // WebID-scoped IndexedDB: { refresh_token + non-extractable DPoP CryptoKeyPair }, keyed by ISSUER
  restoreSession,          // the DPoP-bound refresh_token grant (real oauth4webapi grant + fresh DPoP proof)
  decideSilentRestore,     // a PURE fail-closed decision: given inputs → restore | login(reason)
  webIdsEqual,             // normalising WebID compare (trailing-slash / fragment / host-case)
  shouldDropRememberedPointer, // WebID-aware pointer reconciliation (see below)
  isInvalidGrantError,     // distinguishes a dead refresh token (→ login) from a transient failure (→ keep)
  forgetPersisted, clearPersisted,
} from "@jeswr/solid-session-restore";
```

The package's value is that the invariants are **tested at the boundary, adversarially** — each
guard's test verifies it genuinely FAILS when the guard is removed, then restores it.

**DPoP key extractability — the sharp one (RFC 9449 §4.2), it bit two apps and survived multiple
reviews.** A DPoP-bound refresh token is only redeemable with the **same DPoP key**, so the key
must persist — but persist it *correctly*:

- The DPoP keypair's **PRIVATE** key must be **non-extractable** (never durably store an
  exfiltratable private key). The **PUBLIC** key must be **`extractable: true`** —
  `oauth4webapi`/`dpop` serialise the public key into the DPoP proof header's JWK, so a
  `publicKey.extractable === false` throws `"key is not extractable"` and breaks proof generation
  (→ silent restore silently broken).
- For the **popup-login** key persisted directly in IndexedDB, this is automatic:
  `crypto.subtle.generateKey({ ...alg }, /*extractable*/ false, ["sign","verify"])` already yields
  a **non-extractable private + an always-extractable public** half, and IndexedDB
  structured-clones the non-extractable `CryptoKey` so the private bytes never become script-readable.
  (This is exactly what `@jeswr/solid-session-restore`'s `IndexedDbSessionStore` persists.)
- The **full-page-redirect** path is the trap: it must EXPORT the key (`extractable: true`) to
  survive the navigation via `sessionStorage`, then RE-IMPORT it on return — and the re-import MUST
  be **private `false` / public `true`**, NOT both `true`. Leaving the private key extractable after
  re-import is a hygiene regression (an exfiltratable private key in memory).
- **Test it:** the persisted/re-imported **public** key `exportKey`s to a JWK; the **private** key's
  `exportKey` **rejects**.

**The thin-wiring adoption recipe (each line is a hard-won guard):**

- **Request `offline_access`** on ALL interactive login paths — popup AND redirect — or there is no
  refresh token to persist.
- **Confirm-then-persist.** Persist the refresh credential only AFTER a fail-closed
  `webIdsEqual(authenticatedWebId, requestedWebId)` match. Persist-before-match leaks a credential
  into the wrong account's store.
- **`webid-mismatch` teardown ORDER:** `reset()` → `forgetPersisted` → clear pointer. (Tear the live
  session down before deleting the durable credential before clearing the public pointer.)
- **Generation-fence the store wrapper.** A logout racing the grant must not be undone by the
  package's internal rotated-token write-back — fence the store so a write for a superseded
  generation is dropped (same epoch discipline as the `reset()` rule below).
- **Logout = single-flighted + ordered + AWAITED:** `reset()` → invalidate the restore latch →
  **await** the durable delete → publish logged-out UI. Never fire-and-forget the delete.
- **Pointer (localStorage) writes/clears are best-effort/guarded, but durable `forgetPersisted` runs
  INDEPENDENTLY** — a pointer-clear throw must not skip credential cleanup.
- **Persist the credential BEFORE publishing the logged-in UI** (symmetric with logout's
  delete-before-publish) — else a tab closed in the race window misses the persist and restore fails.
- **WebID-AWARE pointer reconciliation (`shouldDropRememberedPointer`).** The store is keyed by
  **ISSUER**, so a "present" credential on a SHARED issuer may belong to a PRIOR account on that
  issuer — require the stored WebID `webIdsEqual` the requested one before trusting it. On a transient
  store-read failure, write THIS login's pointer; never blind-keep a possibly-stale one.

**Test pattern (lesson, applies to your wiring too):** drive the **real** package `restoreSession`
over a **stubbed `fetch`/transport** — do NOT mock `oauth4webapi`, which would hide the grant and
the DPoP proof entirely. Make every guard **adversarial**: assert it FAILS with the guard removed,
then restore it. (Cited: `@jeswr/solid-session-restore` — `IndexedDbSessionStore` persists the
non-extractable DPoP keypair, `restoreSession.test.ts` drives the real refresh grant over a stubbed
transport; validated across the 7 vite pod-apps + the package extraction from the pod-mail pilot.)

### A restore must yield an AUTHENTICATED, refresh-capable fetch — not just a WebID

The sharp, easy-to-miss half of session restore: restoring a session is **not** recovering the WebID
— it is recovering the ability to make **authenticated** pod requests. A restore path that resolves
the persisted refresh credential, learns the WebID, and then **mounts the app with a bare / unpatched
global `fetch`** silently leaves every pod request **unauthenticated**: the first read `401`s (or pops
an interactive login on page load) even though the refresh token was valid the whole time. The restore
must end with a DPoP-**authenticated** fetch installed/armed — under the reactive-fetch model that means
the singleton manager's provider is armed with the restored session (so the global patch attaches the
token), and/or the proactive boundary is armed (see "Eliminating the per-resource 401-dance"); under a
non-patched model it means the restored authed fetch is the one your pod calls actually use. **Returning
only the WebID from `restoreSession` and forgetting to arm the fetch is the trap.**

- **Make the restored fetch REFRESH-CAPABLE.** A restored access token is short-lived and may already
  be near expiry. On a `401`/expiry the fetch must **re-mint** via the refresh credential and **retry
  once** — and crucially mint the new token through the **DEFAULT/pristine** fetch (the
  `customFetch`/`MODULE_PRISTINE_FETCH` reference, see the re-entrancy section), **never through the
  expired restored fetch** (which would re-enter the dead-token path). One bounded retry, not a loop.
- **Arming is on the same fail-closed footing as the rest of restore.** If the wiring that arms the
  fetch throws **after** the credential resolved, you get the armed-then-fail FAIL-OPEN split — handle
  it exactly as that section says (`provider.reset()` + clear the boundary on every failure path).
- The reset-on-logout/switch, generation-fence, and atomic-commit halves of "restore safely" are
  already covered above (the cross-account-leak + `@jeswr/solid-session-restore` sections) — this rule
  is only the often-forgotten *positive* obligation: the thing you hand the app after a restore is an
  **authenticated, self-refreshing** fetch, not a WebID string.

(Cited: the five jeswr OSS Solid forks — Linkding, Elk, Excalidraw, Miniflux, Actual — 2026-06; Elk's
restore returned the WebID but mounted on the bare fetch so the first timeline read 401'd, fixed over
roborev's auth-lifecycle rounds.)
