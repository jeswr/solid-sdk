// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { Parser, Store } from "n3";
import { describe, expect, test, vi } from "vitest";
import { StorageError } from "./errors.js";
import { applyJsonPatch, displayNameOf } from "./helpers.js";
import { displayNameOf as rootDisplayNameOf } from "./index.js";
import { createLwsBackend } from "./lws.js";
import { createMemoryStorage } from "./memory.js";
import { createSolidBackend } from "./solid.js";
import type { Entry, MetadataOp } from "./types.js";

const ROOT = "https://pod.example/";
const URL = `${ROOT}server-name`;
const META = `${URL}.meta`;
const TITLE = 'Draft "quoted"\n雪 😀';
const DCT_TITLE = "http://purl.org/dc/terms/title";
const factories = [
  ["solid", createSolidBackend],
  ["lws", createLwsBackend],
] as const;
const entry = (url: string, displayName: string | null = null): Entry => ({
  url,
  displayName,
  kind: "resource",
  contentType: null,
  size: null,
  modified: null,
  types: [],
});

function transport() {
  return vi.fn<typeof fetch>(
    async (_input, init) =>
      new Response(null, {
        status: init?.method === "POST" ? 201 : 204,
        headers: {
          etag: '"done"',
          location: new Headers(init?.headers).get("link")?.includes("Container") ? `${URL}/` : URL,
        },
      }),
  );
}

describe.each(factories)("keepalive through %s", (_protocol, create) => {
  test.each([
    undefined,
    false,
    true,
  ])("write and create forward keepalive=%s", async (keepalive) => {
    const fetch = transport();
    const storage = create({ root: ROOT, fetch });
    await storage.write(URL, "text", { contentType: "text/plain", ifMatch: '"v1"', keepalive });
    await storage.create(ROOT, "text", { contentType: "text/plain", keepalive });
    await storage.create(ROOT, "text", {
      contentType: "text/plain",
      name: "server-name",
      keepalive,
    });
    await storage.create(ROOT, null, { kind: "container", name: "folder", keepalive });
    await storage.create(ROOT, null, { kind: "container", keepalive });
    for (const [, init] of fetch.mock.calls) {
      expect(init?.keepalive).toBe(keepalive);
      expect(Object.hasOwn(init as RequestInit, "keepalive")).toBe(keepalive !== undefined);
    }
  });

  test.each([
    "x".repeat(64 * 1024),
    "雪".repeat(21845),
    new Uint8Array(128 * 1024).subarray(0, 64 * 1024),
    new Blob([new Uint8Array(64 * 1024)]),
  ])("accepts known bodies through the exact byte limit (%#)", async (body) => {
    const fetch = transport();
    const storage = create({ root: ROOT, fetch });
    await storage.write(URL, body, { contentType: "text/plain", ifMatch: "*", keepalive: true });
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(body);
    expect(fetch.mock.calls[0]?.[1]?.keepalive).toBe(true);
  });

  test.each([
    () => "x".repeat(70 * 1024),
    () => "雪".repeat(21846),
    () => "😀".repeat(16385),
    () => new Uint8Array(65537),
    () => new Blob([new Uint8Array(65537)]),
    () => new ReadableStream<Uint8Array>({}, { highWaterMark: 0 }),
    () => Object.defineProperty(new Blob([]), "size", { value: NaN }),
    () => Object.defineProperty(new Blob([]), "size", { value: -1 }),
  ])("rejects oversized/unknown bodies before write or create fetch (%#)", async (body) => {
    const fetch = transport();
    const storage = create({ root: ROOT, fetch });
    for (const mutation of [
      () =>
        storage.write(URL, body(), { contentType: "text/plain", ifMatch: "*", keepalive: true }),
      () => storage.create(ROOT, body(), { contentType: "text/plain", keepalive: true }),
      () =>
        storage.create(ROOT, body(), { contentType: "text/plain", name: "named", keepalive: true }),
    ]) {
      const error = await mutation().catch((error: unknown) => error);
      expect(error).toBeInstanceOf(StorageError);
      expect(error).toMatchObject({ code: "bad-request", status: null, retryable: false });
      expect((error as Error).message).toContain("64 KiB");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  test("rejects invalid flags and checks serialized RDF bytes", async () => {
    const fetch = transport();
    const storage = create({ root: ROOT, fetch });
    await expect(
      storage.write(URL, "x", {
        contentType: "text/plain",
        ifMatch: "*",
        keepalive: "true" as never,
      }),
    ).rejects.toThrow(TypeError);
    const dataset = new Store(new Parser().parse('<urn:s> <urn:p> "雪".'));
    await storage.writeRdf(URL, dataset, { ifMatch: "*", keepalive: true });
    expect(fetch.mock.calls[0]?.[1]?.keepalive).toBe(true);
    const large = new Store(new Parser().parse(`<urn:s> <urn:p> "${"雪".repeat(23000)}".`));
    fetch.mockClear();
    await expect(
      storage.writeRdf(URL, large, { ifMatch: "*", keepalive: true }),
    ).rejects.toMatchObject({ code: "bad-request" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("display names", () => {
  test("root and helpers expose the same pure fallback", () => {
    expect(rootDisplayNameOf).toBe(displayNameOf);
    for (const [url, expected] of [
      [`${ROOT}draft%20%E9%9B%AA`, "draft 雪"],
      [`${ROOT}folder/`, "folder"],
      [`${ROOT}draft%20name?q=other#fragment`, "draft name"],
      [`${ROOT}%FF`, "%FF"],
      [`${ROOT}%2`, "%2"],
      [`${ROOT}100%`, "100%"],
      [ROOT, ""],
    ])
      expect(displayNameOf(entry(url as string))).toBe(expected);
    const titled = Object.freeze(entry(URL, TITLE));
    expect(displayNameOf(titled)).toBe(TITLE);
    expect(displayNameOf(entry(URL, ""))).toBe("");
    expect(titled.displayName).toBe(TITLE);
  });

  test("Solid reads dct:title on the listed member and tolerates malformed values", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          `
      @prefix dct: <http://purl.org/dc/terms/>.
      <> <http://www.w3.org/ns/ldp#contains> <a>, <b>, <c>, <folder/>.
      <a> dct:title "Draft 雪".
      <b> dct:title <urn:wrong-kind>.
      <folder/> dct:title "".
    `,
          { headers: { "content-type": "text/turtle" } },
        ),
    );
    const storage = createSolidBackend({ root: ROOT, fetch });
    expect((await storage.list(ROOT)).items.map(({ displayName }) => displayName)).toEqual([
      "Draft 雪",
      null,
      null,
      "",
    ]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  test("LWS takes the listing target title and ignores malformed optional titles", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({
            type: "Container",
            items: [
              { id: "server-name", title: TITLE },
              { id: "empty", title: "" },
              { id: "no-title" },
              { id: "null-title", title: null },
              { id: "bad", title: ["not a title"] },
            ],
          }),
          { headers: { "content-type": "application/lws+json" } },
        ),
    );
    const page = await createLwsBackend({ root: ROOT, fetch }).list(ROOT);
    expect(page.items.map(({ displayName }) => displayName)).toEqual([TITLE, "", null, null, null]);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

function metadataBackend(protocol: "solid" | "lws", original?: unknown, solidType = "text/turtle") {
  let body = protocol === "solid" ? "" : { linkset: [{ anchor: URL }] };
  if (original !== undefined) body = original as typeof body;
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    if (init?.method === "HEAD")
      return new Response(null, {
        headers: {
          link: `<${META}>; rel="${protocol === "solid" ? "describedby" : "linkset"}"`,
        },
      });
    if (init?.method === "PATCH")
      return new Response(null, { status: 204, headers: { etag: '"next"' } });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      headers: {
        "content-type": protocol === "solid" ? solidType : "application/linkset+json",
        etag: '"meta"',
      },
    });
  });
  const create = protocol === "solid" ? createSolidBackend : createLwsBackend;
  return { storage: create({ root: ROOT, fetch }), fetch };
}

describe("metadata titles", () => {
  test("Solid relation changes retain identical statements in named graphs", async () => {
    const named = `<urn:graph> { <${URL}> <urn:rel> <urn:target>. }`;
    const noop = metadataBackend("solid", named, "application/trig");
    const remove: MetadataOp = { op: "remove", rel: "urn:rel", href: "urn:target" };
    await noop.storage.setMetadata(URL, [remove], { ifMatch: '"meta"' });
    expect(noop.fetch).toHaveBeenCalledTimes(2);
    const both = metadataBackend(
      "solid",
      `<${URL}> <urn:rel> <urn:target>. ${named}`,
      "application/trig",
    );
    await both.storage.setMetadata(URL, [remove], { ifMatch: '"meta"' });
    const body = both.fetch.mock.calls.at(-1)?.[1]?.body as string;
    expect(body).toContain("solid:deletes");
    expect(body).not.toContain("urn:graph");
    expect(
      new Parser({ format: "text/n3" })
        .parse(body)
        .filter((quad) => quad.predicate.value === "urn:rel"),
    ).toHaveLength(1);
  });

  test("Solid N3 Patch has stable escaped bytes and round-trips literal titles", async () => {
    const { storage, fetch } = metadataBackend("solid");
    await storage.setMetadata(
      URL,
      [{ op: "add", rel: "related", href: "urn:target", title: TITLE }],
      { ifMatch: '"meta"' },
    );
    const init = fetch.mock.calls.at(-1)?.[1];
    expect(init?.body).toMatchInlineSnapshot(`
      "@prefix solid: <http://www.w3.org/ns/solid/terms#>.
      _:patch a solid:InsertDeletePatch;
        solid:inserts {
      <https://pod.example/server-name> <http://www.iana.org/assignments/relation/related> <urn:target> .
      <https://pod.example/server-name> <http://purl.org/dc/terms/title> "Draft \\"quoted\\"\\n雪 \\U0001f600" .
      };
      .
      "
    `);
    expect(new Headers(init?.headers).get("if-match")).toBe('"meta"');
    const titles = new Parser({ format: "text/n3" })
      .parse(init?.body as string)
      .filter((quad) => quad.predicate.value === DCT_TITLE);
    expect(titles).toHaveLength(1);
    expect(titles[0]?.subject.value).toBe(URL);
    expect(titles[0]?.object.value).toBe(TITLE);
  });

  test("Solid replaces an anchor title and removes only the supplied literal", async () => {
    const original = `<${URL}> <${DCT_TITLE}> "old"; <urn:rel> <urn:target>.`;
    const { storage, fetch } = metadataBackend("solid", original);
    await storage.setMetadata(
      URL,
      [{ op: "add", rel: "urn:rel", href: "urn:target", title: "new" }],
      { ifMatch: '"meta"' },
    );
    const patch = fetch.mock.calls.at(-1)?.[1]?.body as string;
    expect(patch).toContain('"old"');
    expect(patch).toContain('"new"');
    const remove = metadataBackend("solid", original);
    await remove.storage.setMetadata(
      URL,
      [{ op: "remove", rel: "urn:rel", href: "urn:target", title: "old" }],
      { ifMatch: '"meta"' },
    );
    expect(remove.fetch.mock.calls.at(-1)?.[1]?.body).toContain("solid:deletes");
    const noop = metadataBackend("solid", original);
    await noop.storage.setMetadata(
      URL,
      [{ op: "add", rel: "urn:rel", href: "urn:target", title: "old" }],
      { ifMatch: '"meta"' },
    );
    expect(noop.fetch).toHaveBeenCalledTimes(2);
  });

  test("LWS JSON Patch has stable escaped bytes and round-trips target titles", async () => {
    const { storage, fetch } = metadataBackend("lws");
    await storage.setMetadata(
      URL,
      [{ op: "add", rel: "related", href: "urn:target", title: TITLE }],
      { ifMatch: '"meta"' },
    );
    const init = fetch.mock.calls.at(-1)?.[1];
    expect(init?.body).toMatchInlineSnapshot(
      `"[{"op":"add","path":"/linkset/0/related","value":[]},{"op":"add","path":"/linkset/0/related/-","value":{"href":"urn:target","title":"Draft \\"quoted\\"\\n雪 😀"}}]"`,
    );
    const after = applyJsonPatch({ linkset: [{ anchor: URL }] }, JSON.parse(init?.body as string));
    expect(after).toEqual({
      linkset: [{ anchor: URL, related: [{ href: "urn:target", title: TITLE }] }],
    });
    expect(new Headers(init?.headers).get("if-match")).toBe('"meta"');
  });

  test("LWS title updates retain other attributes, no-op titles avoid PATCH", async () => {
    const original = {
      linkset: [
        { anchor: URL, related: [{ href: "urn:target", title: "old", type: "text/plain" }] },
      ],
    };
    const before = structuredClone(original);
    const { storage, fetch } = metadataBackend("lws", original);
    await storage.setMetadata(URL, [{ op: "add", rel: "related", href: "urn:target", title: "" }], {
      ifMatch: '"meta"',
    });
    expect(fetch.mock.calls.at(-1)?.[1]?.body).toBe(
      '[{"op":"add","path":"/linkset/0/related/0/title","value":""}]',
    );
    expect(
      applyJsonPatch(original, JSON.parse(fetch.mock.calls.at(-1)?.[1]?.body as string)),
    ).toEqual({
      linkset: [{ anchor: URL, related: [{ href: "urn:target", title: "", type: "text/plain" }] }],
    });
    expect(original).toEqual(before);
    const noop = metadataBackend("lws", original);
    await noop.storage.setMetadata(
      URL,
      [{ op: "add", rel: "related", href: "urn:target", title: "old" }],
      { ifMatch: '"meta"' },
    );
    expect(noop.fetch).toHaveBeenCalledTimes(2);
  });

  test.each([
    "solid",
    "lws",
  ] as const)("%s rejects non-string titles before fetching", async (protocol) => {
    const { storage, fetch } = metadataBackend(protocol);
    for (const title of [null, 0, {}, []])
      await expect(
        storage.setMetadata(
          URL,
          [{ op: "add", rel: "related", href: "urn:target", title } as MetadataOp],
          { ifMatch: '"meta"' },
        ),
      ).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe.each(["solid", "lws"] as const)("memory %s additions", (protocol) => {
  test("keepalive validation precedes body collection and mutations", async () => {
    const storage = createMemoryStorage({ protocol, root: ROOT });
    const created = await storage.create(ROOT, "old", {
      name: "note",
      contentType: "text/plain",
      keepalive: true,
    });
    const opts = { contentType: "text/plain", ifMatch: created.etag as string, keepalive: true };
    await expect(storage.write(created.url, "雪".repeat(23000), opts)).rejects.toMatchObject({
      code: "bad-request",
    });
    await expect(
      storage.create(ROOT, new ReadableStream({}, { highWaterMark: 0 }), {
        contentType: "text/plain",
        keepalive: true,
      }),
    ).rejects.toMatchObject({ code: "bad-request" });
    expect(await (await storage.read(created.url)).text()).toBe("old");
    await storage.write(created.url, "x".repeat(65536), opts);
  });

  test("metadata titles appear in entries and raw metadata", async () => {
    const storage = createMemoryStorage({ protocol, root: ROOT });
    const { url } = await storage.create(ROOT, "x", { name: "note", contentType: "text/plain" });
    const add = async (title: string) =>
      storage.setMetadata(url, [{ op: "add", rel: "related", href: "urn:target", title }], {
        ifMatch: (await storage.metadata(url)).etag as string,
      });
    await add(TITLE);
    const listing = await storage.read(ROOT);
    const wire = await listing.text();
    if (protocol === "lws") expect(JSON.parse(wire).items[0].title).toBe(TITLE);
    else
      expect(
        [...(await parseRdf(wire, "text/turtle"))].find(
          (quad) => quad.predicate.value === DCT_TITLE,
        )?.object.value,
      ).toBe(TITLE);
    expect((await storage.list(ROOT)).items[0]?.displayName).toBe(TITLE);
    const meta = await storage.metadata(url);
    if (protocol === "lws")
      expect(meta.links.get(url)?.get("related")?.[0]?.params.title).toBe(TITLE);
    else
      expect(
        [...(meta.raw as Store)].find((quad) => quad.predicate.value === DCT_TITLE)?.object.value,
      ).toBe(TITLE);
    await add("");
    expect((await storage.list(ROOT)).items[0]?.displayName).toBe("");
    await expect(
      storage.setMetadata(
        url,
        [{ op: "add", rel: "related", href: "urn:target", title: 1 as never }],
        { ifMatch: (await storage.metadata(url)).etag as string },
      ),
    ).rejects.toThrow(TypeError);
  });
});

test("memory Solid titles belong to anchors independently of links and move with their anchors", async () => {
  const storage = createMemoryStorage({ root: ROOT });
  const created = await storage.create(ROOT, "x", { name: "note", contentType: "text/plain" });
  const url = created.url;
  const change = async (ops: MetadataOp[]) =>
    storage.setMetadata(url, ops, { ifMatch: (await storage.metadata(url)).etag as string });
  await change([{ op: "add", rel: "related", href: "urn:target", title: TITLE }]);
  await change([{ op: "remove", rel: "related", href: "urn:target" }]);
  expect((await storage.list(ROOT)).items[0]?.displayName).toBe(TITLE);
  await change([{ op: "remove", rel: "related", href: "urn:target", title: "wrong" }]);
  expect((await storage.list(ROOT)).items[0]?.displayName).toBe(TITLE);
  await change([{ op: "remove", rel: "related", href: "urn:target", title: TITLE }]);
  expect((await storage.list(ROOT)).items[0]?.displayName).toBeNull();
  await change([
    { op: "add", rel: "related", href: "urn:target", title: TITLE },
    { op: "add", anchor: `${url}#part`, rel: "related", href: "urn:part", title: "part" },
    { op: "add", anchor: `${url}-other`, rel: "related", href: "urn:other", title: "other" },
  ]);
  const moved = await storage.move(url, ROOT, { name: "renamed", ifMatch: created.etag as string });
  const metadata = await storage.metadata(moved.url);
  expect(
    [...(metadata.raw as Store)]
      .filter((quad) => quad.predicate.value === DCT_TITLE)
      .map((quad) => [quad.subject.value, quad.object.value]),
  ).toEqual([
    [moved.url, TITLE],
    [`${moved.url}#part`, "part"],
    [`${url}-other`, "other"],
  ]);
});
