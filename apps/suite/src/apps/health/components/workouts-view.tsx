// AUTHORED-BY Codex GPT-6
"use client";
import { Button, EmptyState, ErrorState, LoadingSkeleton, ProvenanceBadge } from "@jeswr/suite-ui";
import Link from "next/link";
import { useCallback, useState } from "react";
import { decodeRef, encodeRef } from "@/lib/refs";
import { listWorkouts, loadWorkout } from "../lib/data/workouts";
import type { WorkoutSummary } from "../lib/model";
import { useHealth, useHealthResource } from "../state/health-context";
import { useSvgWidth } from "./charts";

const noWorkouts = (items: WorkoutSummary[]) => items.length === 0;
function workoutName(item: WorkoutSummary) {
  return (
    item.name ??
    `${item.activity ?? "Workout"}${item.start ? ` · ${item.start.toLocaleDateString("en-GB", { dateStyle: "medium" })}` : ""}`
  );
}
const number = (value: number) => value.toLocaleString("en", { maximumFractionDigits: 1 });
function duration(item: WorkoutSummary) {
  return item.start && item.end
    ? `${number(Math.max(0, item.end.getTime() - item.start.getTime()) / 60000)} min`
    : "Not recorded";
}
function distance(item: WorkoutSummary) {
  return typeof item.distance === "number"
    ? `${number(item.distance / 1000)} km`
    : (item.distance ?? "Not recorded");
}
export function WorkoutsView() {
  const { store, session, invalidate } = useHealth();
  const loader = useCallback(() => listWorkouts(store, session.fetch), [store, session]);
  const state = useHealthResource(loader, noWorkouts);
  return (
    <div className="hlt-page">
      <header className="hlt-page-header">
        <div>
          <p className="hlt-eyebrow">MOVEMENT & ACTIVITY</p>
          <h1>Workouts</h1>
          <p className="hlt-muted">Your routes and activities, kept together.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/health/import">Import GPX</Link>
        </Button>
      </header>
      {state.status === "loading" ? (
        <LoadingSkeleton label="Loading workouts" />
      ) : state.status === "error" ? (
        <ErrorState error="unreachable" actions={{ retry: invalidate }} />
      ) : state.status === "empty" ? (
        <EmptyState
          title="No workouts yet"
          body="Import a GPX file to add your first route."
          primaryAction={
            <Button asChild>
              <Link href="/health/import">Import GPX</Link>
            </Button>
          }
        />
      ) : (
        <div className="hlt-workout-list">
          {state.data.map((item) => (
            <article className="hlt-panel hlt-workout-row" key={item.iri}>
              <div>
                <Link href={`/health/w/${encodeRef(item.iri)}`}>
                  <h2>{workoutName(item)}</h2>
                </Link>
                <p className="hlt-muted">{item.activity ?? "Activity"}</p>
              </div>
              <dl>
                <div>
                  <dt>Duration</dt>
                  <dd>{duration(item)}</dd>
                </div>
                <div>
                  <dt>Distance</dt>
                  <dd>{distance(item)}</dd>
                </div>
                <div>
                  <dt>Elevation gain</dt>
                  <dd>
                    {item.elevationGain === null
                      ? "Not recorded"
                      : `${number(item.elevationGain)} m`}
                  </dd>
                </div>
              </dl>
              <ProvenanceBadge source={item.source ?? "Unknown source"} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
const notEmpty = () => false;
export function WorkoutView({ reference }: { reference: string }) {
  const { store, session, invalidate } = useHealth();
  const [table, setTable] = useState(false);
  const loader = useCallback(async () => {
    const iri = decodeRef(reference);
    const workout = (await store.loadWorkouts()).find((item) => item.iri === iri);
    if (!workout) return null;
    return loadWorkout(store, workout, session.fetch);
  }, [reference, store, session]);
  const state = useHealthResource(loader, notEmpty);
  return (
    <div className="hlt-page">
      <Link href="/health/workouts" className="hlt-back">
        ← Workouts
      </Link>
      {state.status === "loading" ? (
        <>
          <h1>Workout</h1>
          <LoadingSkeleton preset="detail" label="Loading workout" />
        </>
      ) : state.status === "error" ? (
        <>
          <h1>Couldn't open this workout</h1>
          <ErrorState error="unreachable" actions={{ retry: invalidate }} />
        </>
      ) : !state.data ? (
        <>
          <h1>Workout not found</h1>
          <EmptyState
            title="This workout isn't here"
            body="Choose another workout from your list."
            primaryAction={<Link href="/health/workouts">Go to workouts</Link>}
          />
        </>
      ) : (
        <>
          <header className="hlt-page-header">
            <div>
              <p className="hlt-eyebrow">WORKOUT DETAILS</p>
              <h1>{workoutName(state.data.workout)}</h1>
              {state.data.workout.start && (
                <p className="hlt-muted">
                  Started at{" "}
                  {state.data.workout.start.toLocaleTimeString("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </p>
              )}
            </div>
            <ProvenanceBadge source={state.data.workout.source ?? "Unknown source"} />
          </header>
          <div className="hlt-stats">
            <div className="hlt-stat">
              <span>Duration</span>
              <strong>{duration(state.data.workout)}</strong>
            </div>
            <div className="hlt-stat">
              <span>Distance</span>
              <strong>{distance(state.data.workout)}</strong>
            </div>
            <div className="hlt-stat">
              <span>Elevation gain</span>
              <strong>
                {state.data.route?.profile.some((point) => point.elevation !== null)
                  ? `${number(state.data.route.elevationGain)} m`
                  : "Not recorded"}
              </strong>
            </div>
          </div>
          {state.data.route ? (
            <>
              <section className="hlt-panel">
                <div className="hlt-section-heading">
                  <h2>Route</h2>
                  <span className="hlt-muted">Track only · no map service</span>
                </div>
                <RouteDrawing segments={state.data.route.segments} />
                <p className="hlt-muted hlt-small">North is up. Route gaps remain separate.</p>
              </section>
              <section className="hlt-panel">
                <div className="hlt-section-heading">
                  <h2>Elevation profile</h2>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-pressed={table}
                    onClick={() => setTable(!table)}
                  >
                    {table ? "Show as chart" : "Show as table"}
                  </Button>
                </div>
                {table ? (
                  <div className="hlt-table-scroll">
                    <table className="hlt-table">
                      <caption>Elevation along the route</caption>
                      <thead>
                        <tr>
                          <th scope="col">Distance (km)</th>
                          <th scope="col">Elevation (m)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.data.route.profile.map((point, index) => (
                          <tr key={String(index)}>
                            <td>{number(point.distance / 1000)}</td>
                            <td>
                              {point.elevation === null ? "Not recorded" : number(point.elevation)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <ElevationDrawing profile={state.data.route.profile} />
                )}
                <p className="hlt-muted hlt-small">
                  Latest elevation:{" "}
                  {state.data.route.profile.at(-1)?.elevation === null
                    ? "Not recorded"
                    : `${number(state.data.route.profile.at(-1)?.elevation ?? 0)} m`}
                </p>
              </section>
            </>
          ) : (
            <EmptyState
              title="No route attached"
              body="This activity contains a summary without a recorded route."
              primaryAction={<Link href="/health/import">Import a GPX route</Link>}
            />
          )}
        </>
      )}
    </div>
  );
}
export function RouteDrawing({ segments }: { segments: { lat: number; long: number }[][] }) {
  let minLat = Infinity,
    maxLat = -Infinity,
    minLong = Infinity,
    maxLong = -Infinity,
    count = 0;
  for (const segment of segments)
    for (const point of segment) {
      minLat = Math.min(minLat, point.lat);
      maxLat = Math.max(maxLat, point.lat);
      minLong = Math.min(minLong, point.long);
      maxLong = Math.max(maxLong, point.long);
      count++;
    }
  if (!count) return <p className="hlt-muted">No route points recorded.</p>;
  const longitudeScale = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const width = (maxLong - minLong) * longitudeScale,
    height = maxLat - minLat;
  // Zero spans impose no constraint. Tiny nonzero tracks still fill the available
  // space, centered with padding, without stretching their geographic proportions.
  const fit = Math.min(width > 0 ? 560 / width : Infinity, height > 0 ? 190 / height : Infinity);
  const scale = Number.isFinite(fit) ? fit : 1;
  return (
    <svg
      className="hlt-route"
      viewBox="0 0 640 240"
      role="img"
      aria-label={`Workout route with ${count} points in ${segments.length} segments. North is up.`}
    >
      <text x="600" y="25">
        N ↑
      </text>
      {segments.map((segment, index) => (
        <polyline
          key={String(index)}
          points={segment
            .map(
              (point) =>
                `${(640 - width * scale) / 2 + (point.long - minLong) * longitudeScale * scale},${(240 - height * scale) / 2 + (maxLat - point.lat) * scale}`,
            )
            .join(" ")}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {count === 1 && <circle cx="320" cy="120" r="4" fill="var(--primary)" />}
    </svg>
  );
}
export function ElevationDrawing({
  profile,
}: {
  profile: { distance: number; elevation: number | null }[];
}) {
  const { ref, width } = useSvgWidth();
  let lowest = Infinity,
    highest = -Infinity;
  for (const point of profile)
    if (point.elevation !== null) {
      lowest = Math.min(lowest, point.elevation);
      highest = Math.max(highest, point.elevation);
    }
  if (lowest === Infinity) return <p className="hlt-muted">No elevation data recorded.</p>;
  const min = Math.floor(lowest),
    max = Math.ceil(highest);
  const distance = profile.at(-1)?.distance || 1;
  const coords = profile
    .filter((point) => point.elevation !== null)
    .map(
      (point) =>
        `${60 + (point.distance / distance) * (width - 100)},${195 - (((point.elevation as number) - min) / (max - min || 1)) * 160}`,
    )
    .join(" ");
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${width} 240`}
      className="hlt-chart"
      role="img"
      aria-label={`Elevation profile. Minimum ${min} m, maximum ${max} m.`}
    >
      <text x="12" y="20">
        m
      </text>
      <text x="48" y="40" textAnchor="end">
        {max}
      </text>
      <text x="48" y="200" textAnchor="end">
        {min}
      </text>
      <line x1="60" x2={width - 40} y1="195" y2="195" className="hlt-chart-grid" />
      <polygon points={`60,195 ${coords} ${width - 40},195`} fill="var(--primary-soft)" />
      <polyline points={coords} fill="none" stroke="var(--primary)" strokeWidth="1.75" />
      <text x="60" y="225" textAnchor="middle">
        0 km
      </text>
      <text x={width - 40} y="225" textAnchor="end">
        {number(distance / 1000)} km
      </text>
    </svg>
  );
}
