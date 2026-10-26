// AUTHORED-BY Codex GPT-6.1-Sol
import { totalDuration } from "./duration";
import { createNameComparator, trackComparator } from "./sorting";
import type { LibraryAlbum, LibraryArtist, LibraryTrack, NameSortOptions } from "./types";
import { exactCompare, MusicLibraryError, validateTracks } from "./validation";

export const VARIOUS_ARTISTS = "Various Artists";

/** Group only by exact album identity. Explicit album credits override guest performers. */
export function groupAlbums(
  tracks: readonly LibraryTrack[],
  options: NameSortOptions = {},
): LibraryAlbum[] {
  validateTracks(tracks);
  const compareName = createNameComparator(options);
  const groups = new Map<string, LibraryTrack[]>();
  for (const track of tracks) {
    const group = groups.get(track.albumId);
    if (group) group.push(track);
    else groups.set(track.albumId, [track]);
  }
  const albums: LibraryAlbum[] = [];
  for (const [id, members] of groups) {
    const title = (members[0] as LibraryTrack).albumTitle;
    const credits = new Set<string>();
    const performers = new Set<string>();
    for (const track of members) {
      if (track.albumTitle !== title) throw new MusicLibraryError("conflicting-album");
      if (track.albumArtist !== undefined) credits.add(track.albumArtist);
      performers.add(track.artist);
    }
    if (credits.size > 1) throw new MusicLibraryError("conflicting-album");
    const artist =
      credits.values().next().value ??
      (performers.size === 1 ? (performers.values().next().value as string) : VARIOUS_ARTISTS);
    albums.push({
      id,
      title,
      artist,
      compilation: artist.toLowerCase() === VARIOUS_ARTISTS.toLowerCase(),
      tracks: members.sort(trackComparator(compareName)),
      durationSeconds: totalDuration(members),
    });
  }
  return albums.sort(
    (a, b) =>
      compareName(a.title, b.title) || compareName(a.artist, b.artist) || exactCompare(a.id, b.id),
  );
}

/** Performing-artist groups include compilation contributors, without merging name aliases. */
export function groupArtists(
  tracks: readonly LibraryTrack[],
  options: NameSortOptions = {},
): LibraryArtist[] {
  const albums = groupAlbums(tracks, options);
  const compareName = createNameComparator(options);
  const groups = new Map<string, LibraryTrack[]>();
  // Album sort order, then disc/track order within each album.
  for (const album of albums) {
    for (const track of album.tracks) {
      const group = groups.get(track.artist);
      if (group) group.push(track);
      else groups.set(track.artist, [track]);
    }
  }
  return [...groups]
    .map(([name, members]) => ({
      name,
      tracks: members,
      albumIds: [...new Set(members.map((track) => track.albumId))],
      durationSeconds: totalDuration(members),
    }))
    .sort((a, b) => compareName(a.name, b.name));
}
