// AUTHORED-BY Claude Fable 5
//
// Regression tests for OPTIONAL nested-link DEGRADATION (@jeswr/model-runtime
// 8c7f78e): an optional nested link whose resolution fails — e.g. AMBIGUOUS
// targets (two triples for a single-valued link) — DROPS the field and admits
// the composite, instead of rejecting the whole scrobble. REQUIRED links
// (playedWork / atTime, sh:severity sh:Violation) stay fail-closed.
//
// Before the repin, an untrusted document carrying two media:performedByArtist
// or two media:inAlbum targets rejected the ENTIRE scrobble (the roborev Medium
// held against this branch); now only the ambiguous field is dropped.
import { Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { parseScrobble } from "./scrobble.js";

const RES = "http://localhost:3000/alice/listening/x";

function toStore(ttl: string): Store {
  return new Store(new Parser({ baseIRI: RES }).parse(ttl));
}

/** A valid scrobble skeleton (typed titled track + valid instant) with `extra` spliced onto the track. */
function scrobbleTtl(trackExtra: string): string {
  return `
    @prefix media: <https://w3id.org/jeswr/sectors/media#> .
    @prefix core:  <https://w3id.org/jeswr/core#> .
    @prefix dct:   <http://purl.org/dc/terms/> .
    @prefix foaf:  <http://xmlns.com/foaf/0.1/> .
    @prefix time:  <http://www.w3.org/2006/time#> .
    @prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
    <${RES}#it> a media:PlaybackEvent ; media:playedWork <${RES}#track> ;
      core:atTime <${RES}#playedAt> ; media:msPlayed "194000"^^xsd:integer .
    <${RES}#track> a media:Track ; dct:title "Teardrop" ${trackExtra} .
    <${RES}#playedAt> a time:Instant ;
      time:inXSDDateTime "2026-07-07T10:00:00Z"^^xsd:dateTime .
  `;
}

describe("optional nested-link degradation (untrusted document, ambiguous targets)", () => {
  it("TWO media:performedByArtist targets → scrobble admitted with artist DROPPED, other fields intact", () => {
    const store = toStore(
      scrobbleTtl(`; media:performedByArtist <${RES}#artist>, <${RES}#artist2>`) +
        `
        <${RES}#artist> a media:Artist ; foaf:name "Massive Attack" .
        <${RES}#artist2> a media:Artist ; foaf:name "Imposter" .
      `,
    );
    const back = parseScrobble(RES, store);
    expect(back).toBeDefined();
    expect(back?.artistName).toBeUndefined(); // the ambiguous optional link is dropped…
    expect(back?.trackTitle).toBe("Teardrop"); // …while the rest of the composite survives
    expect(back?.msPlayed).toBe(194000);
    expect(back?.playedAt).toEqual(new Date("2026-07-07T10:00:00.000Z"));
  });

  it("TWO media:inAlbum targets → scrobble admitted with album DROPPED, a valid artist still parsed", () => {
    const store = toStore(
      scrobbleTtl(
        `; media:inAlbum <${RES}#album>, <${RES}#album2> ; media:performedByArtist <${RES}#artist>`,
      ) +
        `
        <${RES}#album> a media:Album ; dct:title "Mezzanine" .
        <${RES}#album2> a media:Album ; dct:title "Not Mezzanine" .
        <${RES}#artist> a media:Artist ; foaf:name "Massive Attack" .
      `,
    );
    const back = parseScrobble(RES, store);
    expect(back).toBeDefined();
    expect(back?.albumTitle).toBeUndefined(); // ambiguous album dropped
    expect(back?.artistName).toBe("Massive Attack"); // unambiguous optional link unaffected
    expect(back?.trackTitle).toBe("Teardrop");
  });

  it("degradation does NOT weaken REQUIRED fail-closed: ambiguous artist + UNTITLED track still rejects", () => {
    const store = toStore(`
      @prefix media: <https://w3id.org/jeswr/sectors/media#> .
      @prefix core:  <https://w3id.org/jeswr/core#> .
      @prefix foaf:  <http://xmlns.com/foaf/0.1/> .
      @prefix time:  <http://www.w3.org/2006/time#> .
      @prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
      <${RES}#it> a media:PlaybackEvent ; media:playedWork <${RES}#track> ; core:atTime <${RES}#playedAt> .
      <${RES}#track> a media:Track ; media:performedByArtist <${RES}#artist>, <${RES}#artist2> .
      <${RES}#artist> a media:Artist ; foaf:name "A" .
      <${RES}#artist2> a media:Artist ; foaf:name "B" .
      <${RES}#playedAt> a time:Instant ;
        time:inXSDDateTime "2026-07-07T10:00:00Z"^^xsd:dateTime .
    `);
    expect(parseScrobble(RES, store)).toBeUndefined();
  });
});
