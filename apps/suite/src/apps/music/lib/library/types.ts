// AUTHORED-BY Codex GPT-6.1-Sol

/** Adapter projection. IDs and artist names are exact identities, never sort keys. */
export interface LibraryTrack {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly albumId: string;
  readonly albumTitle: string;
  readonly albumArtist?: string;
  readonly discNumber?: number;
  readonly trackNumber?: number;
  /** Nonnegative safe integer seconds; absent means unknown. */
  readonly durationSeconds?: number | undefined;
}

export interface NameSortOptions {
  /** Supported BCP 47 locale; defaults to en, independent of the host locale. */
  readonly locale?: string;
  /** Single-word articles, case insensitive. Default The/A/An; [] disables removal. */
  readonly articles?: readonly string[];
}

export interface LibraryAlbum {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly compilation: boolean;
  readonly tracks: readonly LibraryTrack[];
  readonly durationSeconds: number | undefined;
}

export interface LibraryArtist {
  readonly name: string;
  readonly albumIds: readonly string[];
  readonly tracks: readonly LibraryTrack[];
  readonly durationSeconds: number | undefined;
}

export interface PlayEvent {
  readonly id: string;
  readonly trackId: string;
  /** Integer epoch milliseconds, not a local date or a date string. */
  readonly playedAt: number;
}

/** Inclusive from, exclusive to. Neither bound implies a clock. */
export interface PlayWindow {
  readonly from?: number;
  readonly to?: number;
}

export interface TrackPlayStats {
  readonly track: LibraryTrack;
  readonly playCount: number;
  readonly lastPlayedAt: number;
}
