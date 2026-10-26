---
name: accessible-html-links
description: Use when writing or reviewing HTML navigation, vague link text, external links, role=link, onclick navigation, or elements that imitate links. Enforce native anchors, descriptive purpose, valid interactive nesting, and safe external navigation.
metadata:
  author: derived from csarven's review feedback on solid/solidproject.org#956
  version: 1.0.0
---

## Quick reference

<!-- AUTHORED-BY Codex GPT-5 -->

**Write accessible links**

If an element navigates, use `<a href>`. Use `<button>` for an action. Do not emulate either with a `div` or `span`.

### Review checklist

- Replace `role="link"`, `tabindex="0"`, and `onclick` navigation with a real anchor.
- Give visible link text a purpose that makes sense in context. Replace “click here”, “here”, and ambiguous “read more” text.
- Do not use `aria-label` to conceal vague visible text; improve the visible text.
- Reject nested interactive content such as an anchor inside an anchor or button. Restructure the card or expose separate sibling links.
- Preserve browser affordances: address preview, copy link, open in new tab, history, keyboard activation, and crawler discovery.
- Links activate with Enter. Space activation indicates button behavior.
- Use `target="_blank"` only when opening a new context is genuinely helpful. For external new-context navigation, include `rel="noopener noreferrer"`.
- In React/router code, ensure the rendered result is still a native anchor with a real `href`.

```html
<!-- Avoid -->
<span role="link" tabindex="0" onclick="location.assign('/docs')">click here</span>

<!-- Prefer -->
<a href="/docs">Read the API documentation</a>
```

Search reviews for `role="link"`, `window.location`, `onclick`, non-native `tabindex`, nested anchors, `target="_blank"`, and vague link text. Prefer native HTML before adding ARIA.

### Agent persona

When this work is delegated to a sub-agent, spawn the `solid-frontend-dev` persona from
[`.claude/agents/solid-frontend-dev.md`](../../.claude/agents/solid-frontend-dev.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Accessible HTML Links

Checklist for any anchor-like construct in HTML. Apply when authoring new
markup and when reviewing existing markup.

## The one rule

If it navigates, it is an `<a href>`. Not a `<span>`, not a `<div>`, not a
`<button>`. Everything below follows from this.

## Markup anti-patterns to reject

1. **`<span role="link">` / `<div role="link">`** — A non-interactive
   element given link semantics via ARIA. Partial patch: loses
   `href` inspection by assistive tech, loses browser history integration,
   loses right-click / middle-click / prefetch.
2. **`onclick="window.location.assign(...)"`** — Imperative navigation in
   place of a declarative `href`. Strips the same browser affordances and
   makes the link invisible to crawlers and preloaders.
3. **`tabindex="0"` on a faux link** — Only needed because the element
   isn't natively focusable. Redundant once you use `<a>`.
4. **`onkeydown` that activates on both `Enter` and `Space`** — That is
   the button activation pattern, not the link activation pattern. Per
   WAI-ARIA 1.2, the `link` role activates on `Enter` only. Mixing them
   creates inconsistent keyboard behaviour for assistive-tech users.
5. **`return false` inside an inline `onclick`** — Only suppresses the
   element's default action. A `<span>` has none, so the statement is a
   no-op there. Not equivalent to
   `event.preventDefault()` + `event.stopPropagation()`.
6. **Nested interactive content** — `<a>` inside `<a>` (or `<a>` inside a
   `<button>`) is invalid per the HTML spec. If you need two targets
   inside one visually-grouped card, move the inner link OUTSIDE the
   outer anchor (e.g., below the tile, or into a separate `<p>`).

## Link text (WCAG 2.4.4 / 2.4.9)

- **Never "click here" or "here"** — the link text alone must describe
  its purpose.
- **Avoid `aria-label` as a primary fix** — it only helps screen-reader
  users; sighted keyboard users scanning the page still see the vague
  text. Rewrite visible text instead.
- Prefer: `Source code on GitHub (MyApp)` over `<span aria-label="...">here</span>`.

## `rel` and `target` on external links

- External links: `rel="noopener noreferrer"`. Include even without
  `target="_blank"`, as a defence-in-depth against `window.opener`
  reference leaks.
- Use `target="_blank"` only when there is a user-visible reason (e.g.,
  external docs while filling a form). It is not an accessibility
  improvement by default.

## First Rule of ARIA

From the WAI-ARIA spec: if a native HTML element exists that already has
the semantics and behaviour you need, **use it** rather than re-purposing
another element with an ARIA role. The presence of `role="link"` on
anything other than an `<a>` is almost always a mistake.

## Canonical corrected pattern

Replace this:

```html
<span class="external-link" role="link" tabindex="0"
      aria-label="Open the MyApp source on GitHub"
      onclick="event.preventDefault(); event.stopPropagation();
               window.location.assign('https://github.com/x/y'); return false;"
      onkeydown="if(event.key==='Enter'||event.key===' '){
               event.preventDefault(); event.stopPropagation();
               window.location.assign('https://github.com/x/y'); }">here</span>
```

With this:

```html
<a href="https://github.com/x/y" class="external-link" rel="noopener noreferrer">GitHub (MyApp)</a>
```

## How to apply in reviews

When reviewing HTML:

1. Grep for `role="link"`, `onclick="window.location`, `tabindex="0"` on
   non-interactive elements, and literal link text of `here`, `click
   here`, `read more`, `link`.
2. For each hit, propose the corrected `<a href>` form and a
   self-describing link text.
3. If the hit is inside another `<a>` (nested interactive content), flag
   it and suggest restructuring the container — typically by moving the
   inner link out of the outer anchor, or by demoting the outer anchor
   to a heading-level link.
4. Confirm `rel="noopener noreferrer"` on external links.
5. For keyboard behaviour: links activate on `Enter` only. If a handler
   also responds to `Space`, either switch to `<button>` (if the control
   is an action, not navigation) or drop the `Space` branch.

## Specification references

- **First Rule of ARIA** — https://www.w3.org/TR/using-aria/#rule1
- **WAI-ARIA 1.2, `link` role** — https://www.w3.org/TR/wai-aria-1.2/#link
- **WAI-ARIA Authoring Practices, Link Pattern** — https://www.w3.org/WAI/ARIA/apg/patterns/link/
- **WCAG 2.1 SC 2.4.4 Link Purpose (In Context)** (AA) — https://www.w3.org/TR/WCAG21/#link-purpose-in-context
- **WCAG 2.1 SC 2.4.9 Link Purpose (Link Only)** (AAA) — https://www.w3.org/TR/WCAG21/#link-purpose-link-only
- **HTML Living Standard, `<a>`** — https://html.spec.whatwg.org/multipage/text-level-semantics.html#the-a-element
- **HTML Living Standard, `rel=noopener`** — https://html.spec.whatwg.org/multipage/links.html#link-type-noopener
