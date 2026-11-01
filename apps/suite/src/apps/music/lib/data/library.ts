// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import {
  assertWithinPodScope,
  createPodScopedFetch,
  normalizePodBase,
  podScopedUrl,
} from "@jeswr/guarded-fetch";
import { Container } from "@solid/object";
import { createNameComparator, groupAlbums, groupArtists, type LibraryTrack } from "../library";
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
import { S } from "../model/vocab";

export interface MusicTrack extends LibraryTrack {
  artistId: string;
  loved: boolean;
  imageUrl: string | undefined;
  sourceUrl: string | undefined;
  added: string;
}
export interface Library {
  tracks: MusicTrack[];
  albums: ReturnType<typeof groupAlbums>;
  artists: (ReturnType<typeof groupArtists>[number] & { id: string })[];
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
      doc = await loadMusic(scoped, url);
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
  const tracks: MusicTrack[] = models.tracks.map((track) => {
    const artist = track.artists[0];
    const album = track.album;
    return {
      id: track.value,
      title: track.title,
      artist: artist?.name ?? "Unknown artist",
      artistId:
        artist?.iri ??
        new URL(
          `artists/inferred-${encodeURIComponent(artist?.name ?? "unknown")}`,
          musicRoot(root),
        ).href,
      albumId:
        album?.iri ??
        new URL(`albums/inferred-${encodeURIComponent(album?.name ?? "unknown")}`, musicRoot(root))
          .href,
      albumTitle: album?.name ?? "Unknown album",
      loved: track.loved,
      imageUrl: track.imageUrl,
      sourceUrl: track.sourceUrl,
      durationSeconds:
        track.durationSeconds === undefined ? undefined : Math.floor(track.durationSeconds),
      ...(Number(track.strings(`${S}discNumber`)[0])
        ? { discNumber: Number(track.strings(`${S}discNumber`)[0]) }
        : {}),
      ...(Number(track.strings(`${S}trackNumber`, `${S}position`)[0])
        ? { trackNumber: Number(track.strings(`${S}trackNumber`, `${S}position`)[0]) }
        : {}),
      added: track.strings(`${S}dateCreated`)[0] ?? "",
    };
  });
  const albums = groupAlbums(tracks);
  for (const album of models.albums) {
    if (!albums.some((group) => group.id === album.value))
      albums.push({
        id: album.value,
        title: album.title,
        artist: album.artists[0]?.name ?? "Unknown artist",
        compilation: false,
        tracks: [],
        durationSeconds: 0,
      });
  }
  const artists = groupArtists(tracks).map((artist) => ({
    ...artist,
    id: (tracks.find((track) => track.artist === artist.name) as MusicTrack).artistId,
  }));
  for (const artist of models.artists) {
    if (!artists.some((group) => group.id === artist.value))
      artists.push({
        id: artist.value,
        name: artist.title,
        albumIds: models.albums
          .filter((album) => album.artists.some((ref) => ref.iri === artist.value))
          .map((album) => album.value),
        tracks: [],
        durationSeconds: 0,
      });
  }
  const compare = createNameComparator();
  albums.sort((a, b) => compare(a.title, b.title));
  artists.sort((a, b) => compare(a.name, b.name));
  return { tracks, models, documents, albums, artists };
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
