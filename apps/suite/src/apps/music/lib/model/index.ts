// AUTHORED-BY Codex GPT-6.1-Sol
export { Album, Artist, type MusicReference, Recording, Track } from "./entities";
export {
  type ArtistPeriod,
  computeTopArtists,
  historyShard,
  monthKey,
  type Playback,
  PlaybackEvent,
  periodStart,
  readHistory,
  recentlyPlayed,
  type TopArtist,
} from "./history";
export {
  appendPlayback,
  loadHistory,
  loadLibrary,
  loadMusic,
  type MusicDocument,
  MusicWriteError,
  saveMusic,
  type WriteCondition,
} from "./io";
export { type MusicLibrary, readLibrary, searchLibrary } from "./library";
export { Playlist, syncLikedPlaylist } from "./playlists";
export { artworkUrl, type MusicPreferences, parsePreferences } from "./preferences";
export { DataFactory, MusicNode, parseMusic, Store, serializeMusic } from "./rdf";
export { durationSeconds, InvalidMusicError } from "./validation";
