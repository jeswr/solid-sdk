---
name: accessible-html-links
description: Use when writing or reviewing HTML navigation, vague link text, external links, role=link, onclick navigation, or elements that imitate links. Enforce native anchors, descriptive purpose, valid interactive nesting, and safe external navigation.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Write accessible links

If an element navigates, use `<a href>`. Use `<button>` for an action. Do not emulate either with a `div` or `span`.

## Review checklist

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

## Agent persona

When this work is delegated to a sub-agent, spawn the `solid-frontend-dev` persona from
[`.claude/agents/solid-frontend-dev.md`](../../.claude/agents/solid-frontend-dev.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.
