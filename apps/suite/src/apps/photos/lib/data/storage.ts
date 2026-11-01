// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { PhotoIoError, type PreparedPhoto, photoStorage, type UploadInput } from "../model";
/** Validators from successful create-only binary PUTs prove which partial writes
 * this adapter may clean up. A failed request alone never establishes ownership. */
export function photoDataStorage(fetch: typeof globalThis.fetch, storage: string) {
  const root = new URL("photos/", storage).href;
  const createdBinaries = new Map<string, string>();
  const uploads = new Map<string, { input: UploadInput; prepared: PreparedPhoto; now: string }>();
  const scoped = createPodScopedFetch(root, { fetch });
  const observed: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const binaryCreate =
      init?.method === "PUT" &&
      new Headers(init.headers).get("if-none-match") === "*" &&
      !url.endsWith("/") &&
      (url.startsWith(`${root}originals/`) || url.startsWith(`${root}thumbs/`));
    const owned = createdBinaries.get(url);
    if (binaryCreate && owned) {
      const current = await scoped(url, {
        method: "HEAD",
        headers: { "if-match": owned, "cache-control": "no-cache" },
      });
      if (current.status === 404) createdBinaries.delete(url);
      else {
        if (!current.ok) throw new PhotoIoError(url, current.status);
        if (current.headers.get("etag") !== owned) throw new PhotoIoError(url, 412);
        return new Response(null, { status: 201, headers: { etag: owned } });
      }
    }
    const response = await fetch(input, init);
    const etag = response.headers.get("etag");
    if (binaryCreate && response.ok && etag && !etag.startsWith("W/"))
      createdBinaries.set(url, etag);
    return response;
  };
  return {
    ...photoStorage(observed, storage),
    createdBinaries,
    uploads,
    async ownsBinary(url: string) {
      const owned = createdBinaries.get(url);
      if (!owned) return false;
      const current = await scoped(url, {
        method: "HEAD",
        headers: { "if-match": owned, "cache-control": "no-cache" },
      });
      return current.ok && current.headers.get("etag") === owned;
    },
  };
}
export type PhotoDataStorage = ReturnType<typeof photoDataStorage>;
