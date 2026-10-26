// AUTHORED-BY Codex GPT-6.1-Sol
// Time primitives ported from the pilot scheduling domain.
export interface Slot {
  start: string;
  end: string;
}
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
export function localParts(
  d: Date,
  timeZone: string,
): { date: string; weekday: number; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday ?? ""] ?? 0,
    minutes: Number.parseInt(parts.hour ?? "0", 10) * 60 + Number.parseInt(parts.minute ?? "0", 10),
  };
}
