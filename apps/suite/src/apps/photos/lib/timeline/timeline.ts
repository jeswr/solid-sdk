// AUTHORED-BY Codex GPT-6.1-Sol
import { type ResolvedPhoto, resolvePhotos, type TimelinePhoto, zoneFormatter } from "./capture";
import { calendarDate, requireTimeline } from "./validation";

export type TimelineUnit = "day" | "month" | "year";
export interface TimelineOptions {
  readonly unit: TimelineUnit;
  /** Required even for empty inputs and photos with capture offsets; never uses the host zone. */
  readonly timeZone: string;
  readonly order?: "ascending" | "descending";
}
export interface PhotoGroup<T> {
  /** Zero-padded Gregorian YYYY[-MM[-DD]], suitable for locale-specific header formatting. */
  key: string;
  photos: T[];
}

function resolve<T extends TimelinePhoto>(
  photos: readonly T[],
  options: TimelineOptions,
): { entries: ResolvedPhoto<T>[]; direction: number; keyLength: number } {
  requireTimeline(options && typeof options === "object", "invalid-options");
  requireTimeline(
    options.unit === "day" || options.unit === "month" || options.unit === "year",
    "invalid-options",
  );
  requireTimeline(
    options.order === undefined || options.order === "ascending" || options.order === "descending",
    "invalid-options",
  );
  return {
    entries: resolvePhotos(photos, zoneFormatter(options.timeZone)),
    direction: options.order === "ascending" ? 1 : -1,
    keyLength: { day: 10, month: 7, year: 4 }[options.unit],
  };
}

/** Calendar sections in the requested direction; within each, capture instant then ascending id. */
export function groupPhotos<T extends TimelinePhoto>(
  photos: readonly T[],
  options: TimelineOptions,
): PhotoGroup<T>[] {
  const { entries, direction, keyLength } = resolve(photos, options);
  entries.sort((a, b) => {
    const aKey = a.date.slice(0, keyLength);
    const bKey = b.date.slice(0, keyLength);
    if (aKey !== bKey) return direction * (aKey < bKey ? -1 : 1);
    return direction * (a.time - b.time) || (a.photo.id < b.photo.id ? -1 : 1);
  });
  const groups: PhotoGroup<T>[] = [];
  for (const entry of entries) {
    const key = entry.date.slice(0, keyLength);
    const previous = groups[groups.length - 1];
    if (previous?.key === key) previous.photos.push(entry.photo);
    else groups.push({ key, photos: [entry.photo] });
  }
  return groups;
}

/** Exact month/day memories, strictly before the supplied Gregorian reference year. */
export function onThisDay<T extends TimelinePhoto>(
  photos: readonly T[],
  date: string,
  options: Omit<TimelineOptions, "unit">,
): PhotoGroup<T>[] {
  calendarDate(date);
  // Resolve all photos before filtering: invalid non-matching captures must not disappear silently.
  const { entries, direction } = resolve(photos, { ...options, unit: "day" });
  const matching = entries
    .filter(
      (entry) => entry.date.slice(5) === date.slice(5) && entry.date.slice(0, 4) < date.slice(0, 4),
    )
    .sort((a, b) => direction * (a.time - b.time) || (a.photo.id < b.photo.id ? -1 : 1));
  const years = new Map<string, PhotoGroup<T>>();
  for (const entry of matching) {
    const key = entry.date.slice(0, 4);
    const group = years.get(key);
    if (group) group.photos.push(entry.photo);
    else years.set(key, { key, photos: [entry.photo] });
  }
  return [...years.values()].sort((a, b) => direction * (Number(a.key) - Number(b.key)));
}
