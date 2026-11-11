// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad, Term } from "@jeswr/fetch-rdf";
import type { Features } from "@jeswr/storage-capabilities";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, test, vi } from "vitest";
import { StorageError } from "./errors.js";
import {
  lwsWriteExchanges,
  LWS_WRITE_METADATA as META,
  LWS_CONTAINER as NOTES,
  LWS_ROOT as ROOT,
  LWS_WRITE_RESOURCE as URL,
} from "./fixtures/lws.js";
import { applyJsonPatch } from "./helpers.js";
import { createLwsBackend } from "./lws.js";
import type { CreateOptions, MetadataOp, Patch, WriteOptions } from "./types.js";

const { namedNode: nn, literal, quad, variable, blankNode } = DataFactory;
const old = quad(nn("urn:s"), nn("urn:p"), literal("old"));
const added = quad(nn("urn:s"), nn("urn:p"), literal("new"));
const rdf = (inserts: readonly Quad[] = [added], deletes: readonly Quad[] = []): Patch => ({
  kind: "rdf",
  inserts,
  deletes,
});
const raw: Patch = { kind: "raw", mediaType: "text/plain", body: "update" };
const tag = '"resource"';
const mtag = '"metadata"';
const options = { contentType: "text/plain", ifMatch: tag };
interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
  init?: RequestInit;
}
interface Reply {
  status: number;
  headers?: Record<string, string>;
  body?: string | ReadableStream<Uint8Array>;
}
type Exchange = Reply | ((call: Call) => Reply | Promise<Reply>);
function backend(
  overrides: Record<string, Exchange> = {},
  configure?: (features: Features) => void,
) {
  const calls: Call[] = [];
  const exchanges: Record<string, Exchange> = { ...lwsWriteExchanges, ...overrides };
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body,
      init,
    };
    calls.push(call);
    const entry = exchanges[`${call.method} ${call.url}`];
    const reply = typeof entry === "function" ? await entry(call) : (entry ?? { status: 404 });
    return new Response(reply.body ?? null, { status: reply.status, headers: reply.headers });
  });
  const features = structuredClone(createLwsBackend({ root: ROOT, fetch }).features);
  configure?.(features);
  return { storage: createLwsBackend({ root: ROOT, fetch, features }), fetch, calls };
}
const reply = (status = 204, headers: Record<string, string> = {}): Reply => ({ status, headers });
function nativeRdfReply(call: Call, contentType: string, body: string, etag = tag): Reply {
  const type = contentType.split(";")[0];
  const accepted = call.headers
    .get("accept")
    ?.split(",")
    .some((range) => {
      const media = range.trim().split(";")[0];
      return media === "*/*" || media === type;
    });
  return accepted
    ? { status: 200, headers: { "content-type": contentType, etag }, body }
    : reply(406);
}
function json(value: unknown, headers: Record<string, string> = {}): Reply {
  return {
    status: 200,
    headers: { "content-type": "application/linkset+json", etag: mtag, ...headers },
    body: JSON.stringify(value),
  };
}
const linkset = (context: Record<string, unknown> = {}) => ({
  linkset: [{ anchor: URL, up: [{ href: NOTES }], ...context }],
});
const move = (features: Features) => {
  features.move.state = "available";
  features.move.detail = { native: true, containers: true, preservesIdentifier: true };
};
async function rejects(promise: Promise<unknown>, code: string) {
  const error = await promise.catch((error: unknown) => error);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code });
  return error as StorageError;
}
const mutationCalls = (calls: Call[]) =>
  calls.filter((call) => ["PUT", "POST", "PATCH", "DELETE"].includes(call.method));

describe("LWS PUT and POST fixture replay", () => {
  test.each([tag, "*", 'W/"weak"'])("PUT sends mandatory If-Match %s", async (ifMatch) => {
    const { storage, calls } = backend();
    expect(await storage.write(URL, "bytes", { ...options, ifMatch })).toEqual({
      url: URL,
      etag: '"written"',
      created: false,
      etagSource: "response",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: URL,
      method: "PUT",
      body: "bytes",
      init: { redirect: "manual" },
    });
    expect(calls[0]?.headers.get("if-match")).toBe(ifMatch);
    expect(calls[0]?.headers.get("content-type")).toBe("text/plain");
  });
  test("PUT 404 stays not-found; PUT 201 is an invalid create", async () => {
    await rejects(
      backend({ [`PUT ${URL}`]: reply(404) }).storage.write(URL, "", options),
      "not-found",
    );
    await rejects(
      backend({ [`PUT ${URL}`]: reply(201) }).storage.write(URL, "", options),
      "invalid-response",
    );
  });
  test.each([
    new Uint8Array([1, 2]),
    new Blob(["blob"]),
    new ReadableStream<Uint8Array>(),
  ])("body passes through without buffering", async (body) => {
    const { storage, calls } = backend();
    await storage.write(URL, body, options);
    expect(calls[0]?.body).toBe(body);
    expect((calls[0]?.init as RequestInit & { duplex?: string })?.duplex).toBe(
      body instanceof ReadableStream ? "half" : undefined,
    );
  });
  test("writeRdf serializes Turtle through the shared serializer", async () => {
    const { storage, calls } = backend();
    await storage.writeRdf(URL, new Store([added]), { ifMatch: "*", prefixes: { ex: "urn:" } });
    expect(new Store(new Parser().parse(calls[0]?.body as string)).has(added)).toBe(true);
    expect(calls[0]?.headers.get("content-type")).toBe("text/turtle");
    await rejects(
      storage.writeRdf(URL, [], { ifMatch: tag, contentType: "application/ld+json" }),
      "unsupported",
    );
    await storage.writeRdf(URL, [], { ifMatch: tag, contentType: "text/turtle" });
  });
  test("POST uses Slug as hint, forwards initial Link metadata and HEADs Location for ETag", async () => {
    const { storage, calls } = backend({
      [`POST ${NOTES}`]: reply(201, { location: "../opaque-id" }),
      [`HEAD ${ROOT}opaque-id`]: reply(200, { etag: '"created"' }),
    });
    expect(
      await storage.create(NOTES, "body", {
        contentType: "text/plain",
        name: "suggested.txt",
        links: [
          { rel: "type", target: "urn:Class" },
          { rel: "related", target: "urn:other" },
        ],
      }),
    ).toEqual({
      url: `${ROOT}opaque-id`,
      etag: '"created"',
      created: true,
      etagSource: "follow-up",
    });
    expect(calls.map(({ method }) => method)).toEqual(["POST", "HEAD"]);
    expect(calls[0]?.headers.get("slug")).toBe("suggested.txt");
    expect(calls[0]?.headers.get("link")).toBe(
      '<https://www.w3.org/ns/lws#DataResource>; rel="type", <urn:Class>; rel="type", <urn:other>; rel="related"',
    );
    expect(calls[0]?.headers.has("if-match")).toBe(false);
  });
  test("container POST accepts null and emits Container type; absent name emits no Slug", async () => {
    const { storage, calls } = backend();
    await storage.create(NOTES, null, { kind: "container" });
    expect(calls[0]?.body).toBe("");
    expect(calls[0]?.headers.get("link")).toBe('<https://www.w3.org/ns/lws#Container>; rel="type"');
    expect(calls[0]?.headers.has("slug")).toBe(false);
    await storage.create(NOTES, null, { contentType: "text/plain" });
    await storage.create(NOTES, "", { contentType: "text/plain", kind: "container" });
  });
  test.each([
    "資料",
    "📁",
    "café",
    "a:b%100",
    "first draft",
    " padded",
    "padded ",
    "%E8%B3%87",
  ])("POST encodes the decoded name hint %s once and retains the server's identifier", async (name) => {
    const { storage, calls } = backend({
      [`POST ${NOTES}`]: reply(201, { location: "../opaque-id", etag: tag }),
    });
    expect(await storage.create(NOTES, "body", { name, contentType: "text/plain" })).toEqual({
      url: `${ROOT}opaque-id`,
      etag: tag,
      created: true,
      etagSource: "response",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get("slug")).toBe(encodeURIComponent(name));
  });
  test("a slashless container Location can be reused as a create parent", async () => {
    const parentUrl = `${ROOT}opaque-container`;
    const childUrl = `${ROOT}opaque-child`;
    const { storage, calls } = backend({
      [`POST ${NOTES}`]: reply(201, { location: parentUrl, etag: tag }),
      [`POST ${parentUrl}`]: reply(201, { location: childUrl, etag: '"child"' }),
    });
    const parent = await storage.create(NOTES, null, { kind: "container" });
    expect(await storage.create(parent.url, "child", { contentType: "text/plain" })).toEqual({
      url: childUrl,
      etag: '"child"',
      created: true,
      etagSource: "response",
    });
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `POST ${NOTES}`,
      `POST ${parentUrl}`,
    ]);
  });
  test("the server validates a slashless create parent's kind", async () => {
    const { storage, calls } = backend({ [`POST ${URL}`]: reply(405) });
    await rejects(storage.create(URL, "", { contentType: "text/plain" }), "method-not-allowed");
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([`POST ${URL}`]);
  });
  test.each([
    undefined,
    "",
    "https://user:secret@evil.example/new",
    "https://evil.example/x",
    NOTES,
    ROOT,
    "?q",
    "new#",
    "http://[",
  ])("untrusted Location is rejected before a follow-up request: %s", async (location) => {
    const { storage, calls } = backend({
      [`POST ${NOTES}`]: reply(201, location === undefined ? {} : { location }),
    });
    const error = await rejects(
      storage.create(NOTES, "", { contentType: "text/plain" }),
      "invalid-response",
    );
    expect(error.url).toBe(NOTES);
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("secret");
    expect(calls).toHaveLength(1);
  });
  test.each([
    200, 202, 300, 302,
  ])("unexpected POST status %s is invalid-response", async (status) => {
    await rejects(
      backend({ [`POST ${NOTES}`]: reply(status) }).storage.create(NOTES, "", {
        contentType: "text/plain",
      }),
      "invalid-response",
    );
  });
  test("failed ETag observations return null after a committed mutation", async () => {
    const { storage, calls } = backend({ [`PUT ${URL}`]: reply(), [`HEAD ${URL}`]: reply(503) });
    expect((await storage.write(URL, "", options)).etag).toBeNull();
    expect(calls.map(({ method }) => method)).toEqual(["PUT", "HEAD"]);
    const post = backend({ [`HEAD ${URL}`]: reply(200) });
    expect((await post.storage.create(NOTES, "", { contentType: "text/plain" })).etag).toBeNull();
  });
});

describe("validation and transport fail closed", () => {
  test.each([
    "",
    3,
    "a\tb",
    "a\u0001b",
    "a\u007fb",
    "a\rb",
    "a\nb",
    "a\0b",
  ])("invalid decoded name hint %j fails before fetch", async (name) => {
    const { storage, fetch } = backend();
    await expect(
      storage.create(NOTES, "body", { name, contentType: "text/plain" } as CreateOptions),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
  test("a malformed Unicode name hint fails before fetch", async () => {
    const { storage, fetch } = backend();
    await expect(
      storage.create(NOTES, "body", { name: "\ud800", contentType: "text/plain" }),
    ).rejects.toBeInstanceOf(URIError);
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each([
    undefined,
    "",
    " * ",
    "\r\nx",
    "\0",
    "😀",
    3,
  ])("invalid ifMatch %j fails before fetch", async (ifMatch) => {
    const { storage, fetch } = backend();
    await expect(
      storage.write(URL, "", { ...options, ifMatch } as WriteOptions),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each([
    undefined,
    "text/plain\r\nx",
    "not-a-type",
    " text/plain",
    3,
  ])("invalid content type %j fails before fetch", async (contentType) => {
    const { storage, fetch } = backend();
    await expect(
      storage.write(URL, "", { ifMatch: tag, contentType } as WriteOptions),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
  test("media parameters and explicit abort signals are forwarded", async () => {
    const { storage, calls } = backend();
    const signal = new AbortController().signal;
    await storage.write(URL, "", {
      ifMatch: tag,
      contentType: 'text/plain; charset="utf-8"',
      signal,
    });
    expect(calls[0]?.init?.signal).toBe(signal);
  });
  test("mutation options and wildcard restrictions are validated", async () => {
    const { storage, fetch } = backend();
    await expect(
      storage.write(URL, "", undefined as unknown as WriteOptions),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      storage.writeRdf(URL, [], undefined as unknown as WriteOptions),
    ).rejects.toBeInstanceOf(TypeError);
    for (const promise of [
      storage.patch(URL, raw, { ifMatch: "*" }),
      storage.patch(URL, raw, undefined as never),
      storage.move(URL, ROOT),
      storage.delete(URL),
      storage.setMetadata(URL, [], undefined as never),
    ])
      await expect(promise).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each([
    { kind: "other" },
    {},
    { name: "\n", contentType: "text/plain" },
    { contentType: "text/plain", links: [{ rel: "bad relation", target: "urn:x" }] },
    { contentType: "text/plain", links: [{ rel: 3, target: "urn:x" }] },
    { contentType: "text/plain", links: [{ rel: "related", target: "relative" }] },
    { contentType: "text/plain", links: [{ rel: "related", target: 'urn:x>"bad' }] },
    { contentType: "text/plain", links: [{ rel: "anchor", target: "urn:x" }] },
    { contentType: "text/plain", links: [{ rel: "related", target: "urn:😀" }] },
  ])("invalid create options reject without fetch: %j", async (opts) => {
    const { storage, fetch } = backend();
    await expect(storage.create(NOTES, null, opts as CreateOptions)).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each(["up", "linkset"])("create refuses server-managed relation %s", async (rel) => {
    const { storage, fetch } = backend();
    await rejects(
      storage.create(NOTES, "", { contentType: "text/plain", links: [{ rel, target: ROOT }] }),
      "unsupported",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  test("root refuses content PUT", async () => {
    const { storage, fetch } = backend();
    await rejects(storage.write(ROOT, "", options), "method-not-allowed");
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each(["?", "#", "?x=1"])("mutation URLs refuse query/fragment %s", async (suffix) => {
    const { storage, fetch } = backend();
    for (const promise of [
      storage.write(URL + suffix, "", options),
      storage.create(NOTES + suffix, null),
      storage.patch(URL + suffix, raw, { ifMatch: tag }),
      storage.move(URL + suffix, NOTES, { ifMatch: tag }),
      storage.move(URL, NOTES + suffix, { ifMatch: tag }),
      storage.delete(URL + suffix, { ifMatch: tag }),
      storage.setMetadata(URL + suffix, [], { ifMatch: mtag }),
    ])
      await rejects(promise, "bad-request");
    expect(fetch).not.toHaveBeenCalled();
  });
  test("all mutation endpoints scope before fetch and redact credentials", async () => {
    const { storage, fetch } = backend();
    const foreign = "https://user:secret@evil.example/";
    for (const promise of [
      storage.write(foreign, "", options),
      storage.writeRdf(foreign, [], { ifMatch: tag }),
      storage.create(foreign, null),
      storage.patch(foreign, raw, { ifMatch: tag }),
      storage.move(URL, foreign, { ifMatch: tag }),
      storage.delete(foreign, { ifMatch: tag }),
      storage.setMetadata(foreign, [], { ifMatch: tag }),
    ]) {
      const error = await rejects(promise, "scope");
      expect(error.message).not.toContain("secret");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each([
    200, 403, 204,
  ])("mutation response storage binding checked at status %s", async (status) => {
    const { storage } = backend({
      [`PUT ${URL}`]: reply(status, {
        link: '<https://evil.example/>; rel="https://www.w3.org/ns/lws#storage"',
      }),
    });
    await rejects(storage.write(URL, "", options), "scope");
  });
  test.each([
    202, 206, 304, 307,
  ])("unexpected PUT status %s is invalid-response", async (status) => {
    await rejects(
      backend({ [`PUT ${URL}`]: reply(status) }).storage.write(URL, "", options),
      "invalid-response",
    );
  });
  test.each([
    [412, "precondition-failed"],
    [409, "conflict"],
    [405, "method-not-allowed"],
    [415, "unsupported-media-type"],
    [422, "bad-request"],
    [428, "precondition-required"],
  ])("HTTP %s maps to %s", async (status, code) => {
    const { storage } = backend({ [`PUT ${URL}`]: reply(status as number, { etag: '"current"' }) });
    const error = await rejects(storage.write(URL, "", options), code as string);
    if (status === 412) expect(error.etag).toBe('"current"');
  });
  test("stream failures cannot be retried, including HTTP errors", async () => {
    const { storage } = backend({ [`PUT ${URL}`]: reply(503) });
    expect(
      (await rejects(storage.write(URL, new ReadableStream(), options), "server")).retryable,
    ).toBe(false);
    const failed = backend({
      [`PUT ${URL}`]: () => {
        throw new Error("transport");
      },
    });
    expect((await rejects(failed.storage.write(URL, "", options), "network")).retryable).toBe(true);
    expect(
      (await rejects(failed.storage.write(URL, new ReadableStream(), options), "network"))
        .retryable,
    ).toBe(false);
  });
  test("aborts before send and while reading errors are nonretryable", async () => {
    const controller = new AbortController();
    controller.abort();
    const { storage, fetch } = backend();
    expect(
      (await rejects(storage.write(URL, "", { ...options, signal: controller.signal }), "network"))
        .retryable,
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    const other = new AbortController();
    const failing = backend({
      [`PUT ${URL}`]: () => {
        other.abort();
        return reply(503);
      },
    });
    expect(
      (
        await rejects(
          failing.storage.write(URL, "", { ...options, signal: other.signal }),
          "network",
        )
      ).retryable,
    ).toBe(false);
  });
});

describe("LWS JSON, raw and RDF patches", () => {
  test("JSON and raw patch fixture replays", async () => {
    const { storage, calls } = backend();
    expect(
      await storage.patch(
        URL,
        { kind: "json", ops: [{ op: "replace", path: "/a", value: 2 }] },
        { ifMatch: tag },
      ),
    ).toEqual({ url: URL, etag: '"patched"', created: false, etagSource: "response" });
    expect(calls[0]?.body).toBe('[{"op":"replace","path":"/a","value":2}]');
    expect(calls[0]?.headers.get("content-type")).toBe("application/json-patch+json");
    expect(calls[0]?.headers.get("if-match")).toBe(tag);
    await storage.patch(URL, raw, { ifMatch: tag });
    expect(calls[1]?.headers.get("content-type")).toBe("text/plain");
    expect(calls[1]?.body).toBe("update");
  });
  test.each([
    null,
    [null],
    [{ op: "unknown", path: "" }],
    [{ op: "add", path: 3 }],
  ])("malformed JSON patch %j rejected", async (ops) => {
    const { storage, fetch } = backend();
    await expect(
      storage.patch(URL, { kind: "json", ops } as Patch, { ifMatch: tag }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
  test("invalid kinds, empty RDF and raw body types rejected", async () => {
    const { storage, fetch } = backend();
    for (const patch of [{ kind: "other" }, rdf([], []), { ...raw, body: 1 }])
      await expect(storage.patch(URL, patch as Patch, { ifMatch: tag })).rejects.toBeInstanceOf(
        TypeError,
      );
    expect(fetch).not.toHaveBeenCalled();
  });
  test("RMW uses the read ETag and preserves unrelated triples", async () => {
    const { storage, calls } = backend();
    await storage.patch(URL, rdf([added], [old]), { ifMatch: tag });
    expect(calls.map(({ method }) => method)).toEqual(["GET", "PUT"]);
    expect(calls[1]?.headers.get("if-match")).toBe(tag);
    const store = new Store(new Parser().parse(calls[1]?.body as string));
    expect(store.has(old)).toBe(false);
    expect(store.has(added)).toBe(true);
  });
  test.each([
    { type: "text/turtle", retry: false },
    { type: "text/turtle", retry: true },
    { type: "application/trig", retry: false },
    { type: "application/trig", retry: true },
  ])("RMW keeps insertion blank nodes distinct in $type (retry: $retry)", async ({
    type,
    retry,
  }) => {
    const graphs = type === "application/trig";
    const first = blankNode("insert0");
    const second = blankNode("insert1");
    const graph = blankNode("insert2");
    const inserts = [
      quad(first, nn("urn:new"), literal("first")),
      quad(first, nn("urn:ref"), second),
      quad(second, nn("urn:ref"), first),
      ...(graphs
        ? [
            quad(first, nn("urn:graph-ref"), graph),
            quad(second, nn("urn:new"), literal("graph"), graph),
          ]
        : []),
    ];
    let reads = 0;
    let minted = 0;
    let writes = 0;
    const { storage, calls } = backend({
      [`GET ${URL}`]: () => {
        // On retry the resource occupies the labels allocated to the first PUT's insertions.
        minted = reads ? (graphs ? 3 : 2) : 0;
        return {
          status: 200,
          headers: { "content-type": type, etag: reads++ ? '"concurrent"' : tag },
          body:
            '[] <urn:stored> "subject". <urn:anchor> <urn:stored-ref> [].' +
            (graphs ? '[] { <urn:stored> <urn:p> "graph". }' : ""),
        };
      },
      [`PUT ${URL}`]: () => reply(retry && writes++ === 0 ? 412 : 204, { etag: '"final"' }),
    });
    // Simulate independent RDF factories issuing identifiers already used by the patch.
    const factory = vi
      .spyOn(DataFactory, "blankNode")
      .mockImplementation((value) => blankNode(value || `insert${minted++}`));
    try {
      await storage.patch(URL, rdf(inserts), { ifMatch: tag });
    } finally {
      factory.mockRestore();
    }
    const puts = calls.filter(({ method }) => method === "PUT");
    expect(puts).toHaveLength(retry ? 2 : 1);
    expect(puts.map(({ headers }) => headers.get("if-match"))).toEqual(
      retry ? [tag, '"concurrent"'] : [tag],
    );
    for (const put of puts) {
      const actual = new Store(new Parser({ format: type }).parse(put.body as string));
      expect(actual.size).toBe((graphs ? 3 : 2) + inserts.length);
      const stored = actual.getQuads(null, nn("urn:stored"), literal("subject"), null)[0]?.subject;
      const storedObject = actual.getQuads(nn("urn:anchor"), nn("urn:stored-ref"), null, null)[0]
        ?.object;
      const inserted = actual.getQuads(null, nn("urn:new"), literal("first"), null)[0]?.subject;
      const linked = actual.getQuads(inserted, nn("urn:ref"), null, null)[0]?.object;
      const originals: (Term | undefined)[] = [stored, storedObject];
      const insertedNodes: (Term | undefined)[] = [inserted, linked];
      expect(inserted?.equals(linked)).toBe(false);
      expect(actual.countQuads(linked, nn("urn:ref"), inserted, null)).toBe(1);
      if (graphs) {
        const storedGraph = actual.getQuads(
          nn("urn:stored"),
          nn("urn:p"),
          literal("graph"),
          null,
        )[0]?.graph;
        const insertedGraph = actual.getQuads(linked, nn("urn:new"), literal("graph"), null)[0]
          ?.graph;
        originals.push(storedGraph);
        insertedNodes.push(insertedGraph);
        expect(actual.countQuads(inserted, nn("urn:graph-ref"), insertedGraph, null)).toBe(1);
      }
      for (const node of insertedNodes) {
        expect(node?.termType).toBe("BlankNode");
        for (const original of originals) {
          expect(original?.termType).toBe("BlankNode");
          expect(node?.equals(original)).toBe(false);
        }
      }
    }
    expect(inserts[0]?.subject.value).toBe("insert0");
    expect(inserts[1]?.object.value).toBe("insert1");
  });
  test.each([
    "text/turtle",
    "application/n-triples",
    "application/trig",
    "application/n-quads",
  ])("RMW accepts native %s and preserves its media type on retry", async (type) => {
    const contentType = `${type}; charset=utf-8`;
    const kept = quad(nn("urn:keep"), nn("urn:p"), literal("untouched"));
    const concurrent = quad(nn("urn:other"), nn("urn:p"), literal("concurrent"));
    let reads = 0;
    let writes = 0;
    const { storage, calls } = backend({
      [`GET ${URL}`]: (call) =>
        nativeRdfReply(
          call,
          contentType,
          '<urn:s> <urn:p> "old". <urn:keep> <urn:p> "untouched".' +
            (reads ? '<urn:other> <urn:p> "concurrent".' : ""),
          reads++ ? '"concurrent"' : tag,
        ),
      [`PUT ${URL}`]: () => reply(writes++ ? 204 : 412, { etag: '"final"' }),
    });
    expect((await storage.patch(URL, rdf([added], [old]), { ifMatch: tag })).etag).toBe('"final"');
    expect(calls.map(({ method }) => method)).toEqual(["GET", "PUT", "GET", "PUT"]);
    for (const call of calls.filter(({ method }) => method === "GET"))
      expect(call.headers.get("accept")).toBe("*/*");
    const puts = calls.filter(({ method }) => method === "PUT");
    expect(puts.map(({ headers }) => headers.get("if-match"))).toEqual([tag, '"concurrent"']);
    for (const [i, call] of puts.entries()) {
      expect(call.headers.get("content-type")).toBe(contentType);
      const actual = new Store(new Parser({ format: type }).parse(call.body as string));
      expect(actual.size).toBe(i ? 3 : 2);
      expect(actual.has(old)).toBe(false);
      expect(actual.has(added)).toBe(true);
      expect(actual.has(kept)).toBe(true);
      expect(actual.has(concurrent)).toBe(i === 1);
    }
  });
  test.each([false, true])("RMW rereads once after 412; repeated conflict %s", async (repeated) => {
    let reads = 0,
      writes = 0;
    const concurrent = quad(nn("urn:other"), nn("urn:p"), literal("concurrent"));
    const { storage, calls } = backend({
      [`GET ${URL}`]: () => ({
        status: 200,
        headers: { "content-type": "text/turtle", etag: reads++ ? '"concurrent"' : tag },
        body: `<urn:s> <urn:p> "old".${reads > 1 ? '<urn:other> <urn:p> "concurrent".' : ""}`,
      }),
      [`PUT ${URL}`]: () => reply(writes++ === 0 || repeated ? 412 : 204, { etag: '"final"' }),
    });
    const promise = storage.patch(URL, rdf([added], [old]), { ifMatch: tag });
    if (repeated) await rejects(promise, "precondition-failed");
    else expect((await promise).etag).toBe('"final"');
    expect(reads).toBe(2);
    expect(writes).toBe(2);
    const puts = calls.filter(({ method }) => method === "PUT");
    expect(puts[1]?.headers.get("if-match")).toBe('"concurrent"');
    expect(new Store(new Parser().parse(puts[1]?.body as string)).has(concurrent)).toBe(true);
  });
  test("stale caller ETag fails before the first RMW write", async () => {
    const { storage, calls } = backend();
    const error = await rejects(
      storage.patch(URL, rdf(), { ifMatch: '"stale"' }),
      "precondition-failed",
    );
    expect(error.etag).toBe(tag);
    expect(mutationCalls(calls)).toHaveLength(0);
  });
  test("RMW errors propagate without retries", async () => {
    const { storage, calls } = backend({ [`PUT ${URL}`]: reply(500) });
    await rejects(storage.patch(URL, rdf(), { ifMatch: tag }), "server");
    expect(calls).toHaveLength(2);
    await rejects(backend().storage.patch(URL, rdf([], [added]), { ifMatch: tag }), "conflict");
    await rejects(
      backend().storage.patch(URL, rdf([], [quad(blankNode("x"), nn("urn:p"), literal("old"))]), {
        ifMatch: tag,
      }),
      "bad-request",
    );
    await rejects(
      backend().storage.patch(
        URL,
        rdf([quad(nn("urn:s"), nn("urn:p"), literal("x"), nn("urn:g"))]),
        { ifMatch: tag },
      ),
      "bad-request",
    );
    await rejects(
      backend({
        [`GET ${URL}`]: {
          status: 200,
          headers: { etag: tag, "content-type": "application/ld+json" },
          body: "[]",
        },
      }).storage.patch(URL, rdf(), { ifMatch: tag }),
      "unsupported",
    );
  });
  test("RMW rejects missing retry ETag", async () => {
    let count = 0;
    const { storage } = backend({
      [`GET ${URL}`]: () => ({
        status: 200,
        headers: { "content-type": "text/turtle", ...(count++ ? {} : { etag: tag }) },
        body: "",
      }),
      [`PUT ${URL}`]: reply(412),
    });
    await rejects(storage.patch(URL, rdf(), { ifMatch: tag }), "invalid-response");
  });
  test.each([
    rdf([quad(variable("s"), nn("urn:p"), literal("x"))]),
    { ...rdf(), where: [old] },
    { ...rdf(), where: [quad(variable("s"), nn("urn:p"), literal("x"))] },
  ])("variables and where reject before any fetch, even with SPARQL advertised", async (patch) => {
    const { storage, fetch } = backend({}, (features) => {
      features.patch.detail.formats = { "text/turtle": ["application/sparql-update"] };
    });
    await rejects(storage.patch(URL, patch as Patch, { ifMatch: tag }), "unsupported");
    expect(fetch).not.toHaveBeenCalled();
  });
  test("malformed RDF terms cannot reach the server", async () => {
    const { storage, fetch } = backend();
    await rejects(
      storage.patch(
        URL,
        rdf([
          {
            predicate: added.predicate,
            object: added.object,
            graph: added.graph,
            subject: { termType: "NamedNode", value: 3 },
          } as unknown as Quad,
        ]),
        { ifMatch: tag },
      ),
      "bad-request",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each([
    { inserts: [added] },
    { inserts: [] as Quad[] },
  ])("SPARQL selection checks actual resource Content-Type", async ({ inserts }) => {
    const { storage, calls } = backend({}, (features) => {
      features.patch.detail.formats = { "text/turtle": ["application/sparql-update"] };
    });
    await storage.patch(URL, rdf(inserts, [old]), { ifMatch: tag });
    expect(calls.map(({ method }) => method)).toEqual(["HEAD", "PATCH"]);
    expect(calls[1]?.headers.get("content-type")).toBe("application/sparql-update");
    expect(calls[1]?.body).toBe(
      `DELETE DATA {\n<urn:s> <urn:p> "old" .\n}${inserts.length ? ';\nINSERT DATA {\n<urn:s> <urn:p> "new" .\n}' : ""}`,
    );
    expect(calls[1]?.headers.get("if-match")).toBe(tag);
  });
  test("insert-only SPARQL and unmatched/missing advertised media types", async () => {
    const configure = (features: Features) => {
      features.patch.detail.formats = { "text/turtle": ["application/sparql-update"] };
    };
    const native = backend({}, configure);
    await native.storage.patch(URL, rdf(), { ifMatch: tag });
    expect(native.calls[1]?.body).toBe('INSERT DATA {\n<urn:s> <urn:p> "new" .\n}');
    for (const headers of [{ "content-type": "application/n-triples" }, {}]) {
      const fallback = backend({ [`HEAD ${URL}`]: reply(200, headers) }, configure);
      await fallback.storage.patch(URL, rdf(), { ifMatch: tag });
      expect(fallback.calls.map(({ method }) => method)).toEqual(["HEAD", "GET", "PUT"]);
    }
  });
  test.each([
    {
      contentType: "application/trig",
      body: '<urn:s> <urn:p> "old". <urn:g> { <urn:s> <urn:p> "old". } <urn:other> { <urn:s> <urn:p> "keep". }',
    },
    {
      contentType: "application/n-quads",
      body: '<urn:s> <urn:p> "old".\n<urn:s> <urn:p> "old" <urn:g>.\n<urn:s> <urn:p> "keep" <urn:other>.',
    },
  ])("named-graph patches use RMW with SPARQL advertised for $contentType", async ({
    contentType,
    body,
  }) => {
    const namedOld = quad(old.subject, old.predicate, old.object, nn("urn:g"));
    const namedAdded = quad(added.subject, added.predicate, added.object, nn("urn:g"));
    for (const patch of [
      rdf([namedAdded]),
      rdf([], [namedOld]),
      rdf([added, namedAdded], [old, namedOld]),
    ]) {
      const { storage, calls } = backend(
        {
          [`HEAD ${URL}`]: reply(200, { "content-type": contentType, etag: tag }),
          [`GET ${URL}`]: (call) => nativeRdfReply(call, contentType, body),
        },
        (features) => {
          features.patch.detail.formats = { [contentType]: ["application/sparql-update"] };
        },
      );
      expect(await storage.patch(URL, patch, { ifMatch: tag })).toEqual({
        url: URL,
        etag: '"written"',
        created: false,
        etagSource: "response",
      });
      expect(calls.map(({ method }) => method)).toEqual(["GET", "PUT"]);
      expect(calls[1]?.headers.get("if-match")).toBe(tag);
      expect(calls[1]?.headers.get("content-type")).toBe(contentType);
      const expected = new Store(new Parser({ format: contentType }).parse(body));
      if (patch.kind !== "rdf") throw new Error("Expected an RDF patch");
      expected.removeQuads([...patch.deletes]);
      expected.addQuads([...patch.inserts]);
      const actual = new Store(new Parser({ format: contentType }).parse(calls[1]?.body as string));
      expect(actual.size).toBe(expected.size);
      for (const quad of expected) expect(actual.has(quad)).toBe(true);
    }
  });
  test("named graphs remain invalid for a triple-only format advertising SPARQL", async () => {
    const { storage, calls } = backend({}, (features) => {
      features.patch.detail.formats = { "text/turtle": ["application/sparql-update"] };
    });
    await rejects(
      storage.patch(URL, rdf([quad(nn("urn:s"), nn("urn:p"), literal("x"), nn("urn:g"))]), {
        ifMatch: tag,
      }),
      "bad-request",
    );
    expect(calls.map(({ method }) => method)).toEqual(["GET"]);
  });
});

describe("linkset metadata JSON Patch generation", () => {
  test("add relation and remove target have stable bytes; server fields stay intact", async () => {
    const { storage, calls } = backend();
    expect(
      await storage.setMetadata(
        URL,
        [
          { op: "add", rel: "related", href: "urn:new" },
          { op: "add", rel: "license", href: "urn:license" },
          { op: "remove", rel: "related", href: "urn:old" },
        ],
        { ifMatch: mtag },
      ),
    ).toEqual({ etag: '"updated-metadata"' });
    const call = calls.at(-1);
    expect(call?.body).toBe(
      '[{"op":"add","path":"/linkset/0/related/-","value":{"href":"urn:new"}},{"op":"add","path":"/linkset/0/license","value":[]},{"op":"add","path":"/linkset/0/license/-","value":{"href":"urn:license"}},{"op":"remove","path":"/linkset/0/related/0"}]',
    );
    expect(call?.headers.get("if-match")).toBe(mtag);
    const before = JSON.parse(lwsWriteExchanges[`GET ${META}`]?.body ?? "");
    const after = applyJsonPatch(before, JSON.parse(call?.body as string)) as typeof before;
    expect(after.linkset[0].up).toEqual(before.linkset[0].up);
    expect(after.linkset[0].related).toEqual([{ href: "urn:new" }]);
    expect(after.linkset[0].license).toEqual([{ href: "urn:license" }]);
  });
  test("relative anchors/hrefs resolve; duplicates remove descending and no-op changes avoid PATCH", async () => {
    const raw = linkset({
      anchor: "write.ttl",
      related: [{ href: "../same", title: "keep" }, { href: "../same" }, { href: "urn:other" }],
    });
    const { storage, calls } = backend({ [`GET ${META}`]: json(raw) });
    await storage.setMetadata(URL, [{ op: "remove", rel: "related", href: `${ROOT}same` }], {
      ifMatch: mtag,
    });
    expect(calls.at(-1)?.body).toBe(
      '[{"op":"remove","path":"/linkset/0/related/1"},{"op":"remove","path":"/linkset/0/related/0"}]',
    );
    const noop = backend();
    expect(
      await noop.storage.setMetadata(
        URL,
        [
          { op: "add", rel: "related", href: "urn:old" },
          { op: "remove", rel: "absent", href: "urn:none" },
          { op: "remove", rel: "related", href: "urn:none" },
          { op: "remove", anchor: `${ROOT}absent`, rel: "related", href: "urn:none" },
        ],
        { ifMatch: mtag },
      ),
    ).toEqual({ etag: mtag });
    expect(mutationCalls(noop.calls)).toHaveLength(0);
    await noop.storage.setMetadata(URL, [], { ifMatch: mtag });
  });
  test("new anchors and IRI relation keys use escaped pointers, preserving hostile keys as data", async () => {
    const { storage, calls } = backend();
    await storage.setMetadata(
      URL,
      [
        { op: "add", anchor: `${URL}#part`, rel: "https://vocab.example/a~b", href: "urn:x" },
        { op: "add", rel: "constructor", href: "urn:y" },
        { op: "add", rel: "Related", href: "urn:new" },
      ],
      { ifMatch: mtag },
    );
    const ops = JSON.parse(calls.at(-1)?.body as string);
    expect(ops).toEqual([
      { op: "add", path: "/linkset/-", value: { anchor: `${URL}#part` } },
      { op: "add", path: "/linkset/1/https:~1~1vocab.example~1a~0b", value: [] },
      { op: "add", path: "/linkset/1/https:~1~1vocab.example~1a~0b/-", value: { href: "urn:x" } },
      { op: "add", path: "/linkset/0/constructor", value: [] },
      { op: "add", path: "/linkset/0/constructor/-", value: { href: "urn:y" } },
      { op: "add", path: "/linkset/0/related/-", value: { href: "urn:new" } },
    ]);
  });
  test.each([
    "type",
    "up",
    "linkset",
    "UP",
  ])("server-managed relation %s refuses before read even with MoveResource", async (rel) => {
    const { storage, fetch } = backend({}, move);
    await rejects(
      storage.setMetadata(URL, [{ op: "add", rel, href: ROOT }], { ifMatch: mtag }),
      "unsupported",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  test.each([
    { op: "replace", rel: "related", href: "urn:x" },
    { op: "add", rel: "", href: "urn:x" },
    { op: "add", rel: "related", href: "not-absolute" },
    { op: "add", rel: "related", href: 3 },
    { op: "add", rel: "anchor", href: "urn:x" },
  ])("invalid metadata operation %j rejects before read", async (op) => {
    const { storage, fetch } = backend();
    await expect(
      storage.setMetadata(URL, [op as MetadataOp], { ifMatch: mtag }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
  test("foreign anchors, stale metadata ETags, unsupported metadata and 405 are explicit", async () => {
    await rejects(
      backend().storage.setMetadata(
        URL,
        [{ op: "add", anchor: "https://evil.example/", rel: "related", href: "urn:x" }],
        { ifMatch: mtag },
      ),
      "scope",
    );
    const stale = backend();
    await rejects(
      stale.storage.setMetadata(URL, [{ op: "add", rel: "related", href: "urn:x" }], {
        ifMatch: tag,
      }),
      "precondition-failed",
    );
    expect(mutationCalls(stale.calls)).toHaveLength(0);
    await rejects(
      backend({ [`HEAD ${URL}`]: reply(200) }).storage.setMetadata(URL, [], { ifMatch: mtag }),
      "unsupported",
    );
    await rejects(
      backend({ [`PATCH ${META}`]: reply(405) }).storage.setMetadata(
        URL,
        [{ op: "add", rel: "related", href: "urn:x" }],
        { ifMatch: mtag },
      ),
      "method-not-allowed",
    );
    const noEtag = backend({ [`PATCH ${META}`]: reply() });
    expect(
      await noEtag.storage.setMetadata(URL, [{ op: "add", rel: "related", href: "urn:x" }], {
        ifMatch: mtag,
      }),
    ).toEqual({ etag: '"observed-metadata"' });
  });
});

describe("MoveResource linkset mutation", () => {
  test("move accepts a slashless destination without changing its identifier", async () => {
    const destination = `${ROOT}opaque-container`;
    const { storage, calls } = backend({}, move);
    expect(await storage.move(URL, destination, { ifMatch: tag })).toEqual({
      url: URL,
      etag: tag,
      created: false,
    });
    const patch = calls.find(({ method }) => method === "PATCH");
    expect(JSON.parse(patch?.body as string)).toEqual([
      { op: "test", path: "/linkset/0/anchor", value: URL },
      { op: "replace", path: "/linkset/0/up/0/href", value: destination },
    ]);
    expect(patch?.headers.get("if-match")).toBe(mtag);
  });
  test("the server validates a slashless move destination's kind", async () => {
    const { storage, calls } = backend({ [`PATCH ${META}`]: reply(422) }, move);
    await rejects(storage.move(URL, `${ROOT}opaque-resource`, { ifMatch: tag }), "bad-request");
    expect(mutationCalls(calls).map(({ method, url }) => `${method} ${url}`)).toEqual([
      `PATCH ${META}`,
    ]);
  });
  test("move sends test+replace with linkset ETag and ignores name hint", async () => {
    const { storage, calls } = backend({}, move);
    expect(await storage.move(URL, ROOT, { ifMatch: tag, name: "ignored" })).toEqual({
      url: URL,
      etag: tag,
      created: false,
    });
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `HEAD ${URL}`,
      `GET ${META}`,
      `PATCH ${META}`,
      `HEAD ${URL}`,
    ]);
    const patch = calls[2];
    expect(patch?.body).toBe(
      `[{"op":"test","path":"/linkset/0/anchor","value":"${URL}"},{"op":"replace","path":"/linkset/0/up/0/href","value":"${ROOT}"}]`,
    );
    expect(patch?.headers.get("if-match")).toBe(mtag);
    expect(patch?.headers.get("content-type")).toBe("application/json-patch+json");
    expect(patch?.headers.get("accept")).toBe("application/linkset+json");
  });
  test("relative raw anchor is tested verbatim at its actual context index", async () => {
    const { storage, calls } = backend(
      {
        [`GET ${META}`]: json({
          linkset: [{ anchor: "urn:foreign" }, { anchor: "write.ttl", up: [{ href: "./" }] }],
        }),
      },
      move,
    );
    // LWS read contract requires HTTP(S) anchors even when they are only data.
    await rejects(storage.move(URL, ROOT, { ifMatch: tag }), "invalid-response");
    expect(mutationCalls(calls)).toHaveLength(0);
    const valid = backend(
      {
        [`GET ${META}`]: json({
          linkset: [
            { anchor: "https://elsewhere.example/" },
            { anchor: "write.ttl", up: [{ href: "./" }] },
          ],
        }),
      },
      move,
    );
    await valid.storage.move(URL, ROOT, { ifMatch: tag });
    expect(valid.calls[2]?.body).toBe(
      `[{"op":"test","path":"/linkset/1/anchor","value":"write.ttl"},{"op":"replace","path":"/linkset/1/up/0/href","value":"${ROOT}"}]`,
    );
  });
  test("move negotiates JSON when the server defaults to a text linkset", async () => {
    const moved = `${ROOT}moved`;
    const headers = { "content-location": `${moved}.meta` };
    const { storage, calls } = backend(
      {
        [`PATCH ${META}`]: (call) =>
          call.headers.get("accept") === "application/linkset+json"
            ? json(
                linkset({ anchor: moved, up: [{ href: ROOT }], linkset: [{ href: "moved.meta" }] }),
                headers,
              )
            : {
                status: 200,
                headers: { ...headers, "content-type": "application/linkset" },
                body: `<${ROOT}>; rel="up"; anchor="${moved}", <${moved}.meta>; rel="linkset"; anchor="${moved}"`,
              },
        [`HEAD ${moved}`]: reply(200, { etag: '"moved-content"' }),
      },
      (features) => {
        move(features);
        features.move.detail.preservesIdentifier = false;
      },
    );
    expect(await storage.move(URL, ROOT, { ifMatch: tag })).toEqual({
      url: moved,
      etag: '"moved-content"',
      created: true,
    });
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `HEAD ${URL}`,
      `GET ${META}`,
      `PATCH ${META}`,
      `HEAD ${moved}`,
    ]);
  });
  test("identifier-changing move resolves anchor against new linkset Content-Location, then HEADs resource", async () => {
    const moved = `${ROOT}opaque/new-id`;
    const { storage, calls } = backend(
      {
        [`PATCH ${META}`]: json(
          {
            linkset: [
              { anchor: "new-id", up: [{ href: ROOT }], linkset: [{ href: "new-id.meta" }] },
            ],
          },
          { "content-location": "../opaque/new-id.meta", etag: '"linkset-only"' },
        ),
        [`HEAD ${moved}`]: reply(200, { etag: '"new-content"' }),
      },
      (features) => {
        move(features);
        features.move.detail.preservesIdentifier = false;
      },
    );
    expect(await storage.move(URL, ROOT, { ifMatch: tag })).toEqual({
      url: moved,
      etag: '"new-content"',
      created: true,
    });
    expect(calls.at(-1)?.url).toBe(moved);
    expect(calls.some(({ url }) => url === `${moved}.meta`)).toBe(false);
  });
  test("Content-Location is honored when preservation is unknown; HEAD failure after move yields null", async () => {
    const { storage } = backend(
      {
        [`PATCH ${META}`]: json(
          linkset({
            anchor: `${ROOT}moved`,
            up: [{ href: ROOT }],
            linkset: [{ href: `${ROOT}moved.meta` }],
          }),
          { "content-location": `${ROOT}moved.meta` },
        ),
        [`HEAD ${ROOT}moved`]: reply(503),
      },
      (features) => {
        move(features);
        features.move.detail.preservesIdentifier = null;
      },
    );
    expect(await storage.move(URL, ROOT, { ifMatch: tag })).toEqual({
      url: `${ROOT}moved`,
      etag: null,
      created: true,
    });
  });
  test.each([0, 1])("returned context order is independent of source index %i", async (index) => {
    const moved = `${ROOT}opaque/new-id`;
    const delivered = `${moved}.meta`;
    const other = { anchor: `${ROOT}unrelated`, up: [{ href: ROOT }] };
    const before = [other];
    before.splice(index, 0, linkset().linkset[0] as typeof other);
    const after = [
      { ...other, linkset: [{ href: `${ROOT}unrelated.meta` }] },
      // Same linkset, different destination: this auxiliary context is not the moved resource.
      { anchor: `${ROOT}auxiliary`, up: [{ href: NOTES }], linkset: [{ href: delivered }] },
    ];
    after.splice(1 - index, 0, {
      anchor: "new-id",
      up: [{ href: "../" }],
      linkset: [{ href: "new-id.meta" }],
    });
    const { storage, calls } = backend(
      {
        [`GET ${META}`]: json({ linkset: before }),
        [`PATCH ${META}`]: json({ linkset: after }, { "content-location": delivered }),
        [`HEAD ${moved}`]: reply(200, { etag: '"moved-content"' }),
        [`HEAD ${ROOT}unrelated`]: reply(200, { etag: '"unrelated-content"' }),
      },
      (features) => {
        move(features);
        features.move.detail.preservesIdentifier = false;
      },
    );
    expect(await storage.move(URL, ROOT, { ifMatch: tag })).toEqual({
      url: moved,
      etag: '"moved-content"',
      created: true,
    });
    expect(calls[2]?.body).toContain(`/linkset/${index}/up/0/href`);
    expect(calls.slice(3).map(({ method, url }) => `${method} ${url}`)).toEqual([`HEAD ${moved}`]);
  });
  test.each([
    {},
    { up: [{ href: ROOT }] },
    { linkset: [{ href: "new.meta" }] },
    { up: [], linkset: [{ href: "new.meta" }] },
    { up: [{ href: ROOT }], linkset: [] },
    { up: [{ href: NOTES }], linkset: [{ href: "new.meta" }] },
    { up: [{ href: ROOT }], linkset: [{ href: "other.meta" }] },
    { up: [{ href: ROOT }, { href: NOTES }], linkset: [{ href: "new.meta" }] },
    { up: [{ href: ROOT }], linkset: [{ href: "new.meta" }, { href: "other.meta" }] },
  ])("missing or conflicting moved identity relations reject: %j", async (relations) => {
    const { storage, calls } = backend(
      {
        [`PATCH ${META}`]: json(
          { linkset: [{ anchor: `${ROOT}unrelated`, ...relations }] },
          { "content-location": `${ROOT}new.meta` },
        ),
      },
      move,
    );
    await rejects(storage.move(URL, ROOT, { ifMatch: tag }), "invalid-response");
    expect(calls).toHaveLength(3);
  });
  test.each([false, true])("ambiguous returned anchors reject (same anchor: %s)", async (same) => {
    const context = {
      anchor: `${ROOT}moved`,
      up: [{ href: ROOT }],
      linkset: [{ href: "new.meta" }],
    };
    const { storage, calls } = backend(
      {
        [`PATCH ${META}`]: json(
          { linkset: [context, { ...context, anchor: same ? context.anchor : `${ROOT}other` }] },
          { "content-location": `${ROOT}new.meta` },
        ),
      },
      move,
    );
    await rejects(storage.move(URL, ROOT, { ifMatch: tag }), "invalid-response");
    expect(calls).toHaveLength(3);
  });
  test.each([
    undefined,
    "",
    "https://user:secret@evil.example/meta",
    "new.meta?",
    "http://[",
  ])("invalid move Content-Location %s never gets fetched", async (location) => {
    const { storage, calls } = backend(
      {
        [`PATCH ${META}`]: json(
          linkset(),
          location === undefined ? {} : { "content-location": location },
        ),
      },
      (features) => {
        move(features);
        features.move.detail.preservesIdentifier = false;
      },
    );
    const error = await rejects(storage.move(URL, ROOT, { ifMatch: tag }), "invalid-response");
    expect(error.cause).toBeUndefined();
    expect(error.message).not.toContain("secret");
    expect(calls).toHaveLength(3);
  });
  test.each([
    { contexts: [] },
    { contexts: [{ anchor: ROOT }] },
    { contexts: [{ anchor: "https://user:secret@evil.example/x" }] },
    { contexts: [{ anchor: `${ROOT}moved?` }] },
  ])("invalid returned anchors reject: %j", async ({ contexts }) => {
    const { storage, calls } = backend(
      {
        [`PATCH ${META}`]: json(
          {
            linkset: contexts.map((context) => ({
              ...context,
              up: [{ href: ROOT }],
              linkset: [{ href: "new.meta" }],
            })),
          },
          { "content-location": `${ROOT}new.meta` },
        ),
      },
      move,
    );
    const error = await rejects(storage.move(URL, ROOT, { ifMatch: tag }), "invalid-response");
    expect(error.cause).toBeUndefined();
    expect(error.message).not.toContain("secret");
    expect(calls).toHaveLength(3);
  });
  test.each([
    { linkset: [] },
    linkset({ up: [] }),
    linkset({ up: [{ href: ROOT }, { href: NOTES }] }),
    {
      linkset: [
        { anchor: URL },
        { anchor: URL, up: [{ href: ROOT }] },
        { anchor: URL, up: [{ href: ROOT }] },
      ],
    },
    linkset({ anchor: `${ROOT}different` }),
  ])("ambiguous/missing resource parent refuses before patch: %j", async (raw) => {
    const { storage, calls } = backend({ [`GET ${META}`]: json(raw) }, move);
    await rejects(storage.move(URL, ROOT, { ifMatch: tag }), "invalid-response");
    expect(mutationCalls(calls)).toHaveLength(0);
  });
  test("feature, root, self, stale source, missing linkset ETag, and container restrictions", async () => {
    const unavailable = backend();
    await rejects(unavailable.storage.move(URL, ROOT, { ifMatch: tag }), "unsupported");
    expect(unavailable.fetch).not.toHaveBeenCalled();
    await rejects(
      backend({}, move).storage.move(ROOT, NOTES, { ifMatch: tag }),
      "method-not-allowed",
    );
    for (const source of [NOTES, URL]) {
      const self = backend({}, move);
      await rejects(self.storage.move(source, source, { ifMatch: tag }), "conflict");
      expect(self.calls).toHaveLength(0);
    }
    await rejects(
      backend({}, move).storage.move(URL, ROOT, { ifMatch: '"stale"' }),
      "precondition-failed",
    );
    await rejects(
      backend({ [`GET ${META}`]: json(linkset(), { etag: "*" }) }, move).storage.move(URL, ROOT, {
        ifMatch: tag,
      }),
      "invalid-response",
    );
    const container = backend(
      {
        [`HEAD ${NOTES}`]: reply(200, {
          etag: tag,
          link: '<https://www.w3.org/ns/lws#Container>; rel="type"',
        }),
      },
      (features) => {
        move(features);
        features.move.detail.containers = false;
      },
    );
    await rejects(container.storage.move(NOTES, ROOT, { ifMatch: tag }), "unsupported");
    const allowed = backend(
      {
        [`HEAD ${NOTES}`]: reply(200, {
          etag: tag,
          link: `<https://www.w3.org/ns/lws#Container>; rel="type", <${META}>; rel="linkset"`,
        }),
        [`GET ${META}`]: json(linkset({ anchor: NOTES })),
      },
      move,
    );
    expect((await allowed.storage.move(NOTES, ROOT, { ifMatch: tag })).url).toBe(NOTES);
  });
  test("move abort propagates between metadata requests", async () => {
    const controller = new AbortController();
    const { storage, calls } = backend(
      {
        [`GET ${META}`]: () => {
          controller.abort();
          return json(linkset());
        },
      },
      move,
    );
    await rejects(storage.move(URL, ROOT, { ifMatch: tag, signal: controller.signal }), "network");
    expect(mutationCalls(calls)).toHaveLength(0);
  });
});

const CHILD = `${ROOT}logical-child`;
const NEST = `${ROOT}elsewhere/`;
const LEAF = `${ROOT}leaf`;
function headReply(kind = "resource", parent = NOTES, etag = tag): Reply {
  return reply(200, {
    etag,
    link: `<${parent}>; rel="up", <https://www.w3.org/ns/lws#${kind === "container" ? "Container" : "DataResource"}>; rel="type"`,
  });
}
function listReply(ids: string[]): Reply {
  return {
    status: 200,
    headers: { "content-type": "application/lws+json" },
    body: JSON.stringify({ type: "Container", items: ids.map((id) => ({ id })) }),
  };
}
function treeBackend(
  extra: Record<string, Exchange> = {},
  configure?: (features: Features) => void,
) {
  return backend(
    {
      [`HEAD ${NOTES}`]: headReply("container", ROOT),
      [`GET ${NOTES}`]: listReply([CHILD, NEST]),
      [`HEAD ${CHILD}`]: headReply(),
      [`HEAD ${NEST}`]: headReply("container"),
      [`GET ${NEST}`]: listReply([LEAF]),
      [`HEAD ${LEAF}`]: headReply("resource", NEST),
      [`DELETE ${LEAF}`]: reply(),
      [`DELETE ${CHILD}`]: reply(),
      [`DELETE ${NEST}`]: reply(),
      [`DELETE ${NOTES}`]: reply(),
      ...extra,
    },
    configure,
  );
}

describe("LWS conditional delete", () => {
  test("recursive deletion traverses an empty opaque container after HEAD confirms its kind", async () => {
    const container = `${ROOT}opaque-container`;
    const { storage, calls } = backend({
      [`HEAD ${container}`]: headReply("container", ROOT),
      [`GET ${container}`]: listReply([]),
      [`DELETE ${container}`]: reply(),
    });
    await storage.delete(container, { ifMatch: tag, recursive: true });
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `HEAD ${container}`,
      `GET ${container}`,
      `DELETE ${container}`,
    ]);
    expect(calls.at(-1)?.headers.get("if-match")).toBe(tag);
  });
  test.each([
    { nested: false, kind: "resource" },
    { nested: false, kind: "container" },
    { nested: true, kind: "resource" },
    { nested: true, kind: "container" },
  ])("empty container retains its preflight ETag after replacement: %j", async ({
    nested,
    kind,
  }) => {
    const container = nested ? NEST : NOTES;
    const parent = nested ? NOTES : ROOT;
    const replacementTag = '"replacement"';
    let replaced = false;
    let replacementDeleted = false;
    const { storage, calls } = treeBackend({
      [`GET ${NOTES}`]: listReply([NEST]),
      [`HEAD ${container}`]: () =>
        headReply(replaced ? kind : "container", parent, replaced ? replacementTag : tag),
      [`GET ${container}`]: () => {
        replaced = true;
        return listReply([]);
      },
      [`DELETE ${container}`]: ({ headers }) => {
        if (headers.get("if-match") !== replacementTag) return reply(412, { etag: replacementTag });
        replacementDeleted = true;
        return reply();
      },
    });
    const error = await rejects(
      storage.delete(NOTES, { ifMatch: tag, recursive: true }),
      "precondition-failed",
    );
    expect(error.etag).toBe(replacementTag);
    expect(replacementDeleted).toBe(false);
    expect(mutationCalls(calls).map(({ url }) => url)).toEqual([container]);
    expect(calls.filter(({ method, url }) => method === "HEAD" && url === container)).toHaveLength(
      1,
    );
    expect(calls.at(-1)?.headers.get("if-match")).toBe(tag);
  });
  test.each([
    "kind",
    "parent",
    "linkset",
  ])("refresh after child deletion rejects a changed container %s", async (changed) => {
    const original = headReply("container", ROOT);
    original.headers = {
      ...original.headers,
      link: `${original.headers?.link}, <${META}>; rel="linkset"`,
    };
    const replacement = headReply(
      changed === "kind" ? "resource" : "container",
      changed === "parent" ? NEST : ROOT,
      '"replacement"',
    );
    replacement.headers = {
      ...replacement.headers,
      link: `${replacement.headers?.link}, <${changed === "linkset" ? `${ROOT}new-linkset` : META}>; rel="linkset"`,
    };
    let childDeleted = false;
    const { storage, calls } = treeBackend({
      [`HEAD ${NOTES}`]: () => (childDeleted ? replacement : original),
      [`GET ${NOTES}`]: listReply([CHILD]),
      [`DELETE ${CHILD}`]: () => {
        childDeleted = true;
        return reply();
      },
    });
    await rejects(storage.delete(NOTES, { ifMatch: tag, recursive: true }), "invalid-response");
    expect(childDeleted).toBe(true);
    expect(mutationCalls(calls).map(({ url }) => url)).toEqual([CHILD]);
  });
  test("refresh after child deletion still requires an ETag", async () => {
    let heads = 0;
    const { storage, calls } = treeBackend({
      [`GET ${NOTES}`]: listReply([CHILD]),
      [`HEAD ${NOTES}`]: () => {
        const response = headReply("container", ROOT);
        if (heads++ && response.headers) delete response.headers.etag;
        return response;
      },
    });
    await rejects(storage.delete(NOTES, { ifMatch: tag, recursive: true }), "invalid-response");
    expect(mutationCalls(calls).map(({ url }) => url)).toEqual([CHILD]);
  });
  test("recursive deletion paginates opaque containers and follows nested logical containment", async () => {
    const container = `${ROOT}opaque-container`;
    const nested = `${ROOT}unrelated-path/nested-container`;
    const cursor = `${ROOT}pages?opaque=a%2fb&cursor=2`;
    let heads = 0;
    const { storage, calls } = backend({
      [`HEAD ${container}`]: () => headReply("container", ROOT, heads++ ? '"refreshed"' : tag),
      [`GET ${container}`]: {
        ...listReply([nested]),
        headers: { "content-type": "application/lws+json", link: `<${cursor}>; rel="next"` },
      },
      [`GET ${cursor}`]: listReply([CHILD]),
      [`HEAD ${nested}`]: headReply("container", container),
      [`GET ${nested}`]: listReply([LEAF]),
      [`HEAD ${CHILD}`]: headReply("resource", container),
      [`HEAD ${LEAF}`]: headReply("resource", nested),
      [`DELETE ${LEAF}`]: reply(),
      [`DELETE ${CHILD}`]: reply(),
      [`DELETE ${nested}`]: reply(),
      [`DELETE ${container}`]: reply(),
    });
    await storage.delete(container, { ifMatch: tag, recursive: true });
    expect(calls.filter(({ method }) => method === "GET").map(({ url }) => url)).toEqual([
      container,
      cursor,
      nested,
    ]);
    const deletes = mutationCalls(calls);
    expect(deletes.map(({ url }) => url)).toEqual([LEAF, CHILD, nested, container]);
    expect(deletes.map(({ headers }) => headers.get("if-match"))).toEqual([
      tag,
      tag,
      tag,
      '"refreshed"',
    ]);
    expect(calls.findIndex(({ method }) => method === "DELETE")).toBeGreaterThan(
      calls.findIndex(({ method, url }) => method === "HEAD" && url === LEAF),
    );
  });
  test.each([
    {
      listing: json(
        { type: "DataResource", items: [] },
        { "content-type": "application/lws+json" },
      ),
      code: "invalid-response",
    },
    { listing: reply(302, { location: "https://evil.example/" }), code: "invalid-response" },
    {
      listing: {
        ...listReply([]),
        headers: {
          "content-type": "application/lws+json",
          link: '<https://evil.example/>; rel="https://www.w3.org/ns/lws#storage"',
        },
      },
      code: "scope",
    },
  ])("opaque container listing still validates response: $code", async ({ listing, code }) => {
    const container = `${ROOT}opaque-container`;
    const { storage, calls } = backend({
      [`HEAD ${container}`]: headReply("container", ROOT),
      [`GET ${container}`]: listing,
    });
    await rejects(storage.delete(container, { ifMatch: tag, recursive: true }), code);
    expect(calls.map(({ method }) => method)).toEqual(["HEAD", "GET"]);
  });
  test("opaque container traversal rejects children with a different logical parent", async () => {
    const container = `${ROOT}opaque-container`;
    const { storage, calls } = backend({
      [`HEAD ${container}`]: headReply("container", ROOT),
      [`GET ${container}`]: listReply([CHILD]),
      [`HEAD ${CHILD}`]: headReply("resource", ROOT),
    });
    await rejects(storage.delete(container, { ifMatch: tag, recursive: true }), "invalid-response");
    expect(mutationCalls(calls)).toHaveLength(0);
    expect(calls.at(-1)?.url).toBe(CHILD);
  });
  test("opaque container traversal checks the source ETag before listing", async () => {
    const container = `${ROOT}opaque-container`;
    const { storage, calls } = backend({ [`HEAD ${container}`]: headReply("container", ROOT) });
    await rejects(
      storage.delete(container, { ifMatch: '"stale"', recursive: true }),
      "precondition-failed",
    );
    expect(calls.map(({ method }) => method)).toEqual(["HEAD"]);
  });
  test("nonrecursive fixture DELETE sends If-Match without Depth", async () => {
    const { storage, calls } = backend();
    await storage.delete(URL, { ifMatch: tag });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get("if-match")).toBe(tag);
    expect(calls[0]?.headers.has("depth")).toBe(false);
  });
  test("RecursiveDeleteService advertisement still traverses a nonempty container", async () => {
    let childDeleted = false;
    const { storage, calls } = treeBackend(
      {
        [`GET ${NOTES}`]: listReply([CHILD]),
        [`DELETE ${CHILD}`]: () => {
          childDeleted = true;
          return reply();
        },
        [`DELETE ${NOTES}`]: () => reply(childDeleted ? 204 : 409),
      },
      (features) => {
        features.recursiveDelete.state = "available";
        features.recursiveDelete.evidence = `lws-cid:RecursiveDeleteService:${ROOT}delete-service`;
      },
    );
    await storage.delete(NOTES, { ifMatch: tag, recursive: true });
    expect(calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `HEAD ${NOTES}`,
      `GET ${NOTES}`,
      `HEAD ${CHILD}`,
      `DELETE ${CHILD}`,
      `HEAD ${NOTES}`,
      `DELETE ${NOTES}`,
    ]);
    for (const call of mutationCalls(calls)) {
      expect(call.headers.get("if-match")).toBe(tag);
      expect(call.headers.has("depth")).toBe(false);
    }
  });
  test("fallback preflights logical containment and deletes children before containers with refreshed ETags", async () => {
    let parentHeads = 0;
    const { storage, calls } = treeBackend({
      [`HEAD ${NOTES}`]: () =>
        headReply("container", ROOT, parentHeads++ ? '"after-children"' : tag),
    });
    await storage.delete(NOTES, { ifMatch: tag, recursive: true });
    const deletes = calls.filter(({ method }) => method === "DELETE");
    expect(deletes.map(({ url }) => url)).toEqual([LEAF, NEST, CHILD, NOTES]);
    expect(deletes.at(-1)?.headers.get("if-match")).toBe('"after-children"');
    for (const call of deletes) {
      expect(call.headers.has("if-match")).toBe(true);
      expect(call.headers.has("depth")).toBe(false);
    }
    const firstDelete = calls.findIndex(({ method }) => method === "DELETE");
    expect(calls.findIndex(({ url, method }) => url === LEAF && method === "HEAD")).toBeLessThan(
      firstDelete,
    );
  });
  test.each([
    headReply(),
    reply(200, { etag: tag }),
  ])("recursive resource delete needs no listing: %j", async (head) => {
    const { storage, calls } = backend({ [`HEAD ${URL}`]: head });
    await storage.delete(URL, { ifMatch: tag, recursive: true });
    expect(calls.map(({ method }) => method)).toEqual(["HEAD", "DELETE"]);
  });
  test("stale top ETag and unavailable child ETags prevent every delete", async () => {
    const stale = treeBackend();
    await rejects(
      stale.storage.delete(NOTES, { ifMatch: '"stale"', recursive: true }),
      "precondition-failed",
    );
    expect(mutationCalls(stale.calls)).toHaveLength(0);
    const missing = treeBackend({
      [`HEAD ${CHILD}`]: reply(200, { link: `<${NOTES}>; rel="up"` }),
    });
    await rejects(
      missing.storage.delete(NOTES, { ifMatch: tag, recursive: true }),
      "invalid-response",
    );
    expect(mutationCalls(missing.calls)).toHaveLength(0);
  });
  test.each([ROOT, NOTES])("root or containment cycle %s refuses before deleting", async (id) => {
    const { storage, calls } = treeBackend({ [`GET ${NOTES}`]: listReply([id]) });
    await rejects(storage.delete(NOTES, { ifMatch: tag, recursive: true }), "invalid-response");
    expect(mutationCalls(calls)).toHaveLength(0);
  });
  test("foreign-parent membership fails closed", async () => {
    const { storage, calls } = treeBackend({ [`HEAD ${CHILD}`]: headReply("resource", ROOT) });
    await rejects(storage.delete(NOTES, { ifMatch: tag, recursive: true }), "invalid-response");
    expect(mutationCalls(calls)).toHaveLength(0);
  });
  test("root deletion and invalid recursive option refuse without requests; 409 and 412 propagate", async () => {
    const { storage, fetch } = backend();
    await rejects(storage.delete(ROOT, { ifMatch: tag }), "method-not-allowed");
    await expect(
      storage.delete(URL, { ifMatch: tag, recursive: "yes" as never }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(fetch).not.toHaveBeenCalled();
    await rejects(
      backend({ [`DELETE ${URL}`]: reply(409) }).storage.delete(URL, { ifMatch: tag }),
      "conflict",
    );
    await rejects(
      treeBackend({ [`DELETE ${LEAF}`]: reply(412) }).storage.delete(NOTES, {
        ifMatch: tag,
        recursive: true,
      }),
      "precondition-failed",
    );
  });
});

// Malformed RDF positions are rejected using rebuilt RDF/JS fields, before any HTTP request.
test.each([
  "subject",
  "predicate",
  "object",
  "graph",
] as const)("reject invalid RDF %s position", async (position) => {
  const q = {
    subject: added.subject,
    predicate: added.predicate,
    object: added.object,
    graph: added.graph,
    [position]: position === "object" ? DataFactory.defaultGraph() : literal("invalid"),
  } as unknown as Quad;
  const { storage, fetch } = backend();
  await rejects(storage.patch(URL, rdf([q]), { ifMatch: tag }), "bad-request");
  expect(fetch).not.toHaveBeenCalled();
});

test("recursive traversal refuses more than 10000 nodes before any delete", async () => {
  const ids = Array.from({ length: 10000 }, (_, i) => `${ROOT}child-${i}`);
  const { storage, calls } = treeBackend({
    [`GET ${NOTES}`]: listReply(ids),
    ...Object.fromEntries(ids.map((id) => [`HEAD ${id}`, headReply()])),
  });
  await rejects(storage.delete(NOTES, { ifMatch: tag, recursive: true }), "invalid-response");
  expect(mutationCalls(calls)).toHaveLength(0);
}, 15000);

test("metadata changes span repeated anchor contexts without dropping attributes", async () => {
  const raw = {
    linkset: [
      { anchor: URL, related: [{ href: "urn:old", title: "first" }] },
      {
        anchor: URL,
        related: [
          { href: "urn:old", title: "second" },
          { href: "urn:keep", title: "retained" },
        ],
      },
      { anchor: URL, other: [] },
    ],
  };
  const { storage, calls } = backend({ [`GET ${META}`]: json(raw) });
  await storage.setMetadata(
    URL,
    [
      { op: "add", rel: "related", href: "urn:keep" },
      { op: "remove", rel: "related", href: "urn:old" },
    ],
    { ifMatch: mtag },
  );
  expect(calls.at(-1)?.body).toBe(
    '[{"op":"remove","path":"/linkset/0/related/0"},{"op":"remove","path":"/linkset/1/related/0"}]',
  );
  const after = applyJsonPatch(raw, JSON.parse(calls.at(-1)?.body as string)) as typeof raw;
  expect(after.linkset[1]?.related).toEqual([{ href: "urn:keep", title: "retained" }]);
  expect(raw.linkset[0]?.related).toHaveLength(1);
});

test("PUT never infers a container kind from a non-root identifier's trailing slash", async () => {
  const { storage, calls } = backend({ [`PUT ${NOTES}`]: reply(204, { etag: tag }) });
  expect((await storage.write(NOTES, "content", options)).etag).toBe(tag);
  expect(calls[0]?.method).toBe("PUT");
});
