// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { EntryData } from "./model.js";

/** Calendar days use the viewer's time zone, including at daylight-saving transitions. */
export function dayKey(date: Date, timeZone = "UTC"): string {
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid journal date");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function daysWritten(entries: readonly EntryData[], timeZone = "UTC"): Map<string, number> {
  const days = new Map<string, number>();
  for (const entry of entries) {
    const day = dayKey(entry.created, timeZone);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  return days;
}

/** A current streak can end today or yesterday; future entries never contribute. */
export function calculateStreak(
  entries: readonly EntryData[],
  now = new Date(),
  timeZone = "UTC",
): { current: number; longest: number } {
  const today = dayKey(now, timeZone);
  const days = [...daysWritten(entries, timeZone).keys()].filter((day) => day <= today).sort();
  const ordinal = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86400000;
  let longest = 0;
  let run = 0;
  let previous = Number.NEGATIVE_INFINITY;
  for (const day of days) {
    const value = ordinal(day);
    run = value === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = value;
  }
  const current = ordinal(today) - previous <= 1 ? run : 0;
  return { current, longest };
}

export function onThisDay<T extends EntryData>(
  entries: readonly T[],
  now = new Date(),
  timeZone = "UTC",
): T[] {
  const today = dayKey(now, timeZone);
  return entries
    .filter((entry) => {
      const day = dayKey(entry.created, timeZone);
      return day.slice(0, 4) < today.slice(0, 4) && day.slice(5) === today.slice(5);
    })
    .sort((a, b) => b.created.getTime() - a.created.getTime());
}

/** Plain excerpts only: never produces HTML or interprets a link as a navigation target. */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/```[^\n]*\n?|~~~[^\n]*\n?/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/^\s*\[[^\]]+\]:.*$/gm, "")
    .replace(/<[^>]*>/g, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/gm, "")
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, "")
    .replace(/\\([\\`*_{}[\]()#+.!>-])/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (value) =>
        ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " })[
          value
        ] ?? value,
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function wordCount(markdown: string): number {
  return markdownToPlainText(markdown).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function excerpt(markdown: string, limit = 180): string {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new TypeError("Excerpt length must be a positive integer");
  const text = Array.from(markdownToPlainText(markdown));
  return text.length <= limit ? text.join("") : `${text.slice(0, limit).join("").trimEnd()}…`;
}

export function exportMarkdown(entries: readonly EntryData[]): string {
  return [...entries]
    .sort((a, b) => a.created.getTime() - b.created.getTime())
    .map((entry) =>
      [
        `# ${entry.title || "Untitled entry"}`,
        `Date: ${entry.created.toISOString()}`,
        ...(entry.mood ? [`Mood: ${entry.mood}`] : []),
        ...(entry.tags?.length ? [`Tags: ${entry.tags.join(", ")}`] : []),
        ...(entry.location ? [`Location: ${entry.location}`] : []),
        ...(entry.weather ? [`Weather: ${entry.weather}`] : []),
        "",
        entry.text,
        ...(entry.images ?? []).map(
          (url) => `\n![Attached photo](<${encodeURI(url).replaceAll(">", "%3E")}>)`,
        ),
      ].join("\n"),
    )
    .join("\n\n---\n\n");
}
