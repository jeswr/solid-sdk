// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildScrobble,
  isHttpIri,
  parseScrobble,
  parseScrobbleTtl,
  Scrobble,
  type ScrobbleData,
  scrobbleNodeIris,
  scrobbleSubject,
  serializeScrobble,
} from "./scrobble.js";
import {
  CORE_AT_TIME,
  CORE_HAD_PARTICIPANT,
  DCT_TITLE,
  FOAF_NAME,
  MEDIA_DURATION_SECONDS,
  MEDIA_MS_PLAYED,
  MEDIA_PLAYED_WORK,
  PLAYBACK_EVENT_CLASS,
  RDF_TYPE,
  TIME_IN_XSD_DATE_TIME,
} from "./vocab.js";

const RES = "http://localhost:3000/alice/listening/x";
const SUBJ = scrobbleSubject(RES);
const IRIS = scrobbleNodeIris(RES);

/** Parse a Turtle string into an n3 Store for assertions. */
function toStore(ttl: string): Store {
  return new Store(new Parser({ baseIRI: RES }).parse(ttl));
}

const FULL: ScrobbleData = {
  trackTitle: "Teardrop",
  artistName: "Massive Attack",
  albumTitle: "Mezzanine",
  playedAt: new Date("2026-07-07T10:00:00.000Z"),
  msPlayed: 194000,
  durationSeconds: 329.5,
  isrc: "GBAAA9900123",
  listener: "https://alice.pod.example/profile/card#me",
};

describe("buildScrobble", () => {
  it("stamps rdf:type media:PlaybackEvent on the #it subject", () => {
    const store = buildScrobble(RES, { trackTitle: "T" });
    expect(store.getQuads(SUBJ, RDF_TYPE, PLAYBACK_EVENT_CLASS, null)).toHaveLength(1);
  });

  it("links the played work + instant as IRIs (NamedNode), not literals", () => {
    const store = buildScrobble(RES, { trackTitle: "T" });
    const pw = store.getQuads(SUBJ, MEDIA_PLAYED_WORK, null, null);
    expect(pw).toHaveLength(1);
    expect(pw[0]?.object.termType).toBe("NamedNode");
    expect(pw[0]?.object.value).toBe(IRIS.track);
    const at = store.getQuads(SUBJ, CORE_AT_TIME, null, null);
    expect(at[0]?.object.value).toBe(IRIS.instant);
  });

  it("writes the track title on the track node and the instant dateTime", () => {
    const store = buildScrobble(RES, { trackTitle: "Teardrop" });
    expect(store.getQuads(IRIS.track, DCT_TITLE, null, null)[0]?.object.value).toBe("Teardrop");
    const dt = store.getQuads(IRIS.instant, TIME_IN_XSD_DATE_TIME, null, null);
    expect(dt).toHaveLength(1);
    expect(dt[0]?.object.termType).toBe("Literal");
  });

  it("writes msPlayed as a non-negative xsd:integer, truncating a float", () => {
    const store = buildScrobble(RES, { trackTitle: "T", msPlayed: 194000.9 });
    const q = store.getQuads(SUBJ, MEDIA_MS_PLAYED, null, null);
    expect(q[0]?.object.value).toBe("194000");
    expect(q[0]?.object.termType).toBe("Literal");
  });

  it("DROPS a negative / non-finite msPlayed and durationSeconds (numeric filter)", () => {
    const store = buildScrobble(RES, {
      trackTitle: "T",
      msPlayed: -5,
      durationSeconds: Number.NaN,
    });
    expect(store.getQuads(SUBJ, MEDIA_MS_PLAYED, null, null)).toHaveLength(0);
    expect(store.getQuads(IRIS.track, MEDIA_DURATION_SECONDS, null, null)).toHaveLength(0);
  });

  it("writes durationSeconds as an xsd:decimal (not xsd:double)", () => {
    const store = buildScrobble(RES, { trackTitle: "T", durationSeconds: 329.5 });
    const q = store.getQuads(IRIS.track, MEDIA_DURATION_SECONDS, null, null);
    expect(q[0]?.object.value).toBe("329.5");
    expect((q[0]?.object as { datatype: { value: string } }).datatype.value).toBe(
      "http://www.w3.org/2001/XMLSchema#decimal",
    );
  });

  it("writes the artist (foaf:name) + album (dct:title) sub-nodes only when present", () => {
    const withNeither = buildScrobble(RES, { trackTitle: "T" });
    expect(withNeither.getQuads(IRIS.artist, FOAF_NAME, null, null)).toHaveLength(0);
    expect(withNeither.getQuads(IRIS.album, DCT_TITLE, null, null)).toHaveLength(0);

    const withBoth = buildScrobble(RES, { trackTitle: "T", artistName: "A", albumTitle: "Alb" });
    expect(withBoth.getQuads(IRIS.artist, FOAF_NAME, null, null)[0]?.object.value).toBe("A");
    expect(withBoth.getQuads(IRIS.album, DCT_TITLE, null, null)[0]?.object.value).toBe("Alb");
  });

  it("DROPS a non-http(s) listener WebID (untrusted-input filter — no hostile NamedNode)", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "urn:x", "not a url"]) {
      const store = buildScrobble(RES, { trackTitle: "T", listener: bad });
      expect(store.getQuads(SUBJ, CORE_HAD_PARTICIPANT, null, null)).toHaveLength(0);
    }
  });

  it("blank/whitespace artist + album names are skipped (no empty sub-node)", () => {
    const store = buildScrobble(RES, { trackTitle: "T", artistName: "  ", albumTitle: "" });
    expect(store.getQuads(IRIS.artist, null, null, null)).toHaveLength(0);
    expect(store.getQuads(IRIS.album, null, null, null)).toHaveLength(0);
  });
});

describe("round-trip (serialize with n3.Writer → parse back)", () => {
  it("a fully-populated scrobble round-trips through Turtle", async () => {
    const ttl = await serializeScrobble(RES, FULL);
    expect(ttl).toContain("media:"); // pretty prefixes, not raw IRIs
    expect(ttl).toContain("time:Instant");

    const back = parseScrobble(RES, toStore(ttl));
    expect(back).toEqual(FULL);
  });

  it("a minimal scrobble (track title only) round-trips; playedAt auto-set", async () => {
    const ttl = await serializeScrobble(RES, { trackTitle: "Solo" });
    const back = parseScrobble(RES, toStore(ttl));
    expect(back?.trackTitle).toBe("Solo");
    expect(back?.playedAt).toBeInstanceOf(Date);
    expect(back?.artistName).toBeUndefined();
    expect(back?.listener).toBeUndefined();
    expect(back?.msPlayed).toBeUndefined();
  });

  it("parseScrobble returns undefined for a subject that is not a media:PlaybackEvent", () => {
    const store = toStore(`
      @prefix media: <https://w3id.org/jeswr/sectors/media#> .
      <${SUBJ}> <${MEDIA_PLAYED_WORK}> <${IRIS.track}> .
    `);
    expect(parseScrobble(RES, store)).toBeUndefined();
  });

  it("parseScrobble returns undefined when the played work is missing", () => {
    const store = toStore(`
      @prefix media: <https://w3id.org/jeswr/sectors/media#> .
      @prefix core:  <https://w3id.org/jeswr/core#> .
      <${SUBJ}> a media:PlaybackEvent ; core:atTime <${IRIS.instant}> .
      <${IRIS.instant}> a <http://www.w3.org/2006/time#Instant> ;
        <${TIME_IN_XSD_DATE_TIME}> "2026-07-07T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
    `);
    expect(parseScrobble(RES, store)).toBeUndefined();
  });

  it("parseScrobble returns undefined when the played work has no title", () => {
    const store = toStore(`
      @prefix media: <https://w3id.org/jeswr/sectors/media#> .
      @prefix core:  <https://w3id.org/jeswr/core#> .
      <${SUBJ}> a media:PlaybackEvent ; media:playedWork <${IRIS.track}> ; core:atTime <${IRIS.instant}> .
      <${IRIS.track}> a media:Track .
      <${IRIS.instant}> a <http://www.w3.org/2006/time#Instant> ;
        <${TIME_IN_XSD_DATE_TIME}> "2026-07-07T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
    `);
    expect(parseScrobble(RES, store)).toBeUndefined();
  });

  it("parseScrobble returns undefined when the played-at instant has a malformed dateTime", () => {
    const store = toStore(`
      @prefix media: <https://w3id.org/jeswr/sectors/media#> .
      @prefix core:  <https://w3id.org/jeswr/core#> .
      <${SUBJ}> a media:PlaybackEvent ; media:playedWork <${IRIS.track}> ; core:atTime <${IRIS.instant}> .
      <${IRIS.track}> a media:Track ; <${DCT_TITLE}> "T" .
      <${IRIS.instant}> a <http://www.w3.org/2006/time#Instant> ;
        <${TIME_IN_XSD_DATE_TIME}> "not-a-date"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
    `);
    expect(parseScrobble(RES, store)).toBeUndefined();
  });

  it("parseScrobble DROPS a hostile non-http(s) listener but keeps the scrobble (read filter)", () => {
    const store = toStore(`
      @prefix media: <https://w3id.org/jeswr/sectors/media#> .
      @prefix core:  <https://w3id.org/jeswr/core#> .
      <${SUBJ}> a media:PlaybackEvent ; media:playedWork <${IRIS.track}> ;
        core:atTime <${IRIS.instant}> ; core:hadParticipant <javascript:alert(1)> .
      <${IRIS.track}> a media:Track ; <${DCT_TITLE}> "T" .
      <${IRIS.instant}> a <http://www.w3.org/2006/time#Instant> ;
        <${TIME_IN_XSD_DATE_TIME}> "2026-07-07T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
    `);
    const back = parseScrobble(RES, store);
    expect(back?.trackTitle).toBe("T");
    expect(back?.listener).toBeUndefined();
  });

  it("parseScrobble DROPS a malformed msPlayed literal but keeps the scrobble (never aborts)", () => {
    const store = toStore(`
      @prefix media: <https://w3id.org/jeswr/sectors/media#> .
      @prefix core:  <https://w3id.org/jeswr/core#> .
      <${SUBJ}> a media:PlaybackEvent ; media:playedWork <${IRIS.track}> ;
        core:atTime <${IRIS.instant}> ; media:msPlayed "lots"^^<http://www.w3.org/2001/XMLSchema#integer> .
      <${IRIS.track}> a media:Track ; <${DCT_TITLE}> "T" .
      <${IRIS.instant}> a <http://www.w3.org/2006/time#Instant> ;
        <${TIME_IN_XSD_DATE_TIME}> "2026-07-07T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
    `);
    const back = parseScrobble(RES, store);
    expect(back?.trackTitle).toBe("T");
    expect(back?.msPlayed).toBeUndefined();
  });

  it("parseScrobble rejects a whitespace-only track title as untitled (returns undefined)", () => {
    const store = toStore(`
      @prefix media: <https://w3id.org/jeswr/sectors/media#> .
      @prefix core:  <https://w3id.org/jeswr/core#> .
      <${SUBJ}> a media:PlaybackEvent ; media:playedWork <${IRIS.track}> ; core:atTime <${IRIS.instant}> .
      <${IRIS.track}> a media:Track ; <${DCT_TITLE}> "   " .
      <${IRIS.instant}> a <http://www.w3.org/2006/time#Instant> ;
        <${TIME_IN_XSD_DATE_TIME}> "2026-07-07T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
    `);
    expect(parseScrobble(RES, store)).toBeUndefined();
  });

  it("buildScrobble drops a whitespace-only trackTitle (symmetric with the read rejection)", () => {
    const store = buildScrobble(RES, { trackTitle: "   " });
    expect(store.getQuads(IRIS.track, DCT_TITLE, null, null)).toHaveLength(0);
  });

  it("buildScrobble preserves a non-blank trackTitle VERBATIM (surrounding whitespace kept)", () => {
    const store = buildScrobble(RES, { trackTitle: "  Title  " });
    expect(store.getQuads(IRIS.track, DCT_TITLE, null, null)[0]?.object.value).toBe("  Title  ");
  });

  it("a surrounding-whitespace title round-trips unchanged (build + read agree)", async () => {
    const ttl = await serializeScrobble(RES, { trackTitle: "  Spaced Out  " });
    expect(parseScrobble(RES, toStore(ttl))?.trackTitle).toBe("  Spaced Out  ");
  });

  it("parseScrobbleTtl dispatches via @jeswr/fetch-rdf (Turtle) and coalesces a null content-type", async () => {
    const ttl = await serializeScrobble(RES, { trackTitle: "Via fetch-rdf", artistName: "X" });
    const back = await parseScrobbleTtl(RES, ttl, null);
    expect(back?.trackTitle).toBe("Via fetch-rdf");
    expect(back?.artistName).toBe("X");
  });
});

describe("Scrobble typed accessor", () => {
  it("msPlayed setter clears the triple on undefined and round-trips a number", () => {
    const store = new Store();
    const doc = new Scrobble(SUBJ, store, DataFactory).mark();
    doc.msPlayed = 1000;
    expect(doc.msPlayed).toBe(1000);
    doc.msPlayed = undefined;
    expect(store.getQuads(SUBJ, MEDIA_MS_PLAYED, null, null)).toHaveLength(0);
    expect(doc.msPlayed).toBeUndefined();
  });

  it("isPlaybackEvent reflects the rdf:type set", () => {
    const store = new Store();
    const doc = new Scrobble(SUBJ, store, DataFactory);
    expect(doc.isPlaybackEvent).toBe(false);
    doc.mark();
    expect(doc.isPlaybackEvent).toBe(true);
  });
});

describe("isHttpIri (re-exported untrusted-input filter)", () => {
  it("accepts canonical http(s), rejects everything else", () => {
    expect(isHttpIri("https://x.org/a")).toBe(true);
    expect(isHttpIri("javascript:alert(1)")).toBe(false);
    expect(isHttpIri(undefined)).toBe(false);
  });
});
