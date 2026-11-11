// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { MediaEntry, MediaKind, MediaRecord, MediaStatus } from "@jeswr/solid-media-log";
export const KIND_LABELS: Record<MediaKind, string> = {
  film: "Films",
  tv: "TV",
  episode: "TV episodes",
  book: "Books",
  game: "Games",
};
export const STATUS_LABELS: Record<MediaStatus, string> = {
  want: "Want to try",
  "in-progress": "In progress",
  finished: "Finished",
  abandoned: "Abandoned",
};
export interface MediaFilters {
  kind: "all" | Exclude<MediaKind, "episode">;
  status: "all" | MediaStatus;
  query: string;
  rated: boolean;
}
export function filterMedia(records: readonly MediaRecord[], filters: MediaFilters): MediaRecord[] {
  const query = filters.query.trim().toLocaleLowerCase("en-GB");
  return records
    .filter(
      ({ data }) =>
        (filters.kind === "all" ||
          data.kind === filters.kind ||
          (filters.kind === "tv" && data.kind === "episode")) &&
        (filters.status === "all" || data.status === filters.status) &&
        (!filters.rated || data.rating !== undefined) &&
        (!query ||
          [data.title, data.creator, data.year, data.review, data.source]
            .filter((value) => value !== undefined)
            .join(" ")
            .toLocaleLowerCase("en-GB")
            .includes(query)),
    )
    .sort((a, b) => a.data.title.localeCompare(b.data.title, "en-GB"));
}
/** Only fields changed in the editor enter the persistence queue. */
export function entryPatch(before: MediaEntry, after: MediaEntry): Partial<MediaEntry> {
  const patch: Partial<MediaEntry> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]) as Set<
    keyof MediaEntry
  >) {
    if (before[key] !== after[key]) Object.assign(patch, { [key]: after[key] });
  }
  return patch;
}

/** Use the user's calendar day, including near UTC midnight. */
export function localMediaDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
