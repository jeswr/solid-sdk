// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import {
  assertWithinPodScope,
  createPodScopedFetch,
  normalizePodBase,
  podScopedUrl,
} from "@jeswr/guarded-fetch";
import { listContainer } from "@/apps/drive/lib/model/drive";
import { parseLrc } from "../lyrics";
import { type AudioMetadata, extractAudioCover, extractAudioMetadata } from "../metadata/metadata";
import {
  Album,
  Artist,
  loadMusic,
  type MusicDocument,
  type MusicNode,
  MusicWriteError,
  nameKey,
  Store,
  saveMusic,
  Track,
} from "../model";
import { M, MO, NS, S } from "../model/vocab";
import {
  documentUrl,
  type Library,
  loadLibrary,
  musicRoot,
  provision,
  requireEtag,
} from "./library";
import { fingerprint } from "./scrobbles";

const formats: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/flac": "flac",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};
const extensions: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};
export function audioType(name: string, type: string): string | undefined {
  return formats[type] ? type : extensions[name.slice(name.lastIndexOf(".") + 1).toLowerCase()];
}
export interface OwnedFile {
  name: string;
  type: string;
  bytes: ArrayBuffer;
  lyrics?: string;
}
export interface DriveAudio {
  url: string;
  name: string;
}

/** Read-only traversal using Drive's typed listing helper; never follows out-of-pod members. */
export async function listDriveAudio(
  fetch: typeof globalThis.fetch,
  storage: string,
): Promise<DriveAudio[]> {
  const root = new URL("drive/", normalizePodBase(storage)).href;
  const scoped = createPodScopedFetch(root, { fetch });
  const files: DriveAudio[] = [];
  const visited = new Set<string>();
  async function walk(url: string): Promise<void> {
    if (visited.has(url)) return;
    visited.add(url);
    let listing: Awaited<ReturnType<typeof listContainer>>;
    try {
      listing = await listContainer(scoped, url);
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404) return;
      throw error;
    }
    for (const entry of listing.container.entries) {
      const child = podScopedUrl(root, entry.url, { allowRoot: false });
      if (!child) continue;
      if (child.endsWith("/")) await walk(child);
      else if (audioType(child, entry.contentType ?? ""))
        files.push({ url: child, name: entry.name });
    }
  }
  await walk(root);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

/** Create-only binary writes; an identical completed upload is safe to retry. */
export async function createMusicBinary(
  fetch: typeof globalThis.fetch,
  storage: string,
  url: string,
  bytes: ArrayBuffer,
  type: string,
): Promise<boolean> {
  const scoped = createPodScopedFetch(storage, { fetch, maxRedirects: 0 });
  const response = await scoped(url, {
    method: "PUT",
    headers: { "Content-Type": type, "If-None-Match": "*" },
    body: bytes,
  });
  if (response.ok) return true;
  if (response.status === 412) {
    const existing = await scoped(url);
    if (existing.ok) {
      const saved = await existing.arrayBuffer();
      if (saved.byteLength === bytes.byteLength) {
        const [actual, expected] = await Promise.all([
          crypto.subtle.digest("SHA-256", saved),
          crypto.subtle.digest("SHA-256", bytes),
        ]);
        const digest = new Uint8Array(expected);
        if (new Uint8Array(actual).every((byte, i) => byte === digest[i])) return false;
      }
    }
  }
  throw new MusicWriteError(response.status, response.headers.get("etag"));
}
async function open(
  fetch: typeof globalThis.fetch,
  storage: string,
  url: string,
): Promise<MusicDocument> {
  try {
    return await loadMusic(createPodScopedFetch(storage, { fetch }), url);
  } catch (error) {
    if (!(error instanceof RdfFetchError) || error.status !== 404) throw error;
    return { dataset: new Store(), etag: null, url };
  }
}
async function save(fetch: typeof globalThis.fetch, storage: string, doc: MusicDocument) {
  return saveMusic(
    fetch,
    storage,
    doc.url,
    doc.dataset,
    doc.etag === null ? { ifNoneMatch: "*" } : { ifMatch: requireEtag(doc.etag) },
  );
}

async function fillAlbumCover(
  fetch: typeof globalThis.fetch,
  storage: string,
  doc: MusicDocument,
  albumId: string,
  coverUrl: string,
  deferSave: boolean,
): Promise<void> {
  const album = new Album(albumId, doc.dataset);
  if (album.imageUrl) return;
  album.imageUrl = coverUrl;
  if (deferSave) return;
  try {
    await save(fetch, storage, doc);
  } catch (error) {
    if (!(error instanceof MusicWriteError) || error.status !== 412) throw error;
    const fresh = await open(fetch, storage, doc.url);
    if (!new Album(albumId, fresh.dataset).imageUrl) throw error;
  }
}

/** A race after target selection must keep its specific message through the UI. */
export class OwnedRecordingConflictError extends MusicWriteError {
  constructor(etag: string | null) {
    super(412, etag);
    this.message = "This song already has an audio file. Its existing file was kept.";
  }
}

function hasTitle(node: MusicNode): boolean {
  return (
    node.strings(`${S}name`, `${NS.DCT}title`, `${NS.DC}title`, `${NS.FOAF}name`, `${NS.RDFS}label`)
      .length > 0
  );
}

function matchAlbum(library: Library, artistName: string, albumName: string) {
  return library.models.albums.find(
    (album) =>
      nameKey(album.title) === nameKey(albumName) &&
      nameKey(album.artists[0]?.name ?? "Unknown artist") === nameKey(artistName),
  );
}

function matchRecording(library: Library, contentUrl: string, metadata: AudioMetadata) {
  // Exact resource identity makes retries safe even for files without tags.
  const linked = library.models.tracks.find((track) => track.contentUrl === contentUrl);
  if (linked) return linked;
  if (!metadata.title?.trim() || !metadata.artist?.trim()) return undefined;
  const album = metadata.album?.trim();
  const candidates = library.models.tracks.filter((track) => {
    const existingAlbum = track.album?.name?.trim();
    return (
      nameKey(track.title) === nameKey(metadata.title as string) &&
      nameKey(track.artists[0]?.name ?? "") === nameKey(metadata.artist as string) &&
      (!album || !existingAlbum || nameKey(album) === nameKey(existingAlbum)) &&
      (metadata.duration === null ||
        track.durationSeconds === undefined ||
        Math.abs(metadata.duration - track.durationSeconds) <= 3)
    );
  });
  if (candidates.length === 1) return candidates[0];
  const exact = candidates.filter(
    (track) =>
      album &&
      metadata.track !== null &&
      nameKey(track.album?.name ?? "") === nameKey(album) &&
      track
        .strings(`${S}trackNumber`, `${S}position`, `${MO}track_number`)
        .some((n) => Number(n) === metadata.track),
  );
  return exact.length === 1 ? exact[0] : undefined;
}

/** Select the target before writing any binary, and retain that target on write retries. */
export async function linkOwnedRecording(
  fetch: typeof globalThis.fetch,
  storage: string,
  contentUrl: string,
  metadata: AudioMetadata,
  filename: string,
  coverUrl?: string,
  lyricsUrl?: string,
  targetId?: string,
): Promise<string> {
  assertWithinPodScope(storage, contentUrl, { allowRoot: false });
  const title = metadata.title?.trim() || filename.replace(/\.[^.]+$/u, "") || "Untitled";
  const artistName = metadata.artist?.trim() || "Unknown artist";
  const albumName = metadata.album?.trim() || "Unknown album";
  const catalog = `${musicRoot(storage)}tracks/owned.ttl`;
  for (let attempt = 0; ; attempt++) {
    const library = await loadLibrary(fetch, storage);
    const matched = targetId
      ? library.models.tracks.find((track) => track.value === targetId)
      : matchRecording(library, contentUrl, metadata);
    if (matched?.contentUrl && matched.contentUrl !== contentUrl)
      throw new OwnedRecordingConflictError(null);
    if (matched?.contentUrl === contentUrl && !coverUrl && !lyricsUrl) return matched.value;
    const id = targetId ?? matched?.value ?? `${catalog}#song-${fingerprint(contentUrl)}`;
    targetId = id;
    const doc = await open(fetch, storage, documentUrl(storage, id));
    const track = new Track(id, doc.dataset);
    if (track.contentUrl && track.contentUrl !== contentUrl)
      throw new OwnedRecordingConflictError(doc.etag);
    track.stampType();
    // Retain all imported credits/album identities; new entities use stable name identities.
    if (!hasTitle(track)) track.title = title;
    if (!track.artists.length) {
      const artistId =
        library.models.artists.find((a) => nameKey(a.title) === nameKey(artistName))?.value ??
        `${catalog}#artist-${fingerprint(nameKey(artistName))}`;
      if (artistId.startsWith(`${catalog}#`)) {
        const artist = new Artist(artistId, doc.dataset).stampType();
        if (!hasTitle(artist)) artist.title = artistName;
      }
      track.setArtist(artistId);
    }
    if (!track.album) {
      const artistId = track.artists[0]?.iri;
      const albumId =
        matchAlbum(library, artistName, albumName)?.value ??
        `${catalog}#album-${fingerprint(`${nameKey(artistName)}\u0000${nameKey(albumName)}`)}`;
      if (albumId.startsWith(`${catalog}#`)) {
        const album = new Album(albumId, doc.dataset).stampType();
        if (!hasTitle(album)) album.title = albumName;
        if (!album.artists.length) album.setArtist(artistId);
      }
      track.setAlbum(albumId);
    }
    track.contentUrl = contentUrl;
    if (
      metadata.duration !== null &&
      !track.strings(`${S}duration`, `${M}durationSeconds`, `${MO}duration`).length
    )
      track.durationSeconds = metadata.duration;
    if (
      metadata.track !== null &&
      !track.strings(`${S}trackNumber`, `${S}position`, `${MO}track_number`).length
    ) {
      track.clear(`${S}trackNumber`);
      track.writeString(`${S}trackNumber`, String(metadata.track));
    }
    if (metadata.disc !== null && !track.strings(`${S}discNumber`).length) {
      track.clear(`${S}discNumber`);
      track.writeString(`${S}discNumber`, String(metadata.disc));
    }
    if (lyricsUrl && !track.lyricsUrl) track.lyricsUrl = lyricsUrl;
    const albumId = track.album?.iri;
    if (coverUrl && albumId) {
      const albumUrl = documentUrl(storage, albumId);
      const albumDoc = albumUrl === doc.url ? doc : await open(fetch, storage, albumUrl);
      await fillAlbumCover(fetch, storage, albumDoc, albumId, coverUrl, albumDoc === doc);
    }
    try {
      await save(fetch, storage, doc);
    } catch (error) {
      if (error instanceof MusicWriteError && error.status === 412 && attempt < 2) continue;
      throw error;
    }
    return id;
  }
}

export interface OwnedUploadResult {
  id: string;
  status: "added" | "already-owned";
}

export async function uploadMusicFile(
  fetch: typeof globalThis.fetch,
  storage: string,
  file: OwnedFile,
): Promise<OwnedUploadResult> {
  const type = audioType(file.name, file.type);
  if (!type) throw new Error("Choose MP3, M4A, FLAC, Ogg, WAV or WebM audio files");
  if (file.lyrics !== undefined) parseLrc(file.lyrics);
  const metadata = await extractAudioMetadata(file.bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", file.bytes));
  const uploadId = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  const base = `${musicRoot(storage)}files/${uploadId}`;
  const url = `${base}.${formats[type]}`;
  const library = await loadLibrary(fetch, storage);
  const matched = matchRecording(library, url, metadata);
  if (matched?.contentUrl) return { id: matched.value, status: "already-owned" };
  const targetId =
    matched?.value ?? `${musicRoot(storage)}tracks/owned.ttl#song-${fingerprint(url)}`;
  const albumId = matched?.album?.iri;
  const album = albumId
    ? library.models.albums.find((album) => album.value === albumId)
    : matchAlbum(
        library,
        metadata.artist?.trim() || "Unknown artist",
        metadata.album?.trim() || "Unknown album",
      );
  const cover = album?.imageUrl ? undefined : await extractAudioCover(file.bytes);
  await provision(fetch, storage);
  const written: string[] = [];
  async function write(url: string, bytes: ArrayBuffer, type: string) {
    if (await createMusicBinary(fetch, storage, url, bytes, type)) written.push(url);
  }
  try {
    await write(url, file.bytes, type);
    let coverUrl: string | undefined;
    if (cover) {
      coverUrl = `${base}-cover.${{ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[cover.type]}`;
      await write(coverUrl, cover.bytes.buffer, cover.type);
    }
    let lyricsUrl: string | undefined;
    if (file.lyrics !== undefined && !matched?.lyricsUrl) {
      lyricsUrl = `${base}.lrc`;
      await write(
        lyricsUrl,
        new TextEncoder().encode(file.lyrics).buffer,
        "text/plain;charset=utf-8",
      );
    }
    const id = await linkOwnedRecording(
      fetch,
      storage,
      url,
      metadata,
      file.name,
      coverUrl,
      lyricsUrl,
      targetId,
    );
    return { id, status: "added" };
  } catch (error) {
    try {
      // An imported album or another tab may already reference this attempt's binaries.
      const live = await loadLibrary(fetch, storage);
      const referenced = new Set([
        ...live.models.tracks.flatMap((track) => [track.contentUrl, track.lyricsUrl]),
        ...live.models.albums.map((album) => album.imageUrl),
      ]);
      const scoped = createPodScopedFetch(storage, { fetch, maxRedirects: 0 });
      await Promise.allSettled(
        written
          .filter((url) => !referenced.has(url))
          .map((url) => scoped(url, { method: "DELETE" })),
      );
    } catch {
      // If references cannot be checked, retain the binaries and report the original failure.
    }
    throw error;
  }
}

/** No copy and no writes to Drive; metadata is read from the authenticated original. */
export async function addDriveAudio(
  fetch: typeof globalThis.fetch,
  storage: string,
  url: string,
): Promise<string> {
  const root = new URL("drive/", normalizePodBase(storage)).href;
  const target = assertWithinPodScope(root, url, { allowRoot: false });
  const response = await createPodScopedFetch(root, { fetch })(target);
  if (!response.ok) throw new MusicWriteError(response.status, response.headers.get("etag"));
  if (!audioType(target, response.headers.get("content-type") ?? ""))
    throw new Error("Choose an audio file from Drive");
  const metadata = await extractAudioMetadata(await response.arrayBuffer());
  await provision(fetch, storage);
  return linkOwnedRecording(
    fetch,
    storage,
    target,
    metadata,
    decodeURIComponent(new URL(target).pathname.split("/").at(-1) as string),
  );
}
