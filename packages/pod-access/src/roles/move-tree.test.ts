// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { expect, test, vi } from "vitest";
import { checkContainerRdf, emptyContainerEtag, exactName, sourceType } from "./move-tree.js";

const url = "https://pod.example/tree/";
const prefixes = `@prefix ldp: <http://www.w3.org/ns/ldp#>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix stat: <http://www.w3.org/ns/posix/stat#>.
@prefix dct: <http://purl.org/dc/terms/>.`;

test("mirrors the backend's server-managed container RDF allow-list", async () => {
  const dataset = await parseRdf(
    `${prefixes}
<${url}> a ldp:BasicContainer, <http://www.w3.org/ns/pim/space#Storage>;
  ldp:contains <${url}file>; dct:modified "today"; stat:mtime 1.
<${url}file> a <http://www.w3.org/ns/iana/media-types/text/plain#Resource>;
  stat:size 3.`,
    "text/turtle",
  );
  expect(() => checkContainerRdf(url, dataset, [`${url}file`])).not.toThrow();
});

test.each([
  `<${url}> a <http://www.w3.org/ns/iana/media-types/text/plain#Resource>.`,
  `<${url}> a <https://example.org/CustomContainer>.`,
  `<${url}> <https://example.org/title> "secret".`,
  `[] a <http://www.w3.org/ns/ldp#BasicContainer>.`,
  `<${url}file> a "bad type".`,
  `<${url}file> a <http://www.w3.org/ns/iana/media-types/text/plain>.`,
])("refuses container RDF that copy cannot preserve: %s", async (body) => {
  const dataset = await parseRdf(body, "text/turtle");
  expect(() => checkContainerRdf(url, dataset, [`${url}file`])).toThrow("Container RDF");
});

test("exact decoded names fail closed when public create cannot reproduce their bytes", () => {
  expect(exactName(`${url}hello%20world`)).toBe("hello world");
  expect(() => exactName(`${url}%ff`)).toThrow("UTF-8");
  expect(() => exactName(`${url}%41`)).toThrow("exactly");
});

test("conditional container cleanup refuses existing members and membership races", async () => {
  const storage = createMemoryStorage({ protocol: "solid", root: "https://pod.example/" });
  await storage.create(storage.root, null, { name: "tree", kind: "container" });
  await storage.create(url, "", { name: "file", contentType: "text/plain" });
  await expect(emptyContainerEtag(storage, url)).rejects.toMatchObject({ code: "conflict" });
  vi.spyOn(storage, "listAll").mockImplementation(async function* () {});
  await expect(emptyContainerEtag(storage, url)).rejects.toMatchObject({ code: "conflict" });
});

test("source Content-Type follows the backend grammar and rejects unsafe headers", () => {
  expect(sourceType('text/plain; charset="utf-8"', url)).toBe('text/plain; charset="utf-8"');
  for (const value of [
    null,
    "text/plain ",
    "text/plain\r\n",
    "bad",
    'text/plain; charset="unterminated',
  ])
    expect(() => sourceType(value, url)).toThrow("Invalid source Content-Type");
});
