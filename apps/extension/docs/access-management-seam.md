# Access management — the per-data-class grant gate (Phase 2)

Access management — letting a page *request access* to specific **data classes**, the user
*consent* to it in the extension's own chrome, and the service worker *enforce* the resolved
scope — is **implemented** as of Phase 2. This note documents the shipped surface, the
enforcement model, and its honest limits. It supersedes the earlier "deferred seam" note.

Design source: `full-solid-ecosystem/docs/design/access-management-proposal.md` §4 (the client→
extension JS API + SW enforcement) and §6 (the adversarial critique: revocation propagation,
TOCTOU → target-pinning). Phase 0/1 (the per-origin gate + shared replica) is the substrate this
extends — it is NOT replaced; the **service worker remains the SOLE security boundary**.

## The `window.solid` access-management API (`src/inject/inject.ts`)

| Method | Returns | Behaviour |
|---|---|---|
| `requestAccess({classes, modes, purpose, duration})` | `{ ok, grants: SolidGrant[] }` | Resolves each class → concrete pod targets, opens the **unspoofable consent window**, mints one grant per approved class (PINNED targets). |
| `listGrants()` | `SolidGrant[]` | The non-expired grants THIS origin holds for the active WebID. |
| `revokeGrant(grantId)` | `boolean` | Revoke one of THIS origin's grants (cannot touch another origin's). |
| `resolveClass(classIRI)` | `{ shape, targets[] }` | Read-only introspection (granted origins only). |

`duration` is an ISO-8601 duration (e.g. `"P30D"`); it is **required** and clamped to 365 days —
a grant with no bounded expiry can never be minted. The page never receives a token — only a
grant handle and a capability to `fetch` within the pinned set.

## The grant key + enforcement (the security substance)

- **Grant key widened** from `origin` to `(origin, dataClass, modes, purpose, expiry)`, plus a
  `webId` session dimension and a **PINNED resolved target set** — the enforced substance.
  Stored in `chrome.storage.local` (`solid:class-grants`), page-unreachable; every read is
  sanitised so a tampered record authorises nothing.
- **Resolution + pinning (TOCTOU mitigation, design §6.2).** At grant time the data class is
  resolved to concrete targets via the **Type Index** walk (`src/background/core/class-resolve.ts`,
  `solid:publicTypeIndex`/`privateTypeIndex` → `solid:TypeRegistration` `solid:forClass` →
  `solid:instance`/`solid:instanceContainer`) and that set is **frozen into the grant**. A
  resource created later, or re-typed into the class, is NOT covered — it needs fresh consent.
  (SAI `interop:DataRegistration` + SHACL-validate rungs are documented follow-ups.)
- **The SW enforces the pinned set on every `.fetch`** (`gateAccess` in `service-worker.ts`,
  run inside the replica's injected gate so it applies on a cache HIT too). A class-only origin's
  request must fall within a live grant's pinned targets with a satisfying mode, else DENY with a
  **distinguishable** reason (`Out of grant scope` / `No access grant for this data`). Pure gate
  logic + fail-closed rules live in `src/background/core/class-grant.ts` (exhaustively tested).
- **Expiry** is a per-request clock check; an expired grant denies AND is pruned from storage.
- **Revocation** removes the grant record; because the SW re-reads the store on **every** request
  (no in-memory grant cache), it is effective on the **next** request.

## Backwards compatibility (design item 5)

Legacy **origin-only** grants (a deliberate login / `setClientId` opt-in, or a credential/pod
origin) keep **whole-pod access** unchanged — the class gate is only applied to an origin that is
present *solely* because it holds class grants. This is a dual-read: no data migration; a
full-grant origin bypasses the per-class confinement.

## The consent surface

`requestAccess` opens `consent/consent.html` (a `chrome-extension://` page — unspoofable by the
requesting origin) showing, per class, the data class, modes, purpose, expiry, and the **resolved
target list** ("this will share these N resources"). Per-class approve / deny-all; closing the
window denies (fail-closed). Pure view/decision logic: `src/background/core/consent.ts`.

## Honest limits (design §6)

- **Revocation is eventually-consistent, not instant.** In the extension the propagation bound is
  **one request**: the SW re-reads the grant store per request and denies before touching the
  cache or the pod (the gate-on-every-read invariant), so a revoked grant cannot be served off a
  warm replica. Any request already past the gate check completes; there is no page-held token to
  invalidate. A future refinement is a per-grant replica-slice purge on revoke (the replica is
  currently keyed by grant-scope = origin, not per class).
- **Type-Index resolution trusts the writer's typing.** The pinned set is only as correct as the
  pod's Type Index; SHACL-validate-at-resolution (design §6.2 backbone) is a follow-up. Write-by-
  class stays conservative (target-pinned, never a blanket container widen from an app's own type
  declaration).
- **Purpose is audit-only**, never RS-enforced (design §6.3).

## Invariants preserved

1. All access-mediated fetches still pass `core/origin-policy.ts` + `core/authenticated-fetch.ts`.
2. The page stays credential-free; grants + tokens live in the SW / `chrome.storage`.
3. The content-script stamps the real page origin server-side (never page-supplied).
4. The **SW is the sole enforcement point**; the MAIN-world inject has zero security weight.

## What the standalone `solid-access-manager` app needs from this API

The app (design §4.3) that brokers consent when no extension is present speaks the SAME on-pod
artifacts; to drive the extension when it IS present it calls `window.solid.requestAccess(...)` /
`listGrants()` / `revokeGrant()` / `resolveClass()`. The one wiring the app still needs is a
`DataController` `AccessDeniedError` → "request access" hook (a `solid-components` follow-up, design
§4.3) that deep-links into the app's request composer or calls `requestAccess` when the extension
is detected (`'solid' in window` + `data-solid-extension` marker).
