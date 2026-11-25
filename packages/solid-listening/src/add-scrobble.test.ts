// AUTHORED-BY Claude Opus 5.5
import type { Quad } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  addScrobble,
  buildScrobble,
  parseScrobble,
  Scrobble,
  type ScrobbleData,
  type ScrobbleNodeIris,
  scrobbleNodeIris,
} from "./index.js";
import { DCT_TITLE, MEDIA_PLAYED_WORK, PLAYBACK_EVENT_CLASS, RDF_TYPE } from "./vocab.js";

const RES = "https://alice.pod.example/listening/2026-10.ttl";
const WHEN = new Date("2026-10-01T12:00:00.000Z");

const key = (q: Quad) =>
  JSON.stringify([
    q.subject.value,
    q.predicate.value,
    q.object.termType,
    q.object.value,
    q.object.termType === "Literal" ? [q.object.language, q.object.datatype.value] : null,
  ]);
const keys = (store: Store) => [...store].map(key).sort();

const at = (base: string): ScrobbleNodeIris => ({
  event: base,
  track: `${base}-track`,
  artist: `${base}-artist`,
  album: `${base}-album`,
  instant: `${base}-instant`,
});

const CASES: Record<string, ScrobbleData> = {
  full: {
    trackTitle: "Teardrop",
    artistName: "Massive Attack",
    albumTitle: "Mezzanine",
    playedAt: WHEN,
    msPlayed: 194000,
    durationSeconds: 329.5,
    isrc: "GBAAA9900123",
    listener: "https://alice.pod.example/profile/card#me",
  },
  minimal: { trackTitle: "Solo", playedAt: WHEN },
  "artist only": { trackTitle: "Solo", artistName: "Someone", playedAt: WHEN },
  "album only": { trackTitle: "Solo", albumTitle: "Record", playedAt: WHEN },
  "blank names, fractional ms, hostile listener": {
    trackTitle: "Solo",
    artistName: "   ",
    albumTitle: "",
    msPlayed: 12.9,
    playedAt: WHEN,
    listener: "javascript:alert(1)",
  },
  "zero ms": { trackTitle: "Solo", msPlayed: 0, playedAt: WHEN },
};

describe("addScrobble", () => {
  it.each(
    Object.entries(CASES),
  )("adds exactly the generated composite build's quads (%s)", (_, data) => {
    const store = new Store();
    addScrobble(store, scrobbleNodeIris(RES), data);
    expect(keys(store)).toEqual(keys(buildScrobble(RES, data)));
    expect(parseScrobble(RES, store)).toEqual(parseScrobble(RES, buildScrobble(RES, data)));
  });

  it("describes many scrobbles in one dataset at caller-chosen subjects", () => {
    const store = new Store();
    addScrobble(store, at(`${RES}#a`), { trackTitle: "One", artistName: "A", playedAt: WHEN });
    addScrobble(store, at(`${RES}#b`), { trackTitle: "Two", playedAt: WHEN });
    const events = store.getSubjects(RDF_TYPE, PLAYBACK_EVENT_CLASS, null).map((t) => t.value);
    expect(events.sort()).toEqual([`${RES}#a`, `${RES}#b`]);
    expect(store.getObjects(`${RES}#a`, MEDIA_PLAYED_WORK, null)[0]?.value).toBe(`${RES}#a-track`);
    expect(store.getObjects(`${RES}#b-track`, DCT_TITLE, null)[0]?.value).toBe("Two");
    expect(store.getQuads(`${RES}#b-artist`, null, null, null)).toHaveLength(0);
  });

  it("defaults playedAt to now like buildScrobble", () => {
    const store = new Store();
    const before = Date.now();
    addScrobble(store, at(`${RES}#now`), { trackTitle: "Now" });
    const value = store
      .getObjects(`${RES}#now-instant`, null, null)
      .find((t) => t.termType === "Literal");
    expect(Date.parse(value?.value ?? "")).toBeGreaterThanOrEqual(before - 1000);
  });

  it("shares a track, artist and album node described identically by several scrobbles", () => {
    const store = new Store();
    const shared = (base: string) => ({
      ...at(base),
      track: `${RES}#track-1`,
      artist: `${RES}#artist-1`,
      album: `${RES}#album-1`,
    });
    const song = { trackTitle: "One", artistName: "A", albumTitle: "R" };
    addScrobble(store, shared(`${RES}#p1`), { ...song, playedAt: WHEN });
    const size = store.size;
    addScrobble(store, shared(`${RES}#p2`), { ...song, playedAt: new Date(WHEN.getTime() + 1) });
    expect(store.getObjects(`${RES}#p2`, MEDIA_PLAYED_WORK, null)[0]?.value).toBe(`${RES}#track-1`);
    // Only the second event and its instant are new.
    const perPlay = new Store();
    addScrobble(perPlay, at(`${RES}#p`), { trackTitle: "One", playedAt: WHEN });
    expect(store.size - size).toBe(perPlay.size - 2);
    // Re-adding an identical scrobble is a no-op.
    addScrobble(store, shared(`${RES}#p2`), { ...song, playedAt: new Date(WHEN.getTime() + 1) });
    expect(store.size - size).toBe(perPlay.size - 2);
    const before = store.size;
    expect(() =>
      addScrobble(store, shared(`${RES}#p3`), { ...song, albumTitle: "Other", playedAt: WHEN }),
    ).toThrow("already described differently");
    expect(store.size).toBe(before);
  });

  // Regression: building in the target store re-scanned it on every generated write,
  // hitting the runtime's 10,000-read migration budget after ~40 scrobbles.
  it("keeps a constant cost per scrobble in a large dataset", { timeout: 60_000 }, () => {
    const store = new Store();
    const started = performance.now();
    for (let i = 0; i < 1_000; i++)
      addScrobble(store, at(`${RES}#n${i}`), {
        trackTitle: `Song ${i}`,
        artistName: "Artist",
        albumTitle: "Album",
        playedAt: new Date(WHEN.getTime() + i * 1000),
        msPlayed: i,
      });
    expect(store.getSubjects(RDF_TYPE, PLAYBACK_EVENT_CLASS, null)).toHaveLength(1_000);
    expect(performance.now() - started).toBeLessThan(30_000);
  });

  it("refuses duplicate, unsafe or already-described subjects before writing", () => {
    const store = new Store();
    expect(() =>
      addScrobble(store, { ...at(`${RES}#x`), album: `${RES}#x` }, CASES.minimal as ScrobbleData),
    ).toThrow(TypeError);
    expect(() =>
      addScrobble(store, { ...at(`${RES}#x`), track: "not an iri" }, CASES.minimal as ScrobbleData),
    ).toThrow(TypeError);
    expect(store.size).toBe(0);
    new Scrobble(`${RES}#x-instant`, store, DataFactory).mark();
    expect(() => addScrobble(store, at(`${RES}#x`), CASES.minimal as ScrobbleData)).toThrow(
      "already",
    );
    expect(store.size).toBe(1);
  });
});
