// AUTHORED-BY Claude Opus 5.5
//
// The Suite Music library facade over the generated flat entities (src/library.ts).
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import { entities } from "../src/generated/model.js";
import {
  LIBRARY_CO_TYPES,
  LIBRARY_MEDIA,
  libraryFieldQuads,
  libraryTypeQuads,
} from "../src/index.js";

const S = "https://schema.org/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const track = "https://pod.test/music/tracks/a.ttl#it";

const rows = (quads: ReturnType<typeof libraryFieldQuads>) =>
  quads.map((q) => [q.subject.value, q.predicate.value, q.object.value]);

describe("library facade", () => {
  it("stamps the jeswr.org sector class with its schema.org co-type", () => {
    expect(rows(libraryTypeQuads("LibraryTrack", track)).sort()).toEqual([
      [track, RDF_TYPE, `${LIBRARY_MEDIA}Track`],
      [track, RDF_TYPE, `${S}MusicRecording`],
    ]);
    expect(LIBRARY_CO_TYPES.Listen).toBe(`${S}ListenAction`);
    expect(rows(libraryTypeQuads("ListenInstant", `${track}-instant`))).toEqual([
      [`${track}-instant`, RDF_TYPE, "http://www.w3.org/2006/time#Instant"],
    ]);
  });

  it("writes one field through the generated mappers, keeping exact IRIs and text", () => {
    const [decimal] = libraryFieldQuads("LibraryTrack", track, "durationSeconds", 1e-7);
    expect(decimal?.object.value).toBe("0.0000001");
    expect(decimal?.object.termType === "Literal" && decimal.object.datatype.value).toBe(
      `${XSD}decimal`,
    );
    expect(
      rows(libraryFieldQuads("LibraryTrack", track, "byArtist", "HTTPS://POD.test:443/a/../b")),
    ).toEqual([[track, `${S}byArtist`, "HTTPS://POD.test:443/a/../b"]]);
    expect(rows(libraryFieldQuads("LibraryTrack", track, "title", "A\nB\u0000"))[0]?.[2]).toBe(
      "A\nB\u0000",
    );
    expect(rows(libraryFieldQuads("LibraryTrack", track, "loved", false))[0]?.[2]).toBe("false");
    expect(rows(libraryFieldQuads("LibraryAlbum", track, "track", track))).toEqual([
      [track, `${S}track`, track],
    ]);
    expect(libraryFieldQuads("LibraryTrack", track, "isrc", undefined)).toEqual([]);
  });

  it("throws instead of silently dropping a value the model rejects", () => {
    expect(() => libraryFieldQuads("LibraryTrack", track, "durationSeconds", -1)).toThrow(
      RangeError,
    );
    expect(() => libraryFieldQuads("LibraryTrack", track, "title", " ")).toThrow(RangeError);
    expect(() => libraryFieldQuads("Listen", track, "msPlayed", 1e21)).toThrow(RangeError);
    expect(() => libraryTypeQuads("LibraryTrack", "tracks/a.ttl#it")).toThrow(TypeError);
    expect(() => libraryTypeQuads("LibraryTrack", `${track}> <x`)).toThrow(TypeError);
  });

  it("composes a play the generated Listen entity parses", () => {
    const play = "https://pod.test/music/history/2026-10.ttl#one";
    const store = new Store([
      ...libraryTypeQuads("Listen", play),
      ...libraryFieldQuads("Listen", play, "playedWork", track),
      ...libraryFieldQuads("Listen", play, "atTime", `${play}-instant`),
      ...libraryFieldQuads("Listen", play, "msPlayed", 213_000),
    ]);
    expect(entities.Listen.parse(play, store)).toEqual({
      playedWork: track,
      atTime: `${play}-instant`,
      msPlayed: 213_000,
    });
    expect(new entities.Listen.Wrapper(play, store, DataFactory).isInstance).toBe(true);
  });
});
