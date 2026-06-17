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

## Components (P0)

| Tag | Attributes / properties | Events |
|---|---|---|
| `jeswr-theme-toggle` | `theme` (reflected: `light` \| `dark` \| `system`), `resolved-theme` (reflected, read-only-ish) | `theme-change` → `{ theme, resolvedTheme }` |
| `jeswr-account-menu` | `webid`, `name`, `avatar-url`; default `<slot>` for extra menu items | `sign-out` |
| `jeswr-feedback-button` | `repo` (required, `owner/repo`), `app-name`, `app-version`, `webid`; **property** `submit: (payload) => Promise<{url,number}>` | `feedback-submit` → `FeedbackPayload` |
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
import { ThemeToggle, AccountMenu, FeedbackButton } from "@jeswr/solid-elements/react";

<ThemeToggle onThemeChange={(e) => console.log(e.detail)} />
<AccountMenu name="Ada" webId="https://id.example/me" onSignOut={signOut} />
<FeedbackButton repo="jeswr/pod-mail" appName="Pod Mail" onFeedbackSubmit={(e) => track(e.detail)} />
```

Event-prop map: `onThemeChange` ← `theme-change`, `onSignOut` ← `sign-out`,
`onFeedbackSubmit` ← `feedback-submit`.

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
