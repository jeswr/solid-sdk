// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import {
  loadMusic,
  Store,
  saveMusic,
  syncLikedPlaylist,
  Track,
  type WriteCondition,
} from "../model";
import { documentUrl, type Library, loadLibrary, musicRoot, requireEtag } from "./library";

/** Track flags are authoritative. Rebuild the interoperability playlist even after a partial prior failure. */
export async function setLiked(
  fetch: typeof globalThis.fetch,
  storage: string,
  library: Library,
  iri: string,
  loved: boolean,
): Promise<void> {
  const url = documentUrl(storage, iri);
  const scoped = createPodScopedFetch(storage, { fetch });
  const doc = await loadMusic(scoped, url);
  new Track(iri, doc.dataset).loved = loved;
  await saveMusic(fetch, storage, url, doc.dataset, {
    ifMatch: requireEtag(library.documents.get(url)?.etag ?? null),
  });
  const likedUrl = new URL("playlists/liked.ttl", musicRoot(storage)).href;
  let dataset: Store;
  let condition: WriteCondition;
  try {
    const liked = await loadMusic(scoped, likedUrl);
    dataset = liked.dataset;
    condition = { ifMatch: requireEtag(liked.etag) };
  } catch (error) {
    if (!(error instanceof RdfFetchError) || error.status !== 404) throw error;
    dataset = new Store();
    condition = { ifNoneMatch: "*" };
  }
  const fresh = await loadLibrary(fetch, storage);
  syncLikedPlaylist(dataset, `${likedUrl}#it`, fresh.models.tracks);
  await saveMusic(fetch, storage, likedUrl, dataset, condition);
}
