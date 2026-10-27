// AUTHORED-BY Codex GPT-6.1-Sol
import type { TimelinePhoto } from "./capture";
import { groupPhotos, type PhotoGroup, type TimelineOptions } from "./timeline";
import { requireTimeline } from "./validation";

export interface TimelineSection<T> extends PhotoGroup<T> {
  /** Index into the flattened sequence of photos, excluding headers. */
  startPhotoIndex: number;
  /** Header index in rows, inclusive. Keep it mounted while this section is visible. */
  headerIndex: number;
  /** Index after this section's final photo row, exclusive. */
  endIndexExclusive: number;
}

export type TimelineGridRow<T> =
  | { kind: "header"; key: string; sectionKey: string }
  | { kind: "photos"; key: string; sectionKey: string; photos: T[]; startPhotoIndex: number };

export interface TimelineGrid<T> {
  sections: TimelineSection<T>[];
  rows: TimelineGridRow<T>[];
  stickyHeaderIndices: number[];
  photoCount: number;
}

/** Structural virtualizer model; each section starts a fresh grid row, including partial rows. */
export function buildTimelineSections<T extends TimelinePhoto>(
  photos: readonly T[],
  options: TimelineOptions & { readonly columns: number },
): TimelineGrid<T> {
  requireTimeline(options && typeof options === "object", "invalid-options");
  requireTimeline(Number.isSafeInteger(options.columns) && options.columns > 0, "invalid-options");
  const groups = groupPhotos(photos, options);
  const sections: TimelineSection<T>[] = [];
  const rows: TimelineGridRow<T>[] = [];
  const stickyHeaderIndices: number[] = [];
  let photoCount = 0;
  for (const group of groups) {
    const headerIndex = rows.length;
    stickyHeaderIndices.push(headerIndex);
    rows.push({ kind: "header", key: `header:${group.key}`, sectionKey: group.key });
    for (let i = 0; i < group.photos.length; i += options.columns) {
      const rowPhotos = group.photos.slice(i, i + options.columns);
      rows.push({
        kind: "photos",
        key: `photos:${group.key}:${(rowPhotos[0] as T).id}`,
        sectionKey: group.key,
        photos: rowPhotos,
        startPhotoIndex: photoCount + i,
      });
    }
    sections.push({
      ...group,
      startPhotoIndex: photoCount,
      headerIndex,
      endIndexExclusive: rows.length,
    });
    photoCount += group.photos.length;
  }
  return { sections, rows, stickyHeaderIndices, photoCount };
}
