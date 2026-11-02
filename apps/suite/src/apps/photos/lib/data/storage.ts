// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { PhotoIoError, type PreparedPhoto, photoStorage, type UploadInput } from "../model";
import { googlePhotosStorage } from "./google-photos";
import { requireEtag } from "./shared";
/** Strong validators prove which partial writes this adapter may clean up.
 * Successful creates without validators and every unsuccessful create retain
 * their prepared bytes for the same byte-verified resume path. An HTTP failure
 * (including a gateway error) cannot prove that the PUT did not commit. */
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
      // A PUT may have committed without returning a usable validator. Compare
      // exact prepared bytes and use that same fresh GET's strong ETag to resume.
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
    else if (binaryCreate) ambiguousBinaries.set(url, init?.body as Blob);
    return response;
  };
  return {
    ...photoStorage(observed, storage),
    googlePhotos: googlePhotosStorage(fetch, storage),
    createdBinaries,
    uploads,
    forgetBinary(url: string) {
      createdBinaries.delete(url);
      ambiguousBinaries.delete(url);
    },
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
