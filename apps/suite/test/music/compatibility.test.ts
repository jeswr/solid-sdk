// AUTHORED-BY Claude Opus 5.5
//
// Pins where the Music model's writes changed when they moved onto
// @jeswr/solid-listening's generated library model. Listed in that package's README
// ("Suite Music library", exact divergences).
import { describe, expect, it } from "vitest";
import {
  PlaybackEvent,
  parseMusic,
  readHistory,
  Store,
  serializeMusic,
  Track,
} from "../../src/apps/music/lib/model";
import { M, NS } from "../../src/apps/music/lib/model/vocab";

const base = "https://pod.test/music/";

describe("generated-model write divergences", () => {
  it("spells media:durationSeconds with the shortest round-trip decimal", async () => {
    const dataset = new Store();
    const track = new Track(`${base}tracks/a.ttl#it`, dataset).stampType();
    track.durationSeconds = 0.1;
    // Previously 21 significant digits: "0.100000000000000005551".
    expect(track.objects(`${M}durationSeconds`)[0]?.value).toBe("0.1");
    const parsed = await parseMusic(await serializeMusic(dataset), base);
    expect(new Track(track.value, parsed).durationSeconds).toBe(0.1);
  });

  it("writes a valid xsd:dateTime for years after 9999, which the reader skips", () => {
    const dataset = new Store();
    const event = new PlaybackEvent(`${base}history/2026-10.ttl#far`, dataset).stampType();
    event.trackIri = `${base}tracks/a.ttl#it`;
    event.startTime = new Date(Date.UTC(20000, 0, 1));
    // Previously JavaScript's expanded-year form "+020000-01-01T00:00:00.000Z".
    expect(event.strings(`${NS.SCHEMA}startTime`)).toEqual(["20000-01-01T00:00:00.000Z"]);
    expect(event.startTime).toBeUndefined();
    expect(readHistory(dataset)).toEqual([]);
  });
});
