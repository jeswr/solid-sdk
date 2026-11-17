// AUTHORED-BY Codex GPT-6.1-Sol
import { SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import { describe, expect, it, vi } from "vitest";
import { sampleWav } from "../src/apps/music/demo/wav";
import {
  createDocument,
  loadLibrary,
  musicRoot,
  provision,
} from "../src/apps/music/lib/data/library";
import {
  addDriveAudio,
  audioType,
  createMusicBinary,
  linkOwnedRecording,
  listDriveAudio,
  uploadMusicFile,
} from "../src/apps/music/lib/data/owned";
import {
  recordOwnedPlay,
  SOLID_SUITE_AGENT,
  shouldRecordPlay,
} from "../src/apps/music/lib/data/playback";
import { type AudioMetadata, extractAudioCover } from "../src/apps/music/lib/metadata/metadata";
import {
  Album,
  Artist,
  DataFactory,
  historyShard,
  loadMusic,
  MusicNode,
  readHistory,
  Store,
  saveMusic,
  serializeMusic,
  Track,
} from "../src/apps/music/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { flac, id3, join, mpeg, png } from "./music-metadata-fixtures";

const root = "https://owned.test/alice/";
const base = musicRoot(root);
const metadata: AudioMetadata = {
  title: "Paper Moon",
  artist: "Mira Example",
  album: "Fictional Skies",
  track: 7,
  disc: 2,
  year: 2024,
  duration: 2,
  coverArtMime: null,
};
const file = () => ({
  name: "Paper Moon.flac",
  type: "audio/flac",
  bytes: flac().buffer,
  lyrics: "[00:00.00]Paper moon\n[00:01.00]Shining",
});
const failure =
  (
    fetch: typeof globalThis.fetch,
    predicate: (url: string, init?: RequestInit) => boolean,
    status = 500,
  ): typeof globalThis.fetch =>
  async (input, init) =>
    predicate(String(input), init) ? new Response(null, { status }) : fetch(input, init);

async function imported(
  pod: ReturnType<typeof createDemoPod>,
  options: { album?: boolean; artist?: boolean } = {},
) {
  await provision(pod.fetch, root);
  const data = new Store();
  const artist = new Artist(`${base}artists/imported.ttl#it`, data).stampType();
  artist.title = metadata.artist as string;
  const album = new Album(`${base}albums/imported.ttl#it`, data).stampType();
  album.title = metadata.album as string;
  album.setArtist(artist.value);
  const track = new Track(`${root}integrations/spotify/music/tracks.ttl#it`, data).stampType();
  track.title = " ＰＡＰＥＲ   MOON ";
  if (options.artist !== false) track.setArtist(artist.value);
  if (options.album !== false) track.setAlbum(album.value);
  track.sourceUrl = "https://open.spotify.com/track/example";
  for (const id of [artist.value, album.value, track.value])
    await createDocument(
      pod.fetch,
      root,
      id.split("#")[0] as string,
      new Store(data.getQuads(DataFactory.namedNode(id), null, null, null)),
    );
  return { track, artist, album };
}

describe("Owned music", () => {
  it("uploads tags, audio, embedded artwork and synced LRC, then retries without duplicate songs", async () => {
    const pod = createDemoPod({ root });
    const { id } = await uploadMusicFile(pod.fetch, root, file());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", file().bytes));
    const uploadId = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);
    let library = await loadLibrary(pod.fetch, root);
    expect(library.tracks).toHaveLength(1);
    expect(library.tracks[0]).toMatchObject({
      id,
      title: "Paper Moon",
      artist: "Mira Example",
      albumTitle: "Fictional Skies",
      trackNumber: 7,
      discNumber: 2,
      durationSeconds: 2,
      contentUrl: `${base}files/${uploadId}.flac`,
      lyricsUrl: `${base}files/${uploadId}.lrc`,
      imageUrl: `${base}files/${uploadId}-cover.png`,
    });
    expect(
      new Uint8Array(await (await pod.fetch(`${base}files/${uploadId}-cover.png`)).arrayBuffer()),
    ).toEqual(png);
    expect(await (await pod.fetch(`${base}files/${uploadId}.lrc`)).text()).toBe(file().lyrics);
    await uploadMusicFile(pod.fetch, root, file());
    library = await loadLibrary(pod.fetch, root);
    expect(library.tracks).toHaveLength(1);
    expect(library.models.albums[0]?.imageUrl).toBe(`${base}files/${uploadId}-cover.png`);
    await expect(
      uploadMusicFile(pod.fetch, root, { ...file(), name: "Renamed.flac" }),
    ).resolves.toEqual({ id, status: "already-owned" });
  });
  it("links an imported track and preserves its source, credits and album, including existing artwork", async () => {
    const pod = createDemoPod({ root });
    const { track, album } = await imported(pod);
    expect((await uploadMusicFile(pod.fetch, root, file())).id).toBe(track.value);
    let library = await loadLibrary(pod.fetch, root);
    expect(library.tracks).toHaveLength(1);
    expect(library.tracks[0]?.sourceUrl).toContain("spotify");
    expect(library.tracks[0]?.albumId).toBe(album.value);
    const cover = library.models.albums[0]?.imageUrl;
    await linkOwnedRecording(
      pod.fetch,
      root,
      library.tracks[0]?.contentUrl as string,
      metadata,
      "x",
      `${base}files/other-cover.png`,
    );
    library = await loadLibrary(pod.fetch, root);
    expect(library.models.albums[0]?.imageUrl).toBe(cover);
  });
  it("uses filename fallbacks, reuses artist and album identities for new tracks, and needs no tags/cover/LRC", async () => {
    const pod = createDemoPod({ root });
    const { artist, album } = await imported(pod);
    const id = await linkOwnedRecording(
      pod.fetch,
      root,
      `${base}files/another.wav`,
      { ...metadata, title: "Another" },
      "ignored.wav",
    );
    let library = await loadLibrary(pod.fetch, root);
    expect(library.tracks.find((t) => t.id === id)).toMatchObject({
      artistId: artist.value,
      albumId: album.value,
    });
    const wav = { id: "wav", name: "My song.wav", type: "", bytes: sampleWav() };
    await uploadMusicFile(pod.fetch, root, wav);
    library = await loadLibrary(pod.fetch, root);
    expect(library.tracks.find((t) => t.title === "My song")).toMatchObject({
      artist: "Unknown artist",
      albumTitle: "Unknown album",
      durationSeconds: 4,
    });
    const blank = {
      ...metadata,
      title: " ",
      artist: " ",
      album: " ",
      duration: null,
      track: null,
      disc: null,
    };
    const untitled = await linkOwnedRecording(
      pod.fetch,
      root,
      `${base}files/untitled.wav`,
      blank,
      "",
    );
    expect((await loadLibrary(pod.fetch, root)).tracks.find((t) => t.id === untitled)?.title).toBe(
      "Untitled",
    );
  });
  it("validates upload formats, metadata and LRC before any write", async () => {
    const pod = createDemoPod({ root });
    expect(audioType("file", "audio/mpeg")).toBe("audio/mpeg");
    expect(audioType("FILE.M4A", "application/octet-stream")).toBe("audio/mp4");
    expect(audioType("", "")).toBeUndefined();
    await expect(
      uploadMusicFile(pod.fetch, root, { ...file(), name: "x.txt", type: "text/plain" }),
    ).rejects.toThrow("Choose");
    await expect(
      uploadMusicFile(pod.fetch, root, { ...file(), lyrics: "[99:99]bad" }),
    ).rejects.toThrow();
    await expect(
      uploadMusicFile(pod.fetch, root, { ...file(), bytes: new ArrayBuffer(0) }),
    ).rejects.toThrow();
    expect(pod.snapshot().resources).toHaveLength(0);
    await expect(
      linkOwnedRecording(pod.fetch, root, "https://evil.test/a.mp3", metadata, "x"),
    ).rejects.toThrow();
    expect(await extractAudioCover(join(id3(4), mpeg()).buffer)).toEqual({
      type: "image/png",
      bytes: png,
    });
    expect(
      await extractAudioCover(
        join(
          id3(4, 3, true, "No image", undefined, [
            { mime: "image/gif", data: new Uint8Array([71, 73, 70, 56, 57, 97]) },
          ]),
          mpeg(),
        ).buffer,
      ),
    ).toBeUndefined();
  });
  it("binary writes are create-only, reconcile byte-identical 412s and preserve conflicting bytes", async () => {
    const pod = createDemoPod({ root });
    const url = `${base}files/a.wav`;
    await createMusicBinary(pod.fetch, root, url, sampleWav(), "audio/wav");
    await createMusicBinary(pod.fetch, root, url, sampleWav(), "audio/wav");
    for (const bytes of [new Uint8Array([1]).buffer, new Uint8Array(sampleWav().byteLength).buffer])
      await expect(
        createMusicBinary(pod.fetch, root, url, bytes, "audio/wav"),
      ).rejects.toMatchObject({ status: 412 });
    await expect(
      createMusicBinary(
        failure(pod.fetch, (_url, init) => init?.method === "PUT"),
        root,
        url,
        sampleWav(),
        "audio/wav",
      ),
    ).rejects.toMatchObject({ status: 500 });
    await expect(
      createMusicBinary(
        failure(pod.fetch, (_url, init) => !init?.method),
        root,
        url,
        sampleWav(),
        "audio/wav",
      ),
    ).rejects.toMatchObject({ status: 412 });
  });
  it("reconciles library write races without overwriting other entities, and propagates exhausted conflicts and failures", async () => {
    const pod = createDemoPod({ root });
    await provision(pod.fetch, root);
    let raced = false;
    const racing: typeof fetch = async (input, init) => {
      if (!raced && String(input).endsWith("owned.ttl") && init?.method === "PUT") {
        raced = true;
        const data = new Store();
        new Track(`${base}tracks/owned.ttl#other`, data).stampType().title = "Kept";
        await createDocument(pod.fetch, root, `${base}tracks/owned.ttl`, data);
      }
      return pod.fetch(input, init);
    };
    await linkOwnedRecording(racing, root, `${base}files/song.flac`, metadata, "x");
    expect((await loadLibrary(pod.fetch, root)).tracks).toHaveLength(2);
    const conflict = failure(
      pod.fetch,
      (url, init) => url.endsWith("owned.ttl") && init?.method === "PUT",
      412,
    );
    await expect(
      linkOwnedRecording(
        conflict,
        root,
        `${base}files/second.flac`,
        { ...metadata, title: "Second" },
        "x",
      ),
    ).rejects.toMatchObject({ status: 412 });
    await expect(
      linkOwnedRecording(
        failure(pod.fetch, (_url, init) => init?.method === "PUT"),
        root,
        `${base}files/third.flac`,
        { ...metadata, title: "Third" },
        "x",
      ),
    ).rejects.toMatchObject({ status: 500 });
    // A document read can fail after the listing succeeded.
    let reads = 0;
    const broken: typeof fetch = async (input, init) => {
      if (String(input).endsWith("owned.ttl") && !init?.method && ++reads === 2)
        return new Response(null, { status: 403 });
      return pod.fetch(input, init);
    };
    await expect(
      linkOwnedRecording(
        broken,
        root,
        `${base}files/fourth.flac`,
        { ...metadata, title: "Fourth" },
        "x",
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("fills missing imported artist/album metadata conservatively", async () => {
    const pod = createDemoPod({ root });
    const { track } = await imported(pod, { artist: false, album: false });
    const id = await linkOwnedRecording(
      pod.fetch,
      root,
      `${base}files/no-artist.wav`,
      { ...metadata, artist: null },
      "x",
      `${base}files/cover.png`,
    );
    expect(id).not.toBe(track.value);
    expect(
      (await loadLibrary(pod.fetch, root)).models.tracks.find((t) => t.value === track.value)
        ?.album,
    ).toBeUndefined();
  });
  it("accepts another writer's album artwork on 412 and reports an unresolved cover conflict", async () => {
    for (const status of [412, 500]) {
      const pod = createDemoPod({ root });
      const { album } = await imported(pod);
      const url = album.value.split("#")[0] as string;
      const broken = failure(
        pod.fetch,
        (target, init) => target === url && init?.method === "PUT",
        status,
      );
      await expect(
        linkOwnedRecording(
          broken,
          root,
          `${base}files/song.flac`,
          metadata,
          "x",
          `${base}files/cover.png`,
        ),
      ).rejects.toMatchObject({ status });
    }
    const pod = createDemoPod({ root });
    const { album } = await imported(pod);
    const racing: typeof fetch = async (input, init) => {
      if (String(input) === album.value.split("#")[0] && init?.method === "PUT") {
        const doc = await loadMusic(pod.fetch, String(input));
        new Album(album.value, doc.dataset).imageUrl = `${base}files/winner.png`;
        await pod.fetch(input, { ...init, body: await serializeMusic(doc.dataset) });
        return new Response(null, { status: 412 });
      }
      return pod.fetch(input, init);
    };
    await linkOwnedRecording(
      racing,
      root,
      `${base}files/song.flac`,
      metadata,
      "x",
      `${base}files/cover.png`,
    );
    expect((await loadLibrary(pod.fetch, root)).models.albums[0]?.imageUrl).toContain("winner.png");
  });
});

describe("Drive audio", () => {
  it("lists nested audio only, picks by URL without copying or writing to Drive", async () => {
    const pod = createDemoPod({ root });
    expect(await listDriveAudio(pod.fetch, root)).toEqual([]);
    await pod.fetch(`${root}drive/folder/chime.wav`, {
      method: "PUT",
      headers: { "Content-Type": "audio/wav" },
      body: sampleWav(),
    });
    await pod.fetch(`${root}drive/notes.txt`, { method: "PUT", body: "text" });
    expect(await listDriveAudio(pod.fetch, root)).toEqual([
      { url: `${root}drive/folder/chime.wav`, name: "chime.wav" },
    ]);
    const before = await (await pod.fetch(`${root}drive/folder/chime.wav`)).arrayBuffer();
    const id = await addDriveAudio(pod.fetch, root, `${root}drive/folder/chime.wav`);
    expect(
      (await loadLibrary(pod.fetch, root)).tracks.find((track) => track.id === id)?.contentUrl,
    ).toBe(`${root}drive/folder/chime.wav`);
    expect(await (await pod.fetch(`${root}drive/folder/chime.wav`)).arrayBuffer()).toEqual(before);
    expect(
      pod
        .snapshot()
        .resources.some(([url]) => url.startsWith(`${base}files/`) && !url.endsWith("/")),
    ).toBe(false);
    await expect(addDriveAudio(pod.fetch, root, `${root}drive/missing.mp3`)).rejects.toMatchObject({
      status: 404,
    });
    await expect(addDriveAudio(pod.fetch, root, `${root}drive/notes.txt`)).rejects.toThrow(
      "audio file",
    );
    await expect(addDriveAudio(pod.fetch, root, `${root}elsewhere.wav`)).rejects.toThrow();
    await expect(
      listDriveAudio(
        failure(pod.fetch, () => true, 403),
        root,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("Owned listening history", () => {
  it("uses 30 s or half the known duration, and rejects nonfinite listening time", () => {
    for (const [listened, duration, result] of [
      [29, 200, false],
      [30, 200, true],
      [4, 10, false],
      [5, 10, true],
      [30, undefined, true],
      [29, undefined, false],
      [30, 0, true],
      [30, NaN, true],
      [30, Infinity, true],
      [-1, 10, false],
      [NaN, 10, false],
      [Infinity, 10, false],
    ] as const)
      expect(shouldRecordPlay(listened, duration)).toBe(result);
  });
  it("writes the normal event shape/source, accepts an already completed 412 and retries a changed shard", async () => {
    const pod = createDemoPod({ root });
    const startTime = new Date("2026-11-11T12:00:00Z");
    const url = historyShard(base, startTime);
    const play = { iri: `${url}#play`, trackIri: `${base}tracks/song.ttl#it`, startTime };
    await recordOwnedPlay(pod.fetch, root, play);
    expect(readHistory((await loadMusic(pod.fetch, url)).dataset)[0]).toMatchObject({
      ...play,
      agent: SOLID_SUITE_AGENT,
    });
    await recordOwnedPlay(
      failure(pod.fetch, (_url, init) => init?.method === "PUT", 412),
      root,
      play,
    );
    let failed = false;
    const race: typeof fetch = async (input, init) => {
      if (!failed && init?.method === "PUT") {
        failed = true;
        return new Response(null, { status: 412 });
      }
      return pod.fetch(input, init);
    };
    await recordOwnedPlay(race, root, { ...play, iri: `${url}#second` });
    const always = failure(pod.fetch, (_url, init) => init?.method === "PUT", 412);
    await expect(
      recordOwnedPlay(always, root, { ...play, iri: `${url}#third` }),
    ).rejects.toMatchObject({ status: 412 });
    await expect(
      recordOwnedPlay(
        failure(pod.fetch, () => true),
        root,
        play,
      ),
    ).rejects.toThrow();
  });
});

it("validates and clears playable model accessors and reads literal content URLs", () => {
  const dataset = new Store();
  const track = new Track(`${base}tracks/t.ttl#it`, dataset);
  expect(track.contentUrl).toBeUndefined();
  expect(track.lyricsUrl).toBeUndefined();
  track.contentUrl = `${base}files/t.wav`;
  track.lyricsUrl = `${base}files/t.lrc`;
  expect(track.contentUrl).toContain("t.wav");
  expect(track.lyricsUrl).toContain("t.lrc");
  expect(() => {
    track.contentUrl = "javascript:alert(1)";
  }).toThrow();
  expect(() => {
    track.lyricsUrl = "file:///tmp/lyrics";
  }).toThrow();
  track.contentUrl = undefined;
  track.lyricsUrl = undefined;
  track.writeString("https://schema.org/contentUrl", `${base}files/literal.wav`);
  expect(track.contentUrl).toContain("literal.wav");
});
it("handles untrusted Drive members, cycles, absent MIME and sorting without following external links", async () => {
  const pod = createDemoPod({ root });
  for (const name of ["z.wav", "a.wav"])
    await pod.fetch(`${root}drive/${name}`, {
      method: "PUT",
      headers: { "Content-Type": "audio/wav" },
      body: sampleWav(),
    });
  await pod.fetch(`${root}drive/folder/`, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
      Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
    },
    body: "",
  });
  const mutate: typeof fetch = async (input, init) => {
    const response = await pod.fetch(input, init);
    if (!init?.method && String(input).endsWith("/")) {
      const doc = await loadMusic(async () => response, String(input));
      const listing = new MusicNode(String(input), doc.dataset);
      const predicate = "http://www.w3.org/ns/ldp#contains";
      SetFrom.subjectPredicate(listing, predicate, TermAs.is, TermFrom.instance).add(
        new MusicNode(`${root}drive/folder/`, doc.dataset),
      );
      SetFrom.subjectPredicate(listing, predicate, TermAs.is, TermFrom.instance).add(
        new MusicNode("https://evil.test/audio.wav", doc.dataset),
      );
      // Strip listing MIME so the suffix fallback is exercised.
      for (const subject of doc.dataset.getSubjects(null, null, null))
        new MusicNode(subject, doc.dataset).clear("http://purl.org/dc/terms/format");
      return new Response(await serializeMusic(doc.dataset), {
        headers: { "Content-Type": "text/turtle" },
      });
    }
    return response;
  };
  expect((await listDriveAudio(mutate, root)).map((file) => file.name)).toEqual(["a.wav", "z.wav"]);
});
it("uses Unknown artist when matching artist-less albums and tracks", async () => {
  const pod = createDemoPod({ root });
  await provision(pod.fetch, root);
  const data = new Store();
  new Album(`${base}albums/missing.ttl#it`, data).stampType().title = "Unknown album";
  await createDocument(pod.fetch, root, `${base}albums/missing.ttl`, data);
  await linkOwnedRecording(
    pod.fetch,
    root,
    `${base}files/empty.wav`,
    {
      ...metadata,
      title: null,
      artist: null,
      album: null,
      duration: null,
      track: null,
      disc: null,
    },
    "empty.wav",
  );
  expect((await loadLibrary(pod.fetch, root)).tracks[0]?.albumId).toBe(
    `${base}albums/missing.ttl#it`,
  );
});
it("retries an existing Drive link without MIME and can add lyrics to an already linked track", async () => {
  const pod = createDemoPod({ root });
  const url = `${root}drive/chime.wav`;
  await pod.fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "audio/wav" },
    body: sampleWav(),
  });
  const id = await addDriveAudio(pod.fetch, root, url);
  const noMime: typeof fetch = async (input, init) => {
    const response = await pod.fetch(input, init);
    if (String(input) === url) response.headers.delete("Content-Type");
    return response;
  };
  expect(await addDriveAudio(noMime, root, url)).toBe(id);
  const empty = { ...metadata, title: "chime", artist: null, album: null };
  expect(
    await linkOwnedRecording(pod.fetch, root, url, empty, "x", undefined, `${base}files/chime.lrc`),
  ).toBe(id);
});
it("keeps audio linked between the library read and the fresh document read", async () => {
  const pod = createDemoPod({ root });
  const { track } = await imported(pod);
  const target = track.value.split("#")[0] as string;
  let reads = 0;
  const racing: typeof fetch = async (input, init) => {
    if (String(input) === target && !init?.method && ++reads === 2) {
      const doc = await loadMusic(pod.fetch, target);
      new Track(track.value, doc.dataset).contentUrl = `${base}files/winner.wav`;
      await pod.fetch(target, {
        method: "PUT",
        headers: { "Content-Type": "text/turtle", "If-Match": doc.etag as string },
        body: await serializeMusic(doc.dataset),
      });
    }
    return pod.fetch(input, init);
  };
  await expect(
    linkOwnedRecording(racing, root, `${base}files/ours.wav`, metadata, "x"),
  ).rejects.toMatchObject({ status: 412 });
  expect((await loadLibrary(pod.fetch, root)).tracks[0]?.contentUrl).toBe(
    `${base}files/winner.wav`,
  );
});

// AUTHORED-BY Codex GPT-6
it("skips an already-owned match before writing binaries", async () => {
  const pod = createDemoPod({ root });
  const { track } = await imported(pod);
  const doc = await loadMusic(pod.fetch, track.value.split("#")[0] as string);
  new Track(track.value, doc.dataset).contentUrl = `${base}files/existing.flac`;
  await saveMusic(pod.fetch, root, doc.url, doc.dataset, { ifMatch: doc.etag as string });
  const before = pod.snapshot().resources;
  await expect(uploadMusicFile(pod.fetch, root, file())).resolves.toEqual({
    id: track.value,
    status: "already-owned",
  });
  expect(pod.snapshot().resources).toEqual(before);
});
it.each([
  "cover",
  "lyrics",
  "metadata",
])("cleans up attempt binaries when %s fails", async (stage) => {
  const pod = createDemoPod({ root });
  const broken = failure(
    pod.fetch,
    (url, init) =>
      init?.method === "PUT" &&
      (stage === "cover"
        ? url.endsWith("-cover.png")
        : stage === "lyrics"
          ? url.endsWith(".lrc")
          : url.endsWith("owned.ttl")),
  );
  await expect(uploadMusicFile(broken, root, file())).rejects.toMatchObject({ status: 500 });
  expect(
    pod
      .snapshot()
      .resources.filter(([url]) => url.startsWith(`${base}files/`) && !url.endsWith("/")),
  ).toEqual([]);
});
it("distinguishes albums, durations and untagged files and leaves imported fields intact", async () => {
  for (const change of [
    { album: "Another album" },
    { duration: 8 },
    { title: null },
    { artist: null },
  ]) {
    const pod = createDemoPod({ root });
    const { track } = await imported(pod);
    const doc = await loadMusic(pod.fetch, track.value.split("#")[0] as string);
    new Track(track.value, doc.dataset).durationSeconds = 2;
    await saveMusic(pod.fetch, root, doc.url, doc.dataset, { ifMatch: doc.etag as string });
    expect(
      await linkOwnedRecording(
        pod.fetch,
        root,
        `${base}files/other.wav`,
        { ...metadata, ...change },
        "Paper Moon.wav",
      ),
    ).not.toBe(track.value);
  }
  const pod = createDemoPod({ root });
  const { track } = await imported(pod);
  const doc = await loadMusic(pod.fetch, track.value.split("#")[0] as string);
  const existing = new Track(track.value, doc.dataset);
  existing.durationSeconds = 3;
  existing.writeString("https://schema.org/trackNumber", "1");
  existing.writeString("https://schema.org/discNumber", "1");
  await saveMusic(pod.fetch, root, doc.url, doc.dataset, { ifMatch: doc.etag as string });
  await linkOwnedRecording(pod.fetch, root, `${base}files/song.wav`, metadata, "x");
  expect((await loadLibrary(pod.fetch, root)).tracks[0]).toMatchObject({
    durationSeconds: 3,
    trackNumber: 1,
    discNumber: 1,
  });
});
it("never renames an existing owned artist when another song has differently cased tags", async () => {
  const pod = createDemoPod({ root });
  await provision(pod.fetch, root);
  await linkOwnedRecording(pod.fetch, root, `${base}files/first.wav`, metadata, "x");
  await linkOwnedRecording(
    pod.fetch,
    root,
    `${base}files/second.wav`,
    { ...metadata, title: "Second", artist: "mira example" },
    "x",
  );
  expect((await loadLibrary(pod.fetch, root)).models.artists[0]?.title).toBe("Mira Example");
});

it("uses album plus track number to resolve candidates and creates a recording for ambiguous versions", async () => {
  for (const mode of ["exact", "ambiguous", "no-album", "no-number"]) {
    const pod = createDemoPod({ root });
    const { track, artist, album } = await imported(pod);
    const doc = await loadMusic(pod.fetch, track.value.split("#")[0] as string);
    new Track(track.value, doc.dataset).writeString("https://schema.org/trackNumber", "1");
    const second = new Track(`${doc.url}#second`, doc.dataset).stampType();
    second.title = metadata.title as string;
    second.setArtist(artist.value);
    second.setAlbum(album.value);
    second.writeString("https://schema.org/trackNumber", mode === "ambiguous" ? "1" : "7");
    await saveMusic(pod.fetch, root, doc.url, doc.dataset, { ifMatch: doc.etag as string });
    const id = await linkOwnedRecording(
      pod.fetch,
      root,
      `${base}files/version.wav`,
      {
        ...metadata,
        ...(mode === "no-album" ? { album: null } : {}),
        ...(mode === "no-number" ? { track: null } : {}),
      },
      "x",
    );
    if (mode === "exact") expect(id).toBe(second.value);
    else expect([track.value, second.value]).not.toContain(id);
  }
});
it("retains pre-existing identical binaries on failed retries and reuses the content hash paths", async () => {
  const pod = createDemoPod({ root });
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", file().bytes));
  const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  const url = `${base}files/${hash}.flac`;
  await createMusicBinary(pod.fetch, root, url, file().bytes, "audio/flac");
  const broken = failure(
    pod.fetch,
    (url, init) => init?.method === "PUT" && url.endsWith("owned.ttl"),
  );
  await expect(uploadMusicFile(broken, root, file())).rejects.toMatchObject({ status: 500 });
  expect((await pod.fetch(url)).ok).toBe(true);
  const result = await uploadMusicFile(pod.fetch, root, { ...file(), name: "Renamed.flac" });
  expect(result.status).toBe("added");
  expect((await loadLibrary(pod.fetch, root)).tracks[0]?.contentUrl).toBe(url);
});
it("still reports the original write failure if binary cleanup fails", async () => {
  const pod = createDemoPod({ root });
  const broken: typeof fetch = async (input, init) => {
    if (init?.method === "DELETE") throw new Error("Offline during cleanup");
    if (init?.method === "PUT" && String(input).endsWith("owned.ttl"))
      return new Response(null, { status: 500 });
    return pod.fetch(input, init);
  };
  await expect(uploadMusicFile(broken, root, file())).rejects.toMatchObject({ status: 500 });
});

it("does not publish an audio link when writing imported album artwork fails, so a retry can succeed", async () => {
  const pod = createDemoPod({ root });
  const { track, album } = await imported(pod);
  const broken = failure(
    pod.fetch,
    (url, init) => init?.method === "PUT" && url === album.value.split("#")[0],
  );
  await expect(uploadMusicFile(broken, root, file())).rejects.toMatchObject({ status: 500 });
  expect((await loadLibrary(pod.fetch, root)).tracks[0]?.contentUrl).toBeUndefined();
  expect((await uploadMusicFile(pod.fetch, root, file())).id).toBe(track.value);
});

it("accepts missing album/duration and the 3-second boundary without replacing imported values", async () => {
  for (const change of [{ album: null }, { duration: null }, { duration: 5 }]) {
    const pod = createDemoPod({ root });
    const { track } = await imported(pod);
    const doc = await loadMusic(pod.fetch, track.value.split("#")[0] as string);
    new Track(track.value, doc.dataset).durationSeconds = 2;
    await saveMusic(pod.fetch, root, doc.url, doc.dataset, { ifMatch: doc.etag as string });
    expect(
      await linkOwnedRecording(
        pod.fetch,
        root,
        `${base}files/boundary.wav`,
        { ...metadata, ...change },
        "x",
      ),
    ).toBe(track.value);
    expect((await loadLibrary(pod.fetch, root)).tracks[0]?.durationSeconds).toBe(2);
  }
});
it("keeps separate untagged recordings even with the same filename and preserves retries", async () => {
  const pod = createDemoPod({ root });
  const first = sampleWav();
  const second = first.slice(0);
  const changed = new Uint8Array(second);
  changed[100] = (changed[100] as number) ^ 1;
  const a = await uploadMusicFile(pod.fetch, root, {
    name: "01.wav",
    type: "audio/wav",
    bytes: first,
  });
  const b = await uploadMusicFile(pod.fetch, root, {
    name: "01.wav",
    type: "audio/wav",
    bytes: second,
  });
  expect(a.id).not.toBe(b.id);
  expect((await loadLibrary(pod.fetch, root)).tracks).toHaveLength(2);
  expect(
    await uploadMusicFile(pod.fetch, root, {
      name: "Renamed.wav",
      type: "audio/wav",
      bytes: first,
    }),
  ).toEqual({ id: a.id, status: "already-owned" });
});

it("keeps the existing audio and reports a specific conflict when directly linking another resource", async () => {
  const pod = createDemoPod({ root });
  await provision(pod.fetch, root);
  const id = await linkOwnedRecording(pod.fetch, root, `${base}files/first.flac`, metadata, "x");
  await expect(
    linkOwnedRecording(pod.fetch, root, `${base}files/second.flac`, metadata, "x"),
  ).rejects.toThrow("This song already has an audio file. Its existing file was kept.");
  expect((await loadLibrary(pod.fetch, root)).tracks.find((t) => t.id === id)?.contentUrl).toBe(
    `${base}files/first.flac`,
  );
});

it("fills lyrics only when the recording has none", async () => {
  const pod = createDemoPod({ root });
  await provision(pod.fetch, root);
  const url = `${base}files/song.flac`;
  await linkOwnedRecording(
    pod.fetch,
    root,
    url,
    metadata,
    "x",
    undefined,
    `${base}files/first.lrc`,
  );
  await linkOwnedRecording(
    pod.fetch,
    root,
    url,
    metadata,
    "x",
    undefined,
    `${base}files/other.lrc`,
  );
  expect((await loadLibrary(pod.fetch, root)).tracks[0]?.lyricsUrl).toBe(`${base}files/first.lrc`);
});

// AUTHORED-BY Codex GPT-6
it("keeps an imported album's referenced cover when the later track save fails", async () => {
  const pod = createDemoPod({ root });
  const { track } = await imported(pod);
  const broken = failure(
    pod.fetch,
    (url, init) => init?.method === "PUT" && url === track.value.split("#")[0],
  );
  await expect(uploadMusicFile(broken, root, file())).rejects.toMatchObject({ status: 500 });
  const library = await loadLibrary(pod.fetch, root);
  expect(library.tracks[0]?.contentUrl).toBeUndefined();
  const cover = library.models.albums[0]?.imageUrl;
  expect(cover).toBeDefined();
  expect((await pod.fetch(cover as string)).ok).toBe(true);
  expect(
    pod
      .snapshot()
      .resources.filter(([url]) => url.startsWith(`${base}files/`) && !url.endsWith("/")),
  ).toHaveLength(1);
});

it.each([
  "matched",
  "no-album",
  "new",
])("does not upload artwork or lyrics that the %s recording will not use", async (mode) => {
  const pod = createDemoPod({ root });
  const { track, album } = await imported(pod, { album: mode !== "no-album" });
  const albumDoc = await loadMusic(pod.fetch, album.value.split("#")[0] as string);
  new Album(album.value, albumDoc.dataset).imageUrl = `${base}files/existing.png`;
  await saveMusic(pod.fetch, root, albumDoc.url, albumDoc.dataset, {
    ifMatch: albumDoc.etag as string,
  });
  const trackDoc = await loadMusic(pod.fetch, track.value.split("#")[0] as string);
  const existing = new Track(track.value, trackDoc.dataset);
  existing.lyricsUrl = `${base}files/existing.lrc`;
  if (mode === "new") existing.title = "Another song";
  await saveMusic(pod.fetch, root, trackDoc.url, trackDoc.dataset, {
    ifMatch: trackDoc.etag as string,
  });
  const writes: string[] = [];
  const recording: typeof fetch = async (input, init) => {
    if (init?.method === "PUT" && String(input).startsWith(`${base}files/`))
      writes.push(String(input));
    return pod.fetch(input, init);
  };
  const result = await uploadMusicFile(recording, root, file());
  expect(writes.filter((url) => url.includes("-cover."))).toEqual([]);
  expect(writes.filter((url) => url.endsWith(".lrc"))).toHaveLength(mode === "new" ? 1 : 0);
  const library = await loadLibrary(pod.fetch, root);
  expect(library.models.albums[0]?.imageUrl).toBe(`${base}files/existing.png`);
  if (mode !== "new") {
    expect(result.id).toBe(track.value);
    expect(library.tracks.find((t) => t.id === result.id)?.lyricsUrl).toBe(
      `${base}files/existing.lrc`,
    );
  }
});

it("keeps binaries another tab linked after a 412-identical upload when our link fails", async () => {
  const pod = createDemoPod({ root });
  let winner: Awaited<ReturnType<typeof uploadMusicFile>> | undefined;
  const losing: typeof fetch = async (input, init) => {
    if (init?.method === "PUT" && String(input).endsWith("owned.ttl")) {
      winner = await uploadMusicFile(pod.fetch, root, file());
      return new Response(null, { status: 500 });
    }
    return pod.fetch(input, init);
  };
  await expect(uploadMusicFile(losing, root, file())).rejects.toMatchObject({ status: 500 });
  expect(winner?.status).toBe("added");
  const track = (await loadLibrary(pod.fetch, root)).tracks.find((t) => t.id === winner?.id);
  for (const url of [track?.contentUrl, track?.lyricsUrl, track?.imageUrl]) {
    expect(url).toBeDefined();
    expect((await pod.fetch(url as string)).ok).toBe(true);
  }
});

it("checks binary sizes before comparing SHA-256 digests on a 412", async () => {
  const pod = createDemoPod({ root });
  const url = `${base}files/digest.wav`;
  const bytes = sampleWav();
  await createMusicBinary(pod.fetch, root, url, bytes, "audio/wav");
  const digest = vi.spyOn(crypto.subtle, "digest");
  try {
    await expect(
      createMusicBinary(pod.fetch, root, url, new ArrayBuffer(1), "audio/wav"),
    ).rejects.toMatchObject({ status: 412 });
    expect(digest).not.toHaveBeenCalled();
    await expect(createMusicBinary(pod.fetch, root, url, bytes, "audio/wav")).resolves.toBe(false);
    expect(digest).toHaveBeenCalledTimes(2);
    expect(digest.mock.calls.map(([algorithm]) => algorithm)).toEqual(["SHA-256", "SHA-256"]);
  } finally {
    digest.mockRestore();
  }
});

it("retains binaries if cleanup cannot re-read references and preserves the original save error", async () => {
  const pod = createDemoPod({ root });
  let failed = false;
  const deleted: string[] = [];
  const broken: typeof fetch = async (input, init) => {
    if (init?.method === "PUT" && String(input).endsWith("owned.ttl")) {
      failed = true;
      return new Response(null, { status: 500 });
    }
    if (failed && !init?.method) throw new Error("Offline during reference check");
    if (init?.method === "DELETE") deleted.push(String(input));
    return pod.fetch(input, init);
  };
  await expect(uploadMusicFile(broken, root, file())).rejects.toMatchObject({ status: 500 });
  expect(deleted).toEqual([]);
  expect(
    pod
      .snapshot()
      .resources.filter(([url]) => url.startsWith(`${base}files/`) && !url.endsWith("/")),
  ).toHaveLength(3);
});
