// AUTHORED-BY Claude Opus 5.5
/**
 * A synthetic, in-memory Google Health v4 API for tests and offline checks; it never touches
 * the network. It answers only the request forms the v4 reference documents
 * (health.googleapis.com/$discovery/rest?version=v4, revision 20261110) and throws on any
 * other, so an adapter that drifts from the documented grammar fails its tests:
 *
 * - `GET …/dataPoints` with `{type}.sample_time.physical_time` (samples),
 *   `exercise.interval.civil_start_time` (exercise) or `sleep.interval.end_time` (sleep)
 *   bounded by `>=` and `<` in one filter, `pageSize` within the documented maximum (25 for
 *   exercise and sleep, 10,000 otherwise) and opaque `pageToken`s. Points come back in
 *   descending start order, as documented, and empty fields are omitted as proto3 JSON does.
 * - `POST …/dataPoints:dailyRollUp` with a `CivilTimeInterval` range, `windowSizeDays: 1`
 *   and `pageSize` within the documented maximum (14 for total-calories, 90 otherwise).
 */
import type { HealthType } from "./api.js";

type Raw = Record<string, unknown>;
export interface SyntheticHealthData {
  /** Raw DataPoint objects per list type (heart-rate, weight, exercise, sleep). */
  readonly points?: Partial<Record<HealthType, readonly unknown[]>>;
  /** Daily rollup value members per summary type and civil date (YYYY-MM-DD). */
  readonly rollups?: Partial<Record<HealthType, Readonly<Record<string, unknown>>>>;
}
export interface SyntheticHealthOptions {
  /** Serve at most this many points per page (below the requested page size). */
  readonly pageSize?: number;
  /** Extra raw points answered for one list window, as parsed bounds (epoch ms). */
  readonly extra?: (type: HealthType, from: number, to: number) => unknown[];
}

const PAYLOAD: Record<string, string> = {
  "heart-rate": "heartRate",
  weight: "weight",
  exercise: "exercise",
  sleep: "sleep",
  steps: "steps",
  distance: "distance",
  "total-calories": "totalCalories",
};
const PHYSICAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const CIVIL = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?$/;
const record = (v: unknown): v is Raw => v !== null && typeof v === "object" && !Array.isArray(v);
const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const civilText = (c: unknown): string | undefined => {
  if (!record(c) || !record(c.date)) return undefined;
  const d = c.date as Raw;
  const t = record(c.time) ? c.time : {};
  return `${pad(Number(d.year), 4)}-${pad(Number(d.month))}-${pad(Number(d.day))}T${pad(Number(t.hours ?? 0))}:${pad(Number(t.minutes ?? 0))}:${pad(Number(t.seconds ?? 0))}`;
};
const offsetMs = (v: unknown) => (typeof v === "string" ? Number.parseInt(v, 10) * 1000 : 0);

/** The value the documented filter field compares, or undefined for a malformed point. */
function filterKey(type: string, raw: unknown): number | string | undefined {
  const payload = record(raw) ? raw[PAYLOAD[type] as string] : undefined;
  if (!record(payload)) return undefined;
  if (type === "exercise") {
    const iv = payload.interval;
    if (!record(iv) || typeof iv.startTime !== "string") return undefined;
    return (
      civilText(iv.civilStartTime) ??
      new Date(Date.parse(iv.startTime) + offsetMs(iv.startUtcOffset)).toISOString().slice(0, 19)
    );
  }
  if (type === "sleep") {
    const iv = payload.interval;
    return record(iv) && typeof iv.endTime === "string" ? Date.parse(iv.endTime) : undefined;
  }
  const st = payload.sampleTime;
  return record(st) && typeof st.physicalTime === "string"
    ? Date.parse(st.physicalTime)
    : undefined;
}
const sample = (type: string) => type === "heart-rate" || type === "weight";
const startOf = (type: string, raw: unknown): number => {
  const payload = record(raw) ? raw[PAYLOAD[type] as string] : undefined;
  if (!record(payload)) return 0;
  const at = record(payload.interval)
    ? payload.interval.startTime
    : record(payload.sampleTime)
      ? payload.sampleTime.physicalTime
      : undefined;
  return typeof at === "string" ? Date.parse(at) : 0;
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dateOf = (c: unknown): string => {
  if (!record(c) || !record(c.date)) throw new Error("dailyRollUp range needs civil dates");
  const d = c.date as Raw;
  return `${pad(Number(d.year), 4)}-${pad(Number(d.month))}-${pad(Number(d.day))}`;
};
const civilDate = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return { date: { year, month, day } };
};

export function syntheticHealthApi(
  data: SyntheticHealthData,
  options: SyntheticHealthOptions = {},
): typeof fetch {
  // Per type, points sorted by their filter key for binary-searched range queries.
  const index = new Map<string, { keys: (number | string)[]; raws: unknown[] }>();
  const indexed = (type: string) => {
    let entry = index.get(type);
    if (!entry) {
      const sorted = (data.points?.[type as HealthType] ?? [])
        .map((raw) => ({ raw, key: filterKey(type, raw) }))
        .filter((p): p is { raw: unknown; key: number | string } => p.key !== undefined)
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      entry = { keys: sorted.map((p) => p.key), raws: sorted.map((p) => p.raw) };
      index.set(type, entry);
    }
    return entry;
  };
  const lowerBound = (keys: (number | string)[], x: number | string) => {
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((keys[mid] as number | string) < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return async (input, init) => {
    const url = new URL(String(input));
    const match = /^\/v4\/users\/me\/dataTypes\/([a-z-]+)\/dataPoints(:dailyRollUp)?$/.exec(
      url.pathname,
    );
    if (!match) throw new Error(`Undocumented Google Health path ${url.pathname}`);
    const type = match[1] as HealthType;
    const method = (init?.method ?? "GET").toUpperCase();
    if (match[2]) {
      if (method !== "POST" || typeof init?.body !== "string")
        throw new Error("dailyRollUp is a POST with a JSON body");
      const body = JSON.parse(init.body) as Raw;
      const max = type === "total-calories" ? 14 : 90;
      if (body.windowSizeDays !== 1) throw new Error("expected windowSizeDays 1");
      if (typeof body.pageSize !== "number" || body.pageSize < 1 || body.pageSize > max)
        throw new Error(`pageSize ${String(body.pageSize)} outside 1..${max}`);
      const range = record(body.range) ? body.range : {};
      const from = dateOf(range.start);
      const to = dateOf(range.end);
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
      if (!(days >= 1 && days <= max)) throw new Error(`dailyRollUp range of ${days} days`);
      const values = data.rollups?.[type] ?? {};
      const buckets: Raw[] = [];
      for (let date = from; date < to; date = addDays(date, 1)) {
        const value = values[date];
        buckets.push({
          civilStartTime: civilDate(date),
          civilEndTime: civilDate(addDays(date, 1)),
          ...(value !== undefined && { [PAYLOAD[type] as string]: value }),
        });
      }
      const offset = typeof body.pageToken === "string" ? Number(body.pageToken.slice(1)) : 0;
      const size = Math.min(body.pageSize, options.pageSize ?? body.pageSize);
      const page = buckets.slice(offset, offset + size);
      return json({
        ...(page.length > 0 && { rollupDataPoints: page }),
        ...(offset + size < buckets.length && { nextPageToken: `r${offset + size}` }),
      });
    }
    if (method !== "GET") throw new Error(`Unexpected ${method} on a list endpoint`);
    const field =
      type === "exercise"
        ? "exercise.interval.civil_start_time"
        : type === "sleep"
          ? "sleep.interval.end_time"
          : `${type.replaceAll("-", "_")}.sample_time.physical_time`;
    const filter = url.searchParams.get("filter") ?? "";
    const parts = /^(\S+) >= "([^"]+)" AND (\S+) < "([^"]+)"$/.exec(filter);
    if (!parts || parts[1] !== field || parts[3] !== field)
      throw new Error(`Undocumented filter for ${type}: ${filter}`);
    const civil = type === "exercise";
    const [lower, upper] = [parts[2] as string, parts[4] as string];
    if (![lower, upper].every((v) => (civil ? CIVIL : PHYSICAL).test(v)))
      throw new Error(`Filter literal format for ${type}: ${filter}`);
    const max = civil || type === "sleep" ? 25 : 10_000;
    const requested = Number(url.searchParams.get("pageSize"));
    if (!Number.isSafeInteger(requested) || requested < 1 || requested > max)
      throw new Error(`pageSize ${requested} outside 1..${max}`);
    const toMs = (v: string) => Date.parse(civil ? `${v.length === 10 ? `${v}T00:00:00` : v}Z` : v);
    const [lo, hi] = civil ? [lower, upper] : [Date.parse(lower), Date.parse(upper)];
    const { keys, raws } = indexed(type);
    const all = [
      ...raws.slice(lowerBound(keys, lo), lowerBound(keys, hi)),
      ...(options.extra?.(type, toMs(lower), toMs(upper)) ?? []),
    ];
    if (sample(type)) all.reverse();
    else all.sort((a, b) => startOf(type, b) - startOf(type, a));
    const offset = Number(url.searchParams.get("pageToken")?.slice(1) ?? 0);
    const size = Math.min(requested, options.pageSize ?? requested);
    const page = all.slice(offset, offset + size);
    return json({
      ...(page.length > 0 && { dataPoints: page }),
      ...(offset + size < all.length && { nextPageToken: `p${offset + size}` }),
    });
  };
}
