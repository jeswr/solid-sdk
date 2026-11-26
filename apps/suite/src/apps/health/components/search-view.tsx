// AUTHORED-BY Codex GPT-6
"use client";
import { EmptyState, ErrorState, LoadingSkeleton } from "@jeswr/suite-ui";
import Link from "next/link";
import { useCallback } from "react";
import { encodeRef } from "@/lib/refs";
import { diaryLabel } from "../lib/data/diary";
import { CATALOGUE } from "../lib/data/metrics";
import { loadRecords } from "../lib/data/records";
import { listWorkouts } from "../lib/data/workouts";
import { diaryDay } from "../lib/diary-time";
import { useDiary } from "../state/diary-context";
import { useHealth, useHealthResource } from "../state/health-context";
import { DiaryReadNote } from "./diary-read-note";

const empty = (result: { items: { name: string; href: string }[] }) => result.items.length === 0;
export function SearchView({ query }: { query: string }) {
  const { store, session, invalidate } = useHealth();
  const { state: diary, failures } = useDiary();
  const loader = useCallback(async () => {
    const results = await Promise.allSettled([
      loadRecords(store, "medications"),
      loadRecords(store, "conditions"),
      loadRecords(store, "immunisations"),
      listWorkouts(store, session.fetch),
    ]);
    const [medications, conditions, immunisations, workouts] = results;
    const records = [medications, conditions, immunisations].flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    const runs = workouts.status === "fulfilled" ? workouts.value : [];
    return {
      failedSources: results.filter((result) => result.status === "rejected").length,
      items: [
        ...CATALOGUE.map((metric) => ({
          name: metric.label,
          key: metric.id,
          href: `/health/m/${metric.id}`,
        })),
        ...records.map((record) => ({
          name: record.name,
          key: record.iri,
          href: `/health/${record.kind}`,
        })),
        ...runs.map((workout) => ({
          name: workout.name ?? workout.activity ?? "Workout",
          key: workout.iri,
          href: `/health/w/${encodeRef(workout.iri)}`,
        })),
      ],
    };
  }, [store, session]);
  const state = useHealthResource(loader, empty);
  const items = [
    ...(diary.status === "ready" || diary.status === "empty" ? diary.data : []).map((entry) => ({
      name: `${entry.kind === "meal" ? "Meal" : "Symptom"}: ${diaryLabel(entry)} · ${diaryDay(entry.at)}`,
      text: `${diaryLabel(entry)} ${entry.note} ${entry.kind === "meal" ? `${entry.ingredients} ${entry.tags.join(" ")}` : ""}`,
      key: entry.url,
      href: `/health/diary?date=${diaryDay(entry.at)}#diary-${encodeRef(entry.url)}`,
    })),
    ...(state.status === "ready" || state.status === "empty" ? state.data.items : []),
  ].filter((item) =>
    `${item.name} ${"text" in item ? item.text : ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="hlt-page">
      <header className="hlt-page-header">
        <h1>Results for “{query}”</h1>
      </header>
      <DiaryReadNote count={failures.length} />
      {(diary.status === "error" ||
        ((state.status === "ready" || state.status === "empty") &&
          state.data.failedSources > 0)) && (
        <p className="hlt-muted" role="status">
          Some Health records couldn't be read. Other results are shown.
        </p>
      )}
      {state.status === "loading" || diary.status === "loading" ? (
        <LoadingSkeleton />
      ) : state.status === "error" ? (
        <ErrorState error="unreachable" actions={{ retry: invalidate }} />
      ) : !items.length ? (
        <EmptyState
          variant="no-results"
          query={query}
          primaryAction={<Link href="/health">Go to summary</Link>}
        />
      ) : (
        <ul className="hlt-search-results">
          {items.map((item) => (
            <li key={item.key}>
              <Link href={item.href}>{item.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
