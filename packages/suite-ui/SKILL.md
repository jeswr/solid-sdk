---
name: suite-ui
description: Use when adopting or extending @jeswr/suite-ui DataTable collections (sorting, responsive columns, selection, keyboard navigation, row menus, drag targets), Command empty states, responsive dialogs, or ItemDetails inside ShellFrame details panes and mobile sheets. Other surfaces are documented in the package README.
---

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# suite-ui

Use the [package README](README.md) for style imports and component contracts.

## Collections (DataTable)

Read [README.md](README.md)'s DS-06 and Drive adoption sections for the collection API.
DataTable already owns virtual rows, density measurements, sticky headers, sorting,
roving focus and range selection. Extend its optional props instead of copying a
listing into app code. Existing consumers rely on its defaults; preserve them.

- Pass stable `getKey` IDs and filtered items. Share `useSelection` between views;
  folder/account reset and pruning policy belong to the app.
- Bind `sorting` / `onSortingChange` for external sort controls. Use `manualSorting`
  when the caller supplies server order or folders-first order; otherwise TanStack
  sorts using a single key, even with Shift-click; supply at most one sort entry.
  Range selection always follows rendered order.
- `visibleFrom` uses the collection viewport width, not the browser width. Keep a
  primary column visible. Header/cell visibility, widths and ARIA counts must agree.
- Render action controls with `render(item, context?)`; the table supplies `{ active, selected }`.
  Use `context?.active` for the optional parameter. Native controls
  own their events; put only the active row's controls in the Tab sequence.
- `getRowProps` supplies native events, attributes and decoration. Use `preventDefault`
  to consume row shortcuts or activation; keep virtual positioning and grid semantics
  table-owned; row styles must not set `display` or `position`. Click, double-click and
  key handlers skip interactive descendants; all row handlers ignore portalled targets.
  Apps own drag payload validation, permissions, writes and keyboard alternatives.
- `renderRow` can wrap the supplied `tr` with Radix `asChild` context menus. Preserve
  the row, ref and events. Portalled menu actions must never select/open the row.
- `selectionFollowsFocus`, `openOnDoubleClick`, and hiding built-in checkboxes/column
  controls are opt-in. Loading and empty feedback use the existing `state` surface.
  With selection-following enabled, Cmd/Ctrl+(Up, Down, Home, End) moves focus without
  replacing selection; Space then toggles the focused item for non-contiguous selections.
  Cmd/Ctrl+Left/Right stays with the browser.

Verify behavior in [test/collections.test.tsx](test/collections.test.tsx) with jsdom
and axe, then extend the suite app's `/dev/components/data-table` fixture and DS-06
Playwright spec for layout and keyboard changes. Density and responsive behavior need
real browser coverage; retain the 10,000-row virtualization checks.

## Command, dialogs and details panes

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
