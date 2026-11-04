// AUTHORED-BY Codex GPT-6.1-Sol
const relative = new Intl.RelativeTimeFormat("en", { numeric: "always" });
const UNITS = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["week", 7 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
] as const;

/** Promote rounded unit boundaries, so almost a day never displays as 24 hours. */
export function formatRelativeTime(at: number | string, now = Date.now(), expiry = false): string {
  const delta = (typeof at === "string" ? Date.parse(at) : at) - now;
  if (!Number.isFinite(delta)) return "at an unknown time";
  for (const [index, [unit, size]] of UNITS.entries()) {
    const smaller = UNITS[index + 1]?.[1] ?? 0;
    if (Math.abs(delta) >= size - smaller / 2) {
      const formatted = relative.format(Math.round(delta / size), unit);
      return expiry ? `${delta < 0 ? "Expired" : "Expires"} ${formatted}` : formatted;
    }
  }
  return "just now";
}
