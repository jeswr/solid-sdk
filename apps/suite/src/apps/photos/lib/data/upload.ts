// AUTHORED-BY Codex GPT-6
import { isomorphic } from "rdf-isomorphic";
import {
  buildPhoto,
  type CaptureMetadata,
  type ImageEncoder,
  type PreparedPhoto,
  preparePhoto,
} from "../model";
import { statusOf } from "./shared";
import type { PhotoDataStorage } from "./storage";

export interface UploadFile {
  name: string;
  original: Blob;
  /** Outside details (e.g. a Takeout sidecar) that fill gaps in the file's EXIF. */
  metadata?: CaptureMetadata | undefined;
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
      const retry = io.uploads.get(id);
      if (
        retry &&
        (retry.input.original !== file.original ||
          retry.input.name !== file.name ||
          retry.input.metadata !== file.metadata ||
          retry.input.stripLocation !== options.stripLocation)
      )
        throw new TypeError("Retry must use the same upload input");
      prepared =
        retry?.prepared ??
        (await preparePhoto(new URL("../", io.root).href, input, options.encoder, options.now));
      const now = retry?.now ?? options.now;
      io.uploads.set(id, { input, prepared, now });
      options.onProgress?.(index, 30);
      const ready = prepared;
      // Preparation is cached; the model owns the create-only upload sequence.
      const encoder: ImageEncoder = {
        dimensions: async () => ({
          width: ready.photo.exif.pixelWidth as number,
          height: ready.photo.exif.pixelHeight as number,
          durationSeconds: ready.photo.durationSeconds,
        }),
        stripLocation: async () => ready.original,
        thumbnail: async () => ready.thumbnail,
      };
      await io.uploadPhotos([input], encoder, now);
      options.onProgress?.(index, 100);
      io.forgetBinary(prepared.photo.contentUrl);
      io.forgetBinary(prepared.photo.thumbnailUrl as string);
      io.uploads.delete(id);
      results.push({ ok: true, url: prepared.itemUrl, id });
    } catch (error) {
      // Never delete a create-only collision. Metadata may have reached the pod even
      // when its response was lost; in that case keep both binaries for reconciliation.
      if (prepared) {
        try {
          const existing = await io.read(prepared.itemUrl).catch((failure: unknown) => {
            if (statusOf(failure) === 404) return null;
            throw failure;
          });
          if (
            existing &&
            (await io.ownsBinary(prepared.photo.contentUrl)) &&
            (await io.ownsBinary(prepared.photo.thumbnailUrl as string)) &&
            isomorphic([...existing.dataset], [...buildPhoto(prepared.itemUrl, prepared.photo)])
          ) {
            io.forgetBinary(prepared.photo.contentUrl);
            io.forgetBinary(prepared.photo.thumbnailUrl as string);
            io.uploads.delete(id);
            options.onProgress?.(index, 100);
            results.push({ ok: true, url: prepared.itemUrl, id });
            continue;
          }
          if (!existing && statusOf(error) !== 412) {
            for (const url of [prepared.photo.contentUrl, prepared.photo.thumbnailUrl as string]) {
              const etag = io.createdBinaries.get(url);
              if (etag) {
                await io.remove(url, etag);
                io.forgetBinary(url);
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
