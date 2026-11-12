// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * Fitbit → Health. Your logged activities (`/1/user/-/activities/list.json`)
 * as `schema:ExerciseAction` (type, start time, duration, distance).
 *
 * Retired 2 November 2026. Retained as a fixture/demo compatibility oracle for
 * Google Health's pod mappings. The registry hides it from new connections,
 * and the runner refuses live imports before any provider request.
 */
import { DataFactory, Store } from "n3";
import { getJson } from "../core/fixture-fetch.js";
import type { ImportContext, ImportOutcome, IntegrationAdapter } from "../core/types.js";
import { CLASSES, ExerciseAction } from "../core/vocab.js";
import { FITBIT_FIXTURES, type FitbitActivitiesAnswer } from "./fixtures.js";
import { vocabMap } from "./vocab-map.js";

const ID = "fitbit";
const API = "https://api.fitbit.com";
const SCOPES = ["activity", "heartrate", "sleep"] as const;

export const fitbitAdapter: IntegrationAdapter = {
  vocabMap,
  metadata: {
    id: ID,
    deprecated:
      "Fitbit's live API and OAuth retired on 2 November 2026. Connect Google Health and re-authorize with Google; existing pod activities remain valid.",
    name: "Fitbit",
    tier: "B",
    authKind: "oauth-pkce",
    scopes: SCOPES,
    categories: ["health"],
    whatYouGet: "Your logged activities — runs, walks and rides — saved into Health.",
    requirements: [
      "The Fitbit Web API and OAuth endpoints retired on 2 November 2026. Connect Google Health and re-authorize with Google.",
    ],
  },
  oauth: {
    clientId: undefined,
    authorizationEndpoint: "https://www.fitbit.com/oauth2/authorize",
    tokenEndpoint: "https://api.fitbit.com/oauth2/token",
    scopes: SCOPES,
    tokenExchange: "proxy",
    tokenProxyUrl: undefined,
    tokenRequest: "basic-form",
  },
  fixtures: () => FITBIT_FIXTURES,

  async import(ctx: ImportContext): Promise<ImportOutcome> {
    ctx.progress({ label: "Fetching your activity log…", done: 0, total: 1 });
    const answer = await getJson<FitbitActivitiesAnswer>(
      ID,
      ctx.api,
      `${API}/1/user/-/activities/list.json?sort=desc&offset=0&limit=100`,
    );

    const doc = ctx.resolve("health/activities.ttl");
    const activities = new Store();
    for (const a of answer.activities) {
      const ex = new ExerciseAction(`${doc}#activity-${a.logId}`, activities, DataFactory).mark();
      ex.name = a.activityName;
      ex.identifier = String(a.logId);
      ex.exerciseType = a.activityName;
      ex.startTime = startDateTime(a.startDate, a.startTime);
      ex.duration = isoDuration(a.duration);
      if (a.distance !== undefined) ex.distance = `${a.distance} km`;
      ex.sourceUrl = `https://www.fitbit.com/activities/exercise/${a.logId}`;
    }
    await ctx.write({
      slug: "health/activities.ttl",
      category: "health",
      forClass: CLASSES.ExerciseAction,
      dataset: activities,
    });

    ctx.progress({ label: "Done", done: 1, total: 1 });
    return {};
  },
};

/** Fitbit splits date + local time; compose an ISO timestamp (no offset known). */
function startDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
}

/** Milliseconds → ISO-8601 duration (`PT31M`). */
function isoDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `PT${h > 0 ? `${h}H` : ""}${m > 0 ? `${m}M` : ""}${s > 0 || (h === 0 && m === 0) ? `${s}S` : ""}`;
}
