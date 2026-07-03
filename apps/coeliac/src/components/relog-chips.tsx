// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The killer shortcut (DESIGN §5.1.2): one-tap "Log again" chips for frequent +
 * recent meals — most real logging is repetition. A tap clones a past meal as a
 * fresh log at now (optimistic), then refreshes the lists.
 */
import { useState } from "react";
import type { FrequentMeal, StoredMeal } from "@/lib/cache/diary-store";
import { useDiaryActions } from "@/lib/session/use-diary-actions";

export function RelogChips({
  frequent,
  recent,
  onLogged,
}: {
  frequent: FrequentMeal[];
  recent: StoredMeal[];
  onLogged?: () => void;
}) {
  const { relogMeal } = useDiaryActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [justLogged, setJustLogged] = useState<string | null>(null);

  // Frequent first (most-logged), then recent meals not already shown as frequent.
  const shownSignatures = new Set(frequent.map((f) => f.signature));
  const extraRecent = recent.filter((m) => !shownSignatures.has(m.signature)).slice(0, 6);

  async function relog(meal: StoredMeal, key: string) {
    setBusy(key);
    try {
      const { syncing } = await relogMeal(meal);
      // Optimistic: the record is already cached. The pod write settles in the
      // background; a failure is already recorded on the cached record (shown as a
      // Retry badge + reconciled on reconnect), so swallow the rejection here to
      // avoid an unhandled promise rejection.
      syncing.catch(() => {});
      setJustLogged(key);
      onLogged?.();
      setTimeout(() => setJustLogged((k) => (k === key ? null : k)), 1500);
    } finally {
      setBusy(null);
    }
  }

  if (frequent.length === 0 && extraRecent.length === 0) return null;

  return (
    <section className="relog" aria-label="Log a meal again">
      <h2>Log again</h2>
      <div className="chips">
        {frequent.map((f) => (
          <button
            key={f.signature}
            type="button"
            className="chip chip--relog"
            disabled={busy === f.signature}
            onClick={() => relog(f.latest, f.signature)}
          >
            {justLogged === f.signature ? "Logged ✓" : f.label}
            {f.count > 1 ? <span className="chip__count"> ·{f.count}</span> : null}
          </button>
        ))}
        {extraRecent.map((m) => (
          <button
            key={m.ulid}
            type="button"
            className="chip chip--relog"
            disabled={busy === m.ulid}
            onClick={() => relog(m, m.ulid)}
          >
            {justLogged === m.ulid ? "Logged ✓" : m.label}
          </button>
        ))}
      </div>
    </section>
  );
}
