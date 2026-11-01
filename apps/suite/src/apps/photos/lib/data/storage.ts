// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { PhotoIoError, type PreparedPhoto, photoStorage, type UploadInput } from "../model";
import { googlePhotosStorage } from "./google-photos";
import { requireEtag } from "./shared";
/** Validators from successful create-only binary PUTs prove which partial writes
 * this adapter may clean up. A failed request alone never establishes ownership. */
export function photoDataStorage(fetch: typeof globalThis.fetch, storage: string) {
  const root = new URL("photos/", storage).href;
  const createdBinaries = new Map<string, string>();
  const ambiguousBinaries = new Map<string, Blob>();
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
    const expected = ambiguousBinaries.get(url);
    if (binaryCreate && expected) {
      // A rejected PUT may already have committed. Compare the exact prepared
      // bytes and use the validator from that same fresh GET before resuming.
      const current = await scoped(url, { headers: { "cache-control": "no-cache" } });
      if (current.status !== 404) {
        if (!current.ok) throw new PhotoIoError(url, current.status);
        const etag = requireEtag(current.headers.get("etag"));
        const actual = new Uint8Array(await current.arrayBuffer());
        const bytes = new Uint8Array(await expected.arrayBuffer());
        if (actual.length !== bytes.length || !actual.every((byte, i) => byte === bytes[i]))
          throw new PhotoIoError(url, 412);
        createdBinaries.set(url, etag);
        ambiguousBinaries.delete(url);
        return new Response(null, { status: 201, headers: { etag } });
      }
      ambiguousBinaries.delete(url);
    }
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
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      // The model supplies Blob bodies for both binary stages. Retain the same
      // prepared bytes; a fresh ID/input must never adopt this ambiguous write.
      if (binaryCreate) ambiguousBinaries.set(url, init?.body as Blob);
      throw error;
    }
    const etag = response.headers.get("etag");
    if (binaryCreate && response.ok && etag && !etag.startsWith("W/"))
      createdBinaries.set(url, etag);
    return response;
  };
  return {
    ...photoStorage(observed, storage),
    googlePhotos: googlePhotosStorage(fetch, storage),
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
