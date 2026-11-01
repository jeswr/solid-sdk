// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * Strava → Health + Mobility. `/athlete/activities`: runs/swims/workouts as
 * `schema:ExerciseAction` (Health), rides/commutes as `schema:TravelAction`
 * (Mobility).
 *
 * Incremental: the API supports `after=<epoch>` — the returned cursor is the
 * newest activity's start time; the next import fetches only newer activities
 * and **merges** them into the existing collection documents.
 *
 * Live-mode honesty: Strava's token endpoint requires the client secret (no
 * public PKCE) — live mode needs the maintainer's token proxy.
 */
import { DataFactory, Store } from "n3";
import { RunBudget, type RunLimits } from "../core/budget.js";
import { IntegrationSyncError } from "../core/errors.js";
import { getJson } from "../core/fixture-fetch.js";
import { arr, optionalDate, optionalNumber, optionalText, SkipCounter } from "../core/safe.js";
import type { ImportContext, ImportOutcome, IntegrationAdapter } from "../core/types.js";
import { CLASSES, ExerciseAction, TravelAction } from "../core/vocab.js";
import { STRAVA_FIXTURES, type StravaActivity } from "./fixtures.js";
import { vocabMap } from "./vocab-map.js";

const ID = "strava";
const API = "https://www.strava.com/api/v3";
const SCOPES = ["read", "activity:read"] as const;

const RIDE_TYPES = new Set(["Ride", "EBikeRide", "GravelRide", "MountainBikeRide", "Commute"]);

/** Create an adapter with host-selected per-run source limits. */
export function createStravaAdapter(limits?: RunLimits): IntegrationAdapter {
  return {
    vocabMap,
    metadata: {
      id: ID,
      name: "Strava",
      tier: "A",
      authKind: "oauth-pkce",
      scopes: SCOPES,
      categories: ["health", "mobility"],
      whatYouGet: "Workouts and swims into Health; rides and commutes into Mobility.",
      requirements: [
        "Create an API application at strava.com/settings/api.",
        "Set the Authorization Callback Domain to the app's host.",
        "Set NEXT_PUBLIC_STRAVA_CLIENT_ID.",
        "Strava's token endpoint requires the client secret (no public PKCE): deploy the token-exchange proxy and set NEXT_PUBLIC_STRAVA_TOKEN_PROXY.",
      ],
    },
    oauth: {
      clientId: undefined,
      authorizationEndpoint: "https://www.strava.com/oauth/authorize",
      tokenEndpoint: "https://www.strava.com/oauth/token",
      scopes: SCOPES,
      tokenExchange: "proxy",
      tokenProxyUrl: undefined,
      extraAuthParams: { approval_prompt: "auto" },
    },
    fixtures: () => STRAVA_FIXTURES,

    async import(ctx: ImportContext): Promise<ImportOutcome> {
      const budget = new RunBudget(ID, limits);
      const skipped = new SkipCounter();

      ctx.progress({ label: "Fetching your activities…", done: 0, total: 2 });
      const after = ctx.cursor ? `&after=${encodeURIComponent(ctx.cursor)}` : "";
      const list: StravaActivity[] = [];
      const seen = new Set<number>();
      let before: number | undefined;
      for (;;) {
        budget.request();
        const batch = arr(
          await getJson<StravaActivity[] | null>(
            ID,
            ctx.api,
            `${API}/athlete/activities?per_page=100${after}${before === undefined ? "" : `&before=${before}`}`,
            undefined,
            budget,
          ),
        );
        budget.items(batch.length);
        // Short pages are not necessarily final. Traverse time windows rather than
        // offsets so deletion of an already-read activity cannot shift an unseen one past us.
        if (batch.length === 0) break;
        const previousSize = seen.size;
        let oldest = Number.POSITIVE_INFINITY;
        for (const activity of batch) {
          if (!activity || activity.id === undefined || activity.id === null) {
            skipped.skip();
            continue;
          }
          const epoch = activityEpoch(activity);
          if (epoch !== undefined) {
            // Check every timestamp before deduplication or accepting a terminal window.
            if (before !== undefined && epoch >= before) {
              throw new IntegrationSyncError(
                ID,
                "The platform returned a non-advancing activity window.",
              );
            }
            oldest = Math.min(oldest, epoch);
          }
          if (seen.has(activity.id)) continue;
          seen.add(activity.id);
          list.push(activity);
        }
        // An overlap-only window ends normally; every continuing window adds a new id.
        if (seen.size === previousSize) break;
        if (ctx.cursor && oldest <= Number(ctx.cursor)) break;
        if (Number.isFinite(oldest)) {
          // Re-read the oldest second to include timestamp ties, deduplicating by id.
          // More than one window (100) of activities sharing a start second can end
          // traversal early when the overlap contains no unseen ids.
          before = oldest + 1;
        }
      }

      const workoutsDoc = ctx.resolve("fitness/activities.ttl");
      const ridesDoc = ctx.resolve("travel/rides.ttl");
      // Let the framework replace incoming subjects, including removed optional fields.
      const workouts = new Store();
      const rides = new Store();

      for (const a of list) {
        // An activity with no id has no stable fragment IRI — skip it.
        if (!a || a.id === undefined || a.id === null) {
          skipped.skip();
          continue;
        }
        const sportType = optionalText(a.sport_type);
        if (sportType !== undefined && RIDE_TYPES.has(sportType)) {
          const ride = new TravelAction(`${ridesDoc}#activity-${a.id}`, rides, DataFactory).mark();
          fill(ride, a);
        } else {
          const workout = new ExerciseAction(
            `${workoutsDoc}#activity-${a.id}`,
            workouts,
            DataFactory,
          ).mark();
          fill(workout, a);
          workout.exerciseType = sportType;
        }
      }

      ctx.progress({ label: "Saving workouts and rides…", done: 1, total: 2 });
      await ctx.write({
        slug: "fitness/activities.ttl",
        category: "health",
        forClass: CLASSES.ExerciseAction,
        dataset: workouts,
        writeMode: ctx.cursor ? "merge" : "replace",
        sourceUrl: `${API}/athlete/activities`,
      });
      await ctx.write({
        slug: "travel/rides.ttl",
        category: "mobility",
        forClass: CLASSES.TravelAction,
        dataset: rides,
        writeMode: ctx.cursor ? "merge" : "replace",
        sourceUrl: `${API}/athlete/activities`,
      });

      ctx.progress({ label: "Done", done: 2, total: 2 });
      return { cursor: nextCursor(ctx.cursor, list), skipped: skipped.value };
    },
  };
}

export const stravaAdapter: IntegrationAdapter = createStravaAdapter();

function activityEpoch(activity: StravaActivity): number | undefined {
  const date = optionalDate(activity.start_date);
  return date ? Math.floor(date.getTime() / 1000) : undefined;
}

function fill(action: ExerciseAction | TravelAction, a: StravaActivity): void {
  action.name = optionalText(a.name);
  action.identifier = String(a.id);
  action.startTime = optionalDate(a.start_date);
  const movingTime = optionalNumber(a.moving_time);
  action.duration =
    movingTime !== undefined ? `PT${Math.floor(movingTime / 60)}M${movingTime % 60}S` : undefined;
  const distance = optionalNumber(a.distance);
  action.distance = distance !== undefined ? `${(distance / 1000).toFixed(1)} km` : undefined;
  action.sourceUrl = `https://www.strava.com/activities/${a.id}`;
}

/** Newest start time (epoch seconds) across old cursor + new activities. */
function nextCursor(
  previous: string | undefined,
  activities: (StravaActivity | null)[],
): string | undefined {
  let newest = previous ? Number.parseInt(previous, 10) || 0 : undefined;
  for (const activity of activities) {
    if (!activity || activity.id === undefined || activity.id === null) continue;
    const epoch = activityEpoch(activity);
    if (epoch !== undefined) newest = newest === undefined ? epoch : Math.max(newest, epoch);
  }
  return newest === undefined ? previous : String(newest);
}
