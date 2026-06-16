# @jeswr/app-shell

Framework-agnostic React shell components for the Solid app suite. The shared
UX-parity foundation: a **light/dark/system theme system** and a **WebID account
menu**, designed to work identically under **Vite** (the `pod-*` apps) and
**Next.js** (Pod Manager, solid-issues) — no `next-themes`, no `next/*`.

> Built for [#71 — suite UX parity](https://github.com/jeswr/full-solid-ecosystem).
> The Pod Manager and solid-issues shells are the reference; this package
> extracts their two highest-value pieces into something every app can adopt.

## Why this exists

PM + solid-issues are Next.js + shadcn and lean on `next-themes`, which is
Next-only. The 7 target apps are Vite + React. So the shared components are plain
React: theming via a `.dark` class on `<html>` driven by CSS variables, and an
account menu that takes its data as **props** (no app-specific session coupling).
Both are shadcn-compatible (Radix + Tailwind + the suite's OKLCH token set).

## Install

It is GitHub-installable now (committed `dist/`, `ignore-scripts=true`-safe):

```bash
npm install github:jeswr/app-shell#main
```

(Or consume the source directly via a relative path / Vite alias, as the pod-mail
pilot does.) Peer deps: `react` / `react-dom` (>=18). It bundles Radix
(`@radix-ui/react-dropdown-menu`, `@radix-ui/react-avatar`) and `lucide-react`.

## Theme system

```tsx
import { ThemeProvider, ThemeToggle, useTheme, themeScript } from "@jeswr/app-shell";
import "@jeswr/app-shell/styles.css"; // Tailwind v4 consumers (see Styling)

// Wrap your app once (Vite main.tsx / Next providers.tsx):
<ThemeProvider>
  <App />
</ThemeProvider>;

// Drop the toggle in the header:
<ThemeToggle />;
```

- `ThemeProvider` — `light` / `dark` / `system` (default `system`), persisted to
  `localStorage` (key `app-shell-theme`, configurable via `storageKey`; pass
  `null` to disable). It toggles the `.dark` class on `document.documentElement`
  and live-follows `prefers-color-scheme` in `system` mode. SSR-safe (all DOM /
  storage access is in effects).
- `useTheme()` → `{ theme, resolvedTheme, setTheme }`.
- `themeScript(storageKey?, attributeClass?)` — a blocking inline `<head>` script
  that sets `.dark` **before first paint** to avoid a light-flash on a dark
  reload. Inject it in `index.html` (Vite) or via `dangerouslySetInnerHTML`
  (Next). Use the same key/class as the provider.

## Account menu

```tsx
import { AccountMenu } from "@jeswr/app-shell";

<AccountMenu
  webId={session.webId}
  displayName={profile?.name}
  avatarUrl={profile?.avatarUrl}
  onSignOut={logout}
  onProfile={() => navigate("/profile")} // optional → renders a "Profile" item
  onSettings={() => navigate("/settings")} // optional → renders a "Settings" item
/>;
```

Avatar (image → initials fallback) + display name; the dropdown shows the WebID,
optional Profile / Settings entries, and Sign out. **Decoupled** — everything is a
prop, so it has no dependency on any app's session/router/toast.

## Feedback button

A shared "report issue / give feedback / request help" control. Every suite app
(and every `create-solid-app` scaffold) drops it in once and inherits ONE
consistent way to file an issue **against that app's OWN repo**.

```tsx
import { FeedbackButton } from "@jeswr/app-shell";

// The ONE-LINER each app adds — pass YOUR OWN repo:
<FeedbackButton repo="jeswr/pod-mail" appName="Pod Mail" appVersion={BUILD_SHA} webId={session.webId} />;
```

The trigger (icon + "Feedback") opens a dialog with a category selector
(Bug 🐛 / Feedback 💡 / Help ❓), a required description, an **optional**
"Include my WebID so the maintainer can follow up" checkbox (**default off** for
privacy), and a note that basic diagnostics are attached.

### Props

| Prop | Type | Notes |
|---|---|---|
| `repo` | `string` **(required)** | `OWNER/REPO` the issue is filed against — each app passes its **own** (e.g. `"jeswr/pod-mail"`). |
| `appName` | `string` | App name, shown in the dialog and the diagnostics. |
| `appVersion?` | `string` | Build SHA / version, attached to diagnostics. |
| `webId?` | `string \| null` | The signed-in WebID. Attached to the issue **only** if the consent box is ticked. |
| `submit?` | `(payload) => Promise<{ url; number }>` | The proxy hook (see below). When provided, the prefill path is **not** used. |
| `triggerVariant?` | `"ghost" \| "outline"` | Trigger button style (default `"ghost"`). |
| `className?` / `label?` | `string` | Trigger placement / label (default `"Feedback"`). |

### Two mechanisms (graceful degradation)

1. **Prefill (default, zero-infra).** With **no** `submit` hook, the dialog opens
   GitHub's prefilled `…/issues/new?title=…&body=…&labels=…` page in a new tab
   (`noopener,noreferrer`). The reporter (who has a GitHub account) submits. No
   server, no credentials — works the moment an app adds the component.
2. **Proxy (`submit` hook).** Provide a `submit(payload)` that creates the issue
   **server-side** (the future "feedback proxy"), so the reporter needs **no**
   GitHub account. On success the dialog shows "Thanks — tracked as #N" linking
   the created issue.

```tsx
// Proxy mode — wire your feedback-proxy endpoint:
<FeedbackButton
  repo="jeswr/pod-mail"
  appName="Pod Mail"
  webId={session.webId}
  submit={async (payload) => {
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Could not submit feedback.");
    return res.json(); // { url, number }
  }}
/>;
```

### Diagnostics & privacy

The issue body always appends `App: <appName> <appVersion>`, `Page: <location.href>`,
and `UA: <navigator.userAgent>`. The reporter's `Reporter WebID` line is added
**only** when the consent box is ticked. No tokens or secrets are ever included.
Labels are always `user-feedback` plus the category (`bug` / `feedback` / `help`).

### Building blocks (unit-testable)

`buildIssueUrl({ repo, title, body, labels })`, `composeIssueBody(description,
diagnostics)`, `composeIssueTitle(category, description)`, and
`feedbackLabels(category)` are exported pure helpers. `FeedbackDialog` is exported
too if you want to drive the open state yourself; the `FeedbackPayload` /
`FeedbackDiagnostics` / `FeedbackSubmitResult` types are exported for the proxy.

## Styling

The components use shadcn token utility classes (`bg-popover`,
`text-muted-foreground`, …). Bring the tokens in one of two ways:

- **Tailwind v4 app** — after your `@import "tailwindcss";`, add
  `@import "@jeswr/app-shell/styles.css";`. That ships the OKLCH `:root` / `.dark`
  tokens **and** the `@theme inline` mapping so the utilities resolve. Make sure
  Tailwind's content scan includes this package (e.g. `@source` the install path)
  so the classes are generated.
- **Non-Tailwind app** — import just the raw variables
  (`@jeswr/app-shell/tokens.css`) and provide your own utility CSS for
  the few class names the components use; they reference the same `--background`
  etc. so the palette stays consistent.

## Gate

```bash
npm run lint        # Biome
npm run typecheck   # tsc --noEmit
npm test            # vitest (theme persistence + account menu)
npm run build       # tsc → dist/ + copy CSS
npm run check:dist  # guard committed dist/ against drift from src/
```

`dist/` is committed on purpose (GitHub-installable under `ignore-scripts=true`).
Rebuild + commit `dist/` alongside any `src/` change — `check:dist` guards drift.

## Adopting it in another app

1. Add the dep (`github:jeswr/app-shell#main`) or a relative/Vite alias.
2. Adopt Tailwind v4 + import `@jeswr/app-shell/styles.css` (or just `tokens.css`).
3. Wrap the app root in `<ThemeProvider>`; add `themeScript()` to the document head.
4. Replace the hand-rolled header's logout button + raw WebID text with
   `<ThemeToggle />` + `<AccountMenu />`, wiring your session's WebID / display
   name / avatar / `onSignOut` into the props.
5. Add `<FeedbackButton repo="jeswr/<this-app>" appName="<App>" />` to the header,
   passing **this app's own** repo (the only required, app-specific value). Wire
   `webId` + `appVersion` if available, and a `submit` hook once the feedback
   proxy exists.

The pod-mail app is the reference pilot.

---

Authored by Claude Opus 4.8 (the `@jeswr` PSS agent). MIT.
