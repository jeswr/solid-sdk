// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { fetchRdf } from "@jeswr/fetch-rdf";
import { createPodScopedFetch, refuseRedirects } from "@jeswr/guarded-fetch";
import { parsePhotos } from "@jeswr/solid-photos";
import { Container } from "@solid/object";
import { DataFactory } from "n3";
import type { LibraryPhoto } from "./library";
import { children, collect, type Listed } from "./shared";

/** Read-only seam for the connector's existing layout, isolated from Photos writes. */
export function googlePhotosStorage(fetch: typeof globalThis.fetch, storage: string) {
  const root = new URL("integrations/google-photos/media/", storage).href;
  const scoped = createPodScopedFetch(root, { fetch: refuseRedirects(fetch) });
  const read = (url: string) =>
    fetchRdf(url, { fetch: scoped, headers: { "cache-control": "no-cache" } });
  return {
    root,
    async listPhotos(): Promise<Listed<LibraryPhoto>> {
      let urls: string[];
      try {
        urls = await children(
          {
            root,
            async list(url) {
              const { dataset } = await read(url);
              return [...new Container(url, dataset, DataFactory).contains].map((item) => item.id);
            },
          },
          "",
        );
      } catch (error) {
        return { items: [], failures: [{ url: root, error }] };
      }
      return collect(urls, async (url) => {
        const { dataset, etag } = await read(url);
        return parsePhotos(url, dataset).map(({ subject, photo }) => ({
          ...photo,
          ref: subject,
          url,
          etag,
          readOnly: true,
          source: "google-photos" as const,
        }));
      });
    },
  };
}
