// AUTHORED-BY Codex GPT-6
import { createNameComparator, groupAlbums, totalDuration } from "../library";
import type { MusicReference, readLibrary } from "../model";
import { MO, S } from "../model/vocab";
import type { Library, MusicTrack } from "./library";

interface Credit {
  id: string;
  /** Preserve literal identities so model statistics still resolve to this artist. */
  key: string;
  name: string;
}

function display(value: string | undefined, fallback: string): string {
  return (
    value
      ?.toWellFormed()
      .replace(/\p{Cc}/gu, " ")
      .trim() || fallback
  );
}

function position(values: string[]): number | undefined {
  return values.map(Number).find((value) => Number.isSafeInteger(value) && value > 0);
}

/** Read-only boundary between permissive foreign RDF and the strict library helpers. */
export function normalizeLibrary(
  models: ReturnType<typeof readLibrary>,
  base: string,
): Pick<Library, "tracks" | "albums" | "artists"> {
  function credits(refs: MusicReference[]): Credit[] {
    return [
      ...new Map(
        refs.map((ref) => {
          const id =
            ref.iri ??
            new URL(`artists/inferred-${encodeURIComponent(ref.name ?? "unknown")}`, base).href;
          return [
            id,
            {
              id,
              key: ref.iri ?? ref.name ?? "Unknown artist",
              name: display(ref.name, "Unknown artist"),
            },
          ];
        }),
      ).values(),
    ];
  }
  const sourceAlbums = models.albums.map((album) => ({
    id: album.value,
    title: display(album.title, "Untitled"),
    credits: credits(album.artists),
    trackIds: album.tracks,
    imageUrl: album.imageUrl,
  }));
  const albumById = new Map(sourceAlbums.map((album) => [album.id, album]));
  const albumsByTrack = new Map<string, typeof sourceAlbums>();
  for (const album of sourceAlbums)
    for (const id of album.trackIds) {
      const memberships = albumsByTrack.get(id);
      if (memberships) memberships.push(album);
      else albumsByTrack.set(id, [album]);
    }
  const albumMembers = new Map(
    sourceAlbums.map((album) => [
      album.id,
      {
        ...album,
        tracks: [] as MusicTrack[],
      },
    ]),
  );
  const trackCredits = new Map<string, Credit[]>();
  const tracks: MusicTrack[] = models.tracks.map((track) => {
    const artists = credits(track.artists);
    if (!artists.length) artists.push(...credits([{}]));
    trackCredits.set(track.value, artists);
    const memberships = new Map<string, { id: string; title: string; credits: Credit[] }>();
    const ref = track.album;
    if (ref) {
      const id =
        ref.iri ??
        new URL(`albums/inferred-${encodeURIComponent(ref.name ?? "unknown")}`, base).href;
      memberships.set(
        id,
        albumById.get(id) ?? { id, title: display(ref.name, "Unknown album"), credits: [] },
      );
    }
    for (const album of albumsByTrack.get(track.value) ?? []) memberships.set(album.id, album);
    if (!memberships.size) {
      const id = new URL("albums/inferred-unknown", base).href;
      memberships.set(id, { id, title: "Unknown album", credits: [] });
    }
    const primary = [...memberships.values()][0] as { id: string; title: string };
    const normalized: MusicTrack = {
      id: track.value,
      title: display(track.title, "Untitled"),
      artist: artists.map((artist) => artist.name).join(", "),
      artistId: (artists[0] as Credit).id,
      artistIds: artists.map((artist) => artist.id),
      albumId: primary.id,
      albumTitle: primary.title,
      loved: track.loved,
      imageUrl: track.imageUrl ?? albumById.get(primary.id)?.imageUrl,
      sourceUrl: track.sourceUrl,
      contentUrl: track.contentUrl,
      lyricsUrl: track.lyricsUrl,
      durationSeconds:
        track.durationSeconds === undefined ? undefined : Math.floor(track.durationSeconds),
      ...optionalPosition("discNumber", track.strings(`${S}discNumber`)),
      ...optionalPosition(
        "trackNumber",
        track.strings(`${S}trackNumber`, `${S}position`, `${MO}track_number`),
      ),
      added: display(track.strings(`${S}dateCreated`)[0], ""),
    };
    for (const album of memberships.values()) {
      let group = albumMembers.get(album.id);
      if (!group) {
        group = { ...album, imageUrl: undefined, trackIds: [], tracks: [] };
        albumMembers.set(album.id, group);
      }
      group.tracks.push({ ...normalized, albumId: album.id, albumTitle: album.title });
    }
    return normalized;
  });
  const albums = [...albumMembers.values()].flatMap((album) => {
    const artist = album.credits.map((credit) => credit.name).join(", ");
    return album.tracks.length
      ? groupAlbums(
          album.tracks.map((track) => ({ ...track, ...(artist ? { albumArtist: artist } : {}) })),
        )
      : [
          {
            id: album.id,
            title: album.title,
            artist: artist || "Unknown artist",
            compilation: false,
            tracks: [],
            durationSeconds: 0,
          },
        ];
  });
  const compare = createNameComparator();
  albums.sort((a, b) => compare(a.title, b.title));
  const artistsById = new Map<string, Library["artists"][number]>();
  function artistGroup(credit: Credit) {
    let artist = artistsById.get(credit.id);
    if (!artist) {
      artist = { ...credit, albumIds: [], tracks: [], durationSeconds: 0 };
      artistsById.set(credit.id, artist);
    }
    return artist;
  }
  for (const artist of models.artists)
    artistGroup({
      id: artist.value,
      key: artist.value,
      name: display(artist.title, "Unknown artist"),
    });
  for (const album of albums) {
    for (const member of album.tracks) {
      for (const credit of trackCredits.get(member.id) as Credit[]) {
        const artist = artistGroup(credit);
        if (!artist.tracks.some((track) => track.id === member.id))
          artist.tracks.push(member as MusicTrack);
        if (!artist.albumIds.includes(album.id)) artist.albumIds.push(album.id);
      }
    }
  }
  for (const album of sourceAlbums)
    for (const credit of album.credits) {
      const artist = artistGroup(credit);
      if (!artist.albumIds.includes(album.id)) artist.albumIds.push(album.id);
    }
  const artists = [...artistsById.values()];
  for (const artist of artists) artist.durationSeconds = totalDuration(artist.tracks);
  artists.sort((a, b) => compare(a.name, b.name));
  return { tracks, albums, artists };
}

function optionalPosition(key: "discNumber" | "trackNumber", values: string[]) {
  const value = position(values);
  return value === undefined ? {} : { [key]: value };
}
