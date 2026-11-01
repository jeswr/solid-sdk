// AUTHORED-BY Codex GPT-6

import { SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import { describe, expect, it } from "vitest";
import {
  computeTopArtists,
  loadHistory,
  mostPlayedTracks,
  recentlyPlayed,
  recordPlay,
} from "../src/apps/music/lib/data/history";
import {
  createDocument,
  documentUrl,
  loadLibrary,
  musicRoot,
  provision,
  requireEtag,
  search,
  sortTracks,
} from "../src/apps/music/lib/data/library";
import { setLiked } from "../src/apps/music/lib/data/liked";
import {
  createPlaylist,
  deletePlaylist,
  editPlaylist,
  listPlaylists,
  type MusicPlaylist,
} from "../src/apps/music/lib/data/playlists";
import { preferencesStore } from "../src/apps/music/lib/data/preferences";
import {
  Album,
  Artist,
  DataFactory,
  historyShard,
  loadMusic,
  MusicNode,
  Playlist,
  Store,
  serializeMusic,
  Track,
} from "../src/apps/music/lib/model";
import { M, MO, S } from "../src/apps/music/lib/model/vocab";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const root = "https://music.test/alice/";
const base = musicRoot(root);
const now = new Date("2026-11-01T12:00:00Z");
async function fixture() {
  const pod = createDemoPod({ root });
  await provision(pod.fetch, root);
  const dataset = new Store();
  const artist = new Artist(`${base}artists/a.ttl#it`, dataset).stampType();
  artist.title = "The Junipers";
  const album = new Album(`${base}albums/a.ttl#it`, dataset).stampType();
  album.title = "A Small World";
  album.setArtist(artist.value);
  const tracks = ["Zebra", "Apple", "Moon"].map((title, i) => {
    const track = new Track(`${base}tracks/catalog.ttl#t${i}`, dataset).stamp(
      [`${MO}Track`, `${S}MusicRecording`, `${M}Track`][i] as string,
    );
    track.title = title;
    track.setArtist(artist.value);
    track.setAlbum(album.value);
    track.durationSeconds = 180.5;
    track.writeString(`${S}trackNumber`, String(3 - i));
    track.writeString(`${S}discNumber`, "1");
    track.writeString(`${S}dateCreated`, `2026-10-${10 + i}`);
    return track;
  });
  // Cross-document joins are exercised by splitting subjects across three resources.
  const subjects = (iri: string) =>
    new Store(dataset.getQuads(DataFactory.namedNode(iri), null, null, null));
  await createDocument(pod.fetch, root, `${base}artists/a.ttl`, subjects(artist.value));
  await createDocument(pod.fetch, root, `${base}albums/a.ttl`, subjects(album.value));
  await createDocument(
    pod.fetch,
    root,
    `${base}tracks/catalog.ttl`,
    new Store(tracks.flatMap((track) => [...subjects(track.value)])),
  );
  return { pod, tracks, artist, album };
}
function failure(
  fetch: typeof globalThis.fetch,
  predicate: (url: string, init?: RequestInit) => boolean,
  status = 500,
): typeof globalThis.fetch {
  return async (input, init) =>
    predicate(String(input), init) ? new Response(null, { status }) : fetch(input, init);
}

describe("Music library on the demo pod", () => {
  it("provisions idempotently, reads all three types, joins, orders, searches and sorts", async () => {
    const { pod, tracks } = await fixture();
    const before = pod.snapshot();
    await provision(pod.fetch, root);
    expect(pod.snapshot()).toEqual(before);
    const library = await loadLibrary(pod.fetch, root);
    expect(library.tracks).toHaveLength(3);
    expect(
      library.tracks.every(
        (track) => track.artist === "The Junipers" && track.albumTitle === "A Small World",
      ),
    ).toBe(true);
    expect(library.albums[0]?.tracks.map((t) => t.title)).toEqual(["Moon", "Apple", "Zebra"]);
    expect(library.artists[0]?.albumIds).toHaveLength(1);
    expect(library.tracks[0]?.durationSeconds).toBe(180);
    expect(search(library, "junipers small")).toHaveLength(3);
    expect(search(library, " APPLE ").map((t) => t.id)).toEqual([tracks[1]?.value]);
    expect(search(library, "unknown")).toEqual([]);
    expect(search(library, "")).toHaveLength(3);
    for (const key of ["title", "artist", "albumTitle"] as const)
      expect(sortTracks(library.tracks, key).map((t) => t.title)).toEqual([
        "Apple",
        "Moon",
        "Zebra",
      ]);
    expect(sortTracks(library.tracks, "added").map((t) => t.title)).toEqual([
      "Moon",
      "Apple",
      "Zebra",
    ]);
    expect(
      sortTracks(
        library.tracks.map((t) => ({ ...t, added: "" })),
        "added",
      )[0]?.title,
    ).toBe("Apple");
  });
  it("keeps unknown and literal metadata, reads nested documents and ignores non RDF", async () => {
    const pod = createDemoPod({ root });
    expect((await loadLibrary(pod.fetch, root)).tracks).toEqual([]);
    await provision(pod.fetch, root);
    const dataset = new Store();
    const one = new Track(`${base}tracks/nested/a.ttl#one`, dataset).stampType();
    one.title = "Unknown";
    const two = new Track(`${base}tracks/nested/a.ttl#two`, dataset).stampType();
    two.title = "Literal";
    two.writeString(`${S}byArtist`, "A Person");
    two.writeString(`${S}inAlbum`, "Literal album");
    await createDocument(pod.fetch, root, `${base}tracks/nested/a.ttl`, dataset);
    await pod.fetch(`${base}preferences.json`, { method: "PUT", body: "{}" });
    const saved = new Store();
    const emptyArtist = new Artist(`${base}artists/saved.ttl#it`, saved).stampType();
    emptyArtist.title = "A followed artist";
    const emptyAlbum = new Album(`${base}albums/saved.ttl#it`, saved).stampType();
    emptyAlbum.title = "An upcoming album";
    emptyAlbum.setArtist(emptyArtist.value);
    const anonymousAlbum = new Album(`${base}albums/saved.ttl#unknown`, saved).stampType();
    anonymousAlbum.title = "An uncredited album";
    await createDocument(pod.fetch, root, `${base}artists/saved.ttl`, saved);
    const extensionless = new Store();
    new Track(`${base}tracks/source#it`, extensionless).stampType().title = "No extension";
    await createDocument(pod.fetch, root, `${base}tracks/source`, extensionless);
    const library = await loadLibrary(pod.fetch, root);
    expect(library.albums.find((a) => a.title === "An upcoming album")?.tracks).toEqual([]);
    expect(library.artists.find((a) => a.name === "A followed artist")?.albumIds).toEqual([
      emptyAlbum.value,
    ]);
    expect(library.tracks.some((t) => t.title === "No extension")).toBe(true);
    expect(library.tracks.find((t) => t.title === "Unknown")).toMatchObject({
      artist: "Unknown artist",
      albumTitle: "Unknown album",
      durationSeconds: undefined,
    });
    expect(library.tracks.find((t) => t.title === "Literal")).toMatchObject({
      artist: "A Person",
      albumTitle: "Literal album",
    });
  });
  it("rejects failures and missing ETags, enforces scope and create-only writes", async () => {
    const { pod } = await fixture();
    await expect(
      provision(
        failure(pod.fetch, () => true),
        root,
      ),
    ).rejects.toMatchObject({ status: 500 });
    await expect(
      loadLibrary(
        failure(pod.fetch, (url) => url === base, 403),
        root,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      loadLibrary(async () => {
        throw new Error("network");
      }, root),
    ).rejects.toThrow("network");
    expect(() => requireEtag(null)).toThrow("ETag");
    expect(requireEtag('"one"')).toBe('"one"');
    expect(documentUrl(root, `${base}tracks/a.ttl#it`)).toBe(`${base}tracks/a.ttl`);
    expect(() => documentUrl(root, "https://evil.test/x")).toThrow();
    await expect(
      createDocument(pod.fetch, root, `${base}tracks/catalog.ttl`, new Store()),
    ).rejects.toMatchObject({ status: 412 });
  });
  it("does not follow poisoned listing members", async () => {
    const pod = createDemoPod({ root });
    await provision(pod.fetch, root);
    const dataset = (await loadMusic(pod.fetch, base)).dataset;
    const node = new MusicNode(base, dataset);
    const members = SetFrom.subjectPredicate(
      node,
      "http://www.w3.org/ns/ldp#contains",
      TermAs.is,
      TermFrom.instance,
    );
    members.add(new MusicNode(DataFactory.blankNode(), dataset));
    members.add(new MusicNode("https://evil.test/tracks.ttl", dataset));
    members.add(new MusicNode(base, dataset));
    const body = await serializeMusic(dataset);
    const library = await loadLibrary(
      async (input, init) =>
        String(input) === base
          ? new Response(body, { headers: { "Content-Type": "text/turtle" } })
          : pod.fetch(input, init),
      root,
    );
    expect(library.tracks).toEqual([]);
  });
});

describe("Playlists and likes", () => {
  it("creates, renames, retains repeated tracks, reorders, removes by position and deletes", async () => {
    const { pod, tracks } = await fixture();
    let playlist = await createPlaylist(pod.fetch, root, "a", " Morning ", " Slow songs ");
    expect(playlist).toMatchObject({ name: "Morning", description: "Slow songs", tracks: [] });
    const ids = tracks.map((t) => t.value);
    await editPlaylist(pod.fetch, root, playlist, {
      kind: "add",
      tracks: [...ids, ids[0] as string],
    });
    const current = async () =>
      listPlaylists(await loadLibrary(pod.fetch, root))[0] as MusicPlaylist;
    playlist = await current();
    expect(playlist.tracks).toEqual([...ids, ids[0]]);
    await editPlaylist(pod.fetch, root, playlist, { kind: "move", from: 0, to: 2 });
    playlist = await current();
    expect(playlist.tracks).toEqual([ids[1], ids[2], ids[0], ids[0]]);
    await editPlaylist(pod.fetch, root, playlist, { kind: "remove", position: 2 });
    playlist = await current();
    expect(playlist.tracks).toEqual([ids[1], ids[2], ids[0]]);
    await editPlaylist(pod.fetch, root, playlist, {
      kind: "rename",
      name: "Renamed",
      description: "New description",
    });
    playlist = await current();
    expect(playlist.name).toBe("Renamed");
    expect(
      new Playlist(playlist.id, (await loadMusic(pod.fetch, `${base}playlists/a.ttl`)).dataset)
        .tracks,
    ).toEqual(playlist.tracks);
    await deletePlaylist(pod.fetch, root, playlist);
    expect(await current()).toBeUndefined();
    await expect(createPlaylist(pod.fetch, root, "bad", "  ", "")).rejects.toThrow();
  });
  it("surfaces conflicts, read failures and delete errors without overwriting", async () => {
    const { pod } = await fixture();
    const old = await createPlaylist(pod.fetch, root, "a", "A", "");
    await editPlaylist(pod.fetch, root, old, {
      kind: "rename",
      name: "Other tab",
      description: "",
    });
    await expect(
      editPlaylist(pod.fetch, root, old, { kind: "add", tracks: [] }),
    ).rejects.toMatchObject({ status: 412 });
    await expect(deletePlaylist(pod.fetch, root, old)).rejects.toMatchObject({ status: 412 });
    const current = listPlaylists(await loadLibrary(pod.fetch, root))[0] as MusicPlaylist;
    await expect(
      deletePlaylist(
        failure(pod.fetch, (_url, init) => init?.method === "DELETE"),
        root,
        current,
      ),
    ).rejects.toMatchObject({ status: 500 });
    await expect(
      editPlaylist(pod.fetch, root, { ...current, etag: null }, { kind: "remove", position: 0 }),
    ).rejects.toThrow("ETag");
    await expect(
      editPlaylist(
        failure(pod.fetch, () => true),
        root,
        current,
        { kind: "add", tracks: [] },
      ),
    ).rejects.toThrow();
  });
  it("preserves other entities when deleting a playlist from a connector document", async () => {
    const { pod, tracks } = await fixture();
    const dataset = new Store();
    const first = new Playlist(`${base}playlists/shared.ttl#first`, dataset).stampType();
    first.title = "First";
    first.setTracks([tracks[0]?.value as string]);
    const second = new Playlist(`${base}playlists/shared.ttl#second`, dataset).stampType();
    second.title = "Second";
    await createDocument(pod.fetch, root, `${base}playlists/shared.ttl`, dataset);
    let all = listPlaylists(await loadLibrary(pod.fetch, root));
    await deletePlaylist(pod.fetch, root, all.find((p) => p.name === "First") as MusicPlaylist);
    all = listPlaylists(await loadLibrary(pod.fetch, root));
    expect(all.map((p) => p.name)).toEqual(["Second"]);
    const doc = await loadMusic(pod.fetch, `${base}playlists/shared.ttl`);
    new Track(`${base}playlists/shared.ttl#track`, doc.dataset).stampType().title = "Kept";
    await pod.fetch(doc.url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle", "If-Match": doc.etag as string },
      body: await serializeMusic(doc.dataset),
    });
    all = listPlaylists(await loadLibrary(pod.fetch, root));
    await deletePlaylist(pod.fetch, root, all[0] as MusicPlaylist);
    expect((await loadLibrary(pod.fetch, root)).tracks.some((t) => t.title === "Kept")).toBe(true);
  });
  it("keeps the liked playlist in sync, rejects stale writes and supports unlike", async () => {
    const { pod, tracks } = await fixture();
    const old = await loadLibrary(pod.fetch, root);
    const id = tracks[0]?.value as string;
    await setLiked(pod.fetch, root, old, id, true);
    let library = await loadLibrary(pod.fetch, root);
    expect(library.tracks.find((t) => t.id === id)?.loved).toBe(true);
    expect(library.models.playlists[0]?.tracks).toEqual([id]);
    expect(listPlaylists(library)).toEqual([]);
    await expect(setLiked(pod.fetch, root, old, id, false)).rejects.toMatchObject({ status: 412 });
    await setLiked(pod.fetch, root, library, id, false);
    library = await loadLibrary(pod.fetch, root);
    expect(library.models.playlists[0]?.tracks).toEqual([]);
    await expect(
      setLiked(
        failure(pod.fetch, (url, init) => url.endsWith("liked.ttl") && !init?.method, 500),
        root,
        library,
        id,
        true,
      ),
    ).rejects.toThrow();
    await expect(
      setLiked(pod.fetch, root, { ...library, documents: new Map() }, id, true),
    ).rejects.toThrow("ETag");
  });
  it("propagates non-RDF errors while syncing likes", async () => {
    const { pod, tracks } = await fixture();
    let library = await loadLibrary(pod.fetch, root);
    const id = tracks[0]?.value as string;
    const offline: typeof fetch = async (input, init) => {
      if (String(input).endsWith("liked.ttl")) throw new Error("offline");
      return pod.fetch(input, init);
    };
    await expect(setLiked(offline, root, library, id, true)).rejects.toThrow("offline");
    library = await loadLibrary(pod.fetch, root);
    await setLiked(pod.fetch, root, library, id, true);
    library = await loadLibrary(pod.fetch, root);
    const noEtag: typeof fetch = async (input, init) => {
      const response = await pod.fetch(input, init);
      if (String(input).endsWith("liked.ttl")) response.headers.delete("etag");
      return response;
    };
    await expect(setLiked(noEtag, root, library, id, true)).rejects.toThrow("ETag");
  });
  it("lists missing document metadata safely", async () => {
    const { pod } = await fixture();
    const dataset = new Store();
    const p = new Playlist(`${base}playlists/missing.ttl#it`, dataset).stampType();
    p.title = "Missing";
    const library = await loadLibrary(pod.fetch, root);
    library.models.playlists.push(p);
    expect(listPlaylists(library)[0]).toMatchObject({ description: "", etag: null });
  });
});

describe("Music preferences and history", () => {
  it("defaults artwork off, creates and conditionally updates JSON, rejects stale or malformed data", async () => {
    const { pod } = await fixture();
    const store = preferencesStore(pod.fetch, root);
    const missing = await store.load();
    expect(missing).toEqual({ value: { artwork: "none" }, etag: null });
    const saved = await store.save(missing, { artwork: "hot-link" });
    expect(await store.load()).toEqual(saved);
    const next = await store.save(saved, { artwork: "none" });
    expect(next.value.artwork).toBe("none");
    await expect(store.save(saved, { artwork: "hot-link" })).rejects.toMatchObject({ status: 412 });
    await expect(store.save(missing, { artwork: "none" })).rejects.toMatchObject({ status: 412 });
    await expect(store.save({ ...saved, etag: "" }, { artwork: "none" })).rejects.toThrow("ETag");
    await expect(
      preferencesStore(
        failure(pod.fetch, () => true),
        root,
      ).load(),
    ).rejects.toMatchObject({ status: 500 });
    await expect(
      preferencesStore(
        failure(pod.fetch, () => true),
        root,
      ).save(missing, { artwork: "none" }),
    ).rejects.toMatchObject({ status: 500 });
    await pod.fetch(`${base}preferences.json`, { method: "PUT", body: '{"artwork":"bad"}' });
    await expect(store.load()).rejects.toThrow("Artwork");
    const noEtag: typeof fetch = async (input, init) => {
      const response = await pod.fetch(input, init);
      response.headers.delete("etag");
      return response;
    };
    await expect(
      preferencesStore(noEtag, root).save(
        { value: { artwork: "none" }, etag: null },
        { artwork: "none" },
      ),
    ).rejects.toMatchObject({ status: 412 });
    await pod.fetch(`${base}preferences.json`, { method: "PUT", body: '{"artwork":"none"}' });
    await expect(preferencesStore(noEtag, root).load()).rejects.toThrow("ETag");
    const empty = createDemoPod({ root });
    await expect(
      preferencesStore(async (input, init) => {
        const response = await empty.fetch(input, init);
        response.headers.delete("etag");
        return response;
      }, root).save(missing, { artwork: "none" }),
    ).rejects.toThrow("ETag");
  });
  it("propagates connector history and network failures", async () => {
    const { pod } = await fixture();
    await expect(
      loadHistory(
        failure(pod.fetch, (url) => url.includes("integrations/")),
        root,
        now,
      ),
    ).rejects.toThrow();
    await expect(
      loadHistory(
        async (input, init) => {
          if (String(input).includes("integrations/")) throw new Error("offline");
          return pod.fetch(input, init);
        },
        root,
        now,
      ),
    ).rejects.toThrow("offline");
  });
  it("appends month shards with preconditions, loads ranges and computes stats", async () => {
    const { pod, tracks } = await fixture();
    for (const [index, days] of [0, 1, 8, 40, 370].entries()) {
      const startTime = new Date(now.getTime() - days * 86400000);
      const url = historyShard(base, startTime);
      await recordPlay(pod.fetch, root, {
        iri: `${url}#p${index}`,
        trackIri: tracks[index % 3]?.value as string,
        startTime,
      });
    }
    const history = await loadHistory(pod.fetch, root, now);
    expect(history).toHaveLength(4);
    const older = await loadHistory(pod.fetch, root, now, 12, 12);
    expect(older).toHaveLength(1);
    expect(await loadHistory(pod.fetch, root, now, 0)).toEqual([]);
    const library = await loadLibrary(pod.fetch, root);
    for (const [period, count] of [
      ["Today", 1],
      ["1W", 2],
      ["1M", 3],
      ["1Y", 4],
    ] as const)
      expect(computeTopArtists(history, library.models.tracks, period, now)[0]?.plays).toBe(count);
    expect(recentlyPlayed(history)).toHaveLength(3);
    expect(mostPlayedTracks(library, history, "1Y", now)[0]?.plays).toBe(2);
    expect(
      mostPlayedTracks(
        library,
        [
          ...history,
          history[0] as (typeof history)[number],
          { iri: "future", trackIri: "missing", startTime: new Date("2027-01-01") },
          { iri: "unknown", trackIri: "missing", startTime: now },
        ],
        "1M",
        now,
      ),
    ).toHaveLength(3);
    const ties = mostPlayedTracks(library, history, "1M", now);
    expect(ties.map((entry) => entry.track.title)).toEqual(["Apple", "Moon", "Zebra"]);
    await expect(
      loadHistory(
        failure(pod.fetch, () => true),
        root,
        now,
      ),
    ).rejects.toThrow();
    await expect(
      recordPlay(
        failure(pod.fetch, (_url, init) => init?.method === "PUT", 412),
        root,
        {
          iri: `${historyShard(base, now)}#conflict`,
          trackIri: tracks[0]?.value as string,
          startTime: now,
        },
      ),
    ).rejects.toMatchObject({ status: 412 });
  });
});
