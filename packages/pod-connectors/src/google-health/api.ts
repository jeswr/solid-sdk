// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
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
 * VERIFY against https://developers.google.com/health/scopes (unreachable from the
 * authoring sandbox; confirmed on 2026-11-12 only through search-result extracts of that
 * page and developers.google.cn/health/scopes): every scope is the
 * `https://www.googleapis.com/auth/googlehealth` prefix plus `.<category>.readonly|writeonly`,
 * with categories `activity_and_fitness`, `health_metrics_and_measurements`, `sleep` and
 * `nutrition`. Access tokens carry only the scopes the user consented to. Nutrition is not
 * imported, so it is not requested.
 *
 * The supplied facts do not specify payload members, time member spellings, units,
 * exercise-session type or filter grammar. The deliberately narrow synthetic profile
 * below assumes startTime/endTime or time, steps.count, distance.meters,
 * calories.kilocalories, heartRate.beatsPerMinute, weight.kilograms,
 * sleep.stages[{startTime,endTime,stage}], exerciseSession.{activityName,distanceMeters},
 * an optional `dataSource` object and an optional `updateTime`. RFC 3339 times keep the
 * provider's own UTC offset; a daily summary's civil date is its start date in that offset.
 * Search extracts of the v4 reference suggest real points nest times (for example
 * `sampleTime.physicalTime`, `civilTime`, `utcOffset`) and describe `dataSource` with
 * `recordingMethod`, `device`, `application` and `platform`; VERIFY before a live client.
 * Filters assume `endTime > "A" AND endTime <= "B"` for intervals and
 * `time >= "A" AND time < "B"` for samples: one UTC day per request window.
 * Permanently invalid points are skipped. No guessing of units, native Fitbit identifiers,
 * or multi-day allocations. Named resources retain API/name as identity/provenance only;
 * these URLs are never fetched.
 */
import { type RunBudget, readJson } from "../core/budget.js";
import { IntegrationAuthError, IntegrationSyncError, RateLimitedError } from "../core/errors.js";
import { Pagination } from "../core/pagination.js";
import type { ImportContext } from "../core/types.js";

export const ID = "google-health";
export const API = "https://health.googleapis.com/v4";
/** The shared import session's source fallback, also used to recognise migrated records. */
export const SOURCE_ORIGIN = `${new URL(API).origin}/`;
const SCOPE_PREFIX = "https://www.googleapis.com/auth/googlehealth";
/** Steps, distance, calories and exercise sessions. */
export const ACTIVITY_SCOPE = `${SCOPE_PREFIX}.activity_and_fitness.readonly`;
/** Sleep sessions and stages. */
export const SLEEP_SCOPE = `${SCOPE_PREFIX}.sleep.readonly`;
/** Heart rate and weight. */
export const METRICS_SCOPE = `${SCOPE_PREFIX}.health_metrics_and_measurements.readonly`;
export const GOOGLE_HEALTH_SCOPES = [ACTIVITY_SCOPE, SLEEP_SCOPE, METRICS_SCOPE] as const;
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
export const DAY_MS = 24 * 60 * 60 * 1000;
export const OVERLAP_MS = 48 * 60 * 60 * 1000;
/** Largest civil UTC offset the provider may render (UTC-12 … UTC+14). */
export const MAX_OFFSET_MS = 14 * 60 * 60 * 1000;
export const DEFAULT_LOOKBACK_DAYS = 30;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_PAGE_ITEMS = 1000;
export const MAX_STAGES = 500;
export const MAX_TOKEN_CHARS = 2048;
/** Per data type, per run. Exceeding it ends that type at its last fully written day. */
export const DEFAULT_LIMITS = { maxRequests: 512, maxItems: 250_000, maxBytes: 128 * 1024 * 1024 };
/** Whole run, across all types. Exceeding it ends the run at the last fully written day. */
export const DEFAULT_RUN_LIMITS = {
  maxRequests: 2048,
  maxItems: 1_000_000,
  maxBytes: 512 * 1024 * 1024,
};
export const summary = (type: HealthType): boolean =>
  ["steps", "distance", "calories"].includes(type);
export const sample = (type: HealthType): boolean => type === "heart-rate" || type === "weight";
export const endpoint = (type: HealthType): string =>
  `${API}/users/me/dataTypes/${type}/dataPoints${summary(type) ? ":reconcile" : ""}`;

/** Provider-independent records consumed by the pod mapping. */
export interface HealthPoint {
  type: HealthType;
  start: string;
  end: string;
  key: string;
  /** Canonical data-source identity (dataSource object, else resource name, else ""). */
  source: string;
  updateTime?: string;
  nativeId?: string;
  sourceUrl?: string;
  value?: number;
  activity?: string;
  distanceKm?: number;
  /** Start wall-clock time in the provider's offset, rendered with a Z suffix (Fitbit's legacy form). */
  wallStart?: string;
  /** Summary types: civil date (YYYY-MM-DD) in the provider's offset, and that date's UTC span. */
  civilDate?: string;
  civilStart?: number;
  civilEnd?: number;
  stages?: { start: string; end: string; label: string }[];
}
export const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
export function timestamp(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > 40) return undefined;
  const match = RFC3339.exec(v);
  if (!match) return undefined;
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
  const offset = match[1] as string;
  if (offset !== "Z") {
    const [h, m] = offset.slice(1).split(":").map(Number);
    if ((h ?? 99) * 60 + (m ?? 99) > MAX_OFFSET_MS / 60_000 || (m ?? 60) > 59) return undefined;
  }
  // Keep normalized dates within the fixed-width range used by cursor comparisons.
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const normalized = new Date(ms).toISOString();
  return normalized.length === 24 ? normalized : undefined;
}
/** The provider's own offset of a validated RFC 3339 string, as `±HH:MM`. */
function offsetOf(v: string): string {
  const offset = RFC3339.exec(v)?.[1] ?? "Z";
  return offset === "Z" ? "+00:00" : offset;
}
/** Local wall-clock time of a validated RFC 3339 string, re-labelled as UTC. */
function wallClock(v: string): string | undefined {
  return timestamp(v.replace(/(?:Z|[+-]\d{2}:\d{2})$/, "Z"));
}
const text = (v: unknown, max = 256): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  [...v].every((c) => {
    const n = c.codePointAt(0) ?? 0;
    return n >= 32 && (n < 0xd800 || n > 0xdfff);
  });
const number = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;

const MAX_SOURCE_CHARS = 1024;
/**
 * Canonical, bounded identity of a point's `dataSource` object: its scalar leaves (two
 * levels deep) in sorted key order. Undefined when the member is malformed.
 */
function dataSourceKey(value: unknown): string | undefined {
  if (!record(value)) return undefined;
  const parts: string[] = [];
  const visit = (node: Record<string, unknown>, prefix: string, depth: number): boolean => {
    const keys = Object.keys(node).sort();
    if (keys.length > 32) return false;
    for (const key of keys) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) return false;
      const leaf = node[key];
      if (typeof leaf === "string" || typeof leaf === "number" || typeof leaf === "boolean") {
        if (typeof leaf === "string" && leaf.length > 256) return false;
        parts.push(`${prefix}${key}=${JSON.stringify(leaf)}`);
      } else if (record(leaf) && depth < 2) {
        if (!visit(leaf, `${prefix}${key}.`, depth + 1)) return false;
      } else if (leaf !== null && leaf !== undefined) return false;
    }
    return true;
  };
  if (!visit(value, "", 1)) return undefined;
  const key = parts.join(";");
  return key.length <= MAX_SOURCE_CHARS ? key : undefined;
}
/** Short deterministic IRI-safe token for a source identity (FNV-1a, 2 × 32 bits). */
export function sourceToken(source: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ source.length;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000197);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

const RESOURCE_NAME =
  /^users\/[A-Za-z0-9_-]{1,128}\/dataTypes\/([a-z-]+)\/dataPoints\/([A-Za-z0-9_-]{1,128})$/;
/** Recognise a stored native identity without accepting arbitrary source URLs. */
export function nativeSource(value: string | undefined, type: HealthType): string | undefined {
  if (!value?.startsWith(`${API}/`) || value.length > API.length + 513) return undefined;
  const match = RESOURCE_NAME.exec(value.slice(API.length + 1));
  return match?.[1] === type ? value : undefined;
}

/** Normalise one provider point; undefined means permanently invalid (skipped). */
export function point(type: HealthType, raw: unknown): HealthPoint | undefined {
  if (!record(raw)) return undefined;
  const isSample = sample(type);
  const rawStart = isSample ? raw.time : raw.startTime;
  const start = timestamp(rawStart);
  const end = timestamp(isSample ? raw.time : raw.endTime);
  if (!start || !end || end < start || (!isSample && end === start)) return undefined;
  let nativeId: string | undefined;
  let sourceUrl: string | undefined;
  if (raw.name !== undefined && raw.name !== "") {
    if (typeof raw.name !== "string" || raw.name.length > 512) return undefined;
    const match = RESOURCE_NAME.exec(raw.name);
    if (!match || match[1] !== type) return undefined;
    nativeId = match[2];
    sourceUrl = `${API}/${raw.name}`;
  }
  let source = "";
  if (raw.dataSource !== undefined) {
    const key = dataSourceKey(raw.dataSource);
    if (key === undefined) return undefined;
    source = key;
  } else if (sourceUrl) source = `name=${raw.name as string}`;
  let updateTime: string | undefined;
  if (raw.updateTime !== undefined) {
    updateTime = timestamp(raw.updateTime);
    if (!updateTime) return undefined;
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
    source,
    updateTime,
    nativeId,
    sourceUrl,
    key: `${type}-${start}-${end}-${sourceToken(source)}`,
  };
  if (type === "exercise-session") {
    if (!text(payload.activityName)) return undefined;
    result.activity = payload.activityName;
    result.wallStart = wallClock(rawStart as string);
    // Numeric resource suffixes keep the legacy Fitbit key ONLY when supplied, never inferred;
    // other resource names key the session so a revision updates in place.
    result.key =
      nativeId && /^\d{1,32}$/.test(nativeId)
        ? nativeId
        : nativeId
          ? `google-health-exercise-${nativeId}`
          : `google-health-exercise-${start}-${encodeURIComponent(payload.activityName)}`;
    if (payload.distanceMeters !== undefined) {
      if (!number(payload.distanceMeters, 1e9)) return undefined;
      result.distanceKm = payload.distanceMeters / 1000;
    }
  } else if (type === "sleep") {
    result.key = nativeId ? `sleep-${nativeId}` : `sleep-${start}`;
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
    if (summary(type)) {
      // A civil date in the provider's own offset; intervals crossing its midnight are refused
      // (no undocumented allocation rules).
      const date = (rawStart as string).slice(0, 10);
      const offset = offsetOf(rawStart as string);
      const civilStart = Date.parse(`${date}T00:00:00${offset}`);
      const next = new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
      const civilEnd = Date.parse(`${next}T00:00:00${offset}`);
      if (!Number.isFinite(civilStart) || !Number.isFinite(civilEnd)) return undefined;
      if (Date.parse(end) > civilEnd) return undefined;
      Object.assign(result, { civilDate: date, civilStart, civilEnd });
    }
    result.value = value;
  }
  return result;
}

/** Civil date of a summary point that failed validation, when its start is still legible. */
export function civilDateOf(raw: unknown): string | undefined {
  if (!record(raw)) return undefined;
  return timestamp(raw.startTime) ? (raw.startTime as string).slice(0, 10) : undefined;
}

/**
 * Deterministic winner between two different points sharing a key from one source: the
 * latest update time, then the larger value, then the larger canonical serialisation.
 */
export function preferred(a: HealthPoint, b: HealthPoint): HealthPoint {
  if ((a.updateTime ?? "") !== (b.updateTime ?? ""))
    return (a.updateTime ?? "") > (b.updateTime ?? "") ? a : b;
  if ((a.value ?? -1) !== (b.value ?? -1)) return (a.value ?? -1) > (b.value ?? -1) ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
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

const REAUTHORIZE =
  "Re-authorize Google Health with all requested read permissions; the checkpoint is unchanged.";

async function json(ctx: ImportContext, url: string, budget: RunBudget): Promise<unknown> {
  const resource = url.split("?", 1)[0] ?? API; // Never put opaque page tokens in diagnostics.
  for (let attempt = 0; ; attempt++) {
    ctx.signal?.throwIfAborted();
    budget.request();
    const res = await ctx.api(url, { signal: ctx.signal, redirect: "error" });
    if (res.ok) return readJson(res, ID, resource, MAX_PAGE_BYTES, budget);
    await res.body?.cancel();
    // The host transport has already refreshed once on 401; a second 401 or any 403
    // (withheld scope, unapproved Restricted access) needs the user to authorize again.
    if (res.status === 401)
      throw new IntegrationAuthError(
        ID,
        "exchange-failed",
        `Google Health rejected the authorization (401). ${REAUTHORIZE}`,
      );
    if (res.status === 403)
      throw new IntegrationAuthError(
        ID,
        "exchange-failed",
        `Google Health denied access (403). ${REAUTHORIZE}`,
      );
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

/** One request window: [start, end) in epoch ms, at most one UTC day. */
export interface Window {
  readonly start: number;
  readonly end: number;
}

export interface WindowBatch {
  /** Valid, de-duplicated points belonging to this window. */
  points: HealthPoint[];
  /** Permanently invalid points (the cursor still advances past them). */
  skipped: number;
  /** Points ending after the run's upper bound: hold the type cursor at this window. */
  transient: boolean;
  /** Same-key, same-source points with different contents resolved deterministically. */
  conflicts: number;
  /** Summary civil dates with an invalid point; `all` when one could not be attributed. */
  tainted: Set<string>;
  taintedAll: boolean;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Fetch every page of one window, validating each envelope and point before any write. */
export async function fetchWindow(
  ctx: ImportContext,
  type: HealthType,
  window: Window,
  budget: RunBudget,
  maxPages: number,
  until: number,
): Promise<WindowBatch> {
  const points = new Map<string, HealthPoint>();
  const pagination = new Pagination(ID);
  const batch: WindowBatch = {
    points: [],
    skipped: 0,
    transient: false,
    conflicts: 0,
    tainted: new Set(),
    taintedAll: false,
  };
  const filter = sample(type)
    ? `time >= "${iso(window.start)}" AND time < "${iso(window.end)}"`
    : `endTime > "${iso(window.start)}" AND endTime <= "${iso(window.end)}"`;
  let token: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(endpoint(type));
    url.searchParams.set("pageSize", String(MAX_PAGE_ITEMS));
    if (token) url.searchParams.set("pageToken", token);
    url.searchParams.set("filter", filter);
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
      if (!normalized) {
        batch.skipped++;
        if (summary(type)) {
          const date = civilDateOf(value);
          if (date) batch.tainted.add(date);
          else batch.taintedAll = true;
        }
        continue;
      }
      const at = Date.parse(sample(type) ? normalized.start : normalized.end);
      const inWindow = sample(type)
        ? at >= window.start && at < window.end
        : at > window.start && at <= window.end;
      if (!inWindow) {
        // A point the provider will still revise or has not finished: retry it next run.
        if (Date.parse(normalized.end) > until) {
          batch.transient = true;
          batch.skipped++;
        }
        // Otherwise it belongs to another window, which owns it.
        continue;
      }
      budget.items(normalized.stages?.length ?? 0);
      const previous = points.get(normalized.key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) {
        batch.conflicts++;
        points.set(normalized.key, preferred(previous, normalized));
      } else points.set(normalized.key, normalized);
    }
    if (!raw.nextPageToken) {
      batch.points = [...points.values()];
      return batch;
    }
    token = pagination.next(raw.nextPageToken as string);
  }
  throw new IntegrationSyncError(
    ID,
    `Google Health exceeded its page cap for one day of ${type}; checkpoint unchanged.`,
  );
}
