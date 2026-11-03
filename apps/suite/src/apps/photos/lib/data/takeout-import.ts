// AUTHORED-BY Claude Opus 5.5
import { statusOf } from "./shared";
import type { TakeoutItem, TakeoutPlan } from "./takeout";

/**
 * Why a photo didn't save: the pod (worth retrying, and a run of these means the
 * pod has stopped saving) or the photo itself (retrying won't help).
 */
export type TakeoutFailure = { kind: "pod" } | { kind: "photo"; reason: string };
export interface UnreadablePhoto {
  key: string;
  name: string;
  reason: string;
}

/** Sorts an upload error into a pod problem or a photo this browser can't import. */
export function takeoutFailure(
  error: unknown,
  type: string,
  stripLocation: boolean,
): TakeoutFailure {
  // Server errors, timeouts, rate limits and network failures are the pod's; other
  // statuses (413, 415, …) and validation errors are about this one photo.
  const status = statusOf(error);
  if (status !== undefined && (status >= 500 || status === 408 || status === 429))
    return { kind: "pod" };
  if (
    status === undefined &&
    error instanceof TypeError &&
    /fetch|network|load failed/iu.test(error.message)
  )
    return { kind: "pod" };
  if (status !== undefined)
    return { kind: "photo", reason: `Your pod refused this photo (error ${status}).` };
  if (stripLocation && /^image\/(heic|heif|tiff|avif)$/u.test(type))
    return {
      kind: "photo",
      reason:
        "Location can't be removed from this format here. Turn off Remove location to import it.",
    };
  return { kind: "photo", reason: "This browser couldn't read this photo." };
}

export interface TakeoutImportSteps {
  /** Saves one batch; resolves with each item's photo IRI, or why it failed. */
  upload(items: readonly TakeoutItem[]): Promise<(string | TakeoutFailure)[]>;
  /** The URL of an existing album with this title. */
  findAlbum(title: string): string | undefined;
  addToAlbum(url: string, title: string, refs: string[]): Promise<boolean>;
  createAlbum(title: string, refs: string[]): Promise<boolean>;
  onProgress?(done: number, total: number): void;
  /** Called once the photos are saved, before albums are written. */
  onAlbums?(): void;
}
export interface TakeoutImportResult {
  saved: number;
  albums: number;
  /** Albums whose photos saved but which couldn't be written. */
  failedAlbums: number;
  /** The photos that didn't save because of the pod, with their albums, ready to import again. */
  retry?: TakeoutPlan;
  /** Photos that can't be imported as they are; retrying won't help. */
  unreadable: UnreadablePhoto[];
  /** The import stopped early because whole batches kept failing (e.g. the pod is offline). */
  stopped?: boolean;
}

/** Photos per upload batch: keeps the UI responsive in libraries of many thousands. */
export const TAKEOUT_BATCH = 20;
/** Consecutive batches with pod failures and no saved photo before the import gives up. */
export const STOP_AFTER_FAILED_BATCHES = 3;

/**
 * Imports a Takeout plan in batches, then files the saved photos into albums
 * (adding to an album of the same title when one exists). Photos that fail are
 * returned as a smaller plan that keeps their albums, so a retry files them too.
 */
export async function importTakeoutPlan(
  plan: TakeoutPlan,
  steps: TakeoutImportSteps,
  batch = TAKEOUT_BATCH,
): Promise<TakeoutImportResult> {
  const saved = new Map<string, string>();
  const failed: TakeoutItem[] = [];
  const unreadable: UnreadablePhoto[] = [];
  let stopped = false;
  let failedBatches = 0;
  steps.onProgress?.(0, plan.items.length);
  for (let start = 0; start < plan.items.length; start += batch) {
    if (failedBatches >= STOP_AFTER_FAILED_BATCHES) {
      // Keep the rest for a retry rather than reading and failing every photo.
      failed.push(...plan.items.slice(start));
      stopped = true;
      break;
    }
    const items = plan.items.slice(start, start + batch);
    const refs = await steps.upload(items);
    let any = false;
    let pod = false;
    items.forEach((item, index) => {
      const outcome = refs[index] ?? { kind: "pod" };
      if (typeof outcome === "string") {
        saved.set(item.key, outcome);
        any = true;
      } else if (outcome.kind === "photo") {
        unreadable.push({ key: item.key, name: item.name, reason: outcome.reason });
      } else {
        failed.push(item);
        pod = true;
      }
    });
    // Photos that can't be read say nothing about the pod.
    if (any) failedBatches = 0;
    else if (pod) failedBatches += 1;
    steps.onProgress?.(Math.min(start + batch, plan.items.length), plan.items.length);
  }
  if (plan.albums.length && saved.size) steps.onAlbums?.();
  let albums = 0;
  let failedAlbums = 0;
  for (const album of plan.albums) {
    const refs = album.keys.flatMap((key) => saved.get(key) ?? []);
    if (!refs.length) continue;
    const existing = steps.findAlbum(album.title);
    const ok = existing
      ? await steps.addToAlbum(existing, album.title, refs)
      : await steps.createAlbum(album.title, refs);
    if (ok) albums += 1;
    else failedAlbums += 1;
  }
  if (!failed.length) return { saved: saved.size, albums, failedAlbums, unreadable };
  const keys = new Set(failed.map((item) => item.key));
  return {
    saved: saved.size,
    albums,
    failedAlbums,
    unreadable,
    ...(stopped ? { stopped } : {}),
    retry: {
      ...plan,
      items: failed,
      albums: plan.albums
        .map((album) => ({ ...album, keys: album.keys.filter((key) => keys.has(key)) }))
        .filter((album) => album.keys.length),
      withDetails: failed.filter((item) => item.metadata && Object.keys(item.metadata).length)
        .length,
      duplicates: 0,
    },
  };
}
