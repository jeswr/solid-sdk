// AUTHORED-BY Codex GPT-6
"use client";
import { EmptyState, ErrorState, LoadingSkeleton } from "@jeswr/suite-ui";
import Link from "next/link";
import { useCallback } from "react";
import { encodeRef } from "@/lib/refs";
import { CATALOGUE } from "../lib/data/metrics";
import { loadRecords } from "../lib/data/records";
import { listWorkouts } from "../lib/data/workouts";
import { useHealth, useHealthResource } from "../state/health-context";

const empty = (items: { name: string; href: string }[]) => items.length === 0;
export function SearchView({ query }: { query: string }) {
  const { store, session, invalidate } = useHealth();
  const loader = useCallback(async () => {
    const [medications, conditions, immunisations, workouts] = await Promise.all([
      loadRecords(store, "medications"),
      loadRecords(store, "conditions"),
      loadRecords(store, "immunisations"),
      listWorkouts(store, session.fetch),
    ]);
    return [
      ...CATALOGUE.map((metric) => ({
        name: metric.label,
        key: metric.id,
        href: `/health/m/${metric.id}`,
      })),
      ...[...medications, ...conditions, ...immunisations].map((record) => ({
        name: record.name,
        key: record.iri,
        href: `/health/${record.kind}`,
      })),
      ...workouts.map((workout) => ({
        name: workout.name ?? workout.activity ?? "Workout",
        key: workout.iri,
        href: `/health/w/${encodeRef(workout.iri)}`,
      })),
    ].filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
  }, [store, session, query]);
  const state = useHealthResource(loader, empty);
  return (
    <div className="hlt-page">
      <header className="hlt-page-header">
        <h1>Results for “{query}”</h1>
      </header>
      {state.status === "loading" ? (
        <LoadingSkeleton />
      ) : state.status === "error" ? (
        <ErrorState error="unreachable" actions={{ retry: invalidate }} />
      ) : state.status === "empty" ? (
        <EmptyState
          variant="no-results"
          query={query}
          primaryAction={<Link href="/health">Go to summary</Link>}
        />
      ) : (
        <ul className="hlt-search-results">
          {state.data.map((item) => (
            <li key={item.key}>
              <Link href={item.href}>{item.name}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
