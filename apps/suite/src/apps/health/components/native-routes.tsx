// AUTHORED-BY Claude Opus 5.5
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { useSearchParams } from "next/navigation";
import { useRouteParams } from "@/lib/route-params";
import { MetricView } from "./metric-view";
import { SearchView } from "./search-view";
import { WorkoutView } from "./workouts-view";

/** Read the param on the client, so the native export's placeholder page works too. */
export function MetricRoute() {
  const params = useRouteParams<{ metric: string }>("/health/m/[metric]");
  if (!params) return <LoadingSkeleton preset="grid" />;
  return <MetricView metric={params.metric} />;
}

export function WorkoutRoute() {
  const params = useRouteParams<{ ref: string }>("/health/w/[ref]");
  if (!params) return <LoadingSkeleton preset="list" />;
  return <WorkoutView reference={params.ref} />;
}

/** The query comes from the URL on the client, so the page can be exported statically. */
export function SearchRoute() {
  const query = useSearchParams().get("q") ?? "";
  return <SearchView query={query} />;
}
