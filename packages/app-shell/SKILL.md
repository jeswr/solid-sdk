---
name: app-shell
description: Use when building or modifying React application chrome with @jeswr/app-shell, including light/dark/system theming, WebID account menus, feedback controls, error boundaries, extension-presence detection, CSS token integration, or host-style isolation.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Work with `@jeswr/app-shell`

Treat this package as the React shell for suite applications. Keep session, routing, and data access in the host app; pass values and callbacks into the shell components.

## Use the public surface

- Wrap the app once with `ThemeProvider`; read or change the preference through `useTheme`.
- Add `themeScript()` to the document head when first-paint theme correctness matters. Use the same storage key and dark class as `ThemeProvider`.
- Pass `webId`, display data, and navigation/sign-out callbacks to `AccountMenu`. Do not couple this package to an auth implementation.
- Configure `FeedbackButton` with the consuming app's own `owner/repo`. A `submit` callback enables a proxy; without it, the control opens a prefilled GitHub issue.
- Wrap routed content in `ErrorBoundary` and pass a route-derived `resetKey`. Keep raw error text and stacks in telemetry; show friendly copy through `ErrorState`.
- Use `useSolidExtensionPresent()` only as a presence signal. It does not establish identity or authentication.

```tsx
import {
  AccountMenu,
  ErrorBoundary,
  FeedbackButton,
  ThemeProvider,
  ThemeToggle,
} from "@jeswr/app-shell";
import "@jeswr/app-shell/styles.css";

<ThemeProvider>
  <header>
    <ThemeToggle />
    <AccountMenu webId={webId} onSignOut={logout} />
    <FeedbackButton repo="jeswr/my-app" appName="My App" />
  </header>
  <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
</ThemeProvider>;
```

## Integrate styling deliberately

- Tailwind v4 consumers normally import `@jeswr/app-shell/styles.css` after Tailwind and include this package in the content scan.
- Non-Tailwind consumers import `tokens.css` and `reset.css`, then supply the utility classes used by the components.
- The package's `--as-*` token namespace and `[data-app-shell-control]` reset protect shell chrome from host globals. Do not bypass them accidentally.
- If a consumer intentionally styles the exported `Button` primitive, set `defensiveReset={false}` on that button.
- Keep CSS subpath imports within the declared exports: `styles.css`, `tokens.css`, `theme.css`, and `reset.css`.

## Preserve package boundaries

- Keep components framework-agnostic within React: no `next/*`, router, session, or application-store imports.
- Keep feedback diagnostics free of tokens, secrets, and WebIDs unless the user explicitly opts in.
- Maintain SSR safety: DOM and storage access must remain guarded or effect-bound.
- Add or update tests for theme persistence, keyboard/focus behavior, privacy, error fallbacks, and CSS isolation when changing those contracts.

Run the package through the workspace gate after changes. If the public API changes intentionally, update the API report using the package's existing script before running the full gate.
