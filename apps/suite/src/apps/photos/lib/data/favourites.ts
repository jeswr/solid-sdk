// AUTHORED-BY Codex GPT-6
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { PhotoIoError, setFavourite } from "../model";
import { requireEtag } from "./shared";

export interface Preferences {
  favourites: string[];
  etag: string | null;
  exists: boolean;
}
export interface PreferenceStore {
  read(): Promise<Preferences>;
  write(value: Preferences): Promise<void>;
}
export function preferenceStore(fetch: typeof globalThis.fetch, storage: string): PreferenceStore {
  const root = new URL("photos/", storage).href;
  const url = `${root}preferences.json`;
  const scoped = createPodScopedFetch(root, { fetch });
  return {
    async read() {
      const response = await scoped(url, { headers: { "cache-control": "no-cache" } });
      if (response.status === 404) return { favourites: [], etag: null, exists: false };
      if (!response.ok) throw new PhotoIoError(url, response.status);
      const value: unknown = await response.json();
      if (
        !value ||
        typeof value !== "object" ||
        !("favourites" in value) ||
        !Array.isArray(value.favourites) ||
        value.favourites.some(
          (ref: unknown) => typeof ref !== "string" || !/^https?:\/\//.test(ref),
        )
      )
        throw new TypeError("Invalid photo preferences");
      return {
        favourites: [...new Set(value.favourites as string[])],
        etag: response.headers.get("etag"),
        exists: true,
      };
    },
    async write(value) {
      const response = await scoped(url, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...(value.exists ? { "if-match": requireEtag(value.etag) } : { "if-none-match": "*" }),
        },
        body: JSON.stringify({ favourites: value.favourites }),
      });
      if (!response.ok) throw new PhotoIoError(url, response.status);
    },
  };
}
export async function setFavourites(
  store: PreferenceStore,
  refs: readonly string[],
  enabled: boolean,
) {
  const current = await store.read();
  const favourites = refs.reduce(
    (value, ref) => setFavourite(value, ref, enabled),
    current.favourites,
  );
  await store.write({ ...current, favourites });
}
