// AUTHORED-BY Codex GPT-6.1-Sol
export function relativeTime(date: Date, now: Date, locale?: string): string {
  const seconds = (date.getTime() - now.getTime()) / 1000;
  const [divisor, unit]: [number, Intl.RelativeTimeFormatUnit] =
    Math.abs(seconds) >= 86400
      ? [86400, "day"]
      : Math.abs(seconds) >= 3600
        ? [3600, "hour"]
        : Math.abs(seconds) >= 60
          ? [60, "minute"]
          : [1, "second"];
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    Math.round(seconds / divisor),
    unit,
  );
}
