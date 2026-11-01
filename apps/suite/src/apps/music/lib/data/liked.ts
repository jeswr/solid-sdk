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

// Retain failed mirror work independently of the track mutation, until a refresh repairs it.
const pending = new WeakMap<typeof globalThis.fetch, Set<string>>();
export class LikedSyncPendingError extends Error {
  constructor(cause: unknown) {
    super("Liked flag saved; playlist synchronization is pending", { cause });
  }
}

/** Track flags are authoritative; a mirror failure must never be reported as a failed track save. */
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
  const roots = pending.get(fetch) ?? new Set<string>();
  roots.add(musicRoot(storage));
  pending.set(fetch, roots);
  try {
    await retryLikedSync(fetch, storage);
  } catch (cause) {
    throw new LikedSyncPendingError(cause);
  }
}

/** Re-read both the authoritative flags and mirror ETag on every retry, including after a 412. */
export async function retryLikedSync(
  fetch: typeof globalThis.fetch,
  storage: string,
  library?: Library,
): Promise<boolean> {
  let roots = pending.get(fetch);
  // Recover after reopening the app with a new fetch facade too: flags remain
  // authoritative even when the previous session's in-memory marker is gone.
  if (library) {
    const expected = library.models.tracks
      .filter((track) => track.loved)
      .map((track) => track.value)
      .sort();
    const mirror = library.models.playlists.find(
      (playlist) => playlist.value === `${musicRoot(storage)}playlists/liked.ttl#it`,
    );
    const actual = mirror ? [...mirror.tracks].sort() : [];
    if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
      roots ??= new Set<string>();
      roots.add(musicRoot(storage));
      pending.set(fetch, roots);
    }
  }
  if (!roots?.has(musicRoot(storage))) return false;
  const scoped = createPodScopedFetch(storage, { fetch });
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
  roots.delete(musicRoot(storage));
  return true;
}
