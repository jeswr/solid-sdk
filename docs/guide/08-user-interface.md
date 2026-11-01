<!-- AUTHORED-BY Claude Opus 5.5 -->

# 8. The user interface

Suite apps share one look so they feel like one product. Three packages provide it. None of them
knows about sign-in or storage: you pass them values and callbacks.

| Package | Use it for |
| --- | --- |
| `@jeswr/suite-ui` | Design tokens (colour, type, spacing, density) as CSS and TypeScript, bundled fonts, and shared React building blocks such as the shell, navigation, collections and date inputs |
| `@jeswr/app-shell` | React chrome: theme provider and toggle, account menu, feedback button, error boundary |
| `@jeswr/solid-elements` | The same chrome as framework-free web components, with React wrappers |

Read the [app-shell](../../packages/app-shell/SKILL.md) and
[solid-elements](../../packages/solid-elements/SKILL.md) skills before using them.

## Rules that keep apps consistent

- **Use the tokens.** Import `@jeswr/suite-ui`'s styles in the documented order and use its
  variables. Do not hard-code colours. `pnpm check:tokens` and `pnpm check:contrast` guard the
  token set, including contrast in light and dark themes.
- **Support light, dark and system themes.** Wrap the app in `ThemeProvider` and add
  `themeScript()` to the document head so the first paint is in the right theme.
- **Bundle fonts locally.** `pnpm run check:local-fonts` rejects remote font loading.
- **Do not restyle the shared components' own tokens**, and scope any filled-button styles to your
  own forms, so your CSS does not leak into the shared chrome.
- **Use real links for navigation.** The
  [accessible-html-links skill](../../skills/accessible-html-links/SKILL.md) has the rules.
- **Show empty, loading, error and saving states** with the shared components. Show friendly error
  text and keep raw errors for logs.
- **Check three widths.** Screenshot new screens at 375, 768 and 1280 pixels, in light and dark.

## The sign-in screen

Chapter 3 describes the sign-in screen: an account list when accounts are remembered, then the
WebID field, provider buttons, "Other provider", and a footer for newcomers. The shared components render the account menu
once someone is signed in. A shared `SignInCard` in `@jeswr/suite-ui/sign-in` is in review; until
it ships, build the screen in the app in the order chapter 3 gives.

## Show what the pod can do

Hide controls the server cannot support, using `features` (chapter 4), instead of showing a button
that fails. When a feature is `'unknown'`, prefer hiding it, or let the user try and handle an
`unsupported` error clearly.

Next: [testing](09-testing.md).
