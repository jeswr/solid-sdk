// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The brief "restoring your session…" state shown while silent restore runs (UX
 * invariant #1 — never a login prompt flashed before restore resolves).
 */
export function RestoringSplash() {
  return (
    <div className="restoring" role="status" aria-live="polite">
      <div className="restoring__spinner" aria-hidden="true" />
      <p>Restoring your session…</p>
    </div>
  );
}
