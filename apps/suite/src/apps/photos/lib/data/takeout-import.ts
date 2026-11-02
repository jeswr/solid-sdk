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
}
export interface TakeoutImportResult {
  saved: number;
  albums: number;
  /** Albums whose photos saved but which couldn't be written. */
  failedAlbums: number;
  /** The photos that didn't save, with their albums, ready to import again. */
  retry?: TakeoutPlan;
}

/** Photos per upload batch: keeps the UI responsive in libraries of many thousands. */
export const TAKEOUT_BATCH = 20;

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
  steps.onProgress?.(0, plan.items.length);
  for (let start = 0; start < plan.items.length; start += batch) {
    const items = plan.items.slice(start, start + batch);
    const refs = await steps.upload(items);
    items.forEach((item, index) => {
      const ref = refs[index];
      if (ref) saved.set(item.key, ref);
      else failed.push(item);
    });
    steps.onProgress?.(Math.min(start + batch, plan.items.length), plan.items.length);
  }
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
