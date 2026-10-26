---
name: solid-app-shell
description: Use when making Solid app mutations optimistic, fixing stale rollbacks or lost debounced edits, integrating shared app chrome, or diagnosing theme flashes, host CSS conflicts, and cross-app Type Index categories. For the @jeswr/app-shell component API, use the package skill.
---

## Quick reference

Update local UI state immediately, persist asynchronously, and reconcile in the background.
Keep a confirmed baseline and an ordered queue of field-scoped mutations; after failure, recompute the visible value from the baseline plus the remaining queue.
Flush pending debounced writes on page teardown, respecting the keepalive body cap and retaining failed writes for retry.
For shared React chrome APIs, read [the package skill](../../packages/app-shell/SKILL.md); this skill keeps application patterns.

<!-- AUTHORED-BY Codex GPT-6 -->

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

<!-- AUTHORED-BY Claude Opus 4.8 -->

For the component API, [packages/app-shell/SKILL.md](../../packages/app-shell/SKILL.md) is authoritative.

# App shell — optimistic, non-blocking pod mutations

Read the companion [`AGENTS.md`](../../AGENTS.md)
first; pairs with the [`solid-offline-patterns`](../solid-offline-patterns/SKILL.md)
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
// Keep nextGeneration and this record's edit state in the store across renders.
const patch = moveToPatch(move); // only the fields changed by this move
if (isNoOp(visibleValue(edits), patch)) return;
const generation = ++nextGeneration;
setEdits((cur) => enqueueMutation(cur, generation, patch)); // UI updates instantly
persist((repo) => repo.applyWrite(id, move)).then(
  () => setEdits((cur) => settleMutation(cur, generation, true)),
  () => {
    showSaveError();
    setEdits((cur) => settleMutation(cur, generation, false));
  },
);
```

## Revert correctly — the two traps (both real review findings)

### Trap 1 — reverting the WHOLE record clobbers concurrent edits to other fields

While a failed write was in flight, the user may have edited a **different** field of the same
item. Keep each mutation as a field-scoped patch: a status move changes `status`/`state`, a
priority move changes `priority`. Recompute from the confirmed baseline and the remaining
patches so unrelated edits survive.

### Trap 2 — a stale failed write clobbers a NEWER mutation of the same item

Value equality cannot establish ownership: with priority `0 → 1 → 2 → 1`, a late failure
of the first write must not undo the newer successful edits. Generations identify mutations,
but a generation fence alone is insufficient: with `0 → 1 → 2` and **both writes failing**,
the second write's captured original is the unconfirmed `1`. Restoring it resurrects a failed
edit, regardless of which failure arrives first.

**Keep a confirmed baseline plus an ordered queue of mutations.** The visible record is the
baseline with the queue's patches applied in local intent order. On failure, remove that
mutation and recompute; never restore its captured original. On success, mark it confirmed
and fold only the confirmed prefix into the baseline. A successful newer mutation stays in
the queue while an older one is unresolved, so it remains visible without letting a late older
success overwrite it.

```ts
type Fields = { priority: number; status: string; state: string; title: string };
type Item = Fields & { id: string };
type Mutation = { generation: number; patch: Partial<Fields>; confirmed: boolean };
type EditState = { baseline: Item; pending: Mutation[] };

// Store lifetime counter; never reuse a generation after deletion/replacement/account switch.
let nextGeneration = 0;

function visibleValue(state: EditState): Item {
  return state.pending.reduce((item, mutation) => ({ ...item, ...mutation.patch }), state.baseline);
}

function enqueueMutation(state: EditState, generation: number, patch: Partial<Fields>): EditState {
  return {
    ...state,
    pending: [...state.pending, { generation, patch: { ...patch }, confirmed: false }],
  };
}

function settleMutation(state: EditState, generation: number, success: boolean): EditState {
  if (!state.pending.some((mutation) => mutation.generation === generation)) return state;
  let pending = success
    ? state.pending.map((mutation) =>
        mutation.generation === generation ? { ...mutation, confirmed: true } : mutation,
      )
    : state.pending.filter((mutation) => mutation.generation !== generation);
  let baseline = state.baseline;
  while (pending[0]?.confirmed) {
    const [first, ...rest] = pending;
    baseline = { ...baseline, ...first.patch };
    pending = rest;
  }
  return { baseline, pending };
}
```

Initialize one `EditState` per record from its confirmed server value with `pending: []`.
All local writers enqueue field-scoped patches. A confirmed entry waiting behind an unresolved
one remains in `pending` until it can join the baseline. These reducers are pure: React may
replay an updater without consuming a mutation. Drop the queue on deletion, record replacement,
or account switch; callbacks for generations absent from the new state do nothing.
Serialize pod writes per record or use conditional writes with conflict reconciliation to
preserve server ordering; this queue governs local visibility. Generation-fence background
refreshes, and do not replace the baseline with a stale refresh while mutations remain.

## Flush a debounced write on tab teardown — don't lose the last edit

An optimistic mutation that **debounces** the pod write (coalescing rapid edits into one PUT) has a
gap the optimistic path itself doesn't cover: if the user **closes the tab, navigates away, or
backgrounds it** while a debounced write is still pending, the timer never fires and the **last edit
is lost** — the UI showed "Saving…" (or even "Saved" optimistically) but nothing reached the pod. The
durable cache (`solid-offline-patterns`) preserves it for *that* browser, but a different device never sees it.

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

This is the teardown corner of the optimistic-mutation / `solid-offline-patterns` invariant: optimistic +
durable-cache makes the edit *survive locally*; the keepalive flush is what makes it *reach the pod*
when the tab dies mid-debounce. (Cited: the five jeswr OSS Solid forks — Linkding, Elk, Excalidraw,
Miniflux, Actual — 2026-06; Excalidraw's debounced scene-persist needed the `pagehide` keepalive
flush + the 64 KB cap fallback, hardened over roborev's fetch/unload rounds.)

## Indicator, no-ops, and reconciliation

- **A move that doesn't change anything is a no-op** — a drop onto the card's *current* column must
  not fire a write or show "Saving…". Compare the patch with `visibleValue(edits)` and bail.
- **Keep the optimistic state in the durable cache too** (see `solid-offline-patterns`), so a reopen
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

## Pitfalls

### Paginated sources and snapshot overwrites

When syncing a local API into a pod by replacing a whole RDF document, a fresh dataset plus
conditional PUT overwrites everything, even if the source API silently capped the first page.
An oversized `limit` is not proof of completeness. Follow every page/cursor until the API's
completion condition (for example, `offset >= total`), assemble the complete snapshot, then
serialize through the suite RDF writer and perform the conditional write. If a page fails or
pagination stops making progress, fail the sync without writing a partial replacement.
An ETag prevents conflicting writes; it cannot detect a truncated source snapshot.

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
| Concurrent edits lost on revert | Trap 1 — enqueue field-scoped patches and recompute from the confirmed baseline plus remaining mutations |
| Newer move undone by an older failure | Trap 2 — remove only the failed generation from the queue; retain newer edits and never restore an unconfirmed original |
| Spurious "Saving…" on a no-op drop | Compare the patch with the visible value and skip the write when nothing changes |
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
