// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  Album,
  Artist,
  artworkUrl,
  DataFactory,
  durationSeconds,
  InvalidMusicError,
  MusicNode,
  Playlist,
  parseMusic,
  parsePreferences,
  readHistory,
  readLibrary,
  Store,
  searchLibrary,
  serializeMusic,
  syncLikedPlaylist,
  Track,
} from "../../src/apps/music/lib/model";
import { httpIri, nonNegative, validDate } from "../../src/apps/music/lib/model/validation";
import { M, MO, NS, S, TYPE } from "../../src/apps/music/lib/model/vocab";

const base = "https://pod.test/music/";
const trackIri = `${base}tracks/a.ttl#it`;
const artistIri = `${base}artists/a.ttl#it`;
const albumIri = `${base}albums/a.ttl#it`;
const playlistIri = `${base}playlists/a.ttl#it`;
const prefixes = `@prefix s: <${S}>. @prefix media: <${M}>. @prefix mo: <${MO}>. @prefix dct: <${NS.DCT}>. @prefix foaf: <${NS.FOAF}>.`;
const parse = (ttl: string) => parseMusic(prefixes + ttl, base);

async function fixture(name: string) {
  return parseMusic(
    await readFile(new URL(`./fixtures/${name}.ttl`, import.meta.url), "utf8"),
    base,
  );
}

function snapshot(dataset: Store) {
  const library = readLibrary(dataset);
  return {
    tracks: library.tracks.map((track) => ({
      iri: track.value,
      title: track.title,
      artists: track.artists.map((artist) => artist.name),
      album: track.album?.name,
      seconds: track.durationSeconds,
      loved: track.loved,
      isrc: track.isrc,
      source: track.sourceUrl,
      image: track.imageUrl,
    })),
    albums: library.albums.map((album) => ({ title: album.title, tracks: album.tracks })),
    artists: library.artists.map((artist) => artist.title),
    playlists: library.playlists.map((playlist) => ({
      title: playlist.title,
      tracks: playlist.tracks,
    })),
    history: readHistory(dataset),
  };
}

describe("three-model reads", () => {
  it("converges mo, PM schema and solid-listening media fixtures without mutating them", async () => {
    const datasets = await Promise.all(["mo", "schema", "media"].map(fixture));
    const snapshots = datasets.map((dataset) => {
      const before = [...dataset];
      const result = snapshot(dataset);
      expect([...dataset]).toEqual(before);
      return result;
    });
    expect(snapshots[0]).toEqual(snapshots[1]);
    expect(snapshots[1]).toEqual(snapshots[2]);
    expect(snapshots[0]?.tracks).toEqual([
      {
        iri: trackIri,
        title: "Song",
        artists: ["Artist"],
        album: "Album",
        seconds: 213,
        loved: true,
        isrc: "GB123",
        source: "https://open.spotify.com/track/123",
        image: "https://images.test/cover.jpg",
      },
    ]);
  });

  it("reads sparse, multiply typed, blank-linked and malformed foreign records", async () => {
    const dataset = await parse(`
      <#z> a s:MusicRecording, media:Track; s:name <#malformed>, " "; dct:title "Z";
        s:byArtist [ foaf:name "Blank artist" ], <#unlabelled>, "";
        s:duration <#malformed>, "invalid"; media:durationSeconds 1.5;
        s:image [ s:url <#ignored> ]; s:thumbnailUrl "https://images.test/fallback.jpg";
        s:url "https://open.spotify.com/track/fallback".
      <#a> a s:MusicRecording; s:name "A".
      <#a2> a media:MusicRecording; s:name "A".
      <#p> a s:Person; foaf:name "Person".
      <#group> a media:MusicGroup; s:name "Group".
      [] a s:MusicRecording; s:name "Not a resource".
    `);
    const library = readLibrary(dataset);
    expect(library.tracks.map((track) => track.title)).toEqual(["A", "A", "Z"]);
    expect(library.artists.map((artist) => artist.title)).toEqual(["Group", "Person"]);
    const z = library.tracks[2] as Track;
    expect(z.durationSeconds).toBe(1.5);
    expect(z.artists).toEqual([
      { iri: undefined, name: "Blank artist" },
      { iri: `${base}#unlabelled`, name: undefined },
    ]);
    expect(z.album).toBeUndefined();
    expect(z.imageUrl).toBe("https://images.test/fallback.jpg");
    expect(z.sourceUrl).toBe("https://open.spotify.com/track/fallback");
    expect(library.tracks[0]?.durationSeconds).toBeUndefined();
    expect(library.tracks[0]?.title).toBe("A");
    expect(new Track(`${base}#absent`, dataset).title).toBe("Untitled");
    expect(new MusicNode(DataFactory.namedNode(`${base}#z`), dataset).types.size).toBe(2);
  });

  it("searches every library section and artist/album text, including an empty query", async () => {
    const library = readLibrary(await fixture("schema"));
    expect(searchLibrary(library, "song ARTIST album").tracks).toHaveLength(1);
    expect(searchLibrary(library, "missing")).toEqual({
      tracks: [],
      albums: [],
      artists: [],
      playlists: [],
    });
    expect(searchLibrary(library, "  ")).toEqual(library);
  });

  it("resolves relative RDF and parses JSON-LD without changing resource IDs or literals", async () => {
    const dataset = await parseMusic(
      JSON.stringify({
        "@id": "#track",
        "@type": `${S}MusicRecording`,
        [`${S}name`]: "https://w3id.org/jeswr/sectors/media#Literal",
      }),
      `${base}foreign.ttl`,
      "application/ld+json",
    );
    expect(readLibrary(dataset).tracks[0]?.value).toBe(`${base}foreign.ttl#track`);
    expect(readLibrary(dataset).tracks[0]?.title).toBe(
      "https://w3id.org/jeswr/sectors/media#Literal",
    );
    await expect(parseMusic("bad turtle", base)).rejects.toThrow();
    expect(await serializeMusic(new Store())).toBe("");
  });
});

describe("canonical typed writes", () => {
  it("round-trips all entity fields and writes schema + media, never new mo triples", async () => {
    const dataset = new Store();
    const artist = new Artist(artistIri, dataset).stampType().stampType();
    artist.title = "Artist";
    const album = new Album(albumIri, dataset).stampType();
    album.title = "Album";
    album.setArtist(artistIri);
    const track = new Track(trackIri, dataset).stampType();
    track.title = 'A "quoted" title\nwith a newline';
    track.setArtist(artistIri);
    track.setAlbum(albumIri);
    track.durationSeconds = 213.5;
    track.loved = true;
    track.isrc = "GB123";
    track.sourceUrl = "https://open.spotify.com/track/123";
    track.imageUrl = "https://images.test/cover.jpg";
    album.addTrack(trackIri);
    album.addTrack(trackIri);
    const playlist = new Playlist(playlistIri, dataset).stampType();
    playlist.title = "Playlist";
    playlist.setTracks([trackIri, trackIri]);
    expect(album.tracks).toEqual([trackIri]);
    expect(track.artists).toEqual([{ iri: artistIri, name: "Artist" }]);
    expect(track.album).toEqual({ iri: albumIri, name: "Album" });
    expect(track.durationSeconds).toBe(213.5);
    expect(artist.types).toEqual(new Set([`${S}MusicGroup`, `${M}Artist`]));
    expect(
      [...dataset].every(
        (q) =>
          !q.predicate.value.startsWith(MO) &&
          !(q.predicate.value === TYPE && q.object.value.startsWith(MO)),
      ),
    ).toBe(true);
    const roundTrip = await parseMusic(await serializeMusic(dataset), base);
    expect(snapshot(roundTrip)).toEqual(snapshot(dataset));
    const types = track.types;
    types.clear();
    expect(track.types.size).toBe(2);
    const refs = track.artists;
    refs.length = 0;
    expect(track.artists).toHaveLength(1);
    expect(track.sourceUrl).toBe("https://open.spotify.com/track/123");
    expect(track.imageUrl).toBe("https://images.test/cover.jpg");
  });

  it("clears edited legacy values, and never partly mutates invalid fields", async () => {
    const dataset = await fixture("media");
    const track = readLibrary(dataset).tracks[0] as Track;
    const before = await serializeMusic(dataset);
    for (const edit of [
      () => {
        track.title = " ";
      },
      () => track.setArtist("javascript:no"),
      () => track.setAlbum("bad"),
      () => {
        track.durationSeconds = -1;
      },
      () => {
        track.imageUrl = "file:///secret";
      },
      () => {
        track.sourceUrl = "bad";
      },
    ]) {
      expect(edit).toThrow(InvalidMusicError);
      expect(await serializeMusic(dataset)).toBe(before);
    }
    track.setArtist(undefined);
    track.setAlbum(undefined);
    track.durationSeconds = undefined;
    track.imageUrl = undefined;
    track.sourceUrl = undefined;
    track.loved = false;
    track.isrc = undefined;
    expect(track.artists).toEqual([]);
    expect(track.album).toBeUndefined();
    expect(track.durationSeconds).toBeUndefined();
    expect(track.imageUrl).toBeUndefined();
    expect(track.sourceUrl).toBeUndefined();
    expect(track.isrc).toBeUndefined();
    expect(track.loved).toBe(false);
    expect(await serializeMusic(dataset)).not.toContain("w3id.org/jeswr/sectors/media#loved");
    expect(() => new Track("urn:track:1", dataset).stampType()).toThrow(InvalidMusicError);
  });

  it("validates numeric values, IRIs and duration representations", () => {
    for (const n of [-1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => nonNegative(n)).toThrow(InvalidMusicError);
    expect(nonNegative(0)).toBe(0);
    for (const value of [
      "bad",
      "javascript:alert(1)",
      "https://user@pod.test/x",
      "https://:pass@pod.test/x",
      " https://pod.test/x",
    ])
      expect(() => httpIri(value)).toThrow(InvalidMusicError);
    expect(httpIri("https://pod.test/a> b")).toBe("https://pod.test/a%3E%20b");
    expect(() => validDate(new Date("invalid"))).toThrow(InvalidMusicError);
    const cases: [string, number | undefined][] = [
      ["0", 0],
      ["1.5", 1.5],
      ["PT1H2M3.5S", 3723.5],
      ["PT2H", 7200],
      ["PT2M", 120],
      ["PT0S", 0],
      ["PT", undefined],
      ["invalid", undefined],
      ["-1", undefined],
      ["9".repeat(400), undefined],
      [`PT${"9".repeat(400)}S`, undefined],
    ];
    for (const [value, expected] of cases) expect(durationSeconds(value)).toBe(expected);
  });
});

describe("ordered playlists and liked songs", () => {
  it("creates, appends duplicates, reorders both ways, removes and retains dense positions", async () => {
    const dataset = new Store();
    const playlist = new Playlist(playlistIri, dataset).stampType();
    expect(playlist.tracks).toEqual([]);
    playlist.setTracks([trackIri, `${base}tracks/b`, trackIri]).addTrack(`${base}tracks/c`);
    playlist.reorder(0, 3);
    expect(playlist.tracks).toEqual([`${base}tracks/b`, trackIri, `${base}tracks/c`, trackIri]);
    playlist.reorder(3, 0).removeAt(1);
    expect(playlist.tracks).toEqual([trackIri, trackIri, `${base}tracks/c`]);
    const entries = playlist.objects(`${S}itemListElement`);
    expect(entries.map((term) => new MusicNode(term, dataset).strings(`${S}position`)[0])).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(entries.every((term) => new MusicNode(term, dataset).types.has(`${S}ListItem`))).toBe(
      true,
    );
    const snapshot = playlist.tracks;
    snapshot.pop();
    expect(playlist.tracks).toHaveLength(3);
    const before = await serializeMusic(dataset);
    for (const index of [-1, 0.5, 99, Number.NaN]) expect(playlist.removeAt(index)).toBe(playlist);
    for (const pair of [
      [-1, 1],
      [0, 99],
      [0.1, 0],
    ])
      expect(() => playlist.reorder(pair[0] as number, pair[1] as number)).toThrow(
        InvalidMusicError,
      );
    expect(() => playlist.setTracks([trackIri, "bad"])).toThrow(InvalidMusicError);
    expect(await serializeMusic(dataset)).toBe(before);
    const parsed = await parseMusic(before, base);
    expect(new Playlist(playlistIri, parsed).tracks).toEqual(playlist.tracks);
    playlist.setTracks([]);
    expect(playlist.tracks).toEqual([]);
    expect(dataset.size).toBe(2); // only the playlist types remain
  });

  it("migrates flat entries and skips malformed ListItems while sorting valid positions", async () => {
    const dataset = await parse(`<#list> a mo:Playlist; mo:track <#b>, <#a>; s:track <#a>;
      s:itemListElement "bad", [s:position 0; s:item <#x>], [s:position 1.5; s:item <#x>], [s:position 1], [s:item <#x>].`);
    const playlist = new Playlist(`${base}#list`, dataset);
    expect(playlist.tracks).toEqual([`${base}#a`, `${base}#b`]);
    playlist.addTrack(`${base}#a`);
    expect(playlist.iris(`${MO}track`, `${S}track`)).toEqual([]);
    expect(playlist.tracks).toEqual([`${base}#a`, `${base}#b`, `${base}#a`]);
    const outOfOrder = await parse(
      `<#list> s:itemListElement [s:position 7; s:item <#b>], [s:position 2; s:item <#a>].`,
    );
    expect(new Playlist(`${base}#list`, outOfOrder).tracks).toEqual([`${base}#a`, `${base}#b`]);
  });

  it("builds and refreshes the liked interop playlist from media:loved", async () => {
    const dataset = await fixture("media");
    const tracks = readLibrary(dataset).tracks;
    const playlist = syncLikedPlaylist(dataset, `${base}playlists/liked.ttl#it`, tracks);
    expect(playlist.title).toBe("Liked songs");
    expect(playlist.tracks).toEqual([trackIri]);
    (tracks[0] as Track).loved = false;
    expect(syncLikedPlaylist(dataset, playlist.value, tracks).tracks).toEqual([]);
    const numeric = await parse(`<#t> media:loved "1".`);
    expect(new Track(`${base}#t`, numeric).loved).toBe(true);
  });
});

describe("editing foreign metadata", () => {
  it("retains shared blank entries and named ListItems while collecting private blank entries", async () => {
    const dataset = await parse(`<#p> s:itemListElement _:shared, <#named>, "malformed".
      <#other> s:itemListElement _:shared.
      _:shared a s:ListItem; s:position 1; s:item <#a>.
      <#named> a s:ListItem; s:position 2; s:item <#b>.`);
    new Playlist(`${base}#p`, dataset).setTracks([trackIri]);
    expect(new Playlist(`${base}#other`, dataset).tracks).toEqual([`${base}#a`]);
    expect(new MusicNode(`${base}#named`, dataset).iris(`${S}item`)).toEqual([`${base}#b`]);
    const playlist = new Playlist(`${base}#p`, dataset);
    const size = dataset.size;
    for (let i = 0; i < 5; i += 1) playlist.setTracks([trackIri]);
    expect(dataset.size).toBe(size);
  });

  it("removes the legacy mo:isrc when explicitly clearing the field", async () => {
    const dataset = await fixture("mo");
    const track = readLibrary(dataset).tracks[0] as Track;
    expect(track.isrc).toBe("GB123");
    track.isrc = undefined;
    expect(track.isrc).toBeUndefined();
  });
});

describe("artwork preferences", () => {
  it("defaults off and round-trips only the two allowed policies", () => {
    expect(parsePreferences(undefined)).toEqual({ artwork: "none" });
    expect(parsePreferences(null)).toEqual({ artwork: "none" });
    expect(parsePreferences({ artwork: "none", extra: true })).toEqual({ artwork: "none" });
    expect(parsePreferences(JSON.parse(JSON.stringify({ artwork: "hot-link" })))).toEqual({
      artwork: "hot-link",
    });
    for (const value of [1, "none", {}, { artwork: "cache" }])
      expect(() => parsePreferences(value)).toThrow(InvalidMusicError);
    expect(artworkUrl("https://images.test/a", { artwork: "none" })).toBeUndefined();
    expect(artworkUrl(undefined, { artwork: "hot-link" })).toBeUndefined();
    expect(artworkUrl("https://images.test/a", { artwork: "hot-link" })).toBe(
      "https://images.test/a",
    );
    for (const value of [
      "bad",
      "javascript:alert(1)",
      "https://user@images.test/a",
      "https://:pass@images.test/a",
    ])
      expect(artworkUrl(value, { artwork: "hot-link" })).toBeUndefined();
  });
});
