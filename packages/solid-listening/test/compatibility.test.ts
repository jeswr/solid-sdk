// AUTHORED-BY Claude Opus 5.5
//
// Pins where the workspace runtime's parse differs from the July package (generated core
// on the git-pinned model-runtime 8c7f78e). Each case follows the media SHACL profile:
// required fields fail closed on any non-conforming value, ambiguous optional values
// drop, and sh:class honours rdfs:subClassOf asserted in the data graph. README "Exact
// divergences" lists them.
import { Parser, Store } from "n3";
import { expect, it } from "vitest";
import { parseScrobble } from "../src/index.js";

const RES = "http://localhost:3000/alice/listening/x";

function parse(track: string, extra = "", instant = `"2026-07-07T10:00:00Z"^^xsd:dateTime`) {
  const ttl = `
    @prefix media: <https://w3id.org/jeswr/sectors/media#> .
    @prefix core:  <https://w3id.org/jeswr/core#> .
    @prefix dct:   <http://purl.org/dc/terms/> .
    @prefix foaf:  <http://xmlns.com/foaf/0.1/> .
    @prefix time:  <http://www.w3.org/2006/time#> .
    @prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
    @prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
    <${RES}#it> a media:PlaybackEvent ; media:playedWork <${RES}#track> ;
      core:atTime <${RES}#playedAt> .
    <${RES}#track> ${track} .
    <${RES}#playedAt> a time:Instant ; time:inXSDDateTime ${instant} .
    ${extra}`;
  return parseScrobble(RES, new Store(new Parser({ baseIRI: RES }).parse(ttl)));
}

it("rejects a scrobble whose required track title is not exactly one xsd:string", () => {
  expect(parse(`a media:Track ; dct:title "Teardrop"`)?.trackTitle).toBe("Teardrop");
  expect(parse(`a media:Track ; dct:title "Teardrop"@en`)).toBeUndefined();
  expect(parse(`a media:Track ; dct:title "T", "U"`)).toBeUndefined();
  expect(parse(`a media:Track ; dct:title <${RES}#x>`)).toBeUndefined();
});

it("rejects a scrobble with two played-at time values", () => {
  expect(
    parse(
      `a media:Track ; dct:title "T"`,
      "",
      `"2026-07-07T10:00:00Z"^^xsd:dateTime, "2026-07-08T10:00:00Z"^^xsd:dateTime`,
    ),
  ).toBeUndefined();
});

it("drops an ambiguous optional ISRC or artist name instead of keeping the first", () => {
  const back = parse(
    `a media:Track ; dct:title "T" ; media:isrc "A", "B" ;
      media:performedByArtist <${RES}#artist>`,
    `<${RES}#artist> a media:Artist ; foaf:name "One", "Two" .`,
  );
  expect(back?.trackTitle).toBe("T");
  expect(back && "isrc" in back).toBe(false);
  expect(back && "artistName" in back).toBe(false);
});

it("admits a track typed by a data-graph subclass of media:Track (sh:class semantics)", () => {
  const back = parse(
    `a media:Recording ; dct:title "T"`,
    "media:Recording rdfs:subClassOf media:Track .",
  );
  expect(back?.trackTitle).toBe("T");
});
