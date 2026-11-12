// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { createGoogleOAuthConfig } from "../adapters/google/oauth.js";
import { RunBudget, type RunLimits } from "../core/budget.js";
import { IntegrationSyncError } from "../core/errors.js";
import type { IntegrationAdapter } from "../core/types.js";
import {
  DAY_MS,
  DEFAULT_LIMITS,
  DEFAULT_LOOKBACK_DAYS,
  DEFAULT_RUN_LIMITS,
  fetchRollup,
  fetchWindow,
  GOOGLE_HEALTH_SCOPES,
  type HealthType,
  HOUR_MS,
  ID,
  MAX_OFFSET_MS,
  OVERLAP_MS,
  PageCapError,
  record,
  rollupDays,
  sample,
  summary,
  TYPES,
  timestamp,
  type Window,
} from "./api.js";
import { demoFixtures } from "./fixtures.js";
import { HealthMapper } from "./mapping.js";
import { createGoogleHealthSourceAuth } from "./source-auth.js";
import { vocabMap } from "./vocab-map.js";

export interface GoogleHealthOptions {
  /** Per data type, per run (default 512 requests, 250,000 points/stages, 128 MiB). */
  readonly limits?: RunLimits;
  /** Whole run across all types (default 2,048 requests, 1,000,000 points/stages, 512 MiB). */
  readonly runLimits?: RunLimits;
  /** Pages per request window (1–100, default 100); a capped window is split, down to 1 h. */
  readonly maxPages?: number;
  /** Days a first import (no checkpoint) reaches back (1–3,650, default 30). */
  readonly lookbackDays?: number;
  readonly now?: () => Date;
  /**
   * Non-personal diagnostics: resolved duplicate conflicts, skipped unmappable records, a type
   * stopped at the page cap, and an older checkpoint restarted at the lookback window.
   */
  readonly onWarning?: (message: string) => void;
}

/** A per-type or whole-run budget ran out: end gracefully at the last written window. */
class BudgetStop extends IntegrationSyncError {
  constructor(readonly scope: "type" | "run") {
    super(ID, `The Google Health import exceeded its ${scope} budget.`);
    this.name = "BudgetStop";
  }
}

/** A per-type budget that also charges the shared run budget. */
class TypeBudget extends RunBudget {
  constructor(
    limits: RunLimits,
    private readonly run: RunBudget,
  ) {
    super(ID, limits);
  }
  private charge(own: () => void, shared: () => void): void {
    try {
      own();
    } catch {
      throw new BudgetStop("type");
    }
    try {
      shared();
    } catch {
      throw new BudgetStop("run");
    }
  }
  override request(): void {
    this.charge(
      () => super.request(),
      () => this.run.request(),
    );
  }
  override items(n: number): void {
    this.charge(
      () => super.items(n),
      () => this.run.items(n),
    );
  }
  override bytes(n: number): void {
    this.charge(
      () => super.bytes(n),
      () => this.run.bytes(n),
    );
  }
}

interface Cursor {
  /** Every window ending at or before this instant is fully written. */
  through: number;
  /** When those windows were read (late arrivals within 48 h of this are re-read). */
  at: number;
}

/** Checkpoint and parser version: a cursor written by an older parser restarts at the lookback. */
const VERSION = 3;
/** A capped list window splits into these spans; a capped 1 h window ends its type's run. */
const SPLITS = [12, 6, 3, 1].map((h) => h * HOUR_MS);

const limitsOf = (limits: RunLimits, fallback: Required<RunLimits>): Required<RunLimits> => {
  const result = { ...limits, maxBytes: limits.maxBytes ?? fallback.maxBytes };
  for (const n of [result.maxRequests, result.maxItems, result.maxBytes])
    if (!Number.isSafeInteger(n) || n < 1)
      throw new TypeError("Run limits must be positive safe integers.");
  return result;
};

/** Sub-windows of a capped window: list windows by SPLITS, rollup ranges by halves of days. */
function split(window: Window, rollup: boolean): Window[] | undefined {
  const span = window.end - window.start;
  const step = rollup
    ? span > DAY_MS
      ? Math.ceil(span / DAY_MS / 2) * DAY_MS
      : undefined
    : SPLITS.find((s) => s < span);
  if (step === undefined) return undefined;
  const parts: Window[] = [];
  for (let start = window.start; start < window.end; start += step)
    parts.push({ start, end: Math.min(start + step, window.end) });
  return parts;
}

/** Google Health successor; the standard writer retains the legacy Fitbit container. */
export function createGoogleHealthAdapter({
  limits = DEFAULT_LIMITS,
  runLimits = DEFAULT_RUN_LIMITS,
  maxPages = 100,
  lookbackDays = DEFAULT_LOOKBACK_DAYS,
  now = () => new Date(),
  onWarning = () => {},
}: GoogleHealthOptions = {}): IntegrationAdapter {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100)
    throw new TypeError("maxPages must be between 1 and 100.");
  if (!Number.isSafeInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 3650)
    throw new TypeError("lookbackDays must be between 1 and 3650.");
  const typeLimits = limitsOf(limits, DEFAULT_LIMITS);
  const totalLimits = limitsOf(runLimits, DEFAULT_RUN_LIMITS);
  return {
    vocabMap,
    metadata: {
      id: ID,
      name: "Google Health",
      tier: "B",
      authKind: "oauth-pkce",
      scopes: GOOGLE_HEALTH_SCOPES,
      categories: ["health"],
      whatYouGet:
        "Exercise, daily steps, distance and calories, sleep, heart rate and weight saved into Health. Re-authorize to replace a legacy Fitbit connection.",
      requirements: [
        "Google Health Restricted scopes require Google verification and security review for public use; an owner's test-user project may connect privately.",
        "Enable Google Health API in your Google OAuth project and confirm its requested read scopes before configuring a live connection.",
        "Browser hosts inject a Web client id and TOKEN_PROXY; Node hosts use a Desktop client and loopback PKCE. Legacy Fitbit tokens cannot be reused.",
      ],
    },
    oauth: createGoogleOAuthConfig("health"),
    createSourceAuth: (config, token, fetch) =>
      createGoogleHealthSourceAuth({ config, token, fetch }),
    // Synthetic fixtures moved by whole days so demos fall inside the first-import lookback.
    fixtures: () => demoFixtures(now()),
    async import(ctx) {
      if (ctx.scopes && GOOGLE_HEALTH_SCOPES.some((scope) => !ctx.scopes?.includes(scope)))
        throw new IntegrationSyncError(
          ID,
          "Re-authorize Google Health with all requested read permissions.",
        );
      const until = now().getTime();
      if (!Number.isFinite(until) || until < 0)
        throw new IntegrationSyncError(ID, "Invalid clock for Google Health import.");
      const stored = parseCursor(ctx.cursor, until);
      if (stored === "outdated")
        onWarning(
          `The Google Health checkpoint predates parser version ${VERSION}; re-reading the last ${lookbackDays} day(s).`,
        );
      const cursors = stored === "outdated" ? {} : stored;
      const next: Partial<Record<HealthType, Cursor>> = { ...cursors };
      const run = new RunBudget(ID, totalLimits);
      const mapper = new HealthMapper((slug) => ctx.resolve(slug));
      let indexed = false;
      let skipped = 0;
      let conflicts = 0;
      let completedAny = false;
      let runStopped = false;
      for (const [i, type] of TYPES.entries()) {
        if (runStopped) break;
        ctx.signal?.throwIfAborted();
        ctx.progress({ label: `Reading Health ${type}…`, done: i, total: TYPES.length });
        const previous = cursors[type];
        const from = Math.max(
          0,
          previous
            ? floorDay(
                Math.min(
                  previous.through,
                  Math.max(previous.through - OVERLAP_MS, previous.at - OVERLAP_MS),
                ),
              )
            : floorDay(until - lookbackDays * DAY_MS),
        );
        const budget = new TypeBudget(typeLimits, run);
        const rollup = summary(type);
        let through: number | undefined;
        let hold = Number.POSITIVE_INFINITY;

        /** Read and write one window; false ends this type's run (budget or page cap). */
        const visit = async (window: Window): Promise<boolean> => {
          try {
            if (rollup) {
              const batch = await fetchRollup(ctx, type, window, budget, maxPages);
              skipped += batch.skipped;
              conflicts += batch.conflicts;
              for (const total of batch.totals.sort((a, b) => a.date.localeCompare(b.date)))
                for (const doc of mapper.daily(total)) await ctx.write(doc);
            } else {
              const batch = await fetchWindow(ctx, type, window, budget, maxPages, until);
              skipped += batch.skipped;
              conflicts += batch.conflicts;
              if (batch.transient) hold = Math.min(hold, window.start);
              if (type === "exercise" && batch.points.length > 0 && !indexed) {
                mapper.indexActivities(await ctx.read("health/activities.ttl"));
                indexed = true;
              }
              const docs = sample(type)
                ? mapper.samples(type, iso(window.start).slice(0, 10), batch.points)
                : mapper.sessions(batch.points);
              for (const doc of docs) await ctx.write(doc);
            }
          } catch (error) {
            if (error instanceof PageCapError) {
              const parts = split(window, rollup);
              if (parts) {
                for (const part of parts) if (!(await visit(part))) return false;
                return true;
              }
              onWarning(
                `Google Health ${type} reached the ${maxPages}-page cap in one ${rollup ? "day" : "hour"} from ${iso(window.start)}; that type resumes there next run.`,
              );
              return false;
            }
            if (!(error instanceof BudgetStop)) throw error;
            // No progress is possible when the very first window cannot fit: a real error.
            if (through === undefined && (error.scope === "type" || !completedAny))
              throw new IntegrationSyncError(
                ID,
                `One window of Google Health ${type} exceeds the import's ${error.scope} budget; raise its limits. Checkpoint unchanged.`,
              );
            runStopped = error.scope === "run";
            return false;
          }
          through = window.end;
          completedAny = true;
          return true;
        };

        if (rollup) {
          // Civil dates as UTC-midnight instants: from the first re-read date through the civil
          // "today" of the most eastern offset. A date is final once it has ended everywhere.
          const last = floorDay(until + MAX_OFFSET_MS) + DAY_MS;
          const final = Math.max(from, floorDay(until - MAX_OFFSET_MS));
          for (let start = from; start < last; start += rollupDays(type) * DAY_MS)
            if (!(await visit({ start, end: Math.min(start + rollupDays(type) * DAY_MS, last) })))
              break;
          if (through !== undefined) through = Math.min(through, final);
        } else {
          for (let start = from; start < until; start += DAY_MS)
            if (!(await visit({ start, end: Math.min(start + DAY_MS, until) }))) break;
        }
        if (through !== undefined) next[type] = { through: Math.min(through, hold), at: until };
      }
      skipped += mapper.skipped;
      if (conflicts || mapper.warnings)
        onWarning(
          `Google Health resolved ${conflicts} conflicting duplicate point(s) deterministically and skipped ${mapper.warnings} unmappable record group(s).`,
        );
      ctx.progress({ label: "Done", done: TYPES.length, total: TYPES.length });
      return { cursor: serializeCursor(next), skipped: skipped || undefined };
    },
  };
}

const floorDay = (ms: number) => ms - (((ms % DAY_MS) + DAY_MS) % DAY_MS);
const iso = (ms: number) => new Date(ms).toISOString();

function serializeCursor(cursors: Partial<Record<HealthType, Cursor>>): string | undefined {
  const through: Partial<Record<HealthType, string>> = {};
  const fetchedAt: Partial<Record<HealthType, string>> = {};
  for (const type of TYPES) {
    const cursor = cursors[type];
    if (!cursor) continue;
    through[type] = iso(cursor.through);
    fetchedAt[type] = iso(cursor.at);
  }
  return JSON.stringify({ version: VERSION, cursors: through, fetchedAt });
}

/**
 * Version 3 records, per type, the end of the last written window and when it was read.
 * Versions 1 and 2 were written by the pre-v4-shape parser: "outdated" restarts every type
 * at the lookback window instead of trusting what they skipped.
 */
function parseCursor(
  value: string | undefined,
  until: number,
): Partial<Record<HealthType, Cursor>> | "outdated" {
  if (!value) return {};
  try {
    if (value.length > 4096) throw new Error();
    const json: unknown = JSON.parse(value);
    if (record(json) && (json.version === 1 || json.version === 2)) return "outdated";
    const known = (o: unknown): o is Record<string, unknown> =>
      record(o) && Object.keys(o).every((key) => TYPES.includes(key as HealthType));
    if (!record(json) || json.version !== VERSION || !known(json.cursors) || !known(json.fetchedAt))
      throw new Error();
    const fetchedAt = json.fetchedAt;
    const result: Partial<Record<HealthType, Cursor>> = {};
    for (const type of TYPES) {
      if (json.cursors[type] === undefined && fetchedAt[type] === undefined) continue;
      const through = timestamp(json.cursors[type]);
      const at = timestamp(fetchedAt[type]);
      if (!through || !at) throw new Error();
      const cursor = { through: Date.parse(through), at: Date.parse(at) };
      if (cursor.through > cursor.at || cursor.at > until) throw new Error();
      result[type] = cursor;
    }
    return result;
  } catch {
    throw new IntegrationSyncError(ID, "Invalid Google Health checkpoint; start a full import.");
  }
}
export const googleHealthAdapter = createGoogleHealthAdapter();
