// AUTHORED-BY Codex GPT-6
import { extractMediaType, RdfFetchError, SUPPORTED_RDF_MEDIA_TYPES } from "@jeswr/fetch-rdf";
import {
  assertWithinPodScope,
  createPodScopedFetch,
  normalizePodBase,
  podScopedUrl,
} from "@jeswr/guarded-fetch";
import { Container } from "@solid/object";
import { createNameComparator, type LibraryAlbum, type LibraryTrack } from "../library";
import {
  DataFactory,
  InvalidMusicError,
  loadMusic,
  type MusicDocument,
  MusicWriteError,
  readLibrary,
  Store,
  saveMusic,
} from "../model";
import { normalizeLibrary } from "./normalize";

const rdfMediaTypes = new Set<string>(SUPPORTED_RDF_MEDIA_TYPES);

export interface MusicTrack extends LibraryTrack {
  contentUrl?: string | undefined;
  lyricsUrl?: string | undefined;
  artistId: string;
  artistIds: string[];
  loved: boolean;
  imageUrl: string | undefined;
  sourceUrl: string | undefined;
  added: string;
}
export interface Library {
  tracks: MusicTrack[];
  albums: LibraryAlbum[];
  artists: {
    id: string;
    /** The model's statistics key: an IRI, or a literal-only credit. */
    key: string;
    name: string;
    albumIds: string[];
    tracks: MusicTrack[];
    durationSeconds: number | undefined;
  }[];
  models: ReturnType<typeof readLibrary>;
  documents: Map<string, MusicDocument>;
}
export const musicRoot = (storage: string): string =>
  new URL("music/", normalizePodBase(storage)).href;

export async function provision(fetch: typeof globalThis.fetch, storage: string): Promise<void> {
  const root = normalizePodBase(storage);
  const scoped = createPodScopedFetch(root, { fetch, maxRedirects: 0 });
  for (const path of [
    "music/",
    "music/tracks/",
    "music/albums/",
    "music/artists/",
    "music/playlists/",
    "music/history/",
    "music/files/",
  ]) {
    const response = await scoped(new URL(path, root).href, {
      method: "PUT",
      headers: {
        "If-None-Match": "*",
        "Content-Type": "text/turtle",
        Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      },
      body: "",
    });
    if (!response.ok && response.status !== 412)
      throw new MusicWriteError(response.status, response.headers.get("etag"));
  }
}

/** Listings are untrusted. Only descendants are followed, and only RDF documents are read. */
export async function loadLibrary(
  fetch: typeof globalThis.fetch,
  storage: string,
): Promise<Library> {
  const root = normalizePodBase(storage);
  const scoped = createPodScopedFetch(root, { fetch });
  const dataset = new Store();
  const documents = new Map<string, MusicDocument>();
  async function walk(url: string): Promise<void> {
    let doc: MusicDocument;
    try {
      const response = await scoped(url, {
        headers: { Accept: "text/turtle, application/ld+json;q=0.9" },
      });
      if (
        response.ok &&
        !rdfMediaTypes.has(extractMediaType(response.headers.get("content-type")) ?? "text/turtle")
      ) {
        await response.body?.cancel();
        return;
      }
      // Reuse the response; the model still owns parsing and blank-node scoping.
      doc = await loadMusic(async () => response, url);
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) return;
      throw error;
    }
    dataset.addQuads([...doc.dataset]);
    if (!url.endsWith("/")) {
      documents.set(url, doc);
      return;
    }
    for (const member of new Container(url, doc.dataset, DataFactory).contains) {
      if (member.termType !== "NamedNode") continue;
      const child = podScopedUrl(url, member.value, { allowRoot: false });
      if (!child || child.startsWith(new URL("history/", musicRoot(root)).href)) continue;
      if (child !== new URL("preferences.json", musicRoot(root)).href) await walk(child);
    }
  }
  await walk(musicRoot(root));
  await walk(new URL("integrations/spotify/music/", root).href);
  const models = readLibrary(dataset);
  const { tracks, albums, artists } = normalizeLibrary(models, musicRoot(root));
  return { tracks, models, documents, albums, artists };
}

/**
 * Refreshes rendered tracks from the live library while keeping each row's album context:
 * album views pass album-specific copies of tracks that appear on several albums.
 */
export function withLiveState(
  tracks: MusicTrack[],
  live: readonly MusicTrack[] = [],
): MusicTrack[] {
  const current = new Map(live.map((track) => [track.id, track]));
  return tracks.map((track) => {
    const fresh = current.get(track.id);
    return fresh ? { ...fresh, albumId: track.albumId, albumTitle: track.albumTitle } : track;
  });
}

export function search(library: Library, query: string): MusicTrack[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/u);
  return library.tracks.filter((track) =>
    words.every((word) =>
      `${track.title} ${track.artist} ${track.albumTitle}`.toLocaleLowerCase().includes(word),
    ),
  );
}
export function sortTracks(
  tracks: readonly MusicTrack[],
  by: "title" | "artist" | "albumTitle" | "added",
): MusicTrack[] {
  const compare = createNameComparator();
  return [...tracks].sort((a, b) =>
    by === "added"
      ? b.added.localeCompare(a.added) || compare(a.title, b.title)
      : compare(a[by], b[by]) || compare(a.title, b.title),
  );
}

export function requireEtag(etag: string | null): string {
  if (!etag)
    throw new InvalidMusicError("This storage did not provide an ETag. Refresh before saving.");
  return etag;
}
export function documentUrl(storage: string, iri: string): string {
  const target = new URL(
    assertWithinPodScope(normalizePodBase(storage), iri, { allowRoot: false }),
  );
  target.hash = "";
  return target.href;
}
export async function createDocument(
  fetch: typeof globalThis.fetch,
  storage: string,
  url: string,
  dataset: Store,
): Promise<void> {
  await saveMusic(fetch, storage, url, dataset, { ifNoneMatch: "*" });
}
