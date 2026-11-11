// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { expect, test } from "vitest";
import { buildListingDataset, type ListingMetadata } from "../src/index.js";

const container = "https://pod.example/files/";

test("writes exactly the supplied listing terms, datatypes and types", async () => {
  const metadata: ListingMetadata = {
    url: `${container}report.pdf`,
    title: 'Report "Q4"\n📄',
    modified: new Date("2026-11-01T12:30:00.123Z"),
    size: 2048,
    contentType: "application/pdf",
    types: ["https://example.org/Report", "https://example.org/Document"],
  };
  // An independent parsed oracle pins literal lexical values and default-graph identity.
  const expected = await parseRdf(
    `
    @prefix dct: <http://purl.org/dc/terms/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    <${container}> <http://www.w3.org/ns/ldp#contains> <${metadata.url}> .
    <${metadata.url}> dct:title """Report "Q4"\n📄""";
      dct:modified "2026-11-01T12:30:00.123Z"^^xsd:dateTime;
      <http://www.w3.org/ns/posix/stat#size> "2048"^^xsd:integer;
      dct:format "application/pdf";
      a <https://example.org/Report>, <https://example.org/Document> .
  `,
    "text/turtle",
  );
  const quads = buildListingDataset(container, new Set([metadata]));
  const actual = new Store(quads);
  expect(quads).toHaveLength(expected.size);
  for (const quad of expected) expect(actual.has(quad)).toBe(true);
  expect(metadata.types).toEqual(["https://example.org/Report", "https://example.org/Document"]);
});

test("omits null metadata without inferring container or resource types", async () => {
  const expected = await parseRdf(
    `
    <${container}> <http://www.w3.org/ns/ldp#contains> <${container}folder/> .
    <${container}folder/> <http://purl.org/dc/terms/title> "" .
  `,
    "text/turtle",
  );
  const actual = new Store(
    buildListingDataset(container, [
      {
        url: `${container}folder/`,
        title: "",
        modified: null,
        size: null,
        contentType: null,
        types: [],
      },
    ]),
  );
  expect(actual.size).toBe(expected.size);
  for (const quad of expected) expect(actual.has(quad)).toBe(true);
  expect(buildListingDataset(container, [])).toEqual([]);
});

test("preserves zero, the epoch and empty format; repeated members retain all supplied values", async () => {
  const entry: ListingMetadata = {
    url: `${container}empty`,
    title: "first",
    modified: new Date(0),
    size: 0,
    contentType: "",
    types: ["https://example.org/Empty"],
  };
  const quads = buildListingDataset(container, [entry, { ...entry, title: "second" }]);
  const actual = new Store(quads);
  const expected = await parseRdf(
    `
    @prefix dct: <http://purl.org/dc/terms/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    <${container}> <http://www.w3.org/ns/ldp#contains> <${entry.url}> .
    <${entry.url}> dct:title "first", "second";
      dct:modified "1970-01-01T00:00:00.000Z"^^xsd:dateTime;
      <http://www.w3.org/ns/posix/stat#size> "0"^^xsd:integer;
      dct:format ""; a <https://example.org/Empty> .
  `,
    "text/turtle",
  );
  expect(quads).toHaveLength(expected.size);
  for (const quad of expected) expect(actual.has(quad)).toBe(true);
});

test("rejects invalid dates rather than emitting invalid dateTime literals", () => {
  expect(() =>
    buildListingDataset(container, [
      {
        url: `${container}bad`,
        title: "bad",
        modified: new Date(Number.NaN),
        size: null,
        contentType: null,
        types: [],
      },
    ]),
  ).toThrow(RangeError);
});
