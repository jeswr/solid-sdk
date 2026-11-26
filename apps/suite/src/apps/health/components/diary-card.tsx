// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { EmptyState, ErrorState, LoadingSkeleton } from "@jeswr/suite-ui";
import Link from "next/link";
import { diaryLabel } from "../lib/data/diary";
import { diaryMonday, diaryWeek } from "../lib/diary-time";
import { useDiary } from "../state/diary-context";
import { useHealth } from "../state/health-context";
import { DiaryReadNote } from "./diary-read-note";

export function DiaryCard() {
  const { clock } = useHealth();
  const start = diaryMonday(clock);
  const { state, failures, retry } = useDiary(diaryWeek(clock, null, 0));
  const entries =
    state.status === "ready" || state.status === "empty"
      ? state.data.filter((entry) => entry.at <= clock)
      : [];
  const latest = entries[0];
  return (
    <section className="hlt-metric-card" aria-label="Diary summary">
      <div className="hlt-section-heading">
        <h2>Diary</h2>
        <Link href="/health/diary">Open diary</Link>
      </div>
      <DiaryReadNote count={failures.length} />
      {state.status === "loading" ? (
        <LoadingSkeleton count={1} label="Loading diary summary" />
      ) : state.status === "error" ? (
        <ErrorState error="unreachable" actions={{ retry }}>
          <p>Couldn't load diary summary.</p>
        </ErrorState>
      ) : latest ? (
        <>
          <p>
            {entries.filter((entry) => entry.at >= start).length} entries this week · since Monday,
            local time
          </p>
          <p className="hlt-muted">
            Last entry: {diaryLabel(latest)} ·{" "}
            <time dateTime={latest.at.toISOString()}>{latest.at.toLocaleString("en-GB")}</time>
          </p>
        </>
      ) : (
        <EmptyState
          title="No diary entries in the last seven days"
          body="Keep track of meals and how you feel."
          primaryAction={<Link href="/health/diary">Start your diary</Link>}
        />
      )}
    </section>
  );
}
