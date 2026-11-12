// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
/**
 * Every Google Health provider assumption lives here. Source of record: the Google Health
 * API v4 discovery document (`https://health.googleapis.com/$discovery/rest?version=v4`,
 * revision 20261110, read on 2026-11-12), which carries the reference text of
 * developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints (that site was
 * unreachable from the authoring sandbox). Facts used, quoted from that document:
 *
 * - Methods: `list` GET `v4/{parent}/dataPoints`, `dailyRollUp` POST
 *   `v4/{parent}/dataPoints:dailyRollUp` ("Roll up data points over civil time intervals");
 *   parent `users/me/dataTypes/{data_type}`. `list` takes `filter`, `pageSize`, `pageToken`.
 *   "The maximum page size is 10000 … The maximum page size for `exercise` and `sleep` is
 *   25." Responses: `dataPoints` + `nextPageToken` ("empty if the response is complete");
 *   `rollupDataPoints` + `nextPageToken` ("If this field is omitted, there are no subsequent
 *   pages"). Points are "ordered by the interval start time in descending order".
 * - Filters (AIP-160, `>=` and `<`, `AND`): `{sample_data_type}.sample_time.physical_time`
 *   (RFC 3339); `{session_data_type}.interval.civil_start_time` "Excluding Sleep and ECG"
 *   (ISO 8601 `YYYY-MM-DD[THH:mm:ss]`, no zone); sleep only `sleep.interval.end_time`
 *   (RFC 3339) or `sleep.interval.civil_end_time`. Physical and civil bounds are never mixed.
 * - dailyRollUp request: `range` CivilTimeInterval {start, end: CivilDateTime} (closed-open),
 *   `windowSizeDays` (default 1), `pageSize` ("maximum page size is `90`. For … `total-calories`,
 *   the default and maximum page size is `14`"); maximum range 14 days for `total-calories`,
 *   90 days otherwise. Each DailyRollupDataPoint has `civilStartTime`, `civilEndTime` and one
 *   value: `steps.countSum` (int64), `distance.millimetersSum` (int64),
 *   `totalCalories.kcalSum` (double). `total-calories` exists only as a rollup.
 * - DataPoint: optional `name` `users/{user}/dataTypes/{data_type}/dataPoints/{data_point}`,
 *   optional `dataSource` {platform, recordingMethod, device{formFactor, manufacturer,
 *   displayName}, application{packageName, webClientId, googleWebClientId}}, and one payload
 *   member: `heartRate` {sampleTime, beatsPerMinute int64 "[1, 300]"}, `weight` {sampleTime,
 *   weightGrams double "[0, 1000000]"}, `exercise` {interval (SessionTimeInterval),
 *   exerciseType enum, displayName ("generated name based on `exercise_type` (e.g.
 *   \"Walking\" for `WALKING`)"), metricsSummary {distanceMillimeters double, …},
 *   updateTime}, `sleep` {interval, stages[{type enum AWAKE|LIGHT|DEEP|REM|ASLEEP|RESTLESS,
 *   startTime, endTime, startUtcOffset, endUtcOffset}], metadata{processed, …}, updateTime}.
 * - ObservationSampleTime {physicalTime, utcOffset (Duration), civilTime (output only)};
 *   SessionTimeInterval {startTime, endTime, startUtcOffset, endUtcOffset, civilStartTime,
 *   civilEndTime}; CivilDateTime {date{year, month, day}, time{hours, minutes, seconds,
 *   nanos}}. int64 fields are JSON strings (proto3 JSON); Durations are strings like "-18000s".
 * - Scopes: `https://www.googleapis.com/auth/googlehealth.{activity_and_fitness,sleep,
 *   health_metrics_and_measurements}.readonly`, all listed by the document's oauth2 section.
 *
 * VERIFY (not stated by that document, so handled conservatively):
 * - A UTC offset or zero-valued field may be omitted as proto3 JSON omits defaults: a
 *   missing offset counts as UTC and a rollup value member without its field counts as 0.
 * - Real-world civil offsets stay within UTC-14…UTC+14 (DateTime allows ±18 h); larger
 *   offsets are refused as invalid values.
 * - The generated `displayName` strings (other than "Walking") are not enumerated, so legacy
 *   Fitbit rows (`activityName`, e.g. "Run") match only when the strings are equal.
 * - A dailyRollUp range may end on a civil date that has not started for the user yet.
 * - Rate-limit 403s carry the Google API error reasons `rateLimitExceeded`,
 *   `userRateLimitExceeded`, `quotaExceeded`, `dailyLimitExceeded`, `RATE_LIMIT_EXCEEDED`
 *   or status `RESOURCE_EXHAUSTED` (Google API error conventions, not the Health reference).
 *
 * Fitbit tokens cannot migrate; nutrition is not imported, so it is not requested.
 * Named resources retain API/name as identity/provenance only; they are never fetched.
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
/** Steps, distance, total calories, heart rate and exercise. */
export const ACTIVITY_SCOPE = `${SCOPE_PREFIX}.activity_and_fitness.readonly`;
/** Sleep sessions and stages. */
export const SLEEP_SCOPE = `${SCOPE_PREFIX}.sleep.readonly`;
/** Weight. */
export const METRICS_SCOPE = `${SCOPE_PREFIX}.health_metrics_and_measurements.readonly`;
export const GOOGLE_HEALTH_SCOPES = [ACTIVITY_SCOPE, SLEEP_SCOPE, METRICS_SCOPE] as const;
/** The v4 data type ids this adapter imports (URL path segments). */
export const TYPES = [
  "steps",
  "distance",
  "total-calories",
  "exercise",
  "heart-rate",
  "sleep",
  "weight",
] as const;
export type HealthType = (typeof TYPES)[number];
export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const OVERLAP_MS = 48 * HOUR_MS;
/** Largest civil UTC offset accepted (UTC-14 … UTC+14). */
export const MAX_OFFSET_MS = 14 * HOUR_MS;
export const DEFAULT_LOOKBACK_DAYS = 30;
export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** List page size requested for sample types (documented maximum 10,000). */
export const MAX_PAGE_ITEMS = 1000;
export const MAX_STAGES = 500;
export const MAX_TOKEN_CHARS = 2048;
/** Per data type, per run. Exceeding it ends that type at its last fully written window. */
export const DEFAULT_LIMITS = { maxRequests: 512, maxItems: 250_000, maxBytes: 128 * 1024 * 1024 };
/** Whole run, across all types. Exceeding it ends the run at the last fully written window. */
export const DEFAULT_RUN_LIMITS = {
  maxRequests: 2048,
  maxItems: 1_000_000,
  maxBytes: 512 * 1024 * 1024,
};
/** Daily totals come from dailyRollUp; everything else is listed. */
export const summary = (type: HealthType): boolean =>
  type === "steps" || type === "distance" || type === "total-calories";
export const sample = (type: HealthType): boolean => type === "heart-rate" || type === "weight";
/** The documented page size: 25 for sessions, 14/90 for rollups, ours for samples. */
export const pageSize = (type: HealthType): number =>
  type === "exercise" || type === "sleep"
    ? 25
    : type === "total-calories"
      ? 14
      : summary(type)
        ? 90
        : MAX_PAGE_ITEMS;
/** Longest dailyRollUp range, in days. */
export const rollupDays = (type: HealthType): number => (type === "total-calories" ? 14 : 90);
export const endpoint = (type: HealthType): string =>
  `${API}/users/me/dataTypes/${type}/dataPoints${summary(type) ? ":dailyRollUp" : ""}`;
/** The only non-GET request the transport forwards: a read-only civil-day rollup query. */
export const ROLLUP_PATH =
  /^\/v4\/users\/me\/dataTypes\/(?:steps|distance|total-calories)\/dataPoints:dailyRollUp$/;
const PAYLOAD: Record<HealthType, string> = {
  steps: "steps",
  distance: "distance",
  "total-calories": "totalCalories",
  exercise: "exercise",
  "heart-rate": "heartRate",
  sleep: "sleep",
  weight: "weight",
};

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
  /** Exercise display name (the label Fitbit stored as `activityName`). */
  activity?: string;
  /** Exercise `exerciseType` enum value. */
  exerciseType?: string;
  distanceKm?: number;
  /** Start wall-clock time in the user's offset, rendered with a Z suffix (Fitbit's legacy form). */
  wallStart?: string;
  /** Sleep whose stages Google is still processing (`metadata.processed` false). */
  pending?: boolean;
  stages?: { start: string; end: string; label: string }[];
}
/** One civil day's rolled-up total. */
export interface DailyTotal {
  type: HealthType;
  /** Civil date, YYYY-MM-DD. */
  date: string;
  value: number;
}

export const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Why a provider value was refused: an unrecognised shape, or a recognised but invalid value. */
export type Invalid = "shape" | "value";
class Refusal {
  constructor(readonly reason: Invalid) {}
}
const shape = (): never => {
  throw new Refusal("shape");
};
const refuse = (): never => {
  throw new Refusal("value");
};

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/;
/** A validated RFC 3339 instant, normalised to UTC with millisecond precision. */
export function timestamp(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > 40) return undefined;
  const m = RFC3339.exec(v);
  if (!m) return undefined;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as number[];
  if (
    !validDate(year as number, month as number, day as number) ||
    (hour as number) > 23 ||
    (minute as number) > 59 ||
    (second as number) > 59
  )
    return undefined;
  if (m[8] !== "Z") {
    const h = Number(m[9]),
      min = Number(m[10]);
    if (min > 59 || h * 60 + min > MAX_OFFSET_MS / 60_000) return undefined;
  }
  // Date.parse reads at most millisecond precision; nanosecond inputs are truncated.
  const ms = Date.parse(`${v.slice(0, 19)}.${(m[7] ?? "").padEnd(3, "0").slice(0, 3)}${m[8]}`);
  // Keep normalized dates within the fixed-width range used by cursor comparisons.
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const normalized = new Date(ms).toISOString();
  return normalized.length === 24 ? normalized : undefined;
}
function validDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** A required RFC 3339 instant: not a string or not RFC 3339 is an unrecognised shape. */
function instant(v: unknown): string {
  if (typeof v !== "string") return shape();
  const result = timestamp(v);
  if (result) return result;
  return RFC3339.test(v) ? refuse() : shape();
}
/** A Duration UTC offset ("-18000s") in ms; absent counts as UTC (VERIFY, see above). */
function utcOffset(v: unknown): number {
  if (v === undefined) return 0;
  if (typeof v !== "string" || !/^-?\d{1,6}(?:\.0{1,9})?s$/.test(v)) return shape();
  const ms = Number.parseInt(v, 10) * 1000;
  if (Math.abs(ms) > MAX_OFFSET_MS) return refuse();
  return ms === 0 ? 0 : ms;
}
/** A non-negative int64 sent as a JSON number or a bounded decimal digit string. */
function int64(v: unknown, min: number, max: number): number {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^(?:0|[1-9]\d{0,15})$/.test(v)) n = Number(v);
  else if (typeof v === "string" && /^-[1-9]\d{0,15}$/.test(v)) return refuse();
  else return shape();
  if (!Number.isSafeInteger(n) || n < min || n > max) return refuse();
  return n;
}
/** A double sent as a finite JSON number or a plain decimal string (no NaN/Infinity/exponent). */
function double(v: unknown, min: number, max: number): number {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^-?\d{1,16}(?:\.\d{1,16})?$/.test(v)) n = Number(v);
  else return shape();
  if (!Number.isFinite(n) || n < min || n > max) return refuse();
  return n;
}
const int32 = (v: unknown, min: number, max: number): number => {
  if (v === undefined) return 0; // proto3 JSON omits zero-valued fields.
  if (typeof v !== "number" || !Number.isInteger(v)) return shape();
  return v < min || v > max ? refuse() : v;
};
/** CivilDateTime → { date YYYY-MM-DD, wall YYYY-MM-DDTHH:mm:ss.sssZ }; undefined when absent. */
function civilDateTime(v: unknown): { date: string; wall: string } | undefined {
  if (v === undefined) return undefined;
  if (!record(v) || !record(v.date)) return shape();
  const d = v.date as Record<string, unknown>;
  const year = int32(d.year, 0, 9999),
    month = int32(d.month, 0, 12),
    day = int32(d.day, 0, 31);
  if (!validDate(year, month, day)) return refuse();
  if (v.time !== undefined && !record(v.time)) return shape();
  const t = (v.time ?? {}) as Record<string, unknown>;
  const hours = int32(t.hours, 0, 23),
    minutes = int32(t.minutes, 0, 59),
    seconds = int32(t.seconds, 0, 59),
    nanos = int32(t.nanos, 0, 999_999_999);
  const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  return {
    date,
    wall: `${date}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(Math.floor(nanos / 1e6), 3)}Z`,
  };
}
/** Wall clock from civil time, else from the physical instant plus its UTC offset. */
const wallClock = (physical: string, offset: number, civil?: { wall: string }): string =>
  civil?.wall ?? new Date(Date.parse(physical) + offset).toISOString();

const text = (v: unknown, max = 256): string => {
  if (typeof v !== "string") return shape();
  const ok =
    v.length > 0 &&
    v.length <= max &&
    [...v].every((c) => {
      const n = c.codePointAt(0) ?? 0;
      return n >= 32 && (n < 0xd800 || n > 0xdfff);
    });
  return ok ? v : refuse();
};
const ENUM = /^[A-Z][A-Z0-9_]{0,63}$/;
const SLEEP_STAGES = new Set(["AWAKE", "LIGHT", "DEEP", "REM", "ASLEEP", "RESTLESS"]);

const MAX_SOURCE_CHARS = 1024;
/**
 * Canonical, bounded identity of a point's `dataSource` object: its scalar leaves (two
 * levels deep) in sorted key order. Undefined when the member is malformed.
 */
function dataSourceKey(value: Record<string, unknown>): string | undefined {
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

/** Normalise one listed DataPoint, or say why it was refused. */
export function parsePoint(type: HealthType, raw: unknown): HealthPoint | Invalid {
  try {
    return parse(type, raw);
  } catch (error) {
    if (error instanceof Refusal) return error.reason;
    throw error;
  }
}
/** Normalise one listed DataPoint; undefined means it was refused. */
export function point(type: HealthType, raw: unknown): HealthPoint | undefined {
  const result = parsePoint(type, raw);
  return typeof result === "string" ? undefined : result;
}

function parse(type: HealthType, raw: unknown): HealthPoint {
  if (summary(type) || !record(raw)) return shape();
  const payload = raw[PAYLOAD[type]];
  if (!record(payload)) return shape();
  let nativeId: string | undefined;
  let sourceUrl: string | undefined;
  if (raw.name !== undefined && raw.name !== "") {
    if (typeof raw.name !== "string") return shape();
    const match = raw.name.length <= 512 ? RESOURCE_NAME.exec(raw.name) : null;
    if (!match || match[1] !== type) return refuse();
    nativeId = match[2];
    sourceUrl = `${API}/${raw.name}`;
  }
  let source = "";
  if (raw.dataSource !== undefined) {
    if (!record(raw.dataSource)) return shape();
    source = dataSourceKey(raw.dataSource) ?? refuse();
  } else if (sourceUrl) source = `name=${raw.name as string}`;
  const updateTime = payload.updateTime === undefined ? undefined : instant(payload.updateTime);

  if (sample(type)) {
    const st = payload.sampleTime;
    if (!record(st)) return shape();
    const start = instant(st.physicalTime);
    utcOffset(st.utcOffset);
    civilDateTime(st.civilTime);
    const value =
      type === "heart-rate"
        ? int64(payload.beatsPerMinute, 1, 300)
        : double(payload.weightGrams, Number.MIN_VALUE, 1_000_000) / 1000;
    return {
      type,
      start,
      end: start,
      source,
      updateTime,
      nativeId,
      sourceUrl,
      value,
      key: `${type}-${start}-${start}-${sourceToken(source)}`,
    };
  }

  const iv = payload.interval;
  if (!record(iv)) return shape();
  const start = instant(iv.startTime);
  const end = instant(iv.endTime);
  const startOffset = utcOffset(iv.startUtcOffset);
  utcOffset(iv.endUtcOffset);
  const civilStart = civilDateTime(iv.civilStartTime);
  civilDateTime(iv.civilEndTime);
  if (end <= start) return refuse();
  const base = { type, start, end, source, updateTime, nativeId, sourceUrl };

  if (type === "exercise") {
    const activity = text(payload.displayName);
    if (typeof payload.exerciseType !== "string") return shape();
    const exerciseType = ENUM.test(payload.exerciseType) ? payload.exerciseType : refuse();
    let distanceKm: number | undefined;
    if (payload.metricsSummary !== undefined) {
      if (!record(payload.metricsSummary)) return shape();
      const mm = payload.metricsSummary.distanceMillimeters;
      if (mm !== undefined) distanceKm = double(mm, 0, 1e12) / 1e6;
    }
    return {
      ...base,
      activity,
      exerciseType,
      distanceKm,
      wallStart: wallClock(start, startOffset, civilStart),
      // A named session updates in place; a nameless one is keyed by its start and type enum
      // (displayName is localized). Numeric names are never assumed to be Fitbit logIds.
      key: nativeId
        ? `google-health-exercise-${nativeId}`
        : `google-health-exercise-${start}-${exerciseType}`,
    };
  }

  // Sleep.
  if (payload.stages !== undefined && !Array.isArray(payload.stages)) return shape();
  const rawStages = (payload.stages ?? []) as unknown[];
  if (rawStages.length > MAX_STAGES) return refuse();
  const stages: NonNullable<HealthPoint["stages"]> = [];
  for (const stage of rawStages) {
    if (!record(stage) || typeof stage.type !== "string") return shape();
    const from = instant(stage.startTime);
    const to = instant(stage.endTime);
    utcOffset(stage.startUtcOffset);
    utcOffset(stage.endUtcOffset);
    if (!SLEEP_STAGES.has(stage.type) || from < start || to > end || to <= from) return refuse();
    stages.push({ start: from, end: to, label: stage.type.toLowerCase() });
  }
  stages.sort((a, b) => a.start.localeCompare(b.start));
  if (stages.some((s, i) => i > 0 && s.start < (stages[i - 1]?.end ?? ""))) return refuse();
  if (payload.metadata !== undefined && !record(payload.metadata)) return shape();
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  if (metadata.processed !== undefined && typeof metadata.processed !== "boolean") return shape();
  return {
    ...base,
    stages,
    pending: metadata.processed === false,
    key: nativeId ? `sleep-${nativeId}` : `sleep-${start}`,
  };
}

/**
 * Normalise one DailyRollupDataPoint. `null` is a documented no-data day (no value member:
 * "missing days are not zeros"); otherwise the total or the refusal reason.
 */
export function parseRollup(type: HealthType, raw: unknown): DailyTotal | Invalid | null {
  try {
    if (!summary(type) || !record(raw)) return shape();
    const start = civilDateTime(raw.civilStartTime) ?? shape();
    const end = civilDateTime(raw.civilEndTime);
    const next = new Date(Date.parse(`${start.date}T00:00:00Z`) + DAY_MS).toISOString();
    // One-day windows only: a bucket covering another span is not one civil day's total.
    if (start.wall !== `${start.date}T00:00:00.000Z` || (end && end.wall !== next)) refuse();
    const member = raw[PAYLOAD[type]];
    if (member === undefined) return null;
    if (!record(member)) return shape();
    const value =
      type === "steps"
        ? int64(member.countSum ?? 0, 0, 1e9)
        : type === "distance"
          ? int64(member.millimetersSum ?? 0, 0, 1e12) / 1000
          : double(member.kcalSum ?? 0, 0, 1e7);
    return { type, date: start.date, value };
  } catch (error) {
    if (error instanceof Refusal) return error.reason;
    throw error;
  }
}

/**
 * Deterministic winner between two different points sharing a key from one source: the
 * latest update time, then the larger value, then the larger canonical serialisation.
 */
export function preferred<T extends { updateTime?: string; value?: number }>(a: T, b: T): T {
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
const QUOTA_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "dailyLimitExceeded",
  "RATE_LIMIT_EXCEEDED",
]);
/** Whether a 403 body names a rate or quota limit (Google API error conventions; VERIFY). */
async function quotaDenied(res: Response): Promise<boolean> {
  let body: unknown;
  try {
    body = await readJson(res, ID, "Google Health error", 16 * 1024);
  } catch {
    return false;
  }
  const error = record(body) && record(body.error) ? body.error : undefined;
  if (!error) return false;
  if (error.status === "RESOURCE_EXHAUSTED") return true;
  const reasons = [error.errors, error.details].flatMap((list) =>
    Array.isArray(list) ? list.slice(0, 16).map((e) => (record(e) ? e.reason : undefined)) : [],
  );
  return reasons.some((reason) => typeof reason === "string" && QUOTA_REASONS.has(reason));
}

async function request(
  ctx: ImportContext,
  url: string,
  budget: RunBudget,
  body?: unknown,
): Promise<unknown> {
  const resource = url.split("?", 1)[0] ?? API; // Never put opaque page tokens in diagnostics.
  for (let attempt = 0; ; attempt++) {
    ctx.signal?.throwIfAborted();
    budget.request();
    const res = await ctx.api(url, {
      signal: ctx.signal,
      redirect: "error",
      ...(body !== undefined && {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
    if (res.ok) return readJson(res, ID, resource, MAX_PAGE_BYTES, budget);
    // The host transport has already refreshed once on 401; a second 401 or a 403 that is
    // not a rate limit (withheld scope, unapproved Restricted access) needs re-authorization.
    if (res.status === 401) {
      await res.body?.cancel();
      throw new IntegrationAuthError(
        ID,
        "exchange-failed",
        `Google Health rejected the authorization (401). ${REAUTHORIZE}`,
      );
    }
    const throttled = res.status === 429 || (res.status === 403 && (await quotaDenied(res)));
    if (res.status === 403 && !throttled)
      throw new IntegrationAuthError(
        ID,
        "exchange-failed",
        `Google Health denied access (403). ${REAUTHORIZE}`,
      );
    await res.body?.cancel().catch(() => {});
    if (throttled || res.status >= 500) {
      const raw = res.headers.get("retry-after");
      const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
      const ms = seconds === undefined ? 1000 * 2 ** attempt : seconds * 1000;
      if (attempt < 3 && Number.isFinite(ms) && ms <= 60_000) {
        await delay(ms, ctx.signal);
        continue;
      }
      if (throttled) throw new RateLimitedError(ID, resource, seconds);
    }
    throw new IntegrationSyncError(
      ID,
      `Google Health answered ${res.status}; checkpoint unchanged.`,
      { status: res.status },
    );
  }
}

/** One request window: [start, end) in epoch ms. */
export interface Window {
  readonly start: number;
  readonly end: number;
}

/** A window needed more pages than allowed; the caller splits it into smaller windows. */
export class PageCapError extends IntegrationSyncError {
  constructor(type: HealthType) {
    super(ID, `Google Health exceeded its page cap for one window of ${type}.`);
    this.name = "PageCapError";
  }
}
export const UNRECOGNISED =
  "unrecognised Google Health response shape; the checkpoint is unchanged.";
/**
 * More than a tenth of a window's points (or all of them) are not the documented shape: the
 * API changed, so stop before writing anything rather than silently skip real data.
 */
function guardShape(received: number, unrecognised: number): void {
  if (unrecognised > 0 && (unrecognised === received || unrecognised * 10 > received))
    throw new IntegrationSyncError(ID, `The import found an ${UNRECOGNISED}`);
}
function validPage(raw: unknown, member: string, max: number): raw is Record<string, unknown[]> {
  return (
    record(raw) &&
    (raw[member] === undefined ||
      (Array.isArray(raw[member]) && (raw[member] as unknown[]).length <= max)) &&
    (raw.nextPageToken === undefined ||
      (typeof raw.nextPageToken === "string" && raw.nextPageToken.length <= MAX_TOKEN_CHARS))
  );
}
const invalidPage = () =>
  new IntegrationSyncError(ID, "Invalid Google Health page; checkpoint unchanged.");
const rfc3339 = (ms: number) => new Date(ms).toISOString().replace(/\.000Z$/, "Z");
const civilLiteral = (ms: number) => new Date(ms).toISOString().slice(0, 19);
const range = (field: string, from: string, to: string) =>
  `${field} >= "${from}" AND ${field} < "${to}"`;

/** The documented list filter selecting every point this window owns (see the header). */
export function listFilter(type: HealthType, window: Window): string {
  if (sample(type))
    return range(
      `${type.replaceAll("-", "_")}.sample_time.physical_time`,
      rfc3339(window.start),
      rfc3339(window.end),
    );
  if (type === "sleep")
    return range("sleep.interval.end_time", rfc3339(window.start), rfc3339(window.end));
  // Exercise filters only on civil start time: widen by the largest offsets, then keep the
  // sessions whose physical start lies in the window.
  return range(
    "exercise.interval.civil_start_time",
    civilLiteral(window.start - MAX_OFFSET_MS),
    civilLiteral(window.end + MAX_OFFSET_MS),
  );
}

export interface WindowBatch {
  /** Valid, de-duplicated points belonging to this window. */
  points: HealthPoint[];
  /** Invalid points (the cursor still advances past them). */
  skipped: number;
  /** Unfinished or still-processing points: hold the type cursor at this window. */
  transient: boolean;
  /** Same-key, same-source points with different contents resolved deterministically. */
  conflicts: number;
}

/** Fetch every page of one list window, validating each envelope and point before any write. */
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
  const batch: WindowBatch = { points: [], skipped: 0, transient: false, conflicts: 0 };
  const size = pageSize(type);
  let received = 0;
  let unrecognised = 0;
  let token: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(endpoint(type));
    url.searchParams.set("pageSize", String(size));
    if (token) url.searchParams.set("pageToken", token);
    url.searchParams.set("filter", listFilter(type, window));
    const raw = await request(ctx, url.href, budget);
    if (!validPage(raw, "dataPoints", size)) throw invalidPage();
    const list = raw.dataPoints ?? [];
    budget.items(list.length);
    received += list.length;
    for (const value of list) {
      const normalized = parsePoint(type, value);
      if (typeof normalized === "string") {
        batch.skipped++;
        if (normalized === "shape") unrecognised++;
        continue;
      }
      // Samples and exercise belong to the window holding their start; sleep (filtered by
      // its end) to the window holding its end.
      const at = Date.parse(type === "sleep" ? normalized.end : normalized.start);
      const owned = at >= window.start && at < window.end;
      // A session this window owns that is still running at the run's clock, or a point the
      // provider dates after the clock: retry it next run.
      if ((owned && Date.parse(normalized.end) > until) || (!owned && at >= until)) {
        batch.transient = true;
        batch.skipped++;
        continue;
      }
      // Otherwise a point outside the window belongs to another window, which owns it.
      if (!owned) continue;
      if (normalized.pending) batch.transient = true;
      budget.items(normalized.stages?.length ?? 0);
      const previous = points.get(normalized.key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(normalized)) {
        batch.conflicts++;
        points.set(normalized.key, preferred(previous, normalized));
      } else points.set(normalized.key, normalized);
    }
    if (!raw.nextPageToken) {
      guardShape(received, unrecognised);
      batch.points = [...points.values()];
      return batch;
    }
    token = pagination.next(raw.nextPageToken as unknown as string);
  }
  throw new PageCapError(type);
}

export interface RollupBatch {
  totals: DailyTotal[];
  skipped: number;
  conflicts: number;
}
const civilDate = (ms: number) => {
  const d = new Date(ms);
  return { date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() } };
};

/**
 * Fetch one dailyRollUp range of civil days [window.start, window.end) (UTC-midnight epoch
 * ms standing for civil dates), validating every bucket before any write.
 */
export async function fetchRollup(
  ctx: ImportContext,
  type: HealthType,
  window: Window,
  budget: RunBudget,
  maxPages: number,
): Promise<RollupBatch> {
  const totals = new Map<string, DailyTotal>();
  const pagination = new Pagination(ID);
  const batch: RollupBatch = { totals: [], skipped: 0, conflicts: 0 };
  const size = pageSize(type);
  const [first, last] = [
    new Date(window.start).toISOString().slice(0, 10),
    new Date(window.end).toISOString().slice(0, 10),
  ];
  let received = 0;
  let unrecognised = 0;
  let token: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const raw = await request(ctx, endpoint(type), budget, {
      range: { start: civilDate(window.start), end: civilDate(window.end) },
      windowSizeDays: 1,
      pageSize: size,
      ...(token && { pageToken: token }),
    });
    if (!validPage(raw, "rollupDataPoints", size)) throw invalidPage();
    const list = raw.rollupDataPoints ?? [];
    budget.items(list.length);
    received += list.length;
    for (const value of list) {
      const total = parseRollup(type, value);
      if (total === null) continue;
      if (typeof total === "string") {
        batch.skipped++;
        if (total === "shape") unrecognised++;
        continue;
      }
      if (total.date < first || total.date >= last) continue;
      const previous = totals.get(total.date);
      if (previous && previous.value !== total.value) {
        batch.conflicts++;
        totals.set(total.date, preferred(previous, total));
      } else totals.set(total.date, total);
    }
    if (!raw.nextPageToken) {
      guardShape(received, unrecognised);
      batch.totals = [...totals.values()];
      return batch;
    }
    token = pagination.next(raw.nextPageToken as unknown as string);
  }
  throw new PageCapError(type);
}
