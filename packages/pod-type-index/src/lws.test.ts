// AUTHORED-BY Codex GPT-6.1-Sol
import type { Features } from "@jeswr/storage-capabilities";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { NS } from "@jeswr/suite-vocab";
import { describe, expect, it, vi } from "vitest";
import { createTypeIndex } from "./index.js";

const ROOT = "https://lws.example/alice/";
const CLASS = `${NS.POD_DOCS}Document`;
const LEGACY = "https://w3id.org/jeswr/pod-docs#Document";
const MEDIA = "application/lws+json";
const SEARCH = `${ROOT}search`;
function response(data: unknown, link?: string) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": MEDIA, ...(link ? { link } : {}) },
  });
}
function page(items: unknown[] = []) {
  return { type: "ContainerPage", items };
}
function setup() {
  const storage = createMemoryStorage({ protocol: "lws", root: ROOT });
  const features: Features = {
    ...storage.features,
    typeIndex: {
      state: "available",
      evidence: "fixture",
      detail: { mode: "server", searchEndpoint: SEARCH, indexEndpoint: `${ROOT}types` },
    },
  };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response(page()));
  const options = { storage, features, profile: "https://identity.example/#me", fetch };
  return { ...options, options, index: createTypeIndex(options) };
}

describe("LWS type services", () => {
  it("returns a canonical Link creation hint without I/O; unregister is a no-op", async () => {
    const { index, storage, fetch } = setup();
    const hint = await index.register(LEGACY, { instance: `${ROOT}future` });
    expect(hint).toEqual({ links: [{ rel: "type", target: CLASS }] });
    const created = await storage.create(ROOT, "body", { contentType: "text/plain", ...hint });
    expect((await storage.list(ROOT)).items[0]?.types).toEqual([CLASS]);
    await index.unregister(CLASS, { instance: created.url });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("batches aliases in one OR query and partitions/de-duplicates resource types across GET pages", async () => {
    const { storage, index, fetch } = setup();
    const next = await storage.create(
      ROOT,
      JSON.stringify(
        page([
          { id: `${ROOT}a`, type: CLASS },
          { id: `${ROOT}b`, type: [`${NS.TASK}Task`, CLASS] },
          { id: "https://foreign.example/private", type: CLASS },
          { id: "http://[", type: CLASS },
        ]),
      ),
      { name: "next", contentType: MEDIA },
    );
    fetch.mockImplementationOnce(async () =>
      response(
        page([
          { id: `${ROOT}a`, type: [LEGACY, "DataResource"] },
          { id: "javascript:alert(1)", type: CLASS },
          { id: `${ROOT}irrelevant`, type: "urn:other" },
        ]),
        `<${next.url}>; rel="next"`,
      ),
    );
    const all = await index.findAll([CLASS, `${NS.TASK}Task`, LEGACY, "urn:absent"]);
    expect(all.get(CLASS)).toEqual([`${ROOT}a`, `${ROOT}b`]);
    expect(all.get(LEGACY)).toEqual(all.get(CLASS));
    expect(all.get(`${NS.TASK}Task`)).toEqual([`${ROOT}b`]);
    expect(all.get("urn:absent")).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as Parameters<typeof globalThis.fetch>;
    expect(url).toBe(SEARCH);
    expect(init).toMatchObject({
      method: "QUERY",
      redirect: "manual",
      headers: { Accept: MEDIA, "Content-Type": "application/lws-query+json" },
    });
    const query = JSON.parse(init?.body as string);
    expect(query.type).toHaveLength(1);
    expect(query.type[0]).toEqual(expect.arrayContaining([CLASS, LEGACY, `${NS.TASK}Task`]));
  });

  it("enumerates canonical type classes through the TypeIndexService, including GET pages", async () => {
    const { storage, index, fetch } = setup();
    await storage.create(
      ROOT,
      JSON.stringify({
        type: "https://www.w3.org/ns/lws#TypeIndex",
        items: [{ id: LEGACY }, { id: CLASS }, { id: "urn:custom" }, { id: "bad iri" }],
      }),
      { name: "types", contentType: MEDIA },
    );
    expect(await index.listClasses()).toEqual([CLASS, "urn:custom"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "Container",
    "DataResource",
  ])("matches compact and expanded native %s types alongside suite aliases", async (type) => {
    const { index, fetch } = setup();
    const iri = `https://www.w3.org/ns/lws#${type}`;
    fetch.mockImplementation(async () =>
      response(
        page([
          { id: `${ROOT}compact`, type },
          { id: `${ROOT}expanded`, type: [iri, CLASS] },
          { id: `${ROOT}mixed`, type: [type, LEGACY] },
          { id: `${ROOT}other`, type: "urn:other" },
        ]),
      ),
    );
    const locations = [`${ROOT}compact`, `${ROOT}expanded`, `${ROOT}mixed`];
    expect(await index.find(iri)).toEqual(locations);
    expect(await index.findAll([iri, CLASS, LEGACY])).toEqual(
      new Map([
        [iri, locations],
        [CLASS, [`${ROOT}expanded`, `${ROOT}mixed`]],
        [LEGACY, [`${ROOT}expanded`, `${ROOT}mixed`]],
      ]),
    );
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({ type: [[iri]] });
  });

  it("performs no I/O for an empty batch", async () => {
    const { index, fetch } = setup();
    expect(await index.findAll([])).toEqual(new Map());
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { state: "unknown", detail: { mode: "server", searchEndpoint: SEARCH } },
    { state: "unavailable", detail: { mode: "server", searchEndpoint: SEARCH } },
    { state: "available", detail: { mode: "client", searchEndpoint: SEARCH } },
    { state: "available", detail: { mode: "server" } },
  ])("requires advertised available endpoints: %j", async (feature) => {
    const { options, fetch } = setup();
    options.features.typeIndex = { evidence: "fixture", ...feature } as Features["typeIndex"];
    await expect(createTypeIndex(options).find(CLASS)).rejects.toMatchObject({
      code: "unsupported",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never falls back to global fetch when QUERY transport is absent", async () => {
    const { options } = setup();
    const index = createTypeIndex({ ...options, fetch: undefined });
    await expect(index.find(CLASS)).rejects.toMatchObject({ code: "unsupported", method: "QUERY" });
  });

  it.each([
    "https://foreign.example/search",
    "https://lws.example/alice2/search",
    "https://user:password@lws.example/alice/search",
    "javascript:alert(1)",
  ])("rejects unsafe service endpoints before fetch: %s", async (url) => {
    const { options, fetch } = setup();
    options.features.typeIndex.detail.searchEndpoint = url;
    const index = createTypeIndex(options);
    await expect(index.find(CLASS)).rejects.toMatchObject({ code: "scope", url: ROOT });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    401, 403, 404, 412, 429, 500, 302, 201,
  ])("propagates HTTP failures without following redirects (%s)", async (status) => {
    const { index, fetch } = setup();
    fetch.mockResolvedValueOnce(new Response("discard", { status }));
    await expect(index.find(CLASS)).rejects.toMatchObject({ status, method: "QUERY" });
  });

  it("maps transport failures without echoing transport secrets", async () => {
    const { index, fetch } = setup();
    fetch.mockRejectedValueOnce(new Error("synthetic-sensitive-error"));
    const failed = await index.find(CLASS).catch((error) => error);
    expect(failed).toMatchObject({ code: "network" });
    expect(failed.cause).toBeUndefined();
    expect(failed.message).not.toContain("synthetic-sensitive-error");
  });

  it.each([
    "redirected",
    "foreign-url",
  ])("rejects a followed or mismatched response (%s)", async (mode) => {
    const { index, fetch } = setup();
    const reply = response(page());
    Object.defineProperty(reply, mode === "redirected" ? "redirected" : "url", {
      value: mode === "redirected" ? true : "https://foreign.example/",
    });
    fetch.mockResolvedValueOnce(reply);
    await expect(index.find(CLASS)).rejects.toMatchObject({ code: "invalid-response" });
  });

  it.each([
    null,
    [],
    { type: "Wrong", items: [] },
    { type: [123], items: [] },
    { type: "ContainerPage", items: {} },
    page([null]),
    page([{ id: 123 }]),
    page([{ id: `${ROOT}a`, type: [] }]),
    page([{ id: `${ROOT}a`, type: false }]),
  ])("rejects malformed JSON structures (%j)", async (data) => {
    const { index, fetch } = setup();
    fetch.mockResolvedValueOnce(response(data));
    await expect(index.find(CLASS)).rejects.toMatchObject({ code: "invalid-response" });
  });

  it.each([
    null,
    "text/html",
    "application/json",
  ])("rejects incorrect response media (%s)", async (media) => {
    const { index, fetch } = setup();
    fetch.mockResolvedValueOnce(
      new Response("{}", { headers: media ? { "content-type": media } : {} }),
    );
    await expect(index.find(CLASS)).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("accepts response parameters, expanded ContainerPage type, and a known response URL", async () => {
    const { index, fetch } = setup();
    const reply = new Response(
      JSON.stringify({ type: ["https://www.w3.org/ns/lws#ContainerPage"], items: [] }),
      { headers: { "content-type": `${MEDIA}; charset=utf-8` } },
    );
    Object.defineProperty(reply, "url", { value: SEARCH });
    fetch.mockResolvedValueOnce(reply);
    expect(await index.find(CLASS)).toEqual([]);
  });

  it.each([
    "null",
    "invalid-json",
    "broken-stream",
    "oversized",
    "oversized-items",
  ])("rejects failed or excessive bodies (%s)", async (kind) => {
    const { index, fetch } = setup();
    let body: BodyInit | null = "{";
    if (kind === "null") body = null;
    if (kind === "broken-stream")
      body = new ReadableStream({
        start(controller) {
          controller.error(new Error("broken"));
        },
      });
    if (kind === "oversized") body = " ".repeat(1_048_577);
    if (kind === "oversized-items")
      body = JSON.stringify(page(Array.from({ length: 10_001 }, () => ({ id: "a", type: CLASS }))));
    fetch.mockResolvedValueOnce(new Response(body, { headers: { "content-type": MEDIA } }));
    await expect(index.find(CLASS)).rejects.toMatchObject({
      code: kind === "broken-stream" ? "network" : "invalid-response",
    });
  });

  it.each([
    "foreign",
    "cycle",
    "long",
    "overflow",
  ])("rejects unsafe pagination (%s)", async (kind) => {
    const { index, fetch } = setup();
    const url =
      kind === "foreign"
        ? "https://foreign.example/page"
        : kind === "long"
          ? ROOT + "a".repeat(8192)
          : SEARCH;
    const link = kind === "overflow" ? "x".repeat(65_537) : `<${url}>; rel="next"`;
    fetch.mockResolvedValueOnce(response(page(), link));
    await expect(index.find(CLASS)).rejects.toMatchObject({
      code: kind === "foreign" ? "scope" : "invalid-response",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("ignores next links anchored on other resources", async () => {
    const { index, fetch } = setup();
    fetch.mockResolvedValueOnce(
      response(
        page(),
        `<https://foreign.example/>; rel="next"; anchor="${ROOT}other", <${ROOT}ignored>; rel="alternate"`,
      ),
    );
    expect(await index.find(CLASS)).toEqual([]);
  });

  it("caps pages even without cycles, preserving opaque cursors", async () => {
    const { storage, index, fetch } = setup();
    fetch.mockResolvedValueOnce(response(page(), `<${ROOT}page?opaque=1>; rel="next"`));
    const sample = await storage.read(ROOT);
    const read = vi.spyOn(storage, "read").mockImplementation(async () => ({
      ...sample,
      body: response(page()).body,
      contentType: MEDIA,
      links: new Map([
        ["next", [{ target: `${ROOT}page?opaque=${read.mock.calls.length + 1}`, params: {} }]],
      ]),
    }));
    await expect(index.find(CLASS)).rejects.toMatchObject({ code: "invalid-response" });
    expect(read).toHaveBeenCalledTimes(63);
  });

  it("follows opaque GET pages for class enumeration", async () => {
    const { storage, index } = setup();
    const sample = await storage.read(ROOT);
    const read = vi.spyOn(storage, "read");
    read.mockResolvedValueOnce({
      ...sample,
      body: response({ type: "TypeIndex", items: [{ id: CLASS }] }).body,
      contentType: MEDIA,
      links: new Map([["next", [{ target: `${ROOT}types?cursor=second`, params: {} }]]]),
    });
    read.mockResolvedValueOnce({
      ...sample,
      body: response({ type: "TypeIndex", items: [{ id: "urn:second" }] }).body,
      contentType: MEDIA,
      links: new Map(),
    });
    expect(await index.listClasses()).toEqual([CLASS, "urn:second"]);
    expect(read.mock.calls[1]?.[0]).toBe(`${ROOT}types?cursor=second`);
  });
});

it.each([
  "status",
  "links",
  "media",
  "reader",
])("handles body cancellation failures without unhandled rejections (%s)", async (kind) => {
  const { index, fetch } = setup();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (kind === "reader") controller.enqueue(new Uint8Array(1_048_577));
    },
    cancel() {
      return Promise.reject(new Error("cancel failed"));
    },
  });
  const reply = new Response(body, {
    status: kind === "status" ? 403 : 200,
    headers: {
      "content-type": kind === "media" ? "text/html" : MEDIA,
      ...(kind === "links" ? { link: "x".repeat(65_537) } : {}),
    },
  });
  fetch.mockResolvedValueOnce(reply);
  await expect(index.find(CLASS)).rejects.toMatchObject({
    code: kind === "status" ? "forbidden" : "invalid-response",
  });
});
