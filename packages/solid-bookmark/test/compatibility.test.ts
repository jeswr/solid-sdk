// AUTHORED-BY Codex GPT-6.1-Sol
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseRdf } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { expect, it } from "vitest";
import {
  buildBookmark,
  parseBookmark,
  parseBookmarkTtl,
  serializeBookmark,
  storeToTurtle,
} from "../src/index.js";

it("preserves the original serializer's exact bytes for every bookmark field", async () => {
  const turtle = await serializeBookmark("https://pod.example/b/1", {
    url: "https://example.org/a",
    title: "Title",
    description: "Summary",
    notes: "Notes",
    archived: true,
    created: new Date("2026-01-01T00:00:00Z"),
    modified: new Date("2026-01-02T00:00:00Z"),
    tags: ["z", "a"],
  });
  // Captured from the hand-written implementation, with fixed timestamps.
  expect(turtle).toBe(`@prefix book: <https://jeswr.org/ns/bookmark#>.
@prefix schema: <http://schema.org/>.
@prefix dct: <http://purl.org/dc/terms/>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.

<https://pod.example/b/1#it> a book:Bookmark;
    schema:url <https://example.org/a>;
    dct:title "Title";
    dct:description "Summary";
    book:notes "Notes";
    book:archived true;
    dct:created "2026-01-01T00:00:00.000Z"^^xsd:dateTime;
    dct:modified "2026-01-02T00:00:00.000Z"^^xsd:dateTime;
    schema:keywords "z", "a".
`);
});

it("keeps generic Store serialization lossless for legacy predicates", async () => {
  const store = new Store([
    ...(await parseRdf(
      '<https://pod.example/b/1#it> <https://w3id.org/jeswr/bookmark#notes> "Old notes".',
      "text/turtle",
      {},
    )),
  ]);
  const turtle = await storeToTurtle(store);
  expect(turtle).toContain('<https://w3id.org/jeswr/bookmark#notes> "Old notes"');
  expect(turtle).not.toContain('book:notes "Old notes"');
  expect(store.size).toBe(1);
});

it("preserves plain-data JSON bytes through both parse entry points", async () => {
  const resourceUrl = "https://pod.example/b/1";
  const data = {
    url: "https://example.org/a",
    title: "Title",
    description: "Summary",
    notes: "Notes",
    archived: true,
    created: new Date("2026-01-01T00:00:00Z"),
    modified: new Date("2026-01-02T00:00:00Z"),
    tags: ["a", "z"],
  };
  expect(JSON.stringify(parseBookmark(resourceUrl, buildBookmark(resourceUrl, data)))).toBe(
    JSON.stringify(data),
  );
  const turtle = await serializeBookmark(resourceUrl, data);
  expect(JSON.stringify(await parseBookmarkTtl(resourceUrl, turtle))).toBe(JSON.stringify(data));
});

it("preserves clearing setter types for strict consumers of the built declarations", async () => {
  await promisify(execFile)(process.execPath, [
    fileURLToPath(import.meta.resolve("typescript/bin/tsc")),
    "--noEmit",
    "--skipLibCheck",
    "--strict",
    "--exactOptionalPropertyTypes",
    "--module",
    "NodeNext",
    "--target",
    "ES2022",
    "--rootDir",
    fileURLToPath(new URL("..", import.meta.url)),
    fileURLToPath(new URL("./consumer.ts", import.meta.url)),
  ]);
}, 15_000);

it("sorts parsed tags by code unit like the hand-written package (not locale order)", async () => {
  const resourceUrl = "https://pod.example/b/2";
  const tags = ["é", "Z", "a", "B"];
  const expected = [...tags].sort();
  expect(
    parseBookmark(resourceUrl, buildBookmark(resourceUrl, { url: "https://example.org/", tags }))
      ?.tags,
  ).toEqual(expected);
  const turtle = await serializeBookmark(resourceUrl, { url: "https://example.org/", tags });
  expect((await parseBookmarkTtl(resourceUrl, turtle))?.tags).toEqual(expected);
});
