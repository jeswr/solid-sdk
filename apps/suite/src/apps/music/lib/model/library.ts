// AUTHORED-BY Codex GPT-6.1-Sol
import type { Store } from "n3";
import { Album, Artist, Track } from "./entities";
import { Playlist } from "./playlists";
import { MusicNode } from "./rdf";
import { M, MO, S } from "./vocab";

export interface MusicLibrary {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
}

export function readLibrary(dataset: Store): MusicLibrary {
  const library: MusicLibrary = { tracks: [], albums: [], artists: [], playlists: [] };
  for (const subject of dataset.getSubjects(null, null, null)) {
    if (subject.termType !== "NamedNode") continue;
    const node = new MusicNode(subject, dataset);
    const has = (...types: string[]) => types.some((type) => node.types.has(type));
    if (has(`${MO}Track`, `${S}MusicRecording`, `${M}Track`, `${M}MusicRecording`))
      library.tracks.push(new Track(subject, dataset));
    if (has(`${MO}Record`, `${S}MusicAlbum`, `${M}Album`))
      library.albums.push(new Album(subject, dataset));
    if (has(`${MO}MusicArtist`, `${S}MusicGroup`, `${S}Person`, `${M}Artist`, `${M}MusicGroup`))
      library.artists.push(new Artist(subject, dataset));
    if (has(`${MO}Playlist`, `${S}MusicPlaylist`, `${M}Playlist`))
      library.playlists.push(new Playlist(subject, dataset));
  }
  for (const items of [library.tracks, library.albums, library.artists, library.playlists])
    items.sort((a, b) => a.title.localeCompare(b.title) || a.value.localeCompare(b.value));
  return library;
}

/** Search the supplied library only; server/history search belongs to the later SDK hook. */
export function searchLibrary(library: MusicLibrary, query: string): MusicLibrary {
  const words = query.trim().toLowerCase().split(/\s+/);
  const matches = (node: Track | Album | Artist | Playlist) => {
    const text = [node.title, ...node.artists.map((ref) => ref.name), node.album?.name]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  };
  return {
    tracks: library.tracks.filter(matches),
    albums: library.albums.filter(matches),
    artists: library.artists.filter(matches),
    playlists: library.playlists.filter(matches),
  };
}
