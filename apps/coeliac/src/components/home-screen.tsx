// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * The home screen (DESIGN §5): paints instantly from the durable cache — the
 * one-tap re-log chips (the killer shortcut), the always-present "how do you
 * feel?" symptom quick-log, a prominent scan CTA, and recent activity. Never a
 * blank load (UX invariant #3).
 */
import Link from "next/link";
import { useCallback } from "react";
import { useDiaryLists } from "@/lib/session/use-diary-lists";
import { OfflineBanner } from "./offline-banner";
import { RecentActivity } from "./recent-activity";
import { RelogChips } from "./relog-chips";
import { SymptomQuickLog } from "./symptom-quick-log";

export function HomeScreen() {
  const lists = useDiaryLists();
  const refresh = lists.refresh;
  const onLogged = useCallback(() => void refresh(), [refresh]);

  return (
    <div className="home">
      <OfflineBanner pendingWrites={lists.pending} />
      <section className="home__cta">
        <Link href="/log" className="btn btn--primary btn--big">
          Scan or log food
        </Link>
      </section>
      <RelogChips frequent={lists.frequent} recent={lists.recent} onLogged={onLogged} />
      <SymptomQuickLog onLogged={onLogged} />
      <RecentActivity meals={lists.recent} symptoms={lists.symptoms} loaded={lists.loaded} />
    </div>
  );
}
