---
name: solid-optimistic-ui
description: Use when Solid app interactions block on pod writes, implementing optimistic non-blocking mutations, save indicators, rollback after failure, debounced teardown flushes, or guarding stale writes from clobbering newer edits.
---
<!-- AUTHORED-BY Codex GPT-5 -->

# Make pod mutations optimistic

Update local UI state first, persist asynchronously, reconcile in the background, and expose a small non-blocking saving state.

## Correct rollback

Capture both the original fields and the optimistic result.

- Revert only fields changed by the failed mutation, applied to the current record. Replacing the whole record can discard unrelated edits made while the request was in flight.
- Revert only if the current value still matches that mutation's optimistic value or mutation ID. A late failure must not undo a newer edit to the same field.
- If the record was deleted or superseded, drop the stale failure.
- Detect no-op changes before entering the saving state.

```ts
persist(write).catch(() => {
  setItems((current) => revertChangedFieldsIfStillCurrent(current, mutation));
});
```

## Persistence lifecycle

- Keep optimistic state in the durable, WebID-scoped cache so a reload during a write does not resurrect older state.
- Reconcile after success because a server-side write may update coupled fields.
- Generation-fence refreshes so an older response cannot overwrite newer local or server state.
- For debounced writes, flush on `visibilitychange` to hidden and `pagehide`.
- Use `fetch(..., { keepalive: true })` only when the encoded body fits the browser's keepalive budget; otherwise fall back to a normal best-effort fetch.
- Single-flight duplicate teardown flushes for the same snapshot, but do not coalesce a keepalive flush onto a normal fetch that teardown can cancel.
- Clear the durable pending marker only after the write resolves; retain it for retry after failure.

Use `role="status"` and `aria-live="polite"` for Saving/Saved/Error feedback. Avoid modal progress and avoid blocking the user's next action.
