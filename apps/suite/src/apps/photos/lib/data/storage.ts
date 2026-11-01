// AUTHORED-BY Codex GPT-6
import { photoStorage } from "../model";
/** Validators from successful create-only binary PUTs prove which partial writes
 * this adapter may clean up. A failed request alone never establishes ownership. */
export function photoDataStorage(fetch: typeof globalThis.fetch, storage: string) {
  const root = new URL("photos/", storage).href;
  const createdBinaries = new Map<string, string>();
  const observed: typeof globalThis.fetch = async (input, init) => {
    const response = await fetch(input, init);
    const url = String(input);
    const etag = response.headers.get("etag");
    if (
      init?.method === "PUT" &&
      new Headers(init.headers).get("if-none-match") === "*" &&
      (url.startsWith(`${root}originals/`) || url.startsWith(`${root}thumbs/`)) &&
      response.ok &&
      etag &&
      !etag.startsWith("W/")
    )
      createdBinaries.set(url, etag);
    return response;
  };
  return { ...photoStorage(observed, storage), createdBinaries };
}
export type PhotoDataStorage = ReturnType<typeof photoDataStorage>;
