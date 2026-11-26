// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.2-Astra
// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildPhoto,
  formatDuration,
  PHOTOGRAPH_CLASS,
  type Photo,
  PhotographDoc,
  parseDuration,
  parsePhoto,
  parsePhotos,
  parseStoredPhoto,
  RDF_TYPE,
  SCHEMA,
  serializePhotos,
  VIDEO_CLASS,
  XSD,
} from "../src/index.js";

const ROOT = "https://alice.demo.pod/";
const NOW = "2026-11-11T12:00:00.000Z";
const ITEM = `${ROOT}photos/items/clip.ttl`;

describe("video durations and RDF", () => {
  it("strictly parses fixed ISO durations and preserves finite nonnegative seconds", () => {
    for (const [value, seconds] of [
      ["PT0S", 0],
      ["PT1M2.5S", 62.5],
      ["P2D", 172800],
      ["P1DT2H3M4.25S", 93784.25],
      ["PT60S", 60],
    ] as const)
      expect(parseDuration(value)).toBe(seconds);
    for (const seconds of [
      0,
      -0,
      62.5,
      3600,
      Number.MAX_SAFE_INTEGER,
      1e-7,
      1.23e-8,
      Number.MIN_VALUE,
    ])
      expect(parseDuration(formatDuration(seconds))).toBe(seconds || 0);
    expect(formatDuration(1.23e-8)).toBe("PT0.0000000123S");
    for (const value of [
      "P",
      "PT",
      "P1DT",
      "P1Y",
      "P1M",
      "P1W",
      "PT-1S",
      "-PT1S",
      "PT1.2M",
      "PT.5S",
      "PT1e3S",
      " PT1S",
      "PT1S\n",
      "PT1H2H",
      "P0.5D",
      `PT${"9".repeat(400)}S`,
      "P99999999999999999D",
    ])
      expect(parseDuration(value)).toBeUndefined();
    for (const seconds of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => formatDuration(seconds)).toThrow(TypeError);
  });
  it("writes VideoObject with typed duration and round-trips its shared photo metadata", async () => {
    const photo: Photo = {
      kind: "video",
      durationSeconds: 62.5,
      name: "Lake",
      contentUrl: `${ROOT}photos/originals/clip.mp4`,
      thumbnailUrl: `${ROOT}photos/thumbs/clip.webp`,
      keywords: ["water"],
      created: NOW,
      modified: NOW,
      exif: {
        dateTimeOriginal: NOW,
        pixelWidth: 1920,
        pixelHeight: 1080,
        location: { lat: 51.5, long: -0.12 },
      },
    };
    const dataset = buildPhoto(ITEM, photo);
    expect(parsePhoto(ITEM, dataset)).toEqual(photo);
    expect(parsePhotos(ITEM, dataset)).toEqual([{ subject: `${ITEM}#it`, photo }]);
    const doc = new PhotographDoc(`${ITEM}#it`, dataset, DataFactory);
    expect([...doc.types]).toEqual([VIDEO_CLASS]);
    expect(
      dataset.match(null, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(PHOTOGRAPH_CLASS))
        .size,
    ).toBe(0);
    const literal = [...dataset.match(null, DataFactory.namedNode(`${SCHEMA}duration`))][0]?.object;
    expect(literal).toEqual(
      DataFactory.literal("PT62.5S", DataFactory.namedNode(`${XSD}duration`)),
    );
    const turtle = await serializePhotos(dataset);
    expect(turtle).toContain(
      'a schema:VideoObject;\n    schema:duration "PT62.5S"^^xsd:duration;\n    schema:name "Lake"',
    );
    expect(parseStoredPhoto(ITEM, await parseRdf(turtle, "text/turtle"))).toEqual(photo);
    doc.durationSeconds = undefined;
    expect(doc.durationSeconds).toBeUndefined();
    expect(parsePhoto(ITEM, dataset)).toEqual({ ...photo, durationSeconds: undefined });
    for (const term of [
      DataFactory.namedNode(`${ROOT}not-a-literal`),
      DataFactory.literal("PT1S"),
      ...["bad", "P1Y", "P1M", "-PT1S"].map((value) =>
        DataFactory.literal(value, DataFactory.namedNode(`${XSD}duration`)),
      ),
    ]) {
      dataset.add(
        DataFactory.quad(
          DataFactory.namedNode(`${ITEM}#it`),
          DataFactory.namedNode(`${SCHEMA}duration`),
          term,
        ),
      );
      expect(parsePhoto(ITEM, dataset)?.durationSeconds).toBeUndefined();
      expect(parseStoredPhoto(ITEM, dataset)?.durationSeconds).toBeUndefined();
      dataset.deleteMatches(undefined, DataFactory.namedNode(`${SCHEMA}duration`));
    }
    expect(() => {
      doc.durationSeconds = -1;
    }).toThrow(TypeError);
  });
});

it("skips bare video markers in a mixed document and gives the video type precedence", async () => {
  const dataset = await parseRdf(
    `@prefix s: <https://schema.org/>. @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
    <#z> a s:Photograph.
    <#it> a s:VideoObject.
    <#image> a s:ImageObject; s:duration "PT0S"^^xsd:duration.
    <#clip> a s:Photograph, s:VideoObject; s:contentUrl <clip.mp4>;
      s:name "Clip"@en; s:duration "P1DT2H3M4.25S"^^xsd:duration.`,
    "text/turtle",
    { baseIRI: ITEM },
  );
  for (const read of [parsePhoto, parseStoredPhoto]) expect(read(ITEM, dataset)).toBeUndefined();
  const shell = { name: "", contentUrl: "", keywords: [], exif: {} };
  const video = {
    ...shell,
    kind: "video",
    durationSeconds: 93784.25,
    contentUrl: new URL("clip.mp4", ITEM).href,
  };
  for (const tolerant of [false, true]) {
    expect(parsePhotos(ITEM, dataset, { tolerant })).toEqual([
      { subject: `${ITEM}#clip`, photo: { ...video, name: tolerant ? "Clip" : "" } },
      { subject: `${ITEM}#image`, photo: { ...shell, durationSeconds: 0 } },
      { subject: `${ITEM}#z`, photo: shell },
    ]);
  }
});

it("retains explicit durations on stills and marks video views without removing existing types", () => {
  const photo = {
    name: "",
    contentUrl: new URL("image.jpg", ITEM).href,
    exif: {},
    keywords: [],
    durationSeconds: 0,
  };
  expect(parsePhoto(ITEM, buildPhoto(ITEM, photo))).toEqual(photo);
  const dataset = new Store();
  const doc = new PhotographDoc(`${ITEM}#it`, dataset, DataFactory);
  expect(doc.mark().mark("video")).toBe(doc);
  expect(doc.types).toContain(PHOTOGRAPH_CLASS);
  expect(doc.types).toContain(VIDEO_CLASS);
  expect(parsePhoto(ITEM, dataset)).toBeUndefined();
  doc.contentUrl = new URL("clip.mp4", ITEM).href;
  doc.durationSeconds = 1.23e-8;
  expect(doc.durationSeconds).toBe(1.23e-8);
  expect(parsePhoto(ITEM, dataset)?.kind).toBe("video");
});

it("retains only the first typed duration on write-back when a video repeats the predicate", async () => {
  for (const [first, expected] of [
    ['"PT1M"^^xsd:duration', 60],
    ['"PT1M"', undefined],
  ] as const) {
    const dataset = await parseRdf(
      `@prefix s: <https://schema.org/>. @prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
      <#it> a s:VideoObject; s:contentUrl <clip.mp4>; s:duration ${first}, "PT2M"^^xsd:duration.`,
      "text/turtle",
      { baseIRI: ITEM },
    );
    expect(parsePhoto(ITEM, dataset)?.durationSeconds).toBeUndefined();
    const stored = parseStoredPhoto(ITEM, dataset);
    expect(stored?.kind).toBe("video");
    expect(stored?.durationSeconds).toBe(expected);
  }
});

it("skips a video whose contentUrl is not http(s), which the hand-written model listed", async () => {
  const dataset = await parseRdf(
    `@prefix s: <https://schema.org/>.
    <#it> a s:VideoObject; s:contentUrl <urn:example:clip>; s:name "Clip".`,
    "text/turtle",
    { baseIRI: ITEM },
  );
  expect(parsePhoto(ITEM, dataset)).toBeUndefined();
  expect(parseStoredPhoto(ITEM, dataset)).toBeUndefined();
  for (const tolerant of [false, true])
    expect(parsePhotos(ITEM, dataset, { tolerant })).toEqual([]);
});
