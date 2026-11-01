// AUTHORED-BY Codex GPT-6
import {
  type GpxTrackPoint,
  haversineMetres,
  parseGpxSegments,
  routeDistanceMetres,
  type WorkoutSummary,
} from "../model";
import type { HealthStore } from "./metrics";

export class PartialGpxImportError extends Error {
  constructor(readonly cause: unknown) {
    super(
      "The route was saved, but its workout entry still needs to be saved. Retry to finish this workout.",
    );
  }
}

export async function listWorkouts(store: HealthStore, fetch: typeof globalThis.fetch) {
  const items = (await store.loadWorkouts()).sort(
    (a, b) => (b.start?.getTime() ?? 0) - (a.start?.getTime() ?? 0),
  );
  return Promise.all(
    items.map(async (workout) => {
      const detail = await loadWorkout(store, workout, fetch);
      const route = detail.route;
      return {
        ...workout,
        elevationGain: route?.profile.some((point) => point.elevation !== null)
          ? route.elevationGain
          : null,
        routeError: detail.routeError,
      };
    }),
  );
}
export function previewGpx(xml: string) {
  const segments = parseGpxSegments(xml);
  const points = segments.flat();
  if (!points.length) throw new TypeError("This GPX file has no track points");
  let elevationGain = 0;
  const profile: { distance: number; elevation: number | null }[] = [];
  let distance = 0;
  for (const segment of segments) {
    let previous: GpxTrackPoint | undefined;
    for (const point of segment) {
      if (previous) {
        distance += haversineMetres(previous.lat, previous.long, point.lat, point.long);
        if (previous.elevation !== undefined && point.elevation !== undefined)
          elevationGain += Math.max(0, point.elevation - previous.elevation);
      }
      profile.push({ distance, elevation: point.elevation ?? null });
      previous = point;
    }
  }
  return { segments, points, distance: routeDistanceMetres(segments), elevationGain, profile };
}
export async function importGpx(store: HealthStore, id: string, xml: string) {
  previewGpx(xml);
  let routeSaved = false;
  try {
    return await store.importGpx(id, xml, () => {
      routeSaved = true;
    });
  } catch (cause) {
    if (routeSaved) throw new PartialGpxImportError(cause);
    throw cause;
  }
}
export async function loadWorkout(
  store: HealthStore,
  workout: WorkoutSummary,
  fetch: typeof globalThis.fetch,
) {
  if (!workout.gpx) return { workout, route: null, routeError: null };
  try {
    const url = new URL(workout.gpx);
    const base = new URL(store.base);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(`${base.pathname}workouts/`) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /%2f|%5c/i.test(url.pathname)
    )
      throw new TypeError("Route is outside your Health storage");
    const response = await fetch(url.href, { redirect: "error" });
    if (!response.ok) throw new Error("Couldn't load the workout route");
    return { workout, route: previewGpx(await response.text()), routeError: null };
  } catch {
    return {
      workout,
      route: null,
      routeError: "Couldn't load the workout route. Your workout summary is still available.",
    };
  }
}
