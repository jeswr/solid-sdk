// AUTHORED-BY Claude Opus 5.5
import type { TakeoutItem, TakeoutPlan } from "./takeout";

export interface TakeoutImportSteps {
  /** Saves one batch; resolves with each item's photo IRI, or undefined when it failed. */
  upload(items: readonly TakeoutItem[]): Promise<(string | undefined)[]>;
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
  /** The photos that didn't save, with their albums, ready to import again. */
  retry?: TakeoutPlan;
  /** The import stopped early because whole batches kept failing (e.g. the pod is offline). */
  stopped?: boolean;
}

/** Photos per upload batch: keeps the UI responsive in libraries of many thousands. */
export const TAKEOUT_BATCH = 20;
/** Consecutive batches with no saved photo before the import gives up. */
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
    items.forEach((item, index) => {
      const ref = refs[index];
      if (ref) {
        saved.set(item.key, ref);
        any = true;
      } else failed.push(item);
    });
    failedBatches = any ? 0 : failedBatches + 1;
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
  if (!failed.length) return { saved: saved.size, albums, failedAlbums };
  const keys = new Set(failed.map((item) => item.key));
  return {
    saved: saved.size,
    albums,
    failedAlbums,
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
