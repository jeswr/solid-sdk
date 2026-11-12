// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
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

const SCOPES = ["read:recovery", "read:cycles", "read:sleep", "read:workout", "offline"] as const;
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
      const saved = apiCursor(ctx.cursor);
      const previous = saved.newest ? timestamp(saved.newest) : undefined;
      const start = saved.start;
      const itemLimit = Math.min(limits.maxItems, MAX_RECORDS);
      if (!Number.isSafeInteger(limits.maxItems) || itemLimit < 1)
        throw new IntegrationSyncError("whoop", "WHOOP item budget must be positive.");
      let consumed = 0;
      let requests = 0;
      let position = saved.position;
      let partial = false;
      const records: WhoopRecord[] = [];
      const unsupported = new Set<string>();
      const granted = new Set(ctx.scopes ?? SCOPES);
      const cycles = new Map<string, Date>();
      let skipped = 0;
      let newest = previous?.getTime();
      traversal: for (let index = saved.position.index; index < KINDS.length; index++) {
        const kind = KINDS[index] as Kind;
        const scope = kind === "cycle" ? "read:cycles" : `read:${kind}`;
        if (!granted.has(scope)) continue;
        if (kind === "recovery" && !granted.has("read:cycles")) {
          unsupported.add("WHOOP recovery requires read:cycles");
          continue;
        }
        ctx.progress({ label: `Reading WHOOP ${kind} records…`, done: records.length });
        let token = index === saved.position.index ? saved.position.token : undefined;
        let offset = index === saved.position.index ? saved.position.offset : 0;
        // Only the saved collection's first page can carry a resumed token. WHOOP may expire
        // or reject it; restart that collection once from the saved start instead of failing
        // every later run. Rows are keyed by kind and native id, so a replay is idempotent.
        let resumed = token !== undefined;
        const seen = new Set<string>(token ? [token] : []);
        for (;;) {
          position = { index, token, offset };
          if (consumed >= itemLimit || (requests > 0 && requests >= limits.maxRequests)) {
            partial = true;
            break traversal;
          }
          requests++;
          let page: Awaited<ReturnType<typeof collection>>;
          try {
            page = await collection(kind, start, token, ctx, budget, seen);
          } catch (error) {
            if (
              !resumed ||
              !(error instanceof IntegrationSyncError) ||
              (error.status !== 400 && error.status !== 404)
            )
              throw error;
            resumed = false;
            token = undefined;
            offset = 0;
            seen.clear();
            continue;
          }
          resumed = false;
          // A resumed page that shrank since the cursor was saved has shifted rows. Replay it
          // from its start rather than skipping rows or failing every later run.
          if (offset > page.rows.length) offset = 0;
          for (let rowIndex = offset; rowIndex < page.rows.length; rowIndex++) {
            if (consumed >= itemLimit) {
              position = { index, token, offset: rowIndex };
              partial = true;
              break traversal;
            }
            budget.items(1);
            consumed++;
            const raw = page.rows[rowIndex];
            ctx.signal?.throwIfAborted();
            const row = object(raw);
            const id = sourceId(kind === "recovery" ? row.cycle_id : row.id);
            // A resumed recovery traversal no longer has the earlier cycle pages in memory.
            // Resolve the actual cycle instead of persisting an unbounded id/time map in state.
            if (kind === "recovery" && id && !cycles.has(id) && ctx.cursor?.startsWith("{")) {
              if (requests >= limits.maxRequests) {
                position = { index, token, offset: rowIndex };
                partial = true;
                break traversal;
              }
              requests++;
              budget.request();
              let cycle: Record<string, unknown>;
              try {
                cycle = object(
                  await getJson<unknown>(
                    "whoop",
                    ctx.api,
                    `${sourceUrl("cycle")}/${id}`,
                    { signal: ctx.signal },
                    budget,
                  ),
                );
              } catch (error) {
                if (!(error instanceof IntegrationSyncError) || error.status !== 404) throw error;
                cycle = {};
              }
              const cycleStart = sourceId(cycle.id) === id ? timestamp(cycle.start) : undefined;
              if (cycleStart) cycles.set(id, cycleStart);
            }
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
            records.push(record);
            newest = Math.max(newest ?? at.getTime(), at.getTime());
          }
          token = page.next;
          offset = 0;
          if (!token) break;
        }
      }
      await writeRecords(records, ctx);
      return {
        cursor: partial
          ? JSON.stringify({
              v: 1,
              start,
              newest: newest === undefined ? undefined : new Date(newest).toISOString(),
              position,
            })
          : newest === undefined
            ? undefined
            : new Date(newest).toISOString(),
        warnings: partial ? [PARTIAL_WARNING] : undefined,
        skipped: skipped || undefined,
        unsupported: [...unsupported],
      };
    },
  };
}
export const whoopAdapter = createWhoopAdapter();

const KINDS = ["cycle", "recovery", "sleep", "workout"] as const;
export const PARTIAL_WARNING = "WHOOP import partial, re-run to continue.";
interface Position {
  index: number;
  token?: string;
  offset: number;
}
interface ApiCursor {
  v: 1;
  start?: string;
  newest?: string;
  position: Position;
}
function apiCursor(cursor: string | undefined): ApiCursor {
  if (cursor === undefined) return { v: 1, position: { index: 0, offset: 0 } };
  const previous = timestamp(cursor);
  if (previous)
    return {
      v: 1,
      start: new Date(previous.getTime() - LOOKBACK_MS).toISOString(),
      newest: previous.toISOString(),
      position: { index: 0, offset: 0 },
    };
  try {
    if (cursor.length > 4096) throw new Error();
    const value = JSON.parse(cursor) as ApiCursor;
    const p = value.position;
    if (
      value.v !== 1 ||
      !p ||
      !Number.isInteger(p.index) ||
      p.index < 0 ||
      p.index >= KINDS.length ||
      !Number.isInteger(p.offset) ||
      p.offset < 0 ||
      p.offset > 25 ||
      (p.token !== undefined &&
        (typeof p.token !== "string" || !p.token.length || p.token.length > 2048)) ||
      (value.start !== undefined && !timestamp(value.start)) ||
      (value.newest !== undefined && !timestamp(value.newest))
    )
      throw new Error();
    return value;
  } catch {
    throw new IntegrationSyncError("whoop", "Invalid WHOOP cursor.");
  }
}

async function collection(
  kind: Kind,
  start: string | undefined,
  token: string | undefined,
  ctx: ImportContext,
  budget: RunBudget,
  seen: Set<string>,
): Promise<{ rows: unknown[]; next?: string }> {
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
  const next = answer.next_token ?? answer.nextToken;
  if (
    Object.hasOwn(answer, "next_token") &&
    Object.hasOwn(answer, "nextToken") &&
    answer.next_token !== answer.nextToken
  )
    throw new IntegrationSyncError("whoop", "Conflicting WHOOP page tokens.");
  if (next === undefined || next === null) return { rows: answer.records };
  if (typeof next !== "string" || !next.length || next.length > 2048 || seen.has(next))
    throw new IntegrationSyncError("whoop", "Invalid or repeated WHOOP page token.");
  seen.add(next);
  return { rows: answer.records, next };
}
