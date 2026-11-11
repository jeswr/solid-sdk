// AUTHORED-BY Codex GPT-6.1-Sol
import { RunBudget, type RunLimits } from "../core/budget.js";
import { IntegrationSyncError } from "../core/errors.js";
import { getJson } from "../core/fixture-fetch.js";
import type { ImportContext, IntegrationAdapter } from "../core/types.js";
import { WHOOP_FIXTURES } from "./fixtures.js";
import {
  type Kind,
  MAX_RECORDS,
  number,
  object,
  sourceId,
  sourceUrl,
  timestamp,
  type WhoopRecord,
  writeRecords,
} from "./model.js";
import { vocabMap } from "./vocab-map.js";

const SCOPES = [
  "read:recovery",
  "read:cycles",
  "read:sleep",
  "read:workout",
  "read:profile",
  "offline",
] as const;
const DEFAULT_LIMITS: RunLimits = {
  maxRequests: 2_000,
  maxItems: MAX_RECORDS,
  maxBytes: 64 * 1024 * 1024,
};
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export function createWhoopAdapter(limits: RunLimits = DEFAULT_LIMITS): IntegrationAdapter {
  return {
    vocabMap,
    metadata: {
      id: "whoop",
      name: "WHOOP",
      tier: "A",
      authKind: "oauth-pkce",
      scopes: SCOPES,
      categories: ["health"],
      whatYouGet:
        "Recovery vitals, sleep durations and stages, daily energy and workouts in Health; import an export ZIP or CSV too.",
      requirements: [
        "Register a WHOOP developer application and its callback URI at developer.whoop.com.",
        "Inject its public client id through createRegistry({ whoop: { clientId } }); the host supplies source authentication.",
        "Configure WHOOP_TOKEN_PROXY through tokenProxyUrl for confidential token exchange, or inject a client secret in the Node host.",
      ],
    },
    oauth: {
      clientId: undefined,
      authorizationEndpoint: "https://api.prod.whoop.com/oauth/oauth2/auth",
      tokenEndpoint: "https://api.prod.whoop.com/oauth/oauth2/token",
      scopes: SCOPES,
      tokenExchange: "proxy",
      tokenProxyUrl: undefined,
    },
    fixtures: () => WHOOP_FIXTURES,
    async import(ctx) {
      const budget = new RunBudget("whoop", limits);
      const previous = ctx.cursor === undefined ? undefined : timestamp(ctx.cursor);
      if (ctx.cursor !== undefined && !previous)
        throw new IntegrationSyncError("whoop", "Invalid WHOOP cursor.");
      const start = previous ? new Date(previous.getTime() - LOOKBACK_MS).toISOString() : undefined;
      const records: WhoopRecord[] = [];
      const unsupported = new Set<string>();
      const granted = new Set(ctx.scopes ?? SCOPES);
      const cycles = new Map<string, Date>();
      let skipped = 0;
      let newest = previous?.getTime();
      for (const kind of ["cycle", "recovery", "sleep", "workout"] as const) {
        const scope = kind === "cycle" ? "read:cycles" : `read:${kind}`;
        if (!granted.has(scope)) continue;
        if (kind === "recovery" && !granted.has("read:cycles")) {
          unsupported.add("WHOOP recovery requires read:cycles");
          continue;
        }
        ctx.progress({ label: `Reading WHOOP ${kind} records…`, done: records.length });
        for (const raw of await collection(kind, start, ctx, budget)) {
          ctx.signal?.throwIfAborted();
          const row = object(raw);
          const id = sourceId(kind === "recovery" ? row.cycle_id : row.id);
          const at = kind === "recovery" ? cycles.get(id ?? "") : timestamp(row.start);
          if (kind === "cycle" && id && at) cycles.set(id, at);
          // Unscored records have no meaningful measurements yet. The overlap replays them.
          if (!id || !at || row.score_state !== "SCORED") {
            skipped++;
            continue;
          }
          const end = timestamp(row.end);
          if (
            (kind === "sleep" || kind === "workout") &&
            (!end || end <= at || end.getTime() - at.getTime() > 7 * 86_400_000)
          ) {
            skipped++;
            continue;
          }
          const score = object(row.score);
          if (score.recovery_score != null) unsupported.add("WHOOP recovery score %");
          if (score.strain != null) unsupported.add("WHOOP strain");
          if (score.sleep_performance_percentage != null)
            unsupported.add("WHOOP sleep performance %");
          const record: WhoopRecord = {
            kind,
            id,
            start: at,
            end,
            updated: timestamp(row.updated_at),
            values: {},
          };
          if (kind === "recovery") {
            record.values.restingHR = number(score.resting_heart_rate, 300);
            record.values.hrv = number(score.hrv_rmssd_milli, 10_000);
            record.values.oxygen = number(score.spo2_percentage, 100);
            record.values.temperature = number(score.skin_temp_celsius, 60, -20);
          } else if (kind === "sleep") {
            const stages = object(score.stage_summary);
            const light = number(stages.total_light_sleep_time_milli, 7 * 86_400_000);
            const deep = number(stages.total_slow_wave_sleep_time_milli, 7 * 86_400_000);
            const rem = number(stages.total_rem_sleep_time_milli, 7 * 86_400_000);
            if (light !== undefined && deep !== undefined && rem !== undefined) {
              if (light + deep + rem > (end as Date).getTime() - at.getTime()) {
                skipped++;
                continue;
              }
              record.values.sleep = (light + deep + rem) / 1000;
            }
            record.values.light = light === undefined ? undefined : light / 1000;
            record.values.deep = deep === undefined ? undefined : deep / 1000;
            record.values.rem = rem === undefined ? undefined : rem / 1000;
            record.values.respiratory = number(score.respiratory_rate, 100);
          } else {
            record.values.energy = number(score.kilojoule, 1_000_000);
            record.values.averageHR = number(score.average_heart_rate, 300);
            record.values.maxHR = number(score.max_heart_rate, 300);
            if (kind === "workout" && typeof row.sport_name === "string")
              record.name = row.sport_name.slice(0, 256);
          }
          for (const key of Object.keys(record.values) as (keyof WhoopRecord["values"])[])
            if (record.values[key] === undefined) delete record.values[key];
          if (kind !== "workout" && Object.keys(record.values).length === 0) {
            skipped++;
            continue;
          }
          if (records.length >= MAX_RECORDS)
            throw new IntegrationSyncError("whoop", "WHOOP record cap exceeded.");
          records.push(record);
          newest = Math.max(newest ?? at.getTime(), at.getTime());
        }
      }
      await writeRecords(records, ctx);
      return {
        cursor: newest === undefined ? ctx.cursor : new Date(newest).toISOString(),
        skipped: skipped || undefined,
        unsupported: [...unsupported],
      };
    },
  };
}
export const whoopAdapter = createWhoopAdapter();

async function collection(
  kind: Kind,
  start: string | undefined,
  ctx: ImportContext,
  budget: RunBudget,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const seen = new Set<string>();
  let token: string | undefined;
  do {
    ctx.signal?.throwIfAborted();
    budget.request();
    const url = new URL(sourceUrl(kind));
    url.searchParams.set("limit", "25");
    if (start) url.searchParams.set("start", start);
    if (token) url.searchParams.set("nextToken", token);
    const answer = object(
      await getJson<unknown>("whoop", ctx.api, url.href, { signal: ctx.signal }, budget),
    );
    if (!Array.isArray(answer.records) || answer.records.length > 25)
      throw new IntegrationSyncError("whoop", "Invalid WHOOP collection envelope.");
    budget.items(answer.records.length);
    if (rows.length + answer.records.length > MAX_RECORDS)
      throw new IntegrationSyncError("whoop", "WHOOP record cap exceeded.");
    rows.push(...answer.records);
    // v2 returns next_token; accept camel-case exports of recorded envelopes too.
    const next = answer.next_token ?? answer.nextToken;
    if (
      Object.hasOwn(answer, "next_token") &&
      Object.hasOwn(answer, "nextToken") &&
      answer.next_token !== answer.nextToken
    )
      throw new IntegrationSyncError("whoop", "Conflicting WHOOP page tokens.");
    if (next === undefined || next === null) break;
    if (typeof next !== "string" || !next.length || next.length > 2048 || seen.has(next))
      throw new IntegrationSyncError("whoop", "Invalid or repeated WHOOP page token.");
    seen.add(next);
    token = next;
  } while (token);
  return rows;
}
