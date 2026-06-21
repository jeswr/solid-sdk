# @jeswr/solid-elements

Framework-agnostic **W3C Web Components (Lit 3)** for the Solid app suite —
presentation-only "chrome" you can drop into any page (vanilla, Vite, Next.js,
Svelte, …) that inherits the [`@jeswr/app-shell`](https://github.com/jeswr/app-shell)
OKLCH theme through CSS custom properties.

These are **presentation-only**: pure DOM + CSS custom properties + `CustomEvent`s.
There is no auth, data, or RDF seam — the host wires session / navigation /
persistence to the components' events and props.

> **Relationship to `@jeswr/app-shell` — COMPLEMENT, not supersede.**
> `@jeswr/app-shell` is the **React** home for theme truth (the `ThemeProvider`)
> and stateful/RDF concerns. `@jeswr/solid-elements` is the **framework-agnostic**
> presentation layer: the components are co-operative with a host `ThemeProvider`
> (they read + write the SAME `app-shell-theme` localStorage key and the SAME
> `.dark` class on `<html>`), and theme via the same shadcn tokens, so the two
> work together. Use these when you are NOT in React, or want a Web Component;
> use app-shell's React components when you are.

## Install

No npm publish yet — install straight from GitHub (the built `dist/` is committed,
so it works under `ignore-scripts=true` with no build step):

```sh
npm install github:jeswr/solid-elements#main
# peer deps only for the ./react subexport:
npm install react react-dom
```

## Usage — raw custom elements (framework-agnostic)

Importing the package **side-effect registers** every `jeswr-*` tag (each
`customElements.define` is guarded, so double-import is safe):

```js
import "@jeswr/solid-elements";
```

```html
<jeswr-theme-toggle></jeswr-theme-toggle>
<jeswr-account-menu name="Ada Lovelace" webid="https://id.example/me#me"></jeswr-account-menu>
<jeswr-feedback-button repo="jeswr/pod-mail" app-name="Pod Mail" app-version="1.2.3"></jeswr-feedback-button>
```

Listen to the `CustomEvent`s:

```js
document.querySelector("jeswr-account-menu")
  .addEventListener("sign-out", () => myApp.signOut());

document.querySelector("jeswr-theme-toggle")
  .addEventListener("theme-change", (e) => console.log(e.detail)); // { theme, resolvedTheme }
```

## Components

| Tag | Attributes / properties | Events |
|---|---|---|
| `jeswr-theme-toggle` | `theme` (reflected: `light` \| `dark` \| `system`), `resolved-theme` (reflected, read-only-ish) | `theme-change` → `{ theme, resolvedTheme }` |
| `jeswr-account-menu` | `webid`, `name`, `avatar-url`; default `<slot>` for extra menu items | `sign-out` |
| `jeswr-feedback-button` | `repo` (required, `owner/repo`), `app-name`, `app-version`, `webid`; **property** `submit: (payload) => Promise<{url,number}>` | `feedback-submit` → `FeedbackPayload` |
| `jeswr-login-panel` | attrs `initial-webid`, `auto-restore` (default on), `heading`; **property** `controller: LoginController` (the auth seam); read-only props `.fetch`, `.publicFetch`, `.webId`; default `<slot>` for extra signed-in actions | `session-change` → `{ webId, loggedIn }`, `login` → `{ webId }`, `logout` |
| `jeswr-empty-state` | `heading`, `description`; named slots `icon`, `title`, `description`, `action` | — |
| `jeswr-error-state` | `heading`, `description`; named slots `icon`, `title`, `description`, `action` (destructive-styled, `role="alert"`) | — |
| `jeswr-loading` | `label`; spinner + `role="status"` | — |
| `jeswr-saving-indicator` | `state` (`idle` \| `saving` \| `saved` \| `error`), `saving-label`, `saved-label`, `error-label` | — |

### `jeswr-theme-toggle`

Cycles light → dark → system. It is **co-operative, not authoritative**: it reads
and writes the SAME `app-shell-theme` localStorage key and toggles the SAME
`.dark` class + `colorScheme` on `<html>` that `@jeswr/app-shell`'s React
`ThemeProvider` uses, so a host `ThemeProvider` and this toggle converge instead
of fighting. In `system` mode it live-follows `prefers-color-scheme` (and cleans
up the `matchMedia` listener on disconnect). Reflects a `theme` attribute so
consumers can read state; emits `theme-change` with `{ theme, resolvedTheme }`.

### `jeswr-feedback-button`

The shared "report issue / give feedback / request help" control. Two mechanisms:

1. **Proxy** — set the `submit` **property** (a `(payload) => Promise<{url,number}>`
   function, e.g. the feedback proxy). The issue is created server-side (the
   reporter needs no GitHub account); on success the dialog shows the issue link.
2. **Zero-infra (default)** — with no `submit`, it opens GitHub's prefilled
   new-issue page in a new tab via `window.open(url, "_blank", "noopener,noreferrer")`.

It ALSO emits a `feedback-submit` `CustomEvent` with the full `FeedbackPayload`
on every submit, regardless of mechanism. **Privacy:** the WebID is attached ONLY
when the in-dialog consent box is ticked (default **OFF**). The issue URL is built
by `buildIssueUrl`, which **validates `repo`** against a strict `owner/repo`
grammar (fail-closed) so a bad value can't hijack the host, and URL-encodes the
title/body/labels. The dialog is focus-trapped, `aria-modal`, and Escape-closable.

Exported pure helpers (no DOM, unit-tested): `buildIssueUrl`, `composeIssueBody`,
`composeIssueTitle`, `feedbackLabels`, `isValidRepo`.

### `jeswr-login-panel` (the keystone login surface)

The suite's Solid login surface: a WebID/issuer prompt + recent-accounts +
**silent session restore on load**, wrapping
[`@solid/reactive-authentication`](https://www.npmjs.com/package/@solid/reactive-authentication)'s
authorization-code (DPoP) login + [`@jeswr/solid-session-restore`](https://github.com/jeswr/solid-session-restore)'s
DPoP-bound refresh-token restore.

**The auth seam (load-bearing — this is auth).** The panel is **presentation +
events only**; the security-critical auth machinery is injected as a
`LoginController` (the `.controller` property). It exposes three **read-only**
properties — the credential-leak boundary:

| Property | What it is | Use it for |
|---|---|---|
| `.fetch` | the **authenticated**, session-bound fetch (after login) — attaches the DPoP token **only** for an allowed resource origin | the user's OWN origin(s) |
| `.publicFetch` | the **pristine** native fetch, captured BEFORE reactive-auth patches the global | **foreign-origin / public reads** — carries no session, never upgrades on 401 |
| `.webId` | the authenticated WebID (`string \| null`) | rendering / app state |

Before login both fetches are the pristine native fetch. After login, `.fetch`
attaches the DPoP-bound token **only for requests whose origin is in the session's
allowed-origins set** (the WebID's origin + the issuer's origin + any configured
`allowedOrigins`); a 401 from a foreign origin is left **unauthenticated**, and
`.publicFetch` **stays pristine** — so a session token can never leak cross-origin,
even if a caller accidentally routes a foreign request through `.fetch`. The element
authenticates only with its own session fetch; it never patches the global and never
authenticates a foreign-origin request itself. When the access token reaches its
expiry, the next allowed-origin request **transparently redeems the persisted
refresh token** (a token-endpoint fetch; single-flight, rotation-aware) before
attaching — so a long-lived session keeps working without a reload.

**Events:** `session-change` (`{ webId, loggedIn }`), `login` (`{ webId }`),
`logout`.

**Silent restore (suite invariant #1).** On connect (with `auto-restore` on, the
default) the panel shows a "Restoring…" state and asks the controller to silently
re-establish the session from the persisted DPoP-bound refresh token — a
token-endpoint `fetch`, never a redirect/popup/iframe. On success it lands
logged-in; on a genuine restore failure it falls back to the login prompt
(**fail-closed** — it never asserts a session it couldn't rebuild, and never flashes
the prompt before the decision resolves). To disable restore, set `auto-restore="false"`
(or the `.autoRestore` property to `false`).

#### Wiring the auth seam — the `@jeswr/solid-elements/auth` subexport

The core library has **zero auth runtime dependencies** (so the committed `dist/`
stays self-contained for the GitHub-installable contract). The adapter that
implements `LoginController` against the real stack lives in a **separate**
subexport:

```ts
import "@jeswr/solid-elements";                  // registers <jeswr-login-panel>
import "@solid/reactive-authentication";         // importing it registers <authorization-code-flow>
import { createReactiveAuthController } from "@jeswr/solid-elements/auth";

// Ensure an <authorization-code-flow> element exists on the page (the import above
// defines the custom element; add the tag to your HTML, or create it dynamically).
const authFlow = document.querySelector("authorization-code-flow")!;
const panel = document.querySelector("jeswr-login-panel")!;
panel.controller = createReactiveAuthController({
  authFlow,                                            // drives the popup (getCode)
  callbackUri: new URL("/callback.html", location.href).toString(),
  clientId: "https://app.example/clientid.jsonld",     // optional: a Client Identifier Doc
  dbName: "my-app:sessions",                           // unique per app on a shared origin
  rememberedAccountsKey: "my-app.remembered-account",  // the silent-restore pointer (cleared on logout)
  recentAccountsKey: "my-app.recent-accounts",         // the returning-user list (SURVIVES logout)
  // The credential boundary: .fetch attaches the token ONLY to these origins (must
  // be https — a cleartext http origin is dropped, unless it's a loopback host and
  // allowInsecureLoopback is set). The WebID's + issuer's origins are included by
  // default; list a pod on a DIFFERENT host here, or it won't be authenticated. Set
  // includeWebIdOrigin/IssuerOrigin false to rely solely on this list.
  allowedOrigins: ["https://storage.example"],
  // allowInsecureLoopback: true,                       // dev CSS over HTTP only
  // patchGlobalFetch: false (default) — keep the global pristine; .fetch is the authed path
});
```

**`authFlow` is OPTIONAL — restore-only usage doesn't need it.** It drives the
interactive login popup, so it is needed only by `login()`. A consumer that
constructs the controller purely to silently restore a persisted session on load
(calling `restore()`, never `login()`) may omit it entirely — no dummy popup driver
required. Calling `login()` without an `authFlow` throws a targeted
`MissingAuthFlowError` (exported from `@jeswr/solid-elements/auth`) so the
misconfiguration is obvious.

`/callback.html` contains `<script>opener.postMessage(location.href)</script>` (the
reactive-auth popup contract). On login the adapter requests `offline_access`,
persists the DPoP-bound refresh token + non-extractable ES256 key to IndexedDB
(keyed by issuer, with the client_id actually used so the dynamic path stays
restorable), and remembers the account; logout clears both. Issuer resolution
reads `solid:oidcIssuer` from the WebID profile via `@jeswr/fetch-rdf` + `@solid/object`
(**never** regex-scraping Turtle), throwing `AmbiguousIssuerError` when several
issuers are advertised unless you pass a `chooseIssuer` callback.

**WebIDs must be `https:`.** Because the WebID's origin is in the credential
boundary, a login with a cleartext `http:` WebID is rejected by default (the token
would ride over plaintext); `http:` is allowed only for a loopback dev host and only
under `allowInsecureLoopback: true`. **`publicFetch` is snapshotted at module load**
(before any patching) so it stays credential-free even if another controller later
patches the global with `patchGlobalFetch: true`; if you construct the controller
after the global was already patched, inject a known-pristine fetch via the
`publicFetch` option.

> **⚠️ Auth deps install caveat (the GitHub-installable contract).** The `/auth`
> subexport's dependencies are declared as **optional peer dependencies** and are
> NOT bundled into `dist/`. The core entry (and `<jeswr-login-panel>` with a
> **custom** `LoginController`) install + import buildless with no extra deps. But a
> consumer using `createReactiveAuthController` must install them explicitly —
> including the **off-npm** `@jeswr/solid-session-restore` (github-installed,
> committed `dist/`):
> ```bash
> npm install \
>   @solid/reactive-authentication @solid/object @jeswr/fetch-rdf \
>   oauth4webapi dpop n3 \
>   github:jeswr/solid-session-restore#main
> ```

You can also supply your **own** `LoginController` (the interface is exported from
the core entry) — e.g. to wire a different auth stack — with no auth deps at all.

#### Proactive authenticated `fetch` — `installProactiveAuthFetch` (no more 401-dance)

When you keep your **own** token provider (so `createReactiveAuthController` — which
builds its own provider — can't wrap it), use the generic **proactive-fetch installer**
exported from `@jeswr/solid-elements/auth`. It replaces
`@solid/reactive-authentication`'s `ReactiveFetchManager.registerGlobally()`: instead of
sending every request UNAUTHENTICATED and attaching the DPoP token only REACTIVELY on a
401 (per resource, with no origin cache — so a container listing of N children pays N
wasted 401s), it **proactively attaches the token on the FIRST request to an allowed
origin** (zero wasted 401s) and enforces a fail-closed credential boundary.

```ts
import {
  installProactiveAuthFetch,
  deriveProactiveAllowedOrigins,
} from "@jeswr/solid-elements/auth";

// Patch globalThis.fetch ONCE per page (idempotent). Captures the pristine fetch first.
const install = installProactiveAuthFetch();

// Your provider implements `upgrade(request): Promise<Request>` (attaches Authorization:
// DPoP … + the DPoP proof). Its internal OIDC/token requests MUST use install.pristineFetch
// (see the re-entrancy warning below).
const provider = new MyTokenProvider({ customFetch: install.pristineFetch });

// On login / silent-restore — arm the live credential boundary:
install.setState({
  provider,
  allowedOrigins: deriveProactiveAllowedOrigins({
    podRoot,                                // the pod/storage root (its origin is the primary target)
    webId,                                  // its origin is included by default
    issuer,                                 // its origin is included by default
    // extraOrigins: ["https://media.example"],  // a media host / second pod on another host
    // includeWebIdOrigin / includeIssuerOrigin: false  // to rely solely on the explicit list
    allowInsecureLoopback,                  // dev CSS over HTTP only
  }),
});

// On logout — drop the boundary so every request is public again:
install.setState({ provider: null, allowedOrigins: new Set() });
```

Behaviour (preserved exactly from the pod-drive-proven implementation, adversarially
tested): proactively attach on the first allowed-origin request; **one bounded 401
re-upgrade** distinguishing an RFC 9449 `use_dpop_nonce` challenge (reuse the token) from a
stale token (force a fresh proof); **transport errors propagate** (never silently
downgraded to a second public request — that would duplicate a non-idempotent write); only
a **superseded** upgrade (a logout/relogin reset-race, `ReactiveAuthResetError` by default —
override via the `isSuperseded` config) downgrades to a public request.

The **credential boundary is the same fail-closed seam** the controller uses
(`computeAllowedOrigins`): https-only origins, loopback-http only under
`allowInsecureLoopback`, an empty allowed-set authenticates **nothing**, and the token is
**never** attached to a foreign origin even if your provider's `upgrade()` is unconditional.
`isOriginAllowed` is re-checked on every request, so logout takes effect immediately.

> **⚠️ Re-entrancy (this bit pod-drive).** If you opt into patching the **global** `fetch`
> (the default), your token provider's internal OIDC / oauth4webapi token requests
> (discovery, the refresh-token grant) **MUST** be pinned to `install.pristineFetch`, NOT
> the patched global. Otherwise the provider's own token-endpoint `fetch` re-enters the
> patch, which calls `provider.upgrade()` again, which issues another token request — a
> self-deadlock / infinite re-entry. Wire your provider's `customFetch` (and any public
> profile read) to `install.pristineFetch`. Pass `patchGlobal: false` if you'd rather route
> only through the returned `install.fetch` handle and keep the global pristine.

`proactiveAuthenticatedFetch` (the implementation run over an explicit `base` fetch) is also
exported, so the boundary + bounded-retry behaviour are unit-testable without patching the
global. **Origin-level only** — per-storage-prefix learning is a separate follow-on.

##### Optional seams: shared-issuer OAuth bypass + a session-liveness gate

Two **optional** live fields on `ProactiveFetchState` cover the patterns Pod Manager needs
(both default OFF — omit them and behaviour is byte-identical to the pod-drive path above):

- **`issuerOrigins?: ReadonlySet<string>`** — a second line of defence against the
  re-entrancy problem for apps whose provider routes its OWN OAuth calls (discovery / token /
  refresh) over the **patched global** on a **shared issuer/pod origin** (the common CSS
  topology where the pod and the OP share a host). When supplied, the wrapper leaves a
  provider-internal OAuth request to an issuer origin **unauthenticated** so it does not clobber
  oauth4webapi's own headers or recurse. A request is treated as provider-internal only when it
  is on an issuer origin AND it either carries a `DPoP` proof header or has a `/.well-known/` or
  `/.oidc/` path — a plain pod resource read on that same origin keeps the full auth path. The
  pure predicate `isProviderOAuthRequest(request, issuerOrigins)` is exported and tested. (The
  default re-entrancy guard remains **pinning your provider's `customFetch` to
  `install.pristineFetch`** — pod-drive's approach; this seam is for when that is not enough.)
- **`canAttachNonInteractively?: (request: Request) => boolean`** — a per-request liveness gate
  read fresh each call (and on the 401 retry). Return `false` when a token can only be obtained
  via user interaction (a dead refresh token), and the request is left **unauthenticated** so a
  **passive on-load read does not trigger the interactive code-flow popup** from a background
  fetch. Omitted ⇒ always attempt the upgrade on an allowed origin (correct for a provider whose
  every armed session is non-interactively renewable, e.g. pod-drive's).

```ts
install.setState({
  provider,
  allowedOrigins: deriveProactiveAllowedOrigins({ podRoot, webId, issuer, allowInsecureLoopback }),
  // PM-parity opt-ins (omit for the pod-drive path):
  issuerOrigins: new Set([new URL(issuer).origin]),
  canAttachNonInteractively: (req) => sessionStore.isRefreshable(),
});
```

This covers **both** the pod-drive pattern (no extra fields) and Pod Manager's pattern (both
fields) from one shared helper. The single `shouldAttachToken` gate that funnels every decision
is also the documented **#123 P2** extension point for later per-storage-prefix learning,
without an API churn.

## Theming token contract (shadow DOM)

Each component renders in **shadow DOM** and exposes styling hooks via `::part(...)`.
CSS custom properties **inherit through the shadow boundary**, so every component
reads a `--jeswr-*` variable that DEFAULTS, via nested `var()`, to the matching
`@jeswr/app-shell` shadcn variable, then to a hardcoded OKLCH literal (the
app-shell light value, so the components also look right with no host theme):

```css
color: var(--jeswr-fg, /* implicit: */ var(--foreground, oklch(0.21 0.022 235)));
```

Light/dark **just works**: app-shell's `ThemeProvider` flips `.dark` on `<html>`,
which flips `--foreground` etc. on `:root`; that inherited value reaches the shadow
tree. A consumer can override any `--jeswr-*` on the host element to retheme a
single component without touching the app theme.

| `--jeswr-*` token | defaults to app-shell var | role |
|---|---|---|
| `--jeswr-bg` | `--background` | surface background |
| `--jeswr-fg` | `--foreground` | primary text |
| `--jeswr-border` | `--border` | borders / dividers |
| `--jeswr-muted-fg` | `--muted-foreground` | secondary text |
| `--jeswr-primary` | `--primary` | spinner accent / links |
| `--jeswr-primary-fg` | `--primary-foreground` | text on primary |
| `--jeswr-popover` | `--popover` | menu / dialog surface |
| `--jeswr-popover-fg` | `--popover-foreground` | text on popover |
| `--jeswr-destructive` | `--destructive` | error / destructive cues |
| `--jeswr-accent` | `--accent` | hover / selected surface |
| `--jeswr-accent-fg` | `--accent-foreground` | text on accent |
| `--jeswr-ring` | `--ring` | focus ring |
| `--jeswr-radius` | `--radius` | corner radius |

## React subexport (`./react`)

Ergonomic, typed React wrappers built with [`@lit/react`](https://www.npmjs.com/package/@lit/react)
`createComponent`. Each `CustomEvent` maps to a React prop:

```tsx
'use client';
import { useRef } from "react";
import { ThemeToggle, AccountMenu, FeedbackButton, LoginPanel } from "@jeswr/solid-elements/react";
import { createReactiveAuthController } from "@jeswr/solid-elements/auth";

<ThemeToggle onThemeChange={(e) => console.log(e.detail)} />
<AccountMenu name="Ada" webId="https://id.example/me" onSignOut={signOut} />
<FeedbackButton repo="jeswr/pod-mail" appName="Pod Mail" onFeedbackSubmit={(e) => track(e.detail)} />

// LoginPanel: set `controller`, read `.fetch`/`.publicFetch`/`.webId` via a ref.
const ref = useRef<HTMLElement & { fetch: typeof fetch; webId: string | null }>(null);
<LoginPanel
  ref={ref}
  controller={controller}                 // a LoginController (see /auth)
  onSessionChange={(e) => setSession(e.detail)}   // { webId, loggedIn }
  onLogin={(e) => console.log("logged in", e.detail.webId)}
  onLogout={() => setSession(null)}
/>
```

Event-prop map: `onThemeChange` ← `theme-change`, `onSignOut` ← `sign-out`,
`onFeedbackSubmit` ← `feedback-submit`, `onSessionChange` ← `session-change`,
`onLogin` ← `login`, `onLogout` ← `logout`.

### Next.js static-export caveat (client-only)

Custom elements need a real DOM (`window.customElements`), so the React wrappers
are **CLIENT-ONLY**. In Next.js (App Router or `output: 'export'`):

- Put `'use client'` at the top of the file that imports these wrappers.
- Do **not** render them on the server. Either gate on mount —
  `const [m, setM] = useState(false); useEffect(() => setM(true), []);` and render
  only when `m` — or import the consuming component with `next/dynamic` and
  `{ ssr: false }`:

  ```tsx
  const ThemeToggle = dynamic(
    () => import("@jeswr/solid-elements/react").then((m) => m.ThemeToggle),
    { ssr: false },
  );
  ```

The raw `.` custom elements stay framework-agnostic; only this React layer is
client-only. (Plain Vite/CSR React has no SSR step, so no gating is needed.)

## Development

```sh
npm install
npm run lint           # Biome over src test scripts + check:manifest (drift guard)
npm run typecheck      # tsc --noEmit
npm test               # vitest (jsdom) + check:manifest
npm run build          # tsc -> dist/ (committed)
npm run check:dist     # fails if committed dist/ drifts from a fresh build
npm run manifest       # regenerate custom-elements.json (committed)
npm run check:manifest # fails if committed custom-elements.json drifts from a fresh run
npm run api:check      # fails if the committed API report drifts from dist (run build first)
```

`dist/` is **intentionally committed** so the package is GitHub-installable under
`ignore-scripts=true` with no build step. Rebuild + commit `dist/` alongside any
`src/` change — the `check:dist` gate guards against drift.

### The Custom Elements Manifest (`custom-elements.json`)

The package ships a committed [Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest)
(`custom-elements.json`, referenced from `package.json`'s `customElements` field) so
LLM codegen tooling and component catalogs can discover each element's tags,
attributes, slots, CSS parts, CSS custom properties, and events from a GitHub
install with **no build step**. It is generated by
[`@custom-elements-manifest/analyzer`](https://github.com/open-wc/custom-elements-manifest)
(dev-only) from the elements' JSDoc + Lit `static properties`.

A custom analyzer plugin (`scripts/cem/solid-binding-plugin.mjs`) additionally lifts
the suite **data-binding** JSDoc tags into the manifest, so an element that renders
or edits an RDF class advertises that binding in ONE generated artifact (no runtime
registry):

| Tag | Manifest `solid.*` | Meaning |
|---|---|---|
| `@solid-class <IRI>` | `class` | the RDF class the element binds to (http(s) IRI) |
| `@solid-shape <IRI>` | `shape` | the SHACL/shape IRI describing its data (http(s) IRI) |
| `@solid-mode view\|edit` | `mode` | whether it renders or edits that data |
| `@solid-cardinality one\|container` | `cardinality` | one resource, or a container of them |

All four are optional and validated fail-closed; the plugin no-ops cleanly on the
presentation-only chrome elements (which carry no `solid` block). It also strips Lit
`state: true` reactive props (the analyzer would otherwise mis-advertise them as
public attributes). Regenerate + commit the manifest alongside any element change
(`npm run manifest`); the `check:manifest` gate guards against drift.

### The public-API snapshot (`etc/*.api.md`)

The full public surface of each entry point is snapshotted as a committed, diffable
[api-extractor](https://api-extractor.com/) report, so "what is the API?" — and "did a
change perturb it?" — is a one-file diff rather than a code read:

| Entry | Report |
|---|---|
| `@jeswr/solid-elements`         | `etc/solid-elements.api.md` |
| `@jeswr/solid-elements/react`   | `etc/solid-elements.react.api.md` |
| `@jeswr/solid-elements/auth`    | `etc/solid-elements.auth.api.md` |

After an **intended** API change, regenerate + commit the reports with
`npm run build && npm run api:report`; the resulting `etc/` diff is the reviewed,
semver-mappable record of the change. `npm run api:check` gates against accidental
drift. api-extractor is run dev-only via `npx` (it is not a dependency of the package,
so it never reaches the committed `dist/`).

## License

MIT © Jesse Wright
