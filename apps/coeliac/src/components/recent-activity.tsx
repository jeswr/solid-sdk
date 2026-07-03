// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The recent diary activity list — meals + symptoms newest-first, each with a
 * sync badge (Saved / Saving… / Retry). Reads from the durable cache so it paints
 * instantly (UX invariant #3).
 */
import type { StoredMeal, StoredSymptom } from "@/lib/cache/diary-store";
import { triggerLabel } from "@/lib/off/exposure-display";

function SyncBadge({ sync }: { sync: StoredMeal["sync"] }) {
  const label = sync === "synced" ? "Saved" : sync === "error" ? "Retry pending" : "Saving…";
  return <span className={`sync-badge sync-badge--${sync}`}>{label}</span>;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function RecentActivity({
  meals,
  symptoms,
  loaded,
}: {
  meals: StoredMeal[];
  symptoms: StoredSymptom[];
  loaded: boolean;
}) {
  if (!loaded) return <p className="recent__loading">Loading your diary…</p>;
  if (meals.length === 0 && symptoms.length === 0) {
    return (
      <section className="recent" aria-label="Recent activity">
        <h2>Your diary</h2>
        <p className="recent__empty">
          Nothing logged yet. Scan a product or tap a symptom to start — everything stays in your
          own pod.
        </p>
      </section>
    );
  }
  return (
    <section className="recent" aria-label="Recent activity">
      <h2>Recent</h2>
      {meals.length > 0 ? (
        <>
          <h3>Meals</h3>
          <ul className="recent__list">
            {meals.map((m) => (
              <li key={m.ulid} className="recent__item">
                <span className="recent__label">{m.label}</span>
                <span className="recent__time">{timeLabel(m.startTime)}</span>
                <SyncBadge sync={m.sync} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {symptoms.length > 0 ? (
        <>
          <h3>Symptoms</h3>
          <ul className="recent__list">
            {symptoms.map((s) => (
              <li key={s.ulid} className="recent__item">
                <span className="recent__label">{triggerLabel(s.symptomType)}</span>
                {typeof s.severity === "number" ? (
                  <span className="recent__severity">{s.severity}/10</span>
                ) : null}
                <span className="recent__time">{timeLabel(s.onset)}</span>
                <SyncBadge sync={s.sync} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
