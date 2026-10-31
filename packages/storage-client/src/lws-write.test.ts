// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad } from "@jeswr/fetch-rdf";
import type { Features } from "@jeswr/storage-capabilities";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, test, vi } from "vitest";
import { StorageError } from "./errors.js";
import {
  lwsWriteExchanges,
  LWS_CONTAINER as NOTES,
  LWS_ROOT as ROOT,
  LWS_WRITE_RESOURCE as URL,
} from "./fixtures/lws.js";
import { createLwsBackend } from "./lws.js";
import type { CreateOptions, Patch, WriteOptions } from "./types.js";

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
function _json(value: unknown, headers: Record<string, string> = {}): Reply {
  return {
    status: 200,
    headers: { "content-type": "application/linkset+json", etag: mtag, ...headers },
    body: JSON.stringify(value),
  };
}
const _linkset = (context: Record<string, unknown> = {}) => ({
  linkset: [{ anchor: URL, up: [{ href: NOTES }], ...context }],
});
const _move = (features: Features) => {
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
    ).toEqual({ url: `${ROOT}opaque-id`, etag: '"created"', created: true });
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
  test("containers refuse content PUT; container arguments require slash", async () => {
    const { storage, fetch } = backend();
    await rejects(storage.write(NOTES, "", options), "method-not-allowed");
    await rejects(storage.create(URL, ""), "bad-request");

    expect(fetch).not.toHaveBeenCalled();
  });
  test.each(["?", "#", "?x=1"])("mutation URLs refuse query/fragment %s", async (suffix) => {
    const { storage, fetch } = backend();
    for (const promise of [
      storage.write(URL + suffix, "", options),
      storage.create(NOTES + suffix, null),
      storage.patch(URL + suffix, raw, { ifMatch: tag }),
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
    ).toEqual({ url: URL, etag: '"patched"', created: false });
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

test("remaining LWS mutations stay unsupported pending the next implementation step", async () => {
  const { storage, fetch } = backend();
  for (const promise of [
    storage.move(URL, ROOT),
    storage.delete(URL),
    storage.setMetadata(URL, [], { ifMatch: mtag }),
  ])
    await rejects(promise, "unsupported");
  expect(fetch).not.toHaveBeenCalled();
});
