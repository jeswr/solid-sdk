// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { DatasetCore } from "@jeswr/fetch-rdf";
import { httpIriOrUndefined, isSafeAbsoluteIri, sanitizeText } from "@jeswr/model-runtime";
import { DataFactory } from "n3";
import { entities, type MediaLogData, nodes } from "./generated/model.js";

export const LOG_ENTRY = "https://jeswr.org/ns/media-log#LogEntry";
export const WORK_TYPES = {
  film: "https://schema.org/Movie",
  tv: "https://schema.org/TVSeries",
  episode: "https://schema.org/TVEpisode",
  book: "https://schema.org/Book",
  game: "https://schema.org/VideoGame",
} as const;
export type MediaKind = keyof typeof WORK_TYPES;
export const STATUSES = ["want", "in-progress", "finished", "abandoned"] as const;
export type MediaStatus = (typeof STATUSES)[number];
export interface MediaEntry {
  title: string;
  kind: MediaKind;
  status: MediaStatus;
  year?: number | undefined;
  creator?: string | undefined;
  cover?: string | undefined;
  started?: string | undefined;
  finished?: string | undefined;
  rating?: number | undefined;
  review?: string | undefined;
  repeatCount?: number | undefined;
  progress?: number | undefined;
  progressUnit?: "page" | "episode" | undefined;
  source?: string | undefined;
  origin?: string | undefined;
}

/** Calendar dates are deliberately timezone-free at the public boundary. */
export function isMediaDate(value: string): boolean {
  return (
    /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(new Date(value).getTime()) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function mediaUrl(value: string): string | undefined {
  if (!/^https?:\/\//.test(value) || !isSafeAbsoluteIri(value)) return undefined;
  const safe = httpIriOrUndefined(value);
  if (!safe) return undefined;
  const url = new URL(safe);
  return url.username || url.password ? undefined : safe;
}
/** Cross-field rules not expressible by the generator's closed SHACL admission. */
export function validateEntry(entry: MediaEntry): MediaEntry {
  if (!Object.hasOwn(WORK_TYPES, entry.kind) || !STATUSES.includes(entry.status))
    throw new TypeError("Choose a kind and shelf");
  const title = sanitizeText(entry.title).trim();
  if (!title || entry.title.length > 500)
    throw new TypeError("Enter a title of up to 500 characters");
  if (
    (entry.creator?.length ?? 0) > 500 ||
    (entry.source?.length ?? 0) > 500 ||
    (entry.review?.length ?? 0) > 20000
  )
    throw new TypeError("The creator, source or review is too long");
  for (const date of [entry.started, entry.finished])
    if (date !== undefined && !isMediaDate(date)) throw new TypeError("Choose a valid date");
  if (entry.started && entry.finished && entry.finished < entry.started)
    throw new TypeError("The finish date must be on or after the start date");
  if (entry.status !== "finished" && entry.finished)
    throw new TypeError("A finish date needs the Finished shelf");
  for (const value of [entry.progress, entry.repeatCount])
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
      throw new TypeError("Progress and repeats must be whole numbers, zero or above");
  if (
    entry.year !== undefined &&
    (!Number.isInteger(entry.year) || entry.year < 1000 || entry.year > 9999)
  )
    throw new TypeError("Enter a four-digit year");
  if (
    entry.rating !== undefined &&
    (!Number.isFinite(entry.rating) ||
      entry.rating < 0.5 ||
      entry.rating > 5 ||
      !Number.isInteger(entry.rating * 2))
  )
    throw new TypeError("Choose a rating from 0.5 to 5 in half-star steps");
  if (
    entry.progressUnit !== undefined &&
    entry.progressUnit !== "page" &&
    entry.progressUnit !== "episode"
  )
    throw new TypeError("Choose pages or episodes");
  for (const url of [entry.cover, entry.origin])
    if (url !== undefined && !mediaUrl(url))
      throw new TypeError("Use a full http or https URL without sign-in details");
  return { ...entry, title };
}
function generated(entry: MediaEntry): MediaLogData {
  const { kind, started, finished, ...rest } = validateEntry(entry);
  return {
    ...rest,
    rating: rest.rating as MediaLogData["rating"],
    workType: WORK_TYPES[kind],
    started: started ? new Date(started) : undefined,
    finished: finished ? new Date(finished) : undefined,
  };
}
export function buildMediaLog(url: string, entry: MediaEntry) {
  const data = generated(entry);
  const store = entities.MediaLog.build(url, data);
  // The work is both the sector's CreativeWork and the precise schema.org kind.
  new nodes.MediaLog.work.Wrapper(nodes.MediaLog.work.subject(url), store, DataFactory).types.add(
    data.workType,
  );
  if (!entities.MediaLog.parse(url, store)) throw new TypeError("This media entry cannot be saved");
  return store;
}
export async function serializeMediaLog(url: string, entry: MediaEntry): Promise<string> {
  return entities.MediaLog.storeToTurtle(buildMediaLog(url, entry));
}
export function parseMediaLog(url: string, dataset: DatasetCore): MediaEntry | undefined {
  const data = entities.MediaLog.parse(url, dataset);
  if (!data) return undefined;
  const kind = (Object.keys(WORK_TYPES) as MediaKind[]).find(
    (key) => WORK_TYPES[key] === data.workType,
  );
  if (!kind) return undefined;
  const { workType: _, started, finished, ...rest } = data;
  try {
    return validateEntry({
      ...rest,
      kind,
      status: data.status as MediaStatus,
      progressUnit: data.progressUnit as MediaEntry["progressUnit"],
      started: started?.toISOString().slice(0, 10),
      finished: finished?.toISOString().slice(0, 10),
    });
  } catch {
    return undefined;
  }
}
