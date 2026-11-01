// AUTHORED-BY Codex GPT-6
import { type ImageEncoder, type PreparedPhoto, preparePhoto } from "../model";
import { statusOf } from "./shared";
import type { PhotoDataStorage } from "./storage";

export interface UploadFile {
  name: string;
  original: Blob;
}
export interface UploadOptions {
  encoder: ImageEncoder;
  stripLocation: boolean;
  now: string;
  id: () => string;
  onProgress?: (index: number, progress: number) => void;
}
export type UploadResult =
  | { ok: true; url: string; id: string }
  | { ok: false; error: unknown; id: string };
/** Each file is a separate model batch. Clean up unpublished partial writes before retry. */
export async function uploadFiles(
  io: PhotoDataStorage,
  files: readonly UploadFile[],
  options: UploadOptions,
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  for (const [index, file] of files.entries()) {
    const id = options.id();
    let prepared: PreparedPhoto | undefined;
    try {
      options.onProgress?.(index, 0);
      const input = { ...file, id, stripLocation: options.stripLocation };
      prepared = await preparePhoto(
        new URL("../", io.root).href,
        input,
        options.encoder,
        options.now,
      );
      options.onProgress?.(index, 30);
      const ready = prepared;
      // Preparation is cached; the model owns the create-only upload sequence.
      const encoder: ImageEncoder = {
        dimensions: async () => ({
          width: ready.photo.exif.pixelWidth as number,
          height: ready.photo.exif.pixelHeight as number,
        }),
        stripLocation: async () => ready.original,
        thumbnail: async () => ready.thumbnail,
      };
      await io.uploadPhotos([input], encoder, options.now);
      options.onProgress?.(index, 100);
      io.createdBinaries.delete(prepared.photo.contentUrl);
      io.createdBinaries.delete(prepared.photo.thumbnailUrl as string);
      results.push({ ok: true, url: prepared.itemUrl, id });
    } catch (error) {
      // Never delete a create-only collision. Metadata may have reached the pod even
      // when its response was lost; in that case keep both binaries for reconciliation.
      if (prepared && statusOf(error) !== 412) {
        try {
          const listing = await io.loadPhotos(prepared.itemUrl).catch((failure: unknown) => {
            if (statusOf(failure) === 404) return { photos: [] };
            throw failure;
          });
          if (!listing.photos.length) {
            for (const url of [prepared.photo.contentUrl, prepared.photo.thumbnailUrl as string]) {
              const etag = io.createdBinaries.get(url);
              if (etag) {
                await io.remove(url, etag);
                io.createdBinaries.delete(url);
              }
            }
          }
        } catch {
          /* Preserve recoverable binaries when storage is unavailable. */
        }
      }
      results.push({ ok: false, error, id });
    }
  }
  return results;
}
