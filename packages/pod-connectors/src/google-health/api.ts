// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Provider assumptions live here. Source: Google's Health REST v4 / scopes docs
 * (developers.google.com/health), supplied with sst-uqit CON-A4; no live verification.
 * Facts supplied: health.googleapis.com/v4; users/me/dataTypes/{kebab-case type}/
 * dataPoints[:reconcile]; pageSize/pageToken/filter/dataSourceFamily; dataPoints +
 * nextPageToken (absent or "" terminates); camelCase union payloads; interval/sample
 * times; optional users/{user}/dataTypes/{type}/dataPoints/{id} name. Reconcile
 * summary types, list sessions/samples. Google OAuth + offline PKCE; Fitbit tokens
 * cannot migrate. All Health scopes are Restricted.
 *
 * VERIFY against developers.google.com/health/scopes: category spellings below.
 * The supplied facts do not specify payload members, time member spellings, units,
 * exercise-session type or filter grammar. The deliberately narrow synthetic profile
 * below assumes startTime/endTime or time, steps.count, distance.meters,
 * calories.kilocalories, heartRate.beatsPerMinute, weight.kilograms,
 * sleep.stages[{startTime,endTime,stage}], exerciseSession.{activityName,distanceMeters}.
 * Filters assume `endTime >= "RFC3339"` for intervals, `time >= ...` for samples.
 * Unknown/malformed points are skipped and hold that type's checkpoint. No guessing
 * of units, local time zones, native Fitbit identifiers, or multi-day allocations.
 * Named resources retain API/name as identity/provenance only; these URLs are never fetched.
 */
import { type RunBudget, readJson } from "../core/budget.js";
import { IntegrationSyncError, RateLimitedError } from "../core/errors.js";
import { Pagination } from "../core/pagination.js";
import type { ImportContext } from "../core/types.js";

export const ID = "google-health";
export const API = "https://health.googleapis.com/v4";
/** The shared import session's source fallback, also used to recognise migrated records. */
export const SOURCE_ORIGIN = `${new URL(API).origin}/`;
// verify against developers.google.com/health/scopes before enabling a live client.
export const ACTIVITY_SCOPE =
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";
export const SLEEP_SCOPE = "https://www.googleapis.com/auth/googlehealth.sleep.readonly";
export const METRICS_SCOPE = "https://www.googleapis.com/auth/googlehealth.health_metrics.readonly";
export const BODY_SCOPE = "https://www.googleapis.com/auth/googlehealth.body_measurements.readonly";
export const GOOGLE_HEALTH_SCOPES = [
  ACTIVITY_SCOPE,
  SLEEP_SCOPE,
  METRICS_SCOPE,
  BODY_SCOPE,
] as const;
export const TYPES = [
  "steps",
  "distance",
  "calories",
  "exercise-session",
  "heart-rate",
  "sleep",
  "weight",
] as const;
export type HealthType = (typeof TYPES)[number];
export const OVERLAP_MS = 48 * 60 * 60 * 1000;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_PAGE_ITEMS = 1000;
export const MAX_STAGES = 500;
export const MAX_TOKEN_CHARS = 2048;
export const DEFAULT_LIMITS = { maxRequests: 1024, maxItems: 100_000, maxBytes: 64 * 1024 * 1024 };
export const summary = (type: HealthType): boolean =>
  ["steps", "distance", "calories"].includes(type);
export const endpoint = (type: HealthType): string =>
  `${API}/users/me/dataTypes/${type}/dataPoints${summary(type) ? ":reconcile" : ""}`;

/** Provider-independent records consumed by the pod mapping. */
export interface HealthPoint {
  type: HealthType;
  start: string;
  end: string;
  key: string;
  nativeId?: string;
  sourceUrl?: string;
  value?: number;
  activity?: string;
  distanceKm?: number;
  stages?: { start: string; end: string; label: string }[];
}
export const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export function timestamp(v: unknown): string | undefined {
  if (
    typeof v !== "string" ||
    v.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)
  )
    return undefined;
  const ms = Date.parse(v);
  const [year, month, day] = v.slice(0, 10).split("-").map(Number);
  const [hour, minute, second] = v.slice(11, 19).split(":").map(Number);
  if (
    !year ||
    !month ||
    !day ||
    (hour ?? 24) > 23 ||
    (minute ?? 60) > 59 ||
    (second ?? 60) > 59 ||
    new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== v.slice(0, 10)
  )
    return undefined;
  // Keep normalized dates within the fixed-width range used by cursor comparisons.
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const normalized = new Date(ms).toISOString();
  return normalized.length === 24 ? normalized : undefined;
}
const text = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 256 &&
  [...v].every((c) => {
    const n = c.codePointAt(0) ?? 0;
    return n >= 32 && (n < 0xd800 || n > 0xdfff);
  });
const number = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;

const RESOURCE_NAME =
  /^users\/[A-Za-z0-9_-]{1,128}\/dataTypes\/([a-z-]+)\/dataPoints\/([A-Za-z0-9_-]{1,128})$/;
/** Recognise a stored native identity without accepting arbitrary source URLs. */
export function nativeSource(value: string | undefined, type: HealthType): string | undefined {
  if (!value?.startsWith(`${API}/`) || value.length > API.length + 513) return undefined;
  const match = RESOURCE_NAME.exec(value.slice(API.length + 1));
  return match?.[1] === type ? value : undefined;
}

export function point(type: HealthType, raw: unknown): HealthPoint | undefined {
  if (!record(raw)) return undefined;
  const sample = type === "heart-rate" || type === "weight";
  const start = timestamp(sample ? raw.time : raw.startTime);
  const end = timestamp(sample ? raw.time : raw.endTime);
  if (!start || !end || end < start || (!sample && end === start)) return undefined;
  let nativeId: string | undefined;
  let sourceUrl: string | undefined;
  if (raw.name !== undefined && raw.name !== "") {
    if (typeof raw.name !== "string" || raw.name.length > 512) return undefined;
    const match = RESOURCE_NAME.exec(raw.name);
    if (!match || match[1] !== type) return undefined;
    nativeId = match[2];
    sourceUrl = `${API}/${raw.name}`;
  }
  const field =
    { "heart-rate": "heartRate", "exercise-session": "exerciseSession" }[
      type as "heart-rate" | "exercise-session"
    ] ?? type;
  const payload = raw[field];
  if (!record(payload)) return undefined;
  const result: HealthPoint = {
    type,
    start,
    end,
    nativeId,
    sourceUrl,
    key: `${type}-${start}-${end}`,
  };
  if (type === "exercise-session") {
    if (!text(payload.activityName)) return undefined;
    result.activity = payload.activityName;
    // Numeric resource suffixes are used verbatim ONLY when supplied, never inferred.
    result.key =
      nativeId && /^\d{1,32}$/.test(nativeId)
        ? nativeId
        : `google-health-exercise-${start}-${encodeURIComponent(payload.activityName)}`;
    if (payload.distanceMeters !== undefined) {
      if (!number(payload.distanceMeters, 1e9)) return undefined;
      result.distanceKm = payload.distanceMeters / 1000;
    }
  } else if (type === "sleep") {
    result.key = `sleep-${start}`;
    if (!Array.isArray(payload.stages) || payload.stages.length > MAX_STAGES) return undefined;
    const stages: NonNullable<HealthPoint["stages"]> = [];
    for (const stage of payload.stages) {
      if (!record(stage) || !text(stage.stage)) return undefined;
      const from = timestamp(stage.startTime),
        to = timestamp(stage.endTime);
      if (!from || !to || from < start || to > end || to <= from) return undefined;
      stages.push({ start: from, end: to, label: stage.stage });
    }
    stages.sort((a, b) => a.start.localeCompare(b.start));
    if (stages.some((s, i) => i > 0 && s.start < (stages[i - 1]?.end ?? ""))) return undefined;
    result.stages = stages;
  } else {
    const [member, max] = {
      steps: ["count", 1e9],
      distance: ["meters", 1e9],
      calories: ["kilocalories", 1e7],
      "heart-rate": ["beatsPerMinute", 1000],
      weight: ["kilograms", 2000],
    }[type] as [string, number];
    const value = payload[member];
    if (!number(value, max) || (type === "steps" && !Number.isSafeInteger(value))) return undefined;
    // Refuse intervals crossing a UTC day: no undocumented allocation rules.
    if (
      summary(type) &&
      start.slice(0, 10) !== new Date(Date.parse(end) - 1).toISOString().slice(0, 10)
    )
      return undefined;
    result.value = value;
  }
  return result;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

async function json(ctx: ImportContext, url: string, budget: RunBudget): Promise<unknown> {
  const resource = url.split("?", 1)[0] ?? API; // Never put opaque page tokens in diagnostics.
  for (let attempt = 0; ; attempt++) {
    ctx.signal?.throwIfAborted();
    budget.request();
    const res = await ctx.api(url, { signal: ctx.signal, redirect: "error" });
    if (res.ok) return readJson(res, ID, resource, MAX_PAGE_BYTES, budget);
    await res.body?.cancel();
    if (res.status === 429 || res.status >= 500) {
      const raw = res.headers.get("retry-after");
      const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
      const ms = seconds === undefined ? 1000 * 2 ** attempt : seconds * 1000;
      if (attempt < 3 && Number.isFinite(ms) && ms <= 60_000) {
        await delay(ms, ctx.signal);
        continue;
      }
      if (res.status === 429) throw new RateLimitedError(ID, resource, seconds);
    }
    throw new IntegrationSyncError(
      ID,
      `Google Health answered ${res.status}; checkpoint unchanged.`,
      { status: res.status },
    );
  }
}

export async function fetchPoints(
  ctx: ImportContext,
  type: HealthType,
  cursor: string | undefined,
  budget: RunBudget,
  maxPages: number,
  until: string,
): Promise<{ points: HealthPoint[]; skipped: number; latest?: string }> {
  const points = new Map<string, HealthPoint>();
  const pagination = new Pagination(ID);
  let token: string | undefined;
  let skipped = 0;
  let latest = cursor;
  let from = cursor
    ? new Date(Math.max(0, Date.parse(cursor) - OVERLAP_MS)).toISOString()
    : undefined;
  // Summaries need a complete UTC day when the overlap begins part-way through it.
  if (from && summary(type)) from = `${from.slice(0, 10)}T00:00:00.000Z`;
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(endpoint(type));
    url.searchParams.set("pageSize", String(MAX_PAGE_ITEMS));
    if (token) url.searchParams.set("pageToken", token);
    const time = type === "heart-rate" || type === "weight" ? "time" : "endTime";
    url.searchParams.set(
      "filter",
      `${from ? `${time} >= "${from}" AND ` : ""}${time} <= "${until}"`,
    );
    const raw = await json(ctx, url.href, budget);
    if (
      !record(raw) ||
      !Array.isArray(raw.dataPoints) ||
      raw.dataPoints.length > MAX_PAGE_ITEMS ||
      (raw.nextPageToken !== undefined &&
        (typeof raw.nextPageToken !== "string" || raw.nextPageToken.length > MAX_TOKEN_CHARS))
    )
      throw new IntegrationSyncError(ID, "Invalid Google Health page; checkpoint unchanged.");
    budget.items(raw.dataPoints.length);
    for (const value of raw.dataPoints) {
      const normalized = point(type, value);
      // An inclusive end filter can return the previous day's final interval.
      // Do not replace that day's full total using this boundary fragment alone.
      if (normalized && from && summary(type) && normalized.start < from) continue;
      if (!normalized || normalized.end > until || (from && normalized.end < from)) {
        skipped++;
        continue;
      }
      budget.items(normalized.stages?.length ?? 0);
      const previous = points.get(normalized.key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(normalized))
        throw new IntegrationSyncError(
          ID,
          "Conflicting Google Health points; checkpoint unchanged.",
        );
      points.set(normalized.key, normalized);
      if (!latest || normalized.end > latest) latest = normalized.end;
    }
    if (!raw.nextPageToken)
      return { points: [...points.values()], skipped, latest: skipped ? cursor : latest };
    token = pagination.next(raw.nextPageToken as string);
  }
  throw new IntegrationSyncError(ID, "Google Health exceeded its page cap; checkpoint unchanged.");
}
