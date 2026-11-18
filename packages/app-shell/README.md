<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/app-shell

Shared React application chrome for theming, account menus, feedback, error states, and Solid extension presence.

The components work in Vite and Next.js without owning authentication, routing, or application
data; hosts pass those values and callbacks as props.

## Install

```sh
npm install github:jeswr/app-shell#main react react-dom
```

Requires React 18 or newer and Node.js 20.12 or newer for tooling.

## Minimal usage

```tsx
import {
  AccountControl,
  ErrorBoundary,
  FeedbackButton,
  ThemeProvider,
  ThemeToggle,
} from "@jeswr/app-shell";
import "@jeswr/app-shell/styles.css";

<ThemeProvider>
  <header>
    <ThemeToggle />
    <AccountControl webId={webId} displayName={name} onSignOut={logout} />
    <FeedbackButton repo="jeswr/my-app" appName="My App" />
  </header>
  <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
</ThemeProvider>;
```

Tailwind v4 consumers import `styles.css` after Tailwind and include the package in their content
scan. Non-Tailwind consumers import `tokens.css` and `reset.css`, then provide equivalent utility
styles for the class names used by the components.

## Key API

- Theme: `ThemeProvider`, `ThemeToggle`, `useTheme`, `themeScript`.
- Account: `AccountControl`, `AccountMenu`; the host owns session, profile, navigation, and logout.
- Feedback: `FeedbackButton`, `FeedbackDialog`, and pure issue-body helpers.
- Errors: `ErrorBoundary`, `ErrorState`.
- Extension signal: `useSolidExtensionPresent` reports presence, not identity or authentication.
- CSS exports: `styles.css`, `tokens.css`, `theme.css`, `reset.css`.

`AccountControl` accepts `webId`, `displayName`, `avatarUrl` and required `onSignOut` with
the same types as `AccountMenu`. It renders the account menu when the extension is absent,
or an isolated ghost sign-out button when `useSolidExtensionPresent()` reports presence.
Optional `signOutLabel` customizes that standalone button (default “Sign out”). Presence
changes presentation only; the callback always signs out the host's session. Use `AccountMenu`
directly when you need its extra navigation callbacks or menu items.

## Links

- [Source](https://github.com/jeswr/app-shell)
- [Issues](https://github.com/jeswr/app-shell/issues)
- [Solid Project](https://solidproject.org/)

## License

[MIT](./LICENSE) © Jesse Wright
