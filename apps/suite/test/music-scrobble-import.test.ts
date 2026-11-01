// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { computeTopArtists, loadHistory } from "../src/apps/music/lib/data/history";
import {
  createDocument,
  loadLibrary,
  musicRoot,
  provision,
} from "../src/apps/music/lib/data/library";
import {
  fingerprint,
  matchName,
  planScrobbleImport,
  readScrobbleFiles,
  SCROBBLE_AGENTS,
  saveScrobbles,
  scrobbleErrorMessage,
} from "../src/apps/music/lib/data/scrobbles";
import {
  Artist,
  appendPlaybacks,
  historyShard,
  InvalidMusicError,
  MusicWriteError,
  Store,
  Track,
} from "../src/apps/music/lib/model";
import { ScrobbleError } from "../src/apps/music/lib/scrobbles";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const root = "https://scrobbles.test/alice/";
const base = musicRoot(root);
const now = new Date("2026-11-01T12:00:00Z");
const lastFm = [
  "artist,album,track,timestamp",
  "The Junipers,A Small World,Apple,1793534400", // 2026-11-01T12:00:00Z, in the library
  "  the  JUNIPERS ,,apple ,1793448000", // 2026-10-31T12:00:00Z, same song by name
  "Nora Field,,Lanterns,1790856000", // 2026-10-01T12:00:00Z, not in the library
  "Nora Field,,Lanterns,1790856000", // exact duplicate, removed by the parser
  "broken row",
].join("\n");
const listenBrainz = (artist: string, track: string, seconds: number) =>
  JSON.stringify({
    listened_at: seconds,
    track_metadata: { artist_name: artist, track_name: track },
  });

async function fixture() {
  const pod = createDemoPod({ root });
  await provision(pod.fetch, root);
  const dataset = new Store();
  const artist = new Artist(`${base}artists/j.ttl#it`, dataset).stampType();
  artist.title = "The Junipers";
  const track = new Track(`${base}tracks/j.ttl#apple`, dataset).stampType();
  track.title = "Apple";
  track.setArtist(artist.value);
  const twin = new Track(`${base}tracks/j.ttl#apple-live`, dataset).stampType();
  twin.title = "Apple";
  twin.setArtist(artist.value);
  await createDocument(pod.fetch, root, `${base}tracks/j.ttl`, dataset);
  return { pod, library: await loadLibrary(pod.fetch, root), track };
}

describe("reading scrobble exports", () => {
  it("reads a Last.fm CSV and several ListenBrainz JSON Lines files together", () => {
    const result = readScrobbleFiles(
      [
        { name: "scrobbles.CSV", text: lastFm },
        { name: "2026-10.jsonl", text: listenBrainz("Nora Field", "Embers", 1793361600) },
        { name: "2026-09.jsonl", text: listenBrainz("Nora Field", "Lanterns", 1790856000) },
      ],
      now,
    );
    expect(result.listens.map((listen) => listen.track).sort()).toEqual(
      ["Apple", "Embers", "Lanterns", "apple "].sort(),
    );
    expect(result.warnings).toHaveLength(1);
  });
  it("reads a Last.fm CSV on its own", () => {
    expect(readScrobbleFiles([{ name: "a.csv", text: lastFm }], now).listens).toHaveLength(3);
  });
  it("finds the date range whatever order listens arrive in", () => {
    const { listens } = readScrobbleFiles([{ name: "a.csv", text: lastFm }], now);
    const plan = planScrobbleImport([...listens].reverse(), [], [], root);
    expect([plan.first, plan.last]).toEqual([
      new Date("2026-10-01T12:00:00Z"),
      new Date("2026-11-01T12:00:00Z"),
    ]);
  });
  it("reads one ListenBrainz JSON array file", () => {
    const text = `﻿ [${listenBrainz("A", "B", 1793361600)}]`;
    expect(readScrobbleFiles([{ name: "listens.json", text }], now).listens).toHaveLength(1);
  });
  it("refuses unsupported or ambiguous file choices", () => {
    const array = { name: "a.json", text: "[]" };
    expect(() => readScrobbleFiles([{ name: "a.txt", text: "" }], now)).toThrow(
      "Choose Last.fm .csv files or ListenBrainz .json or .jsonl files",
    );
    expect(() =>
      readScrobbleFiles(
        [
          { name: "a.csv", text: lastFm },
          { name: "b.csv", text: lastFm },
        ],
        now,
      ),
    ).toThrow("Choose one Last.fm file at a time");
    expect(() => readScrobbleFiles([array, { name: "b.jsonl", text: "{}" }], now)).toThrow(
      "Choose one ListenBrainz .json file at a time",
    );
  });
  it("explains failures in plain words", () => {
    expect(scrobbleErrorMessage(new RangeError("Pick one"))).toBe("Pick one");
    expect(scrobbleErrorMessage(new ScrobbleError("EXPORT_TOO_LARGE"))).toMatch(/too large/);
    expect(scrobbleErrorMessage(new ScrobbleError("INVALID_EXPORT"))).toMatch(/can read/);
    expect(scrobbleErrorMessage(new Error("x"))).toMatch(/can read/);
  });
});

describe("matching and naming", () => {
  it("matches names regardless of case, width and spacing", () => {
    expect(matchName("  The　JUNIPERS \n")).toBe("the junipers");
    expect(fingerprint("a")).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint("a")).not.toBe(fingerprint("b"));
    expect(fingerprint("")).toBe(fingerprint(""));
  });
});

describe("importing listens into the pod", () => {
  it("matches library songs, keeps the rest by name, and is idempotent", async () => {
    const { pod, library, track } = await fixture();
    const { listens, warnings } = readScrobbleFiles(
      [
        { name: "lastfm.csv", text: lastFm },
        { name: "lb.jsonl", text: listenBrainz("Nora Field", "Embers", 1793361600) },
      ],
      now,
    );
    const plan = planScrobbleImport(listens, warnings, library.tracks, root);
    expect(plan).toMatchObject({
      matched: 2,
      unmatched: 2,
      first: new Date("2026-10-01T12:00:00Z"),
      last: new Date("2026-11-01T12:00:00Z"),
    });
    // Two library songs share a name; the first by IRI is chosen every time.
    const matched = plan.plays.filter((play) => !play.recording);
    expect(matched.map((play) => play.trackIri)).toEqual([track.value, track.value]);
    expect(plan.plays.find((play) => play.agent === SCROBBLE_AGENTS.listenbrainz)).toBeDefined();
    const progress: string[] = [];
    expect(
      await saveScrobbles(pod.fetch, root, plan, (done, total) =>
        progress.push(`${done}/${total}`),
      ),
    ).toEqual({ added: 4, existing: 0 });
    expect(progress).toEqual(["1/2", "2/2"]);
    expect(await saveScrobbles(pod.fetch, root, plan)).toEqual({ added: 0, existing: 4 });

    const history = await loadHistory(pod.fetch, root, now, 2);
    expect(history).toHaveLength(4);
    const named = history.filter((play) => play.title);
    expect(named.map((play) => [play.title, play.artist])).toEqual([
      ["Embers", "Nora Field"],
      ["Lanterns", "Nora Field"],
    ]);
    expect(history.filter((play) => play.trackIri === track.value)).toHaveLength(2);
    // Named-only listens count towards the library artist with the same name.
    expect(
      computeTopArtists(
        [
          ...history,
          {
            iri: "x",
            trackIri: "urn:gone",
            startTime: now,
            title: "Apple",
            artist: "the junipers",
          },
          { iri: "y", trackIri: "urn:gone", startTime: now },
        ],
        library.models.tracks,
        "1Y",
        now,
      ),
    ).toEqual([
      { key: `${base}artists/j.ttl#it`, name: "The Junipers", plays: 3 },
      { key: "Nora Field", name: "Nora Field", plays: 2 },
    ]);
  });

  it("re-uses recordings already described in a shard and validates fragments", async () => {
    const { pod } = await fixture();
    const shard = historyShard(base, now);
    const recording = {
      iri: `${shard}#song-1`,
      title: "Lanterns",
      artistIri: `${shard}#artist-1`,
      artist: "Nora Field",
    };
    const play = (id: string) => ({
      iri: `${shard}#scrobble-${id}`,
      trackIri: recording.iri,
      startTime: now,
      recording,
    });
    expect(await appendPlaybacks(pod.fetch, base, [play("a")])).toEqual({ added: 1, existing: 0 });
    expect(await appendPlaybacks(pod.fetch, base, [play("b")])).toEqual({ added: 1, existing: 0 });
    // A song by an artist already described in the shard re-uses the artist node.
    expect(
      await appendPlaybacks(pod.fetch, base, [
        {
          ...play("c"),
          trackIri: `${shard}#song-2`,
          recording: { ...recording, iri: `${shard}#song-2`, title: "Embers" },
        },
      ]),
    ).toEqual({ added: 1, existing: 0 });
    const history = await loadHistory(pod.fetch, root, now, 1);
    expect(history.map((entry) => entry.title).sort()).toEqual(["Embers", "Lanterns", "Lanterns"]);

    await expect(
      appendPlaybacks(pod.fetch, base, [
        { ...play("d"), recording: { ...recording, iri: play("d").iri } },
      ]),
    ).rejects.toThrow(InvalidMusicError);
    await expect(
      appendPlaybacks(pod.fetch, base, [{ ...play("e"), trackIri: `${base}tracks/j.ttl#apple` }]),
    ).rejects.toThrow("An imported play must point at its recording");
    await expect(
      appendPlaybacks(pod.fetch, base, [{ ...play("f"), iri: `${base}elsewhere.ttl#x` }]),
    ).rejects.toThrow(InvalidMusicError);
  });

  it("propagates a conflicting write without overwriting the shard", async () => {
    const { pod } = await fixture();
    const shard = historyShard(base, now);
    const conflicting: typeof globalThis.fetch = async (input, init) =>
      init?.method === "PUT" ? new Response(null, { status: 412 }) : pod.fetch(input, init);
    await expect(
      appendPlaybacks(conflicting, base, [
        { iri: `${shard}#scrobble-z`, trackIri: `${base}tracks/j.ttl#apple`, startTime: now },
      ]),
    ).rejects.toThrow(MusicWriteError);
  });
});
