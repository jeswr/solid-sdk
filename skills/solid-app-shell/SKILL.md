---
name: solid-app-shell
description: Use when making Solid app mutations optimistic, fixing stale rollbacks or lost debounced edits, integrating shared app chrome, or diagnosing theme flashes, host CSS conflicts, and cross-app Type Index categories. For the @jeswr/app-shell component API, use the package skill.
---

## Quick reference

Update local UI state immediately, persist asynchronously, and reconcile in the background.
Revert only the failed mutation's fields, and only while its optimistic state or mutation ID still owns them.
Flush pending debounced writes on page teardown, respecting the keepalive body cap and retaining failed writes for retry.
For shared React chrome APIs, read [the package skill](../../packages/app-shell/SKILL.md); this skill keeps application patterns.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

<!-- AUTHORED-BY Claude Opus 4.8 -->

For the component API, [packages/app-shell/SKILL.md](../../packages/app-shell/SKILL.md) is authoritative.

# App shell — optimistic, non-blocking pod mutations

Read the companion [`AGENTS.md`](../../AGENTS.md)
first; pairs with the [`solid-offline`](../solid-offline/SKILL.md)
skill (instant-load reads) — this one is the **write** side of the same "the app feels instant" goal.

A pod write is a network round-trip (often a conditional PUT/PATCH plus a refresh). Blocking the
interaction on it makes the UI feel sluggish — a dragged card hangs in mid-air until the server
answers. Instead, make mutations **optimistic**:

1. **Update the UI immediately.** Apply the change to local state the instant the user acts — the
   kanban card slides to its new column, the toggle flips, the title updates — before any network
   call.
2. **Persist asynchronously.** Fire the pod write **without blocking** the interaction, and crucially
   **without the blocking full-refresh** that a normal mutation does (the local state is already
   correct). Reconcile in the background on success (a live-sync/refresh will also catch any coupled
   change the server made).
3. **Show a small, non-intrusive save indicator** for in-flight writes: "Saving…" while pending, a
   brief "Saved" on success that auto-clears to idle, "Save failed" on error. A fixed-corner pill
   (`role="status"`, `aria-live="polite"`, hidden when idle) — never a modal or a blocking spinner.
4. **On failure: show an error AND revert** the optimistic change. The revert is where the
   correctness lives — see below.

```ts
// optimistic write — local first, persist in the background, revert on failure
// optimisticMove returns three things: the new item LIST, the pre-move record,
// and the optimistically-moved record (the "expected current state" the revert
// compares against so a stale failure can't clobber a newer move — see Trap 2).
const { items: next, original, optimistic } = optimisticMove(items, id, move /* … */);
if (!original) return;          // no-op (already in that state) — don't show "Saving…"
setItemsLocal(() => next);      // UI updates instantly
persist((repo) => repo.applyWrite(id, move)).catch(() => {
  setItemsLocal((cur) => revertIfCurrent(cur, original, optimistic, move));
});
```

## Revert correctly — the two traps (both real review findings)

A naïve revert ("on error, put the old record back") is wrong in two ways that bite in practice.

### Trap 1 — reverting the WHOLE record clobbers concurrent edits to other fields

While the failed write was in flight, the user may have edited a **different** field of the same
item (changed the title, added a comment, reassigned it). Replacing the whole record with the stale
`original` throws those edits away.

**Fix: revert only the field(s) the failed write changed, onto the CURRENT record.** A status move
rolls back `status`/`state` only; a priority move rolls back `priority` only — both spread over the
*current* record so every unrelated field is preserved:

```ts
const reverted =
  move.kind === "status"
    ? { ...current, status: original.status, state: original.state }
    : { ...current, priority: original.priority };
```

### Trap 2 — a stale failed write clobbers a NEWER mutation of the same item

If the user moves the **same** card again while the first write is still in flight, the first
write's later failure must **not** roll the card back to where the *first* move started — the second
move now owns the card's state. A blind revert resurrects stale state and undoes the user's newer
action.

**Fix: track the expected optimistic state and only revert if the current local state still
corresponds to the failed mutation.** Capture the record the failed write optimistically produced
(`optimistic`); on failure, compare the card's *current* state against it on the move's own
dimension. If they no longer match, a newer move already changed the card — **drop the stale failure
and leave the list unchanged**:

```ts
function revertIfCurrent(items, original, optimistic, move) {
  const current = items.find((i) => i.id === original.id);
  if (!current) return items;                 // item gone (deleted/archived) — nothing to revert
  const stillThisMove =
    move.kind === "status"
      ? current.status === optimistic.status && current.state === optimistic.state
      : current.priority === optimistic.priority;
  if (!stillThisMove) return items;           // a newer move owns it — drop the stale failure
  const reverted = move.kind === "status"
    ? { ...current, status: original.status, state: original.state }   // Trap 1: field-scoped
    : { ...current, priority: original.priority };
  return items.map((i) => (i.id === original.id ? reverted : i));
}
```

Compare on the **move's dimension** (status vs priority), not by object reference — a later
unrelated re-render produces a fresh object reference and must not look like "a newer move".
Equivalently, a per-item mutation id works: stamp each optimistic write with an id, and only revert
when the item's current pending-mutation id still equals the failed write's.

## Flush a debounced write on tab teardown — don't lose the last edit

An optimistic mutation that **debounces** the pod write (coalescing rapid edits into one PUT) has a
gap the optimistic path itself doesn't cover: if the user **closes the tab, navigates away, or
backgrounds it** while a debounced write is still pending, the timer never fires and the **last edit
is lost** — the UI showed "Saving…" (or even "Saved" optimistically) but nothing reached the pod. The
durable cache (`solid-offline`) preserves it for *that* browser, but a different device never sees it.

Flush pending writes on the teardown signals — and mind the `keepalive` body cap:

- **Flush on `pagehide` AND `visibilitychange` → `hidden` (and `beforeunload` as a belt-and-braces).**
  `visibilitychange(hidden)` is the most reliable on mobile (a backgrounded tab the OS may kill never
  fires `pagehide`/`unload`); `pagehide` covers tab-close/navigation. Treat them as the same "the page
  may be going away now — persist now" trigger and de-dupe (below).
- **Use `fetch(url, { keepalive: true })` so the request OUTLIVES the page** — a normal `fetch` is
  cancelled when the document tears down, so the write never completes. `keepalive` lets the browser
  finish it after the page is gone. **But `keepalive` has a hard ~64 KB cap on the encoded request
  body** (the Fetch spec's `keepalive` inflight-body limit) — over it the `fetch` **rejects**. So:
  encode the body first, and use `keepalive` **only when it fits**; an oversized snapshot falls back
  to a **normal** `fetch` (best-effort — it may not finish, but it can't silently swallow the write).
  (`navigator.sendBeacon` is the same cap and can't send the conditional `If-Match`/`Content-Type`
  headers a pod PUT needs, so prefer `keepalive` `fetch`.)
- **Clear the pending marker only AFTER the write resolves — keep it for retry on failure.** A teardown
  flush that optimistically marks the snapshot "saved" before the keepalive request resolves loses the
  edit if that request fails; leave the durable-cache pending flag set until success so the next open
  retries.
- **Coalesce concurrent unload flushes of the SAME snapshot.** `pagehide` and `visibilitychange` can
  both fire for one teardown; firing two keepalive PUTs of the same body **doubles** the bytes counted
  against the per-page keepalive cap (and can race the conditional `If-Match`). Single-flight the flush
  on the snapshot's identity/version so one teardown sends **one** request. **But never coalesce a
  keepalive flush onto a non-keepalive in-flight save** — a normal debounced save already in flight is
  cancelled by the teardown, so the keepalive flush must still run; only coalesce keepalive-with-keepalive.

This is the teardown corner of the optimistic-mutation / `solid-offline` invariant: optimistic +
durable-cache makes the edit *survive locally*; the keepalive flush is what makes it *reach the pod*
when the tab dies mid-debounce. (Cited: the five jeswr OSS Solid forks — Linkding, Elk, Excalidraw,
Miniflux, Actual — 2026-06; Excalidraw's debounced scene-persist needed the `pagehide` keepalive
flush + the 64 KB cap fallback, hardened over roborev's fetch/unload rounds.)

## Indicator, no-ops, and reconciliation

- **A move that doesn't change anything is a no-op** — a drop onto the card's *current* column must
  not fire a write or show "Saving…". `optimisticMove` returns no `original` in that case; bail.
- **Keep the optimistic state in the durable cache too** (see `solid-offline`), so a reopen
  mid-write paints the optimistic state rather than the pre-write one.
- **Reconcile in the background after a successful persist** (a non-blocking refresh), so a change
  the server coupled to your write — e.g. a workflow status that also flips an open/closed flag —
  lands without the user waiting on it.

## Reading a pod container into a view (the read side)

Building a list/browser view over a pod container surfaced three patterns worth applying every time (each a roborev finding while building 8 sibling Solid apps):

- **Inject the authenticated `fetch` as a seam, don't hard-wire login.** The view/hook/data-layer take an injectable `fetch` (fall back to the ambient global a reactive-auth shell patches). This builds + unit-tests *now* (stub the fetch) while the real login wires in later — the view is never coupled to the auth flow.
- **Validate `ldp:contains` child IRIs before you fetch them.** A view that reads each child of a listed container must NOT blindly fetch every IRI the container advertises — a malicious/malformed container can list arbitrary URLs/schemes (an SSRF vector, and it runs before any href-display gate). Require each child to be: an `http(s):` IRI, **same-origin** with the container (compare parsed `URL.origin`, not a raw string prefix — defeats `https://you@evil/…` userinfo + look-alike-prefix tricks), and a **real descendant path** (compare `URL.pathname` under the container's slash-terminated path with a non-empty remainder — so the container itself, even with `?query`/`#fragment`, is rejected). Drop anything else (don't fetch, don't fail the listing).
- **A data-layer `list()` that swallows 401/403 → `[]` is right for the store but WRONG for a screen.** It makes "you don't have permission" indistinguishable from "empty", so a forbidden container renders "Nothing here" instead of an access-denied state. Wrap it in a thin **UI read facade** that surfaces a typed `AccessDeniedError` (401/403), maps **404 → empty**, **2xx-empty → empty**, else re-throws — without changing the shared store contract other callers depend on. And on an access error during a *reload*, **clear the previously-loaded list + selection** so stale data doesn't linger under the access-denied state.



## Detailed integration patterns

- Read for cross-app class mapping, prebuild environment precedence, and controlled forms. [references/interop-and-forms.md](references/interop-and-forms.md).
- Read when integrating shared chrome, Tailwind tokens, theming, or Lit/React controls. [references/chrome-integration.md](references/chrome-integration.md).

## Gotchas

| Gotcha | Detail |
|---|---|
| Interaction hangs until the pod answers | The write is blocking — update local state first, persist async, never `await` before the UI updates |
| Editor breaks on the empty string mid-edit | A controlled input wired straight to a throwing typed setter (`@solid/object` `…As`) throws on every transiently-invalid keystroke — store the **raw** string in local state, never throw in `onChange`, validate the assembled draft separately, call the setter only at save with a valid value |
| Host app's `button {}` repaints your shell's controls | Tailwind v4: an **unlayered** author rule beats EVERY `@layer`'d utility — `@layer`/specificity bumps don't fix it. Ship an unlayered attribute-scoped reset (`[data-app-shell-control]{…}`, 0,1,0 > a bare element's 0,0,1 when both unlayered) + a **private literal** token mirror (`--as-accent`, not `var(--accent)` indirection) declared on a `:root`/shared ancestor so portaled menus/dialogs inherit it |
| Dark-OS user sees a one-frame light flash | A `ThemeProvider` resolving/applying the theme in a passive `useEffect` runs after paint, so `resolvedTheme` starts `light`. Apply in an **isomorphic layout effect** (`useLayoutEffect` in-browser, `useEffect` off-browser via a `typeof window` guard) — correct on the first painted frame, SSR-safe; a pre-hydration class-toggling `<script>` doesn't fix React state |
| Web-Component prop dropped via the React wrapper | `@lit/react` `createComponent` classifies props before the Lit class finalizes, so a non-reflected reactive **property** is silently dropped under React 19 — the element renders its fallback (e.g. `Loading` shows generic "Loading"). Make the prop `reflect: true`, or consume the raw element with a DOM **attribute** (`<jeswr-loading label="…">`) |
| `@lit/react` prop won't render in a vitest test | `@lit/react` resolves its **`node`** export condition under vitest/jsdom, whose build SKIPS the `useLayoutEffect` that forwards props — so a React-wrapper assertion (`render(<Loading label/>)` then check the label) **can't pass even with `reflect: true`**; it's an env artifact, not a bug. Test the **raw element**: set the property directly, then assert the reflected attribute + the rendered `::part`, not the wrapper |
| Host `button {}` distorts the shared controls' SIZE | A chrome library's reset isolates **color/border/fill** but leaves the **box model** to its own layered classes — so a consumer's bare unlayered global `button {}` still out-ranks that layered sizing and squashes the shared controls. Scope host element rules (`.login-form button`), or exclude the controls with `button:where(:not([data-app-shell-control]))`; only globally relax what the reset covers, never the box model |
| Bare `:not([attr])` exclusion repaints your OWN buttons | The exclusion-selector trap: `button:not([data-app-shell-control])` **leaks the attribute's specificity through `:not()`** → `(0,1,1)`, out-ranking your class-only host overrides (`.foo-link`/`.foo-cancel` at `(0,1,0)`) and repainting them with the base look. Wrap it: `button:where(:not([…]))` carries **zero** specificity → stays `(0,0,1)`. Guard with a test rejecting BOTH the unscoped and the bare-`:not()` form |
| App shows the SUITE palette instead of its own | To consume `@jeswr/app-shell` on a Tailwind-v4 app while keeping your own colours: **alias** the shell-private `--as-*` tokens onto your palette on **both `:root` and `.dark`**, register the `as-*` keys in `@theme` + set `darkMode: 'class'`, and import **only the shell's reset** — NOT its suite theme-token sheet (which re-declares `--as-*` with the suite colours and overrides your aliases). Re-point the token seam; don't fork the shell |
| `npm run build` bakes a localhost client-id | A prebuild config script doesn't get the bundler's `.env` loading — load `.env`/`.env.local` yourself via `node:util` `parseEnv`; a wrong client-id origin = broken login at the deployed subdomain |
| `.env.local` fails to fully override `.env` | Resolve the origin **per-layer** (`shell → .env.local → .env → default`, first layer that yields one wins), never merge into one dict + pick per-variable — that lets `.env` beat `.env.local` cross-variable |
| Forbidden container shows "empty" | A store `list()` swallowing 401/403→`[]` hides access-denied — wrap in a UI facade that surfaces a typed AccessDenied; clear stale list on a reload that 403s |
| View fetches an attacker's URL | Don't fetch every `ldp:contains` IRI — require http(s) + same-origin (parsed `origin`) + a real descendant `pathname` before fetching a child |
| A producer app's data shows under "Other" | A consumer must map EVERY producer's Type-Index `solid:forClass` IRI into its own category/view map (both `https`/`http` schema.org forms) — an unmapped class is still discovered but mis-bucketed into the fallback (cited: pod-docs' `pd:Document`); add the mapping + a regression test when you add a producer app |
| Concurrent edits lost on revert | Trap 1 — revert only the failed write's field(s) onto the **current** record, never replace the whole record with `original` |
| Newer move undone by an older failure | Trap 2 — capture the optimistic state / a mutation id and revert only if the current state still corresponds to the failed write |
| Spurious "Saving…" on a no-op drop | A move to the current column changes nothing — detect it (no `original`) and skip the write |
| Indicator clutters the UI | Hide when idle; auto-clear "Saved" back to idle after ~1.5 s; fixed-corner pill, `aria-live="polite"`, not a modal |
| Coupled server change missing after persist | Background-reconcile on success — the server may have changed a field your write didn't set |
| Last edit lost when the tab is closed mid-debounce | A debounced pod write whose timer hasn't fired is lost on tab-close/navigate/background. Flush on `pagehide` **and** `visibilitychange→hidden` (mobile-reliable) with `fetch(url,{keepalive:true})` so the request outlives the page; clear the pending marker only AFTER it resolves (keep it for retry) |
| `keepalive` flush rejects on a big body | `keepalive` has a hard ~64 KB encoded-body cap — over it the `fetch` rejects and the write silently never sends. Encode first, use `keepalive` only when it fits; an oversized snapshot falls back to a **normal** `fetch` (best-effort). `sendBeacon` has the same cap and can't carry the `If-Match`/`Content-Type` a pod PUT needs |
| Two keepalive PUTs of one snapshot blow the cap | `pagehide` + `visibilitychange` both fire for one teardown — single-flight the flush on the snapshot's version so one teardown = one request. But never coalesce a keepalive flush onto a non-keepalive in-flight save (the normal save is cancelled by the teardown; the keepalive flush must still run) |

---

*Learned building [`jeswr/solid-issues`](../../apps/issues/README.md): the optimistic
board logic in [`src/lib/board.ts`](../../apps/issues/src/lib/board.ts)
(`optimisticMove`, `revertMoveIfCurrent` — both revert traps), the non-blocking `persist` in
[`src/lib/use-issues.ts`](../../apps/issues/src/lib/use-issues.ts),
and the [`src/components/save-indicator.tsx`](../../apps/issues/src/components/save-indicator.tsx)
pill, commit `ca0c687`. Both revert traps were roborev findings fixed in that change.*
