// AUTHORED-BY Codex GPT-6.1-Sol
import { fileAdapterById, runFileImport } from "@jeswr/pod-connectors";
import {
  SPOTIFY_FILE_LIMITS,
  spotifyHistorySlug,
} from "@jeswr/pod-connectors/spotify/file-adapter";
import { describe, expect, it } from "vitest";
import { createImportWriter } from "../src/apps/home/components/connect/import-service";
import { loadHistory } from "../src/apps/music/lib/data/history";
import {
  dedupeImportedPlays,
  SPOTIFY_HISTORY_PARTS,
  spotifyHistoryUrl,
} from "../src/apps/music/lib/data/spotify-history";
import type { Playback } from "../src/apps/music/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

describe("Spotify history in Music", () => {
  it("reads monthly imported songs unchanged, and re-import adds no plays", async () => {
    const pod = createDemoPod({
      root: DEMO_ROOT,
      seed: await buildDemoSeed(Date.parse("2026-11-01T12:00:00Z")),
    });
    const adapter = fileAdapterById("spotify");
    if (!adapter) throw new Error("Missing Spotify file adapter");
    const rows = [
      {
        endTime: "2026-10-03 13:00",
        msPlayed: 1000,
        artistName: "Fixture Artist",
        trackName: "Fixture Song",
      },
    ];
    const file = new File([JSON.stringify(rows)], "StreamingHistory_music_0.json");
    const session = {
      mode: "demo" as const,
      webId: DEMO_WEBID,
      storageUrl: DEMO_ROOT,
      fetch: pod.fetch,
      displayName: "Fixture",
      subscribe: () => () => {},
      reset: async () => {},
    };
    const run = () =>
      runFileImport({
        adapter,
        file,
        podWriter: createImportWriter(session, "spotify", new AbortController().signal),
      });
    await run();
    const history = await loadHistory(pod.fetch, DEMO_ROOT, new Date("2026-11-01T12:00:00Z"));
    expect(history).toContainEqual(
      expect.objectContaining({
        title: "Fixture Song",
        artist: "Fixture Artist",
        startTime: new Date("2026-10-03T13:00:00.000Z"),
      }),
    );
    await run();
    const again = await loadHistory(pod.fetch, DEMO_ROOT, new Date("2026-11-01T12:00:00Z"));
    expect(again).toHaveLength(history.length);
  });
});

const NOW = new Date("2026-11-01T12:00:00Z");
async function demo() {
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.parse("2026-11-01T12:00:00Z")),
  });
  const adapter = fileAdapterById("spotify");
  if (!adapter) throw new Error("Missing Spotify file adapter");
  const session = {
    mode: "demo" as const,
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    fetch: pod.fetch,
    displayName: "Fixture",
    subscribe: () => () => {},
    reset: async () => {},
  };
  const run = (rows: unknown[]) =>
    runFileImport({
      adapter,
      file: new File([JSON.stringify(rows)], "StreamingHistory_music_0.json"),
      podWriter: createImportWriter(session, "spotify", new AbortController().signal),
    });
  return { pod, run };
}
const basic = (minute: number, trackName = "Fixture Song") => ({
  endTime: `2026-10-03 13:${String(minute).padStart(2, "0")}`,
  msPlayed: 1000,
  artistName: "Fixture Artist",
  trackName,
});
const extended = (time: string, name = "Fixture Song") => ({
  ts: time,
  ms_played: 1000,
  master_metadata_track_name: name,
  master_metadata_album_artist_name: "Fixture Artist",
  master_metadata_album_album_name: "Fixture Album",
  spotify_track_uri: "spotify:track:0123456789ABCDEFGHIJKL",
});
const titled = (history: Playback[], title: string) =>
  history.filter((play) => play.title === title);

describe("Spotify history parts, failures and duplicates in Music", () => {
  it("names the same documents as the connector", () => {
    expect(SPOTIFY_HISTORY_PARTS).toBe(SPOTIFY_FILE_LIMITS.monthParts);
    for (const part of [1, 2, 64])
      expect(spotifyHistoryUrl(DEMO_ROOT, "2026-10", part)).toBe(
        new URL(`integrations/spotify/${spotifyHistorySlug("2026-10", part)}`, DEMO_ROOT).href,
      );
  });

  it("reads every part of a split month", async () => {
    const { pod, run } = await demo();
    const previous = SPOTIFY_FILE_LIMITS.documentPlays;
    Object.assign(SPOTIFY_FILE_LIMITS, { documentPlays: 2 });
    try {
      await run([0, 10, 20, 30, 40].map((minute) => basic(minute, `Song ${minute}`)));
    } finally {
      Object.assign(SPOTIFY_FILE_LIMITS, { documentPlays: previous });
    }
    expect(await pod.fetch(spotifyHistoryUrl(DEMO_ROOT, "2026-10", 3))).toMatchObject({
      ok: true,
    });
    const history = await loadHistory(pod.fetch, DEMO_ROOT, NOW);
    expect(history.filter((play) => play.title?.startsWith("Song "))).toHaveLength(5);
  });

  it("keeps native history and earlier parts when imported history cannot be read", async () => {
    const { pod, run } = await demo();
    const native = await loadHistory(pod.fetch, DEMO_ROOT, NOW);
    await run([basic(0)]);
    const failing =
      (match: string): typeof fetch =>
      async (input, init) =>
        String(input).includes(match)
          ? new Response("unavailable", { status: 500 })
          : pod.fetch(input, init);
    const history = await loadHistory(
      failing("/integrations/spotify/music/history/"),
      DEMO_ROOT,
      NOW,
    );
    expect(history).toEqual(native);
    const partial = await loadHistory(failing("2026-10-part-2"), DEMO_ROOT, NOW);
    expect(titled(partial, "Fixture Song")).toHaveLength(1);
  });

  it("counts a Basic and an Extended export of the same play once", async () => {
    const { pod, run } = await demo();
    await run([basic(0)]);
    await run([extended("2026-10-03T13:00:42Z")]);
    const history = await loadHistory(pod.fetch, DEMO_ROOT, NOW);
    const plays = titled(history, "Fixture Song");
    expect(plays).toHaveLength(1);
    // The precise Extended time wins.
    expect(plays[0]?.startTime).toEqual(new Date("2026-10-03T13:00:42.000Z"));
  });

  it("keeps repeated precise plays from one source and distinct songs", async () => {
    const { pod, run } = await demo();
    await run([
      extended("2026-10-03T13:00:10Z"),
      extended("2026-10-03T13:00:40Z"),
      extended("2026-10-03T13:00:41Z", "Other Song"),
    ]);
    const history = await loadHistory(pod.fetch, DEMO_ROOT, NOW);
    expect(titled(history, "Fixture Song")).toHaveLength(2);
    expect(titled(history, "Other Song")).toHaveLength(1);
  });

  it("drops a file play that repeats a live recently-played listen", () => {
    const live = `${DEMO_ROOT}integrations/spotify/music/recently-played.ttl`;
    const file = spotifyHistoryUrl(DEMO_ROOT, "2026-10", 1);
    const play = (iri: string, time: string, title: string, artist?: string): Playback => ({
      iri,
      trackIri: `${iri}-track`,
      startTime: new Date(time),
      title,
      artist,
    });
    const kept = dedupeImportedPlays(
      [
        play(`${live}#play-1`, "2026-10-03T13:00:41.512Z", "Fixture Song", "Fixture Artist, Guest"),
        play(`${file}#scrobble-a`, "2026-10-03T13:00:42.000Z", "fixture  song", "Fixture Artist"),
        play(`${file}#scrobble-b`, "2026-10-03T13:00:42.000Z", "Fixture Song", "Someone Else"),
        play(`${file}#scrobble-c`, "2026-10-03T13:05:42.000Z", "Fixture Song", "Fixture Artist"),
        play(`${file}#scrobble-d`, "2026-10-03T13:00:42.000Z", "Untitled"),
      ],
      live,
    );
    expect(kept.map((entry) => entry.iri.split("#")[1]).sort()).toEqual([
      "play-1",
      "scrobble-b",
      "scrobble-c",
      "scrobble-d",
    ]);
  });
});
