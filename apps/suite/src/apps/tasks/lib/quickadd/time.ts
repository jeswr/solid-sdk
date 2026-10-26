// AUTHORED-BY Codex GPT-6.1-Sol
const DAY = 86_400_000;

/** Calendar arithmetic uses a UTC surrogate, never the host process time zone. */
export function localCalendar(instant: Date, tz: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map(({ type, value }) => [type, value]),
  );
  return new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    ),
  );
}

/** Reject nonexistent wall times; choose the earlier instant for a repeated wall time. */
export function toInstant(calendar: Date, tz: string): Date | undefined {
  const wall = calendar.getTime();
  const candidates = [-DAY, 0, DAY].map((delta) => {
    const sample = new Date(wall + delta);
    const offset = localCalendar(sample, tz).getTime() - sample.getTime();
    return wall - offset;
  });
  const matches = candidates.filter(
    (candidate) => localCalendar(new Date(candidate), tz).getTime() === wall,
  );
  if (matches.length === 0) return undefined;
  return new Date(Math.min(...matches));
}
