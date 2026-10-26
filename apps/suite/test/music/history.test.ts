// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  Artist,
  computeTopArtists,
  historyShard,
  InvalidMusicError,
  MusicNode,
  monthKey,
  type Playback,
  PlaybackEvent,
  parseMusic,
  periodStart,
  readHistory,
  recentlyPlayed,
  Store,
  serializeMusic,
  Track,
} from "../../src/apps/music/lib/model";
import { M, NS, S } from "../../src/apps/music/lib/model/vocab";

const base = "https://pod.test/music/";
const trackIri = `${base}tracks/a.ttl#it`;
const now = new Date("2026-10-25T12:00:00Z");
const play = (id: string, date: string, track = trackIri): Playback => ({
  iri: `${base}history/2026-10.ttl#${id}`,
  trackIri: track,
  startTime: new Date(date),
});

describe("playback model", () => {
  it("round-trips dual-typed events and retains distinct plays of the same track", async () => {
    const dataset = new Store();
    const event = new PlaybackEvent(`${base}history/2026-10.ttl#one`, dataset).stampType();
    event.trackIri = trackIri;
    event.startTime = now;
    event.endTime = new Date("2026-10-25T12:03:33Z");
    event.agent = "https://pod.test/profile#me";
    event.msPlayed = 213_000;
    expect(event.msPlayed).toBe(213_000);
    expect(event.types).toEqual(new Set([`${S}ListenAction`, `${M}PlaybackEvent`]));
    const second = new PlaybackEvent(`${base}history/2026-10.ttl#two`, dataset).stampType();
    second.trackIri = trackIri;
    second.startTime = now;
    const instantIri = event.iris(`${NS.CORE}atTime`)[0] as string;
    const instant = new MusicNode(instantIri, dataset);
    expect(instantIri).not.toBe(second.iris(`${NS.CORE}atTime`)[0]);
    expect(event.objects(`${NS.CORE}atTime`)).toHaveLength(1);
    expect(instant.types).toEqual(new Set([`${NS.TIME}Instant`]));
    expect(instant.strings(`${NS.TIME}inXSDDateTime`)).toEqual([now.toISOString()]);
    expect(instant.objects(`${NS.TIME}inXSDDateTime`)[0]?.datatype.value).toBe(`${NS.XSD}dateTime`);
    expect(readHistory(dataset)).toHaveLength(2);
    const roundTrip = await parseMusic(await serializeMusic(dataset), base);
    expect(readHistory(roundTrip)).toEqual(readHistory(dataset));
    expect(readHistory(dataset)[0]).toMatchObject({
      endTime: new Date("2026-10-25T12:03:33Z"),
      agent: "https://pod.test/profile#me",
    });
    expect(new PlaybackEvent(event.value, roundTrip).msPlayed).toBe(213_000);
    expect(readHistory(dataset).map((item) => item.iri)).toEqual([event.value, second.value]);
  });

  it("reads and updates linked media instants without replacing their IRI or metadata", async () => {
    const dataset = await parseMusic(
      `
      @prefix media: <${M}>. @prefix core: <${NS.CORE}>.
      @prefix time: <${NS.TIME}>. @prefix xsd: <${NS.XSD}>. @prefix s: <${S}>.
      <#play> a media:PlaybackEvent; media:playedWork <${trackIri}>; core:atTime <#instant>.
      <#instant> a time:Instant; time:inXSDDateTime "2026-10-25T12:00:00Z"^^xsd:dateTime;
        s:description "Imported metadata".
    `,
      base,
    );
    const event = new PlaybackEvent(`${base}#play`, dataset);
    expect(readHistory(dataset)[0]?.startTime).toEqual(now);
    expect(event.strings(`${S}startTime`)).toEqual([]);
    const next = new Date("2026-10-25T13:00:00Z");
    event.startTime = next;
    event.startTime = now;
    event.startTime = next;
    expect(event.iris(`${NS.CORE}atTime`)).toEqual([`${base}#instant`]);
    expect(event.strings(`${NS.CORE}atTime`)).toEqual([]);
    expect(event.strings(`${S}startTime`)).toEqual([next.toISOString()]);
    const instant = new MusicNode(`${base}#instant`, dataset);
    expect(instant.strings(`${NS.TIME}inXSDDateTime`)).toEqual([next.toISOString()]);
    expect(instant.strings(`${S}description`)).toEqual(["Imported metadata"]);
    const parsed = await parseMusic(await serializeMusic(dataset), base);
    expect(readHistory(parsed)[0]?.startTime).toEqual(next);
    event.startTime = undefined;
    expect(event.objects(`${NS.CORE}atTime`, `${S}startTime`)).toEqual([]);
    expect(readHistory(dataset)).toEqual([]);
    expect(instant.strings(`${S}description`)).toEqual(["Imported metadata"]);
  });

  it("skips malformed instant values and reads blank-linked instants", async () => {
    const dataset = await parseMusic(
      `
      @prefix media: <${M}>. @prefix core: <${NS.CORE}>. @prefix time: <${NS.TIME}>.
      <#play> a media:PlaybackEvent; media:playedWork <${trackIri}>;
        core:atTime "not-a-date", <#missing>, [ time:inXSDDateTime "bad" ],
          [ a time:Instant; time:inXSDDateTime "2026-10-25T12:00:00Z" ].
    `,
      base,
    );
    expect(readHistory(dataset)[0]?.startTime).toEqual(now);
    const event = new PlaybackEvent(`${base}#play`, dataset);
    event.startTime = now;
    expect(event.objects(`${NS.CORE}atTime`)).toHaveLength(1);
    expect(event.iris(`${NS.CORE}atTime`)).toEqual([`${base}#missing`]);
    expect(new MusicNode(`${base}#missing`, dataset).types).toEqual(new Set([`${NS.TIME}Instant`]));
  });

  it("falls back independently across malformed predicates and skips incomplete events", async () => {
    const dataset = await parseMusic(
      `
      @prefix s: <http://schema.org/>. @prefix media: <https://w3id.org/jeswr/sectors/media#>.
      @prefix core: <https://w3id.org/jeswr/core#>.
      <#one> a media:PlaybackEvent; s:object "bad"; media:playedWork <${trackIri}>;
        s:startTime <#malformed>, "not-a-date"; core:atTime "2026-10-25T12:00:00Z";
        core:hadParticipant <https://pod.test/profile#me>; s:endTime "bad"; media:msPlayed -1, "NaN", 5.
      <#incomplete> a s:ListenAction; s:startTime "bad".
      <#missing-time> a media:PlaybackEvent; media:playedWork <${trackIri}>.
      <#newer> a s:ListenAction; s:object <${trackIri}>; s:startTime "2026-10-26T00:00:00Z".
      [] a media:PlaybackEvent.
    `,
      base,
    );
    const events = readHistory(dataset);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      startTime: now,
      agent: "https://pod.test/profile#me",
      endTime: undefined,
    });
    const event = new PlaybackEvent(`${base}#one`, dataset);
    expect(event.msPlayed).toBe(5);
    const before = await serializeMusic(dataset);
    for (const edit of [
      () => {
        event.trackIri = "bad";
      },
      () => {
        event.startTime = new Date("invalid");
      },
      () => {
        event.endTime = new Date("invalid");
      },
      () => {
        event.agent = "bad";
      },
      () => {
        event.msPlayed = -1;
      },
    ]) {
      expect(edit).toThrow(InvalidMusicError);
      expect(await serializeMusic(dataset)).toBe(before);
    }
    event.trackIri = undefined;
    event.startTime = undefined;
    event.endTime = undefined;
    event.agent = undefined;
    event.msPlayed = undefined;
    expect(event.trackIri).toBeUndefined();
    expect(event.startTime).toBeUndefined();
    expect(event.endTime).toBeUndefined();
    expect(event.agent).toBeUndefined();
    expect(event.msPlayed).toBeUndefined();
    expect(readHistory(dataset)).toHaveLength(1);
  });

  it("uses UTC month keys across offsets, leap days and year boundaries", () => {
    expect(monthKey(new Date("2026-11-01T00:30:00+01:00"))).toBe("2026-10");
    expect(monthKey(new Date("2024-02-29T23:59:59Z"))).toBe("2024-02");
    expect(historyShard(base.slice(0, -1), new Date("2026-12-31T23:30:00-02:00"))).toBe(
      `${base}history/2027-01.ttl`,
    );
    expect(() => monthKey(new Date("invalid"))).toThrow(InvalidMusicError);
  });
});

describe("pure history helpers", () => {
  const dataset = new Store();
  const artist = new Artist(`${base}artists/a`, dataset).stampType();
  artist.title = "Artist A";
  const a = new Track(trackIri, dataset).stampType();
  a.setArtist(artist.value);
  const b = new Track(`${base}tracks/b`, dataset).stampType();
  b.writeString(`${S}byArtist`, "Artist B");
  const history = [
    play("today", "2026-10-25T10:00:00Z"),
    play("week", "2026-10-20T12:00:00Z"),
    play("month", "2026-10-05T12:00:00Z"),
    play("year", "2026-01-01T12:00:00Z"),
    play("old", "2024-01-01T12:00:00Z"),
    play("future", "2026-10-26T12:00:00Z"),
    play("other-artist", "2026-10-25T11:00:00Z", b.value),
    play("missing-track", "2026-10-25T11:30:00Z", `${base}missing`),
  ];

  it.each([
    ["Today", 1],
    ["1W", 2],
    ["1M", 3],
    ["1Y", 4],
  ] as const)("counts plays for %s", (period, count) => {
    expect(computeTopArtists(history, [a, b], period, now)).toEqual([
      { key: artist.value, name: "Artist A", plays: count },
      { key: "Artist B", name: "Artist B", plays: 1 },
    ]);
  });

  it.each([
    "Today",
    "1W",
    "1M",
    "1Y",
  ] as const)("includes exact %s boundaries but excludes earlier/future/invalid events", (period) => {
    const start = periodStart(period, now);
    const boundary = play("start", start.toISOString());
    const events = [
      boundary,
      boundary,
      play("before", new Date(start.getTime() - 1).toISOString()),
      play("now", now.toISOString()),
      play("future", new Date(now.getTime() + 1).toISOString()),
      play("invalid", "invalid"),
    ];
    expect(computeTopArtists(events, [a], period, now)[0]?.plays).toBe(2);
  });

  it("handles absent names, multiple artists and deterministic ties without mutating input", async () => {
    const c = new Track(`${base}tracks/c`, dataset).stampType();
    c.setArtist(`${base}artists/unnamed`);
    const d = new Track(`${base}tracks/d`, dataset).stampType();
    d.setArtist(`${base}artists/unnamed2`);
    const blank = new Track(
      `${base}tracks/blank`,
      await parseMusic(`<${base}tracks/blank> <${S}byArtist> [].`, base),
    );
    const multi = new Track(`${base}tracks/multi`, dataset).stampType();
    multi.setArtist(artist.value);
    multi.writeString(`${NS.MEDIA}performedByArtist`, "Artist B");
    const events = [
      play("c", now.toISOString(), c.value),
      play("d", now.toISOString(), d.value),
      play("blank", now.toISOString(), blank.value),
      play("multi", now.toISOString(), multi.value),
    ];
    const before = [...events];
    expect(computeTopArtists(events, [c, d, blank, multi], "Today", now)).toEqual([
      { key: artist.value, name: "Artist A", plays: 1 },
      { key: "Artist B", name: "Artist B", plays: 1 },
      { key: `${base}artists/unnamed`, name: "Unknown artist", plays: 1 },
      { key: `${base}artists/unnamed2`, name: "Unknown artist", plays: 1 },
    ]);
    expect(events).toEqual(before);
    expect(computeTopArtists([], [], "Today", now)).toEqual([]);
  });

  it("returns the latest play of each track in descending order with stable ties and limits", () => {
    const events = [
      play("z", "2026-10-24T10:00:00Z"),
      play("b", "2026-10-25T10:00:00Z", b.value),
      play("a", "2026-10-25T10:00:00Z"),
      play("invalid", "invalid"),
    ];
    const before = [...events];
    expect(recentlyPlayed(events).map((item) => item.iri)).toEqual([
      events[2]?.iri,
      events[1]?.iri,
    ]);
    expect(recentlyPlayed(events, 1)).toHaveLength(1);
    expect(recentlyPlayed(events, 0)).toEqual([]);
    expect(recentlyPlayed(events, 1.9)).toHaveLength(1);
    expect(recentlyPlayed([])).toEqual([]);
    expect(events).toEqual(before);
    expect(() => recentlyPlayed(events, -1)).toThrow(InvalidMusicError);
  });
});
