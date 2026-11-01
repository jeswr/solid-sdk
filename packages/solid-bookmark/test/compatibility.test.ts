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

// Pinned divergences from the hand-written implementation, outside the 78-test oracle.
// The generated model follows the package SHACL profile exactly; whether that profile
// should widen these datatypes is a normative decision tracked as a needs:jesse bead.
const RES = "https://pod.example/b/9";
const doc = (body: string) => `@prefix book: <https://jeswr.org/ns/bookmark#> .
@prefix schema: <http://schema.org/> . @prefix dct: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${RES}#it> a book:Bookmark ; ${body} .`;

it("carries literals outside the profile's datatypes like the hand-written package", async () => {
  const parsed = await parseBookmarkTtl(
    RES,
    doc(`schema:url <https://example.org/> ; dct:title "Hi"@en ; dct:description "D"@en-GB ;
      schema:keywords "t"@en, "kept" ; dct:created "2026-01-01"^^xsd:date`),
  );
  expect(parsed).toEqual({
    url: "https://example.org/",
    title: "Hi",
    description: "D",
    archived: false,
    created: new Date("2026-01-01"),
    tags: ["kept", "t"],
  });
  expect(
    (
      await parseBookmarkTtl(
        RES,
        doc(`schema:url <https://example.org/> ; dct:title "5"^^xsd:integer`),
      )
    )?.title,
  ).toBe("5");
  // The same carry applies to the Store entry point and to lang-tagged legacy notes.
  const store = await parseRdf(
    doc(`schema:url <https://example.org/> ; <https://w3id.org/jeswr/bookmark#notes> "n"@en ;
      dct:modified "not a date"`),
    "text/turtle",
    { baseIRI: RES },
  );
  const fromStore = parseBookmark(RES, store);
  expect(fromStore?.notes).toBe("n");
  expect(fromStore && "modified" in fromStore).toBe(false);
});

it("keeps unprofiled values through a plain-data edit of an unrelated field", async () => {
  const original = doc(`schema:url <https://example.org/> ; dct:title "Hola"@es ;
    dct:description "Resumen"@es ; schema:keywords "etiqueta"@es, "plain" ;
    dct:created "2025-03-04"^^xsd:date`);
  const parsed = await parseBookmarkTtl(RES, original);
  if (!parsed) throw new Error("expected a bookmark");
  const reparsed = await parseBookmarkTtl(
    RES,
    await serializeBookmark(RES, { ...parsed, archived: true }),
  );
  expect(reparsed).toEqual({
    url: "https://example.org/",
    title: "Hola",
    description: "Resumen",
    archived: true,
    created: new Date("2025-03-04"),
    tags: ["etiqueta", "plain"],
  });
});

it("carries a timezone-qualified xsd:date created value through a plain-data edit", async () => {
  for (const [lexical, iso] of [
    ["2025-03-04+00:00", "2025-03-04T00:00:00.000Z"],
    ["2025-03-04-05:00", "2025-03-04T05:00:00.000Z"],
    ["2025-03-04Z", "2025-03-04T00:00:00.000Z"],
  ]) {
    const parsed = await parseBookmarkTtl(
      RES,
      doc(`schema:url <https://example.org/> ; dct:created "${lexical}"^^xsd:date`),
    );
    expect(parsed?.created?.toISOString()).toBe(iso);
    if (!parsed) throw new Error("expected a bookmark");
    const edited = await serializeBookmark(RES, { ...parsed, archived: true });
    expect((await parseBookmarkTtl(RES, edited))?.created?.toISOString()).toBe(iso);
  }
});

it("rejects a relative or unsafe resource URL instead of minting a relative subject", () => {
  expect(() => buildBookmark("bm/1", { url: "https://example.org/" })).toThrow(TypeError);
  expect(() => buildBookmark("https://pod.example/a b", { url: "https://example.org/" })).toThrow(
    TypeError,
  );
});

it("fails closed on an uppercase-scheme URL and reads the first of several titles", async () => {
  expect(await parseBookmarkTtl(RES, doc("schema:url <HTTPS://example.org/>"))).toBeUndefined();
  const parsed = await parseBookmarkTtl(
    RES,
    doc(`schema:url <https://example.org/> ; dct:title "a", "b"`),
  );
  expect(parsed?.url).toBe("https://example.org/");
  expect(parsed?.title).toBe("a");
});
