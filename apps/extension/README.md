# Solid Browser Extension

A Manifest V3 browser extension that brings **Solid sign-in to the browser itself**. It
injects a `window.solid` consent stub into every page (`login` and `requestAccess`).
Explicit origin consent adds DPoP-authenticated `fetch`, the bound profile's `webId`,
and class-management APIs. The toolbar account menu shows the signed-in WebID's avatar. The UI is built with
[`@jeswr/solid-elements`](https://github.com/jeswr/solid-elements)
so it is visually consistent with [Pod Manager](https://github.com/jeswr/solid-pod-manager)
and the rest of the [@jeswr Solid app suite](https://github.com/jeswr).

> **Scope:** auth, `window.solid`, popup/side-panel account UI, a gated shared replica,
> and per-data-class consent through `requestAccess` / `listGrants` / `revokeGrant` /
> `resolveClass` are implemented. Class resolution currently uses Solid Type Indexes;
> SAI registration discovery, SHACL validation, and offline write queues remain follow-ups.

## Architecture

Four contexts, with the access token held in exactly one of them (the service worker):

```
 Page (MAIN world)          Content script (ISOLATED)        Service worker (background)
   window.solid     ⇄          content-script.ts      ⇄            service-worker.ts
   inject.ts          postMessage                 chrome.runtime    ├─ auth-flow.ts (auth-code + PKCE + DPoP)
   (no credential)    (trust boundary:            (sole token       ├─ core/authenticated-fetch.ts (the boundary)
                       stamps real origin)          holder)         ├─ core/dpop.ts (RFC 9449 proofs, Web Crypto)
                                                                     ├─ core/origin-policy.ts (fail-closed gate)
   Popup = the account UI (@jeswr/solid-elements) ⇄ chrome.runtime  ├─ core/profile-store.ts + profile-db.ts (IndexedDB)
                                                                     └─ action-icon.ts (avatar toolbar icon)
```

- **The page never sees a credential.** `window.solid` (MAIN world) can only `postMessage`
  to the content script, which relays to the worker. The page gets back the WebID and
  proxied `Response`s — never the access or refresh token.
- **The service worker is the sole token holder.** Each profile's tokens and DPoP keypair
  live together in the worker's IndexedDB (`core/profile-store.ts`, `profile-db.ts`), with
  the private key held as a **non-extractable** `CryptoKey` — neither is reachable from any web page, satisfying
  the suite's "DPoP refresh token in non-page-reachable secure storage" invariant, and the
  private key additionally cannot be exported to JWK by ANY code (not even a compromised
  extension context — `crypto.subtle.exportKey` on it always rejects).
- **Every proxied pod read/write is gated before cache access or egress.** The worker
  cross-checks the content script's origin stamp against Chrome's sender, then checks
  origin grants and, for class-only origins, the pinned targets, modes, and expiry.
  Ungranted pages have no `webId` or `fetch` property.

### The credential boundary (security heart)

Because any page can send proxy messages, the worker must never hand a foreign
origin the user's token. `core/origin-policy.ts` + `core/authenticated-fetch.ts` enforce,
fail-closed:

- The token is attached **only** to a target origin in the allowed set (the WebID's origin ∪
  the issuer's origin ∪ user-configured pod origins), after the requesting app passes its
  access gate. An explicit `solid.fetch` from an ungranted origin returns 403 before any
  cache read or pod egress. Foreign targets are allowed only on the requesting app's own
  origin, without the Solid token; unrelated third-party targets return 403.
- **Cleartext guard:** the token never rides over `http:` (loopback excepted, for dev CSS).
- The resource token is never attached to the issuer's `/token` endpoint.
- Page-supplied `Authorization` / `DPoP` headers are **stripped** (no header injection).
- DPoP proofs follow RFC 9449 §4.2 (the same proof shape as
  [`@jeswr/solid-dpop`](https://github.com/jeswr/solid-dpop), reimplemented on Web Crypto
  because a service worker has no `node:crypto`), with the §8 `use_dpop_nonce` single retry.

These invariants are pinned by an adversarial unit suite (`test/`), including a
WebID/origin-mismatch test that genuinely fails without the guard.

## `window.solid`

```ts
// Ungranted origins receive only login() and requestAccess().
// These additional properties become available after explicit origin consent.
interface SolidExtension {
  readonly webId: string | null;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  setClientId(clientId: string): void;          // declare this origin's Client ID Document
  login(webId: string): Promise<void>;
  logout(): Promise<void>;
  requestAccess(request: AccessRequestArgs): Promise<{ ok: boolean; grants: SolidGrant[] }>;
  listGrants(): Promise<SolidGrant[]>;
  revokeGrant(grantId: string): Promise<boolean>;
  resolveClass(classIRI: string): Promise<{
    shape: string | null;
    targets: Array<{ url: string; kind: 'instance' | 'container' }>;
  }>;
}

interface AccessRequestArgs {
  readonly classes: readonly string[];
  readonly modes: readonly string[]; // read, append, write (case-insensitive)
  readonly purpose?: string;
  readonly duration?: string;       // required at runtime: positive ISO-8601, e.g. P30D
}

interface SolidGrant {
  readonly grantId: string;
  readonly dataClass: string;
  readonly modes: readonly string[];
  readonly purpose: string | null;
  readonly expiresAt: number;        // epoch milliseconds
  readonly targets: ReadonlyArray<{ url: string; kind: 'instance' | 'container' }>;
}
```

Presence can also be detected using the `solid-extension:ready` event or the sticky
`<html data-solid-extension="1">` marker. These carry no identity. The best-effort
`fetch` patch is registered only on granted origins; other pages retain native fetch.
Requests the worker does not authorize fall back to the page's captured native fetch
with normal CORS behavior.
Explicit `solid.fetch` calls retain the worker's denial response.

## Auth + session

- **Login:** Solid-OIDC **authorization-code + PKCE + DPoP**, driven by
  `chrome.identity.launchWebAuthFlow` (a service worker has no `window`). The WebID's
  `solid:oidcIssuer` is resolved by **proper RDF parsing** (N3.js, not regex). The extension's
  own Solid-OIDC **Client Identifier Document** is generated from
  `src/background/client-id-template.ts` and the manifest's public key into
  `public/clientid.jsonld` before builds (Node 24 required). The document's `client_id` is
  `https://jeswr.github.io/solid-browser-extension/clientid.jsonld`, its redirect is
  `https://bicabcdahgfbkgmlidjpmiadmjlppikk.chromiumapp.org/`, and its auth method is `none`.
  The build rejects a missing or mismatched public key; the dispatcher-supplied key can be
  imported with `EXT_PUBKEY=/path/to/extension-pubkey.b64 pnpm run generate:client-id`.
  The public key belongs in `manifest.key`; the extension signing private key stays with Jesse.
  A page may still declare its own Client ID Document via `solid.setClientId(...)`.
- **Profiles:** `ProfileStore` supports up to eight distinct WebIDs. Each profile has its own
  access/refresh token set, non-extractable DPoP keypair and pod settings, persisted
  atomically in IndexedDB under the profile id. Explicit origin grants bind those profile IDs
  in worker-owned `chrome.storage.local`. The current single session migrates to profile
  `1`, keeping its matching key. A missing/mismatched key retains the display entry and requires
  re-login. Legacy token/key storage is cleared only after migration commits.
- **Default and restore:** the default profile supplies the account surface. Each origin
  grant binds one profile independently of that default. Requests capture the bound profile's
  id; a default switch cannot substitute another profile's credentials mid-request. Refresh
  is single-flight per profile, reuses its persisted key, and commits rotated tokens before use. Reopening the worker restores from IndexedDB.
- **Removal and logout:** removing a profile revokes its grants, cancels pending replica fetches,
  finishes local replica commits, purges its WebID's replica slices and deletes its credentials.
  Interrupted removal resumes on worker wake. Logout signs out only the default profile, retaining its display entry; other
  profiles keep their own sessions. One default exists whenever the store is nonempty.

The popup and side panel share a profile switcher: list accounts with photos or initials,
add an account through sign-in, rename, remove with confirmation, and choose the default.
Adding keeps the existing default. Signed-out entries offer re-login; all eight slots stay
visible at capacity. Native controls support Tab, Enter and Space; arrows move between the
same action on adjacent profiles, Escape cancels edits, and results/errors are announced.
Removal revokes that profile's app access and clears its local replica while keeping its pod.

The worker API accepts the following messages **only from browser-attested extension contexts**, returning display-only
`{ ok, profiles, defaultProfileId }` or `{ error }` (never tokens or key objects):

| Message | Fields |
|---|---|
| `SOLID_PROFILES_LIST` | none |
| `SOLID_PROFILE_ADD` | `webId` (interactive login; keeps the existing default) |
| `SOLID_PROFILE_RENAME` | `profileId`, `label` |
| `SOLID_PROFILE_REMOVE` | `profileId` |
| `SOLID_PROFILE_SET_DEFAULT` | `profileId` |

A successful legacy `SOLID_LOGIN` selects the logged-in profile as default. Re-login updates
only the same WebID. Removing the default selects the oldest survivor; an empty store has no
default. Per-origin bindings and the consent profile picker are implemented. `requestAccess`
requires a click, opens extension-owned consent, and shows the selected profile's pinned class targets.
Approved class grants nest under `{origin, profileId, scope: {pods, classes}, createdAt, expiresAt}`.
Every request rechecks the parent and its class constraints. Revocation/expiry unregisters
the origin's patch, clears page capabilities and denies captured functions on their next call.
Legacy implicit grants require fresh consent. The trusted grants-manager worker seam is
documented in [manifest permissions](docs/manifest-permissions.md); its side-panel UI is EXT-06.

The trusted `clientIdMode` setting is stored as `solid:client-id-mode` in
`chrome.storage.local`. It accepts `document` or `dcr`, defaulting to `dcr` while Pages
enablement is pending. `dcr` uses dynamic client registration without probing the hosted
document. `document` uses the published URL and fails login if the document cannot be
fetched or does not self-reference; it never silently registers a different client.
Malformed settings fail closed. A page-declared Client ID Document keeps precedence in
either mode, and page messages cannot set the mode.

`.github/workflows/pages.yml` renders and publishes only the public document and its logo
on `main` (or manual dispatch from `main`). **Jesse must enable GitHub Pages with GitHub
Actions as its source**; the workflow does not enable Pages. Once hosting is available,
set the mode from an extension context's DevTools console:

```js
await chrome.storage.local.set({ 'solid:client-id-mode': 'document' });
```

Use `dcr` in the same setting to retain dynamic registration during local development.

## The pinned toolbar identity

The `chrome.action` icon is rendered (off-DOM, `OffscreenCanvas`) to the signed-in WebID's
**avatar** — the profile photo (circular crop) or coloured initials — with a green status
badge. The **popup is the account UI**: `@jeswr/solid-elements`' `jeswr-account-menu` +
`jeswr-theme-toggle`, a recent-accounts affordance, a pod shortcut, a "restoring" state, and
a **first-run pin nudge** (extensions can't self-pin). Light/dark themes the popup chrome and
the web components in lockstep via the app-shell OKLCH tokens.

### The side panel (persistent surface)

For users who want the account UI to **stay open** as they browse (vs the ephemeral popup),
the extension also ships an MV3 **side panel** (`sidepanel/sidepanel.html`). It renders the
**identical** signed-in/signed-out surface as the popup — the SAME `@jeswr/solid-elements`
components driven by the SAME token-free `MessageBridgeLoginController` seam — via the shared
`mountAccountSurface()` (`src/popup/account-surface.ts`), so there is exactly one copy of the
view-switching + auth-bridge logic. Both surfaces also share the profile controls. **Open it** by right-clicking the
toolbar icon → **"Open Solid side panel"** (a left-click still opens the quick popup; Chrome
ignores open-on-action-click while a `default_popup` is set, so both surfaces coexist via the
context-menu entry).

## Shared replica

Granted pod reads use the extension-owned replica: bytes in CacheStorage, metadata and
DPoP nonces in IndexedDB, keyed by WebID and grant scope. Cached reads revalidate against
the pod and remain subject to the access gate on every hit. Writes go through to the pod
synchronously; logout purges the replica before further serving. Offline write queues and
central WebSocket invalidation are follow-ups.

## Per-data-class access management

After signing in through the extension, an app can request access from a click or keypress:

```js
document.querySelector('#share-contacts').addEventListener('click', async () => {
  const { ok, grants } = await window.solid.requestAccess({
    classes: ['https://schema.org/Person'],
    modes: ['read'],
    purpose: 'Display your contacts',
    duration: 'P30D',
  });
  if (!ok) return; // no classes approved

  const current = await window.solid.listGrants();
  const { shape, targets } = await window.solid.resolveClass(grants[0].dataClass);
  // Use solid.fetch within the grant's pinned targets. Later, to withdraw access:
  await window.solid.revokeGrant(grants[0].grantId);
});
```

- **`requestAccess`** opens a consent window in extension chrome showing the verified app
  origin, profile picker, classes, modes, purpose, expiry, and resolved targets. It requires transient user
  activation and is limited to three admitted requests per origin per minute (best-effort
  in-memory throttle, reset on worker restart). At least one valid HTTP(S) class IRI and
  recognized mode are required. `duration` is optional in the TypeScript shape but mandatory
  at runtime: a positive ISO-8601 duration, capped at 365 days. Years/months use 365/30 days.
  Approval returns one grant per approved class; denying all returns `{ ok: false, grants: [] }`.
  Invalid requests, missing activation/session, or throttling reject the promise.
- **`listGrants`** returns only this origin's non-expired class grants for the bound profile's WebID;
  no live parent/session or an unverifiable origin yields `[]`. Summaries contain no WebID or credential.
- **`revokeGrant`** removes this origin's class grant and returns whether it was removed.
  Removal precedes replica-slice purging, so even a purge failure cannot keep access live.
  Cached bytes still covered by another live read grant of the same origin are retained.
  The parent origin binding is managed separately from its nested class records.
- **`resolveClass`** walks the WebID's public/private Solid Type Indexes for `solid:forClass`
  and returns `solid:instance` / `solid:instanceContainer` targets on allowed pod origins.
  It requires a verified, granted origin and an active session. Class-only origins can
  resolve only classes they currently hold beneath their parent origin grant.
  It returns `shape: null` today: SAI discovery and SHACL validation are not implemented.
  An unknown/unreachable class resolves to an empty target set.

Class-only origins are confined to the targets pinned at consent, the granted modes, and
expiry, including on cache hits. Instances cover an exact resource path; containers cover
their path and descendants. GET/HEAD require `read`, POST requires `append`, and
PUT/PATCH/DELETE require `write`; `write` also satisfies `append`, but does not imply `read`.
Empty target sets authorize nothing. Re-resolution does not widen an existing grant.
`purpose` is an audit/display value, not an enforced usage restriction. Login,
`setClientId` and credential origins confer no implicit access. The origin parent and its
nested class scopes are both required. Changing the default profile does not rebind apps;
changing an origin's profile clears its old pod/class scope before fresh consent.

## Fill forms from your profile

On a recognised contact or address form, click the small **Fill from pod** field button,
activate it with Enter/Space, or right-click an editable field and choose **Fill from pod**.
An extension-owned preview shows the requesting site, profile picker, and the exact values
from your profile and linked address book. Check **Contact details** and/or **Address**, then
choose **Fill**. **Remember for this site** preselects those categories on later visits;
the preview still appears every time. Cancel, closing the preview or requesting tab, or
navigating the tab to another origin writes nothing. Profile/address-book discovery has a
30-second loading timeout; once open, the preview allows review until you decide, with only
a 24-hour safety cap. Forms are never filled on page load or submitted by the extension.

Form-fill consent is independent of app/API consent. Ordinary sites can use it without
calling `window.solid`; it never enables that API or discloses your profile identifier.
The worker stores only `{origin, profileId, categories, createdAt, expiresAt?}` in the separate
`solid:formfill-grants` table. Switching the default profile does not rebind remembered sites.
Removing or signing out of a profile clears its form-fill grants and cancels pending fills.

Only HTTPS pages (plus loopback HTTP for development) and frames with the top page's origin
are eligible. Passwords, payment fields, one-time codes, `autocomplete=off`, hidden and
uneditable controls are refused. The content script checks again before writing, preserves
existing/user-entered values, and emits native input/change events. Values live only in the
worker/preview and the approved form controls; they are not cached in page storage.
Public profile reads omit credentials; linked private address-book documents use the bound
profile's authenticated fetch, restricted to its pod origins with redirects refused.

The E2E fixture is [`test-site/address-form.html`](test-site/address-form.html); the local pod
seed includes a private address record. `e2e/tests/formfill.spec.ts` covers approval, denial,
and cross-origin iframe refusal.

## Build & load the unpacked extension

```bash
pnpm install --frozen-lockfile                 # from the solid-sdk root; @jeswr deps are workspace:*
pnpm turbo run build --filter=@jeswr/app-extension # builds solid-elements, then webpack -> dist/
```

Then in Chrome:

1. Open `chrome://extensions`, toggle **Developer mode** (top-right).
2. **Load unpacked** → select `apps/extension/dist/`.
3. Pin it (puzzle-piece icon → pin) — the popup is the account menu.
4. Click the icon, enter your WebID / Pod URL, sign in.

## Develop & test

```bash
pnpm run gate          # lint (biome) + typecheck (tsc) + test (vitest) + build (webpack)
pnpm run lint          # biome over src test e2e scripts
pnpm run typecheck      # tsc --noEmit
pnpm test              # vitest — mocked security-critical core, no server needed
pnpm run build         # webpack bundle to dist/
pnpm run test:e2e      # build + Playwright against a LOCAL Community Solid Server
```

The unit suite stubs `fetch` / `chrome.*` and needs no server. The Playwright e2e suite
boots a **local** Community Solid Server (`e2e/setup`) and a local test site — **never** the
live deploy — and drives the real extension in headless Chromium. CI uses Node.js 24 and
runs the gate before the local-server e2e suite. See [e2e/README.md](e2e/README.md) for
setup and runner troubleshooting. The profile-switcher scenario uses two
seeded CSS accounts, keyboard controls, axe WCAG checks and screenshots of both surfaces
in light/dark themes.

## License

MIT © Jesse Wright
