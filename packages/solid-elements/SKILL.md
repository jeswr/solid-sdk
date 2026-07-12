---
name: solid-elements
description: Use when building or consuming @jeswr/solid-elements Lit web components, React wrappers, shared theme/account/feedback/status chrome, custom events and reflected attributes, or its optional Solid login adapter.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Work with `@jeswr/solid-elements`

Keep the root package presentation-oriented: custom elements receive attributes/properties and emit `CustomEvent`s; the host owns navigation, persistence, and application state.

## Choose an entry point

- Import `@jeswr/solid-elements` to register the `jeswr-*` custom elements.
- Import `@jeswr/solid-elements/react` for React wrappers.
- Import `@jeswr/solid-elements/auth` only when using its optional auth adapter, and install every optional peer it requires. Prefer `@jeswr/solid-auth-core` for new shared auth logic.

Use the documented tags for theme toggle, account menu, feedback, login, empty/error/loading states, and saving status. Prefer DOM attributes for string configuration; set function/object seams such as `submit` or `controller` as properties.

## Component rules

- Keep `app-shell-theme`, the `.dark` class, and shared CSS tokens compatible with `@jeswr/app-shell`.
- Reflect user-visible string properties when attribute-based consumption is part of the contract.
- Emit composed/bubbling custom events where hosts across shadow boundaries must observe them.
- Preserve keyboard navigation, focus trapping, Escape behavior, roles, labels, and reduced-motion behavior.
- Keep feedback WebID inclusion opt-in and validate the GitHub repository target before opening a URL.
- Validate external URLs and never emit tokens, secrets, or raw diagnostic internals.
- Guard `customElements.define` so repeated imports are safe.

## React-wrapper testing caveat

Under jsdom, `@lit/react` may resolve its Node build and skip browser property-forwarding effects. Test the raw custom element contract by setting properties directly, awaiting `updateComplete`, and asserting reflected attributes, events, and shadow DOM. Use a real browser test for React-to-custom-element forwarding.

Keep auth implementation out of presentation components. The login panel consumes a controller; it should not grow a second token provider. Run manifest checks, API checks, unit tests, and the full workspace gate after changes.
