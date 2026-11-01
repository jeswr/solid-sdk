// AUTHORED-BY Codex
import type { Term } from "@rdfjs/types";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { resolveContentType } from "../src/apps/drive/lib/files/resolve-content-type";
import { friendlyType, previewKind, toListEntry, viewItems } from "../src/apps/drive/lib/view/view";
import { turtle } from "./drive-wac-pod";

const ROOT = "https://mime.test/";
const FOLDER = `${ROOT}drive/`;
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const DCT_FORMAT = "http://purl.org/dc/terms/format";
const { literal, namedNode, blankNode } = DataFactory;
const iana = (type: string) => namedNode(`http://www.w3.org/ns/iana/media-types/${type}#Resource`);

class Fields extends TermWrapper {
  terms(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, TermAs.term, TermFrom.itself);
  }
}

async function setup(name: string, formats: Term[], types: Term[], header?: string) {
  const url = `${FOLDER}${encodeURIComponent(name)}`;
  const data = new Store();
  new Fields(FOLDER, data, DataFactory)
    .terms("http://www.w3.org/ns/ldp#contains")
    .add(namedNode(url));
  const resource = new Fields(url, data, DataFactory);
  for (const value of formats) resource.terms(DCT_FORMAT).add(value);
  for (const value of types) resource.terms(RDF_TYPE).add(value);
  const body = await turtle(data);
  const http = vi.fn<typeof fetch>(async (input, init) =>
    String(input) === FOLDER
      ? new Response(body, { headers: { "content-type": "text/turtle" } })
      : new Response(init?.method === "HEAD" ? null : new Uint8Array([65]), {
          headers: header === undefined ? {} : { "content-type": header },
        }),
  );
  return { url, http, client: createSolidDriveClient({ storageUrl: ROOT, fetch: http }) };
}

it.each([
  {
    label: "dct:format literal beats IANA rdf:type, HEAD and extension",
    formats: [literal(" Text/Plain; charset=utf-8 ")],
    types: [iana("image/png")],
    header: "application/pdf",
    expected: "text/plain",
  },
  {
    label: "dct:format IANA class IRI beats rdf:type, HEAD and extension",
    formats: [iana("text/plain")],
    types: [iana("image/png")],
    header: "application/pdf",
    expected: "text/plain",
  },
  {
    label: "dct:format IANA registry IRI beats rdf:type, HEAD and extension",
    formats: [namedNode("https://www.iana.org/assignments/media-types/text/plain")],
    types: [iana("image/png")],
    header: "application/pdf",
    expected: "text/plain",
  },
  {
    label: "IANA rdf:type beats HEAD and extension after unusable declared formats",
    formats: [namedNode("https://example.test/format"), blankNode(), literal("invalid")],
    types: [
      literal("text/plain"),
      blankNode(),
      namedNode("https://example.test/Type"),
      iana("text/plain"),
    ],
    header: "application/pdf",
    expected: "text/plain",
  },
  {
    label: "known HEAD Content-Type beats extension without type triples",
    formats: [],
    types: [],
    header: "Text/Plain; charset=utf-8",
    expected: "text/plain",
  },
  {
    label: "extension decides a listing with no type triples or response MIME",
    formats: [],
    types: [],
    header: undefined,
    expected: "image/png",
  },
])("$label", async ({ formats, types, header, expected }) => {
  const { client, http, url } = await setup("report.png", formats, types, header);
  await client.stat(url);
  const before = http.mock.calls.length;
  const items = await client.list(FOLDER);
  expect(http.mock.calls.length - before).toBe(1);
  const item = items[0];
  if (!item) throw new Error("Missing listing row");
  expect(item).toMatchObject({ contentType: expected });
  expect((await client.stat(url)).contentType).toBe(expected);
  expect(viewItems(items, { types: [expected === "text/plain" ? "documents" : "images"] })).toEqual(
    items,
  );
  expect(viewItems(items, { types: ["other"] })).toEqual([]);
  expect(friendlyType(item)).toBe(expected === "text/plain" ? "Text file" : "Image (PNG)");
  expect(previewKind(item?.contentType, item?.name)).toBe(
    expected === "text/plain" ? "text" : "image",
  );
});

it("known GET MIME beats the extension on later listings without extra child requests", async () => {
  const { client, http, url } = await setup("report.png", [], [], "text/plain; charset=utf-8");
  expect((await client.list(FOLDER))[0]?.contentType).toBe("image/png");
  expect((await client.read(url)).type).toBe("text/plain;charset=utf-8");
  const before = http.mock.calls.length;
  const [item] = await client.list(FOLDER);
  expect(http.mock.calls.length - before).toBe(1);
  expect(item?.contentType).toBe("text/plain");
});

it("retains the known Content-Type of a parsed RDF GET for later listings", async () => {
  const { client, http, url } = await setup("resource", [], []);
  http.mockResolvedValueOnce(new Response("", { headers: { "content-type": "text/turtle" } }));
  await client.readRdf(url);
  expect((await client.list(FOLDER))[0]?.contentType).toBe("text/turtle");
  expect((await client.stat(url)).contentType).toBe("text/turtle");
});

it("skips malformed format terms independently and uses the next valid declared format", async () => {
  const { client } = await setup(
    "report.png",
    [
      blankNode(),
      namedNode("https://example.test/invalid"),
      literal("image/*"),
      literal("text/plain"),
    ],
    [iana("image/png")],
  );
  expect((await client.list(FOLDER))[0]?.contentType).toBe("text/plain");
});

it("keeps unknown MIME absent and tolerates invalid filename hints", async () => {
  const { client, url } = await setup("unknown", [], [], "");
  expect((await client.list(FOLDER))[0]).not.toHaveProperty("contentType");
  expect(await client.stat(url)).not.toHaveProperty("contentType");
  await client.read(url);
  expect(resolveContentType("file.unknown", "image/*")).toBeUndefined();
  expect(resolveContentType("bad\u0000.txt")).toBeUndefined();
  expect(resolveContentType("path/report.txt")).toBe("text/plain");
  expect(resolveContentType("path\\report.txt")).toBe("text/plain");
  expect(resolveContentType("/")).toBeUndefined();
});

it("uses the same extension fallback in list entries, Details and preview", () => {
  const item = { url: `${FOLDER}report.txt`, name: "report.txt", kind: "file" as const };
  expect(toListEntry(item).contentType).toBe("text/plain");
  expect(viewItems([item], { types: ["documents"] })).toEqual([item]);
  expect(friendlyType(item)).toBe("Text file");
  expect(previewKind(undefined, item.name)).toBe("text");
  expect(toListEntry({ ...item, kind: "folder" }).contentType).toBeNull();
});
