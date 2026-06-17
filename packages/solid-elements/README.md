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
npm run lint        # Biome over src test scripts
npm run typecheck   # tsc --noEmit
npm test            # vitest (jsdom)
npm run build       # tsc -> dist/ (committed)
npm run check:dist  # fails if committed dist/ drifts from a fresh build
```

`dist/` is **intentionally committed** so the package is GitHub-installable under
`ignore-scripts=true` with no build step. Rebuild + commit `dist/` alongside any
`src/` change — the `check:dist` gate guards against drift.

## License

MIT © Jesse Wright
