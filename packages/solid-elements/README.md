<!-- AUTHORED-BY Codex GPT-5 -->

# @jeswr/solid-elements

Framework-independent Lit web components for shared Solid application chrome and status UI.

The root package is presentation-only: hosts provide state through properties and listen for
`CustomEvent`s. Optional React wrappers and a legacy authentication adapter use separate subpaths.

> Security-critical surfaces such as login and feedback remain host-controlled. Prefer
> `@jeswr/solid-auth-core` for new shared authentication logic.

## Install

```sh
npm install github:jeswr/solid-elements#main
```

For React wrappers, also install `react`, `react-dom`, and the optional peers listed for the
`./react` entry. The `./auth` entry requires all of its declared optional auth peers.

## Minimal usage

```js
import "@jeswr/solid-elements";

const menu = document.createElement("jeswr-account-menu");
menu.name = "Ada Lovelace";
menu.webId = "https://id.example/profile#me";
menu.addEventListener("sign-out", () => signOut());
document.body.append(menu);
```

Or use the registered tags directly:

```html
<jeswr-theme-toggle></jeswr-theme-toggle>
<jeswr-loading label="Loading profile"></jeswr-loading>
<jeswr-saving-indicator state="saved"></jeswr-saving-indicator>
```

## Key API

- Components: `jeswr-theme-toggle`, `jeswr-account-menu`, `jeswr-feedback-button`,
  `jeswr-login-panel`, `jeswr-empty-state`, `jeswr-error-state`, `jeswr-loading`, and
  `jeswr-saving-indicator`.
- Events: `theme-change`, `sign-out`, `feedback-submit`, `session-change`, `login`, `logout`.
- React wrappers: `@jeswr/solid-elements/react` (client-only under SSR frameworks).
- Optional auth adapter: `createReactiveAuthController` from `@jeswr/solid-elements/auth`.
- Theme and feedback helpers are exported from the root.

## Links

- [Source](https://github.com/jeswr/solid-elements)
- [Issues](https://github.com/jeswr/solid-elements/issues)
- [Custom Elements Manifest](./custom-elements.json)
- [Lit](https://lit.dev/)

## License

[MIT](./LICENSE) © Jesse Wright
