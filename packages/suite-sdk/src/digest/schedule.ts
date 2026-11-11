// AUTHORED-BY Codex GPT-6.1-Sol
export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
}
export type DigestSchedule = (
  | { mode: "off" }
  | { mode: "hourly" }
  | { mode: "daily"; time: string }
  | { mode: "twice-daily"; times: readonly [string, string] }
) & { quietHours?: QuietHours };
const DAY = 86400000;
const minute = (time: string) => {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time)) throw new RangeError("Expected HH:MM");
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
};
function calendar(tz: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const wall = (instant: number) => {
    const fields = Object.fromEntries(
      formatter.formatToParts(instant).map((p) => [p.type, p.value]),
    );
    return Date.UTC(
      Number(fields.year),
      Number(fields.month) - 1,
      Number(fields.day),
      Number(fields.hour),
      Number(fields.minute),
    );
  };
  // Resolve civil time using the offsets on both sides of a transition. A fold uses its
  // first occurrence; a gap shifts forward by its duration (02:30 -> 03:30).
  const instants = (civil: number) => {
    const candidates = [
      ...new Set(
        [-DAY, 0, DAY].map((delta) => {
          const sample = civil + delta;
          return civil - (wall(sample) - sample);
        }),
      ),
    ].sort((a, b) => a - b);
    const exact = candidates.filter((t) => wall(t) === civil);
    return exact.length ? exact : [candidates.find((t) => wall(t) > civil) as number];
  };
  return { wall, instants, instant: (civil: number) => instants(civil)[0] as number };
}
function quietEnd(civil: number, quiet: QuietHours | undefined): number {
  if (!quiet?.enabled) return civil;
  const start = minute(quiet.start),
    end = minute(quiet.end);
  const current = new Date(civil).getUTCHours() * 60 + new Date(civil).getUTCMinutes();
  if (
    start === end ||
    !(start < end ? current >= start && current < end : current >= start || current < end)
  )
    return civil;
  const day = Math.floor(civil / DAY) * DAY;
  return day + end * 60000 + (start > end && current >= start ? DAY : 0);
}
/** Shared quiet-hours predicate for delivery adapters as well as the scheduler. */
export function inQuietHours(quiet: QuietHours, now: Date, tz = "UTC"): boolean {
  if (!quiet.enabled) return false;
  const civil = calendar(tz).wall(now.getTime());
  return quietEnd(civil, quiet) !== civil;
}

/** Strictly after now. Off returns null. Quiet slots are deferred to the quiet period's end. */
export function nextDigestTime(schedule: DigestSchedule, now: Date, tz = "UTC"): Date | null {
  if (schedule.mode === "off") return null;
  if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid now");
  const { wall, instants, instant } = calendar(tz);
  const civilNow = wall(now.getTime());
  const day = Math.floor(civilNow / DAY) * DAY;
  const slots =
    schedule.mode === "hourly"
      ? Array.from({ length: 24 }, (_, i) => i * 60)
      : schedule.mode === "daily"
        ? [minute(schedule.time)]
        : schedule.times.map(minute);
  const candidates: number[] = [];
  // Yesterday's late slot can defer into this morning; include it across midnight.
  for (let d = -1; d <= 3; d++)
    for (const slot of slots) {
      const civil = day + d * DAY + slot * 60000;
      for (const candidate of schedule.mode === "hourly" ? instants(civil) : [instant(civil)]) {
        // Apply quiet hours to the resolved local time, including DST gap shifts.
        const deferred = quietEnd(wall(candidate), schedule.quietHours);
        const delivery =
          deferred === wall(candidate)
            ? candidate
            : (instants(deferred).find((t) => t >= candidate) as number);
        if (delivery > now.getTime()) candidates.push(delivery);
      }
    }
  return new Date(Math.min(...candidates));
}
/** A first digest is due immediately outside quiet hours; subsequent deliveries use slots. */
export function isDue(
  lastDelivered: Date | null,
  schedule: DigestSchedule,
  now: Date,
  tz = "UTC",
): boolean {
  if (schedule.mode === "off") return false;
  const { wall } = calendar(tz);
  const current = wall(now.getTime());
  if (quietEnd(current, schedule.quietHours) !== current) return false;
  if (!lastDelivered) return true;
  return (nextDigestTime(schedule, lastDelivered, tz) as Date).getTime() <= now.getTime();
}
