---
name: suite-ui
description: Use when composing or changing @jeswr/suite-ui Command empty states, responsive dialogs, or ItemDetails inside ShellFrame details panes and mobile sheets.
---

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Use the [package README](README.md) for style imports and component contracts.

Keep `CommandEmpty` inside `CommandList`. cmdk hard-codes the listbox role; the shared
empty component provides a disabled option without registering a selectable cmdk item.
Check both no matches and keyboard selection after clearing the query. Shell palettes
consume the same primitive. Dialog width and maximum inline size must remain bounded
by the viewport when resized while open, including at 320px.

Pass `<ItemDetails variant="embedded" ... />` through `ShellFrame.details.children`.
The embedded variant removes ItemDetails' border, padding and background; `DetailsPane`
supplies padding and the desktop shell slot supplies the border. The default standalone
variant retains its chrome. Below 1024px ShellFrame renders those same children inside
a right-hand modal sheet: keep the embedded variant, let the shell trap focus, dismiss
on Escape and restore focus to the details toggle. Do not add a second sheet in the child.

Use the suite-ui unit tests for component behavior and the suite app's DS-02, DS-04
and shell search/shortcuts browser specs for accessibility and real layout. Visual
baselines use `apps/suite/playwright.visual.config.ts`; update only affected images
in the `375-light` and `1280-dark` projects.
