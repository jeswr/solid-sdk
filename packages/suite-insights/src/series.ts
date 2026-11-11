// AUTHORED-BY Codex (GPT-6.1 Sol)
export type Timestamp = Date | number | string;
export type Aggregation = "sum" | "mean" | "last";
export interface Sample {
  at: Timestamp;
  value: number;
}
export interface DailyPoint {
  day: string;
  value: number | null;
  count: number;
}
export interface Series {
  id: string;
  label: string;
  unit: string;
  aggregation: Aggregation;
  points: readonly Sample[];
}
const DAY = 86_400_000;
const civil = /^\d{4}-\d{2}-\d{2}$/u;
const isoInstant =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/iu;
function instant(at: Timestamp): number {
  // Offset-free date-times would use the host's zone, silently defeating timeZone.
  if (typeof at === "string" && !civil.test(at)) {
    if (!isoInstant.test(at))
      throw new RangeError("Use a calendar date or a date-time with an explicit offset");
    const day = at.slice(0, 10);
    if (new Date(day).toISOString().slice(0, 10) !== day) throw new RangeError("Invalid day");
  }
  const value = new Date(at).getTime();
  if (!Number.isFinite(value)) throw new RangeError("Invalid timestamp");
  return value;
}
function formatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
/** Date-only values remain civil dates; instants are projected into the requested zone. */
export function calendarDay(at: Timestamp, timeZone: string): string {
  return dayWithFormat(at, formatter(timeZone));
}
function dayWithFormat(at: Timestamp, format: Intl.DateTimeFormat): string {
  const stamp = instant(at);
  if (typeof at === "string" && civil.test(at)) {
    if (new Date(stamp).toISOString().slice(0, 10) !== at) throw new RangeError("Invalid day");
    return at;
  }
  const parts = format.formatToParts(stamp);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function shiftDay(day: string, days: number): string {
  if (!civil.test(day) || !Number.isInteger(days)) throw new RangeError("Invalid day offset");
  const stamp = instant(day);
  if (new Date(stamp).toISOString().slice(0, 10) !== day) throw new RangeError("Invalid day");
  return new Date(stamp + days * DAY).toISOString().slice(0, 10);
}
function aggregate(values: readonly number[], mode: Aggregation): number {
  if (mode === "last") return values[values.length - 1] as number;
  const sum = values.reduce((total, n) => total + n, 0);
  return mode === "sum" ? sum : sum / values.length;
}
/** Invalid/non-finite measurements are missing, never zero. Last is chronological. */
export function dailySeries(
  points: readonly Sample[],
  timeZone: string,
  mode: Aggregation,
): DailyPoint[] {
  const format = formatter(timeZone);
  const days = new Map<string, number[]>();
  const valid = points.filter((p) => Number.isFinite(p.value));
  for (const point of [...valid].sort((a, b) => instant(a.at) - instant(b.at))) {
    const key = dayWithFormat(point.at, format);
    const group = days.get(key) ?? [];
    group.push(point.value);
    days.set(key, group);
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, values]) => ({
      day,
      value: aggregate(values, mode),
      count: values.length,
    }));
}
export interface AlignedPoint {
  day: string;
  x: number | null;
  y: number | null;
}
export interface AlignmentOptions {
  timeZone: string;
  xAggregation?: Aggregation;
  yAggregation?: Aggregation;
  /** Positive lag pairs X on day D with Y on day D + lagDays. */
  lagDays?: number;
  missing?: "omit" | "null" | "zero";
}
export function alignDaily(
  x: readonly Sample[],
  y: readonly Sample[],
  options: AlignmentOptions,
): AlignedPoint[] {
  const { timeZone, lagDays = 0, missing = "omit" } = options;
  if (!Number.isInteger(lagDays) || Math.abs(lagDays) > 365)
    throw new RangeError("Lag must be within 365 days");
  const left = new Map(
    dailySeries(x, timeZone, options.xAggregation ?? "mean").map((p) => [p.day, p.value]),
  );
  const right = new Map(
    dailySeries(y, timeZone, options.yAggregation ?? "mean").map((p) => [
      shiftDay(p.day, -lagDays),
      p.value,
    ]),
  );
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  if (!keys.length) return [];
  const result: AlignedPoint[] = [];
  const start = keys[0] as string;
  const end = keys[keys.length - 1] as string;
  if ((instant(end) - instant(start)) / DAY > 10_000)
    throw new RangeError("Series spans more than 10,000 days");
  for (let day = start; day <= end; day = shiftDay(day, 1)) {
    const a = left.get(day) ?? null;
    const b = right.get(day) ?? null;
    if (missing === "omit" && (a === null || b === null)) continue;
    result.push({
      day,
      x: missing === "zero" ? (a ?? 0) : a,
      y: missing === "zero" ? (b ?? 0) : b,
    });
  }
  return result;
}
export interface Bucket {
  id: string;
  label: string;
  value: number | null;
  n: number;
}
const WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Mean daily values by weekday; unobserved days do not count as zero. */
export function weekdayAggregation(points: readonly DailyPoint[]): Bucket[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = (i + 1) % 7;
    const values = points
      .filter((p) => new Date(`${calendarDay(p.day, "UTC")}T00:00:00Z`).getUTCDay() === day)
      .flatMap((p) => (p.value !== null && Number.isFinite(p.value) ? [p.value] : []));
    return {
      id: String(day),
      label: WEEK[day] as string,
      value: values.length ? aggregate(values, "mean") : null,
      n: values.length,
    };
  });
}
/** Civil dates have no hour and are excluded. Repeated DST hours share a bucket. */
export function hourlyAggregation(
  points: readonly Sample[],
  timeZone: string,
  mode: Aggregation = "mean",
): Bucket[] {
  const format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" });
  const groups = Array.from({ length: 24 }, () => [] as number[]);
  for (const point of [...points].sort((a, b) => instant(a.at) - instant(b.at))) {
    if (!Number.isFinite(point.value) || (typeof point.at === "string" && civil.test(point.at)))
      continue;
    groups[Number(format.format(instant(point.at)))]?.push(point.value);
  }
  return groups.map((values, hour) => ({
    id: String(hour),
    label: `${String(hour).padStart(2, "0")}:00`,
    value: values.length ? aggregate(values, mode) : null,
    n: values.length,
  }));
}
/** Calendar windows include gaps; minimum observed days defaults to the full window. */
export function rollingAverage(
  points: readonly DailyPoint[],
  windowDays: number,
  minimumSamples = windowDays,
): DailyPoint[] {
  if (
    !Number.isInteger(windowDays) ||
    windowDays < 1 ||
    windowDays > 10_000 ||
    !Number.isInteger(minimumSamples) ||
    minimumSamples < 1 ||
    minimumSamples > windowDays
  )
    throw new RangeError("Invalid rolling window");
  const daily = new Map(points.map((p) => [calendarDay(p.day, "UTC"), p.value]));
  const days = [...daily.keys()].sort();
  if (!days.length) return [];
  const start = days[0] as string;
  const end = days[days.length - 1] as string;
  if ((instant(end) - instant(start)) / DAY > 10_000)
    throw new RangeError("Series spans more than 10,000 days");
  const result: DailyPoint[] = [];
  for (let day = start; day <= end; day = shiftDay(day, 1)) {
    const values: number[] = [];
    for (let i = 0; i < windowDays; i++) {
      const v = daily.get(shiftDay(day, -i));
      if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    result.push({
      day,
      value: values.length >= minimumSamples ? aggregate(values, "mean") : null,
      count: values.length,
    });
  }
  return result;
}
