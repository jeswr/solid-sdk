// AUTHORED-BY Codex GPT-6.1-Sol
/** Bounds apply across every file in an archive, including malformed records. */
export const ACTIVITY_LIMITS = {
  fileBytes: 64 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  activities: 1000,
  records: 100_000,
  points: 1_000_000,
  messages: 2_000_000,
  trackPoints: 2000,
  /** Track samples retained across one file's activities; overflow truncates and stops. */
  fileTrackPoints: 200_000,
} as const;
/** Elapsed durations outside [1 s, 7 days] are dropped; the activity is kept. */
export const MIN_DURATION_SECONDS = 1;
export const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;
/** Activities starting or ending outside [1970-01-01, 2100-01-01] are invalid. */
export const MIN_ACTIVITY_TIME = Date.UTC(1970, 0, 1);
export const MAX_ACTIVITY_TIME = Date.UTC(2100, 0, 1);
export type ActivityLimits = { readonly [K in keyof typeof ACTIVITY_LIMITS]: number };
export class ActivityCap extends Error {}
export class ActivityBudget {
  readonly limits: ActivityLimits;
  readonly warnings = new Set<string>();
  points = 0;
  messages = 0;
  activities = 0;
  /** Track samples currently retained by the file being parsed. */
  retained = 0;
  constructor(
    limits: Partial<ActivityLimits> = {},
    readonly signal?: AbortSignal,
  ) {
    this.limits = { ...ACTIVITY_LIMITS, ...limits };
    for (const key of Object.keys(ACTIVITY_LIMITS) as (keyof ActivityLimits)[]) {
      const value = this.limits[key];
      if (!Number.isSafeInteger(value) || value < 1 || value > ACTIVITY_LIMITS[key])
        throw new Error(`Invalid activity limit: ${key}.`);
    }
  }
  /** Per-file counters restart for each file, including archive entries. */
  beginFile(): void {
    this.retained = 0;
  }
  warn(reason: string): void {
    this.warnings.add(reason);
  }
  message(): void {
    this.signal?.throwIfAborted();
    if (++this.messages > this.limits.messages) {
      this.warn("message-cap-exceeded");
      throw new ActivityCap();
    }
  }
  activity(): void {
    if (++this.activities > this.limits.activities) {
      this.warn("activity-cap-exceeded");
      throw new ActivityCap();
    }
  }
}
export interface Point {
  time?: number;
  lat?: number;
  lon?: number;
  altitude?: number;
  hr?: number;
  cadence?: number;
  temperature?: number;
  distance?: number;
  speed?: number;
  power?: number;
  segment?: number;
}
export class Activity {
  name?: string;
  sport = "workout";
  creator?: string;
  serial?: string;
  start?: number;
  end?: number;
  duration?: number;
  distance?: number;
  calories?: number;
  elevation?: number;
  avgHr?: number;
  maxHr?: number;
  /** Original format slug (gpx, tcx or fit), set by the parser. */
  format?: string;
  readonly track: Point[] = [];
  records = 0;
  /** Set by finish() when the start/end lies outside the supported time range. */
  invalid = false;
  private firstTime?: number;
  private lastTime?: number;
  private timedPoints = 0;
  private stride = 1;
  private coordinates = 0;
  private previous?: Point;
  private last?: Point;
  private hrTotal = 0;
  private hrCount = 0;
  private derivedDistance = 0;
  private derivedElevation = 0;
  truncated = false;
  summary = false;
  constructor(readonly budget: ActivityBudget) {}
  point(point: Point): void {
    if (++this.records > this.budget.limits.records) {
      this.truncated = true;
      this.budget.warn("record-cap-exceeded");
      return;
    }
    if (++this.budget.points > this.budget.limits.points) {
      this.truncated = true;
      this.budget.warn("point-cap-exceeded");
      return;
    }
    if (point.time !== undefined) {
      this.start ??= point.time;
      this.end = Math.max(this.end ?? point.time, point.time);
      this.firstTime = Math.min(this.firstTime ?? point.time, point.time);
      this.lastTime = Math.max(this.lastTime ?? point.time, point.time);
      this.timedPoints++;
    }
    if (point.hr !== undefined) {
      this.hrTotal += point.hr;
      this.hrCount++;
      this.maxHr = Math.max(this.maxHr ?? 0, point.hr);
    }
    if (point.distance !== undefined) this.distance = Math.max(this.distance ?? 0, point.distance);
    const valid =
      point.lat !== undefined &&
      point.lon !== undefined &&
      Math.abs(point.lat) <= 90 &&
      Math.abs(point.lon) <= 180;
    if (!valid) return;
    const prev = this.previous;
    if (prev && prev.segment === point.segment) {
      this.derivedDistance += haversine(prev, point);
      if (prev.altitude !== undefined && point.altitude !== undefined)
        this.derivedElevation += Math.max(0, point.altitude - prev.altitude);
    }
    this.previous = point;
    this.last = point;
    if (this.coordinates++ % this.stride === 0) {
      if (this.budget.retained >= this.budget.limits.fileTrackPoints) {
        // Bound retained memory for many-track files: keep this prefix and stop the file.
        this.truncated = true;
        this.budget.warn("file-track-point-cap-exceeded");
        throw new ActivityCap();
      }
      this.track.push(point);
      this.budget.retained++;
    }
    if (this.track.length >= this.budget.limits.trackPoints) {
      this.stride *= 2;
      const kept = this.track.filter((_, i) => i % 2 === 0);
      this.budget.retained -= this.track.length - kept.length;
      this.track.splice(0, this.track.length, ...kept);
    }
  }
  /** Earliest and latest point times, when at least two points carry a time. */
  get pointTimes(): { first: number; last: number } | undefined {
    return this.timedPoints >= 2 && this.firstTime !== undefined && this.lastTime !== undefined
      ? { first: this.firstTime, last: this.lastTime }
      : undefined;
  }
  /** Normalises summary values. Durations outside [1 s, 7 days] are dropped with
   * their end time; out-of-range start/end marks the activity invalid. After finish,
   * a defined end always equals start + duration, so it is never before start.
   */
  finish(): this {
    const inRange = (t: number | undefined) =>
      t === undefined || (t >= MIN_ACTIVITY_TIME && t <= MAX_ACTIVITY_TIME);
    if (!inRange(this.start) || !inRange(this.end)) return this.reject();
    this.duration ??=
      this.start !== undefined && this.end !== undefined
        ? (this.end - this.start) / 1000
        : undefined;
    const d = this.duration;
    if (d !== undefined && !(d >= MIN_DURATION_SECONDS && d <= MAX_DURATION_SECONDS)) {
      // Sub-second spans (single-point tracks) are degenerate, not malformed.
      if (!Number.isFinite(d) || d < 0 || d > MAX_DURATION_SECONDS)
        this.budget.warn("activity-duration-dropped");
      this.duration = undefined;
    }
    this.end =
      this.start !== undefined && this.duration !== undefined
        ? this.start + this.duration * 1000
        : undefined;
    if (!inRange(this.end)) return this.reject();
    this.distance ??= this.derivedDistance || undefined;
    this.elevation ??= this.derivedElevation || undefined;
    this.avgHr ??= this.hrCount ? this.hrTotal / this.hrCount : undefined;
    if (this.last && this.track.at(-1) !== this.last) {
      if (this.track.length === this.budget.limits.trackPoints) this.track.pop();
      this.track.push(this.last);
    }
    return this;
  }
  private reject(): this {
    this.invalid = true;
    this.budget.warn("activity-time-out-of-range");
    this.budget.retained -= this.track.length;
    this.track.length = 0;
    return this;
  }
}
function haversine(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin((((b.lat as number) - (a.lat as number)) * rad) / 2) ** 2 +
    Math.cos((a.lat as number) * rad) *
      Math.cos((b.lat as number) * rad) *
      Math.sin((((b.lon as number) - (a.lon as number)) * rad) / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function sport(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (/^(run|running|trail run|trail running|9)$/.test(value)) return "running";
  if (/^(ride|cycling|biking|bike|1)$/.test(value)) return "cycling";
  if (/^(walk|walking|hiking|hike)$/.test(value)) return "walking";
  if (/^(swim|swimming)$/.test(value)) return "swimming";
  return value.slice(0, 100) || "workout";
}
export function numeric(raw: string | undefined, min = 0, max = 1e12): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}
export function timestamp(raw: string | undefined): number | undefined {
  if (!raw || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(raw))
    return undefined;
  const n = Date.parse(raw);
  return Number.isFinite(n) ? n : undefined;
}
