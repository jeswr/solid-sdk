// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CSS_ROOT, cssReadExchanges, cssWriteExchanges } from "./fixtures/css.js";
import {
  LWS_CONTAINER,
  LWS_ROOT,
  LWS_WRITE_RESOURCE,
  lwsReadExchanges,
  lwsWriteExchanges,
} from "./fixtures/lws.js";
import { createLwsBackend } from "./lws.js";
import { createSolidBackend } from "./solid.js";
import {
  createRecordingFetch,
  createReplayFetch,
  type HttpFixture,
  loadFixtures,
} from "./testing.js";

const URL = "https://pod.example/data";
const encode = (value: string | Uint8Array) => Buffer.from(value).toString("base64");
const directories: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "sst-8xm.41-fixtures-"));
  directories.push(path);
  return path;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
function fixture(): HttpFixture {
  return {
    version: 1,
    request: { method: "GET", url: URL, headers: [], body: null },
    response: {
      url: URL,
      status: 200,
      statusText: "OK",
      headers: [],
      body: encode("response"),
      redirected: false,
    },
  };
}

describe("fixture recording", () => {
  test.each([undefined, "0", "true"])("does nothing when RECORD=%s", async (record) => {
    vi.stubEnv("RECORD", record);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("pass-through"));
    const dir = join(await directory(), "untouched");
    const wrapped = createRecordingFetch({ fetch, directory: dir });
    expect(wrapped).toBe(fetch);
    expect(await (await wrapped(URL)).text()).toBe("pass-through");
    await expect(readdir(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("redacts both directions, retaining request options and live response headers/body", async () => {
    vi.stubEnv("RECORD", "1");
    const dir = join(await directory(), "scenario");
    const privateHeaders = {
      Authorization: "authorization-sentinel",
      DPoP: "dpop-sentinel",
      "Set-Cookie": "set-cookie-sentinel",
      Cookie: "cookie-sentinel",
      "Proxy-Authorization": "proxy-sentinel",
    };
    const bytes = new Uint8Array([0, 255, 128, 10, 13]);
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(input).toBeInstanceOf(Request);
      const req = input as Request;
      expect(req.method).toBe("PUT");
      expect(req.redirect).toBe("manual");
      expect(req.credentials).toBe("include");
      expect(req.cache).toBe("no-store");
      expect(req.signal.aborted).toBe(false);
      expect(req.headers.get("authorization")).toBe(privateHeaders.Authorization);
      expect(req.headers.get("dpop")).toBe(privateHeaders.DPoP);
      expect(await req.text()).toBe("request π");
      const response = new Response(bytes, {
        status: 201,
        statusText: "Created",
        headers: { ...privateHeaders, ETag: '"created"' },
      });
      Object.defineProperties(response, {
        url: { value: `${URL}?final` },
        redirected: { value: true },
      });
      return response;
    });
    const record = createRecordingFetch({ fetch, directory: dir });
    const response = await record(new globalThis.URL(URL), {
      method: "put",
      body: "request π",
      headers: { ...privateHeaders, "Content-Type": "text/plain", "If-Match": '"old"' },
      redirect: "manual",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    expect(response.headers.get("set-cookie")).toBe(privateHeaders["Set-Cookie"]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    const json = await readFile(join(dir, "000001.json"), "utf8");
    for (const secret of Object.values(privateHeaders)) expect(json).not.toContain(secret);
    const [saved] = await loadFixtures(dir);
    expect(saved?.request).toEqual({
      method: "PUT",
      url: URL,
      headers: [
        ["content-type", "text/plain"],
        ["if-match", '"old"'],
      ],
      body: encode("request π"),
    });
    expect(saved?.response).toEqual({
      url: `${URL}?final`,
      status: 201,
      statusText: "Created",
      headers: [["etag", '"created"']],
      body: encode(bytes),
      redirected: true,
    });
    const replay = createReplayFetch(await loadFixtures(dir));
    const replayed = await replay(URL, {
      method: "PUT",
      body: "request π",
      headers: {
        "Content-Type": "text/plain",
        "If-Match": '"old"',
        Authorization: "different-token",
      },
    });
    expect(replayed.url).toBe(response.url);
    expect(replayed.redirected).toBe(true);
    expect(replayed.statusText).toBe("Created");
    expect(new Uint8Array(await replayed.arrayBuffer())).toEqual(bytes);
    expect(replayed.headers.has("set-cookie")).toBe(false);
    replay.assertDone();
  });

  test("Request input and init overrides are captured without consuming the original", async () => {
    vi.stubEnv("RECORD", "1");
    const dir = await directory();
    const original = new Request(URL, {
      method: "POST",
      body: "original",
      headers: { "x-original": "yes" },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const req = input as Request;
      expect(req.method).toBe("PATCH");
      expect(req.headers.has("x-original")).toBe(false);
      expect(req.headers.get("x-override")).toBe("yes");
      expect(await req.text()).toBe("override");
      return new Response(null, { status: 204 });
    });
    const record = createRecordingFetch({ fetch, directory: dir });
    await record(original, { method: "PATCH", body: "override", headers: { "x-override": "yes" } });
    expect(original.bodyUsed).toBe(false);
    expect(await original.text()).toBe("original");
    const [saved] = await loadFixtures(dir);
    expect(saved?.request.body).toBe(encode("override"));
    expect(saved?.response).toMatchObject({ body: null, url: URL });
    const replay = createReplayFetch(await loadFixtures(dir));
    await replay(
      new Request(URL, { method: "PATCH", body: "override", headers: { "x-override": "yes" } }),
    );
    replay.assertDone();
  });

  test("streams are forwarded intact and binary bytes round-trip", async () => {
    vi.stubEnv("RECORD", "1");
    const bytes = new Uint8Array([0, 128, 255, 1]);
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      expect(new Uint8Array(await (input as Request).arrayBuffer())).toEqual(bytes);
      return new Response(new Uint8Array());
    });
    const dir = await directory();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(bytes);
        c.close();
      },
    });
    await createRecordingFetch({ fetch, directory: dir })(URL, {
      method: "PUT",
      body,
      duplex: "half",
    } as RequestInit);
    const fixtures = await loadFixtures(dir);
    expect(fixtures[0]?.request.body).toBe(encode(bytes));
    expect(fixtures[0]?.response.body).toBe("");
    const replay = createReplayFetch(fixtures);
    const response = await replay(URL, { method: "PUT", body: bytes });
    expect(response.body).not.toBeNull();
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    replay.assertDone();
  });

  test("keeps invocation order when responses complete out of order and never overwrites", async () => {
    vi.stubEnv("RECORD", "1");
    const dir = await directory();
    let resolve!: (response: Response) => void;
    const slow = new Promise<Response>((r) => {
      resolve = r;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      (input as Request).url === URL ? slow : new Response(null, { status: 304 }),
    );
    const record = createRecordingFetch({ fetch, directory: dir });
    const first = record(URL);
    await record(`${URL}?second`, { method: "HEAD" });
    resolve(new Response("first"));
    await first;
    expect((await loadFixtures(dir)).map((f) => f.request.url)).toEqual([URL, `${URL}?second`]);
    const before = await readFile(join(dir, "000001.json"), "utf8");
    await expect(
      createRecordingFetch({ fetch, directory: dir })(`${URL}?collision`),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(dir, "000001.json"), "utf8")).toBe(before);
  });

  test("does not record transport or failed body reads", async () => {
    vi.stubEnv("RECORD", "1");
    const dir = await directory();
    const fail = new Error("synthetic transport failure");
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw fail;
    });
    await expect(createRecordingFetch({ fetch, directory: dir })(URL)).rejects.toBe(fail);
    const response = new Response(
      new ReadableStream({
        start(c) {
          c.error(fail);
        },
      }),
    );
    const broken = vi.fn<typeof globalThis.fetch>(async () => response);
    await expect(
      createRecordingFetch({ fetch: broken, directory: dir })(URL),
    ).rejects.toMatchObject({ code: "network", cause: fail });
    expect(await readdir(dir)).toEqual([]);
  });

  test("aborts before fetch, including when a buffered request body triggers an abort", async () => {
    vi.stubEnv("RECORD", "1");
    const dir = await directory();
    const controller = new AbortController();
    const fetch = vi.fn();
    controller.abort();
    await expect(
      createRecordingFetch({ fetch, directory: dir })(URL, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const active = new AbortController();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1]));
        c.close();
        active.abort();
      },
    });
    await expect(
      createRecordingFetch({ fetch, directory: dir })(URL, {
        method: "PUT",
        body,
        signal: active.signal,
      } as RequestInit),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

test("interrupts stalled bodies during recording and replay", async () => {
  vi.stubEnv("RECORD", "1");
  const dir = await directory();
  for (const mode of ["record", "replay"]) {
    const active = new AbortController();
    const started = Promise.withResolvers<void>();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        source = controller;
      },
      pull() {
        started.resolve();
      },
    });
    const fetch = vi.fn();
    const entry = fixture();
    entry.request.method = "PUT";
    entry.request.body = "";
    const wrapped =
      mode === "record"
        ? createRecordingFetch({ fetch, directory: dir })
        : createReplayFetch([entry]);
    const pending = wrapped(URL, {
      method: "PUT",
      body: stream,
      signal: active.signal,
    } as RequestInit);
    await started.promise;
    active.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
    if (mode === "record") source.close();
  }
  expect(await readdir(dir)).toEqual([]);
});

describe("strict offline replay", () => {
  test.each([
    "url",
    "method",
    "headers",
    "body",
  ])("rejects a %s mismatch without consuming or exposing request data", async (field) => {
    const entry = fixture();
    const replay = createReplayFetch([entry]);
    const headers = { "x-private-input": "do-not-echo-this-value" };
    const wrong: RequestInit =
      field === "method"
        ? { method: "HEAD" }
        : field === "headers"
          ? { headers }
          : field === "body"
            ? { method: "POST", body: "do-not-echo-this-value" }
            : {};
    const error = await replay(
      field === "url" ? `${URL}?do-not-echo-this-value` : URL,
      wrong,
    ).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("HTTP fixture request mismatch at exchange 1");
    expect(() => replay.assertDone()).toThrow("unused exchanges");
    const response = await replay(URL);
    expect(response.url).toBe(URL);
    expect(await response.text()).toBe("response");
    replay.assertDone();
    await expect(replay(URL)).rejects.toThrow("exhausted");
  });

  test("matches a changed body with otherwise identical request fields", async () => {
    const entry = fixture();
    entry.request = { ...entry.request, method: "PUT", body: encode(new Uint8Array([0, 1, 255])) };
    const replay = createReplayFetch([entry]);
    await expect(replay(URL, { method: "PUT", body: new Uint8Array([0, 2, 255]) })).rejects.toThrow(
      "mismatch",
    );
    await replay(URL, { method: "PUT", body: new Uint8Array([0, 1, 255]) });
    replay.assertDone();
  });

  test.each([204, 205, 304])("replays bodyless status %i", async (status) => {
    const entry = fixture();
    entry.response.status = status;
    entry.response.body = null;
    const replay = createReplayFetch([entry]);
    expect((await replay(URL)).body).toBeNull();
    replay.assertDone();
  });

  test("snapshots fixtures, redacts hand-authored headers, and serialises concurrent calls", async () => {
    const first = fixture();
    first.request.headers = [["Authorization", "ignored"]];
    first.response.headers = [
      ["Set-Cookie", "ignored"],
      ["ETag", '"one"'],
    ];
    const second = fixture();
    second.response.body = encode("second");
    const replay = createReplayFetch([first, second]);
    first.response.body = encode("mutated");
    first.response.headers = [];
    const responses = await Promise.all([replay(URL), replay(URL)]);
    expect(await responses[0]?.text()).toBe("response");
    expect(await responses[1]?.text()).toBe("second");
    expect(responses[0]?.headers.get("etag")).toBe('"one"');
    expect(responses[0]?.headers.has("set-cookie")).toBe(false);
    replay.assertDone();
  });

  test("snapshots Request inputs when called, before queued replay starts", async () => {
    const replay = createReplayFetch([fixture()]);
    const input = new Request(URL);
    const pending = replay(input);
    input.headers.set("x-later-edit", "must not affect the pending fetch");
    expect(await (await pending).text()).toBe("response");
    replay.assertDone();
  });

  test("abort does not consume an entry", async () => {
    const replay = createReplayFetch([fixture()]);
    await expect(replay(URL, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
    await replay(URL);
    replay.assertDone();
    createReplayFetch([]).assertDone();
  });
});

const invalidValues: unknown[] = [
  null,
  [],
  {},
  { ...fixture(), version: 2 },
  ...["request", "response"].flatMap((side) =>
    [null, [], "invalid"].map((value) => ({ ...fixture(), [side]: value })),
  ),
  ...[
    ["request", "method", null],
    ["request", "method", "bad method"],
    ["request", "url", null],
    ["request", "url", "invalid"],
    ["request", "url", "file:///tmp/x"],
    ["request", "url", "https://user:password@pod.example/"],
    ["request", "url", "https://:password@pod.example/"],
    ["response", "url", false],
    ["request", "headers", {}],
    ["response", "headers", {}],
    ["request", "headers", [null]],
    ["request", "headers", [["one"]]],
    ["request", "headers", [[1, "two"]]],
    ["request", "headers", [["one", 2]]],
    ["request", "headers", [["bad name", "value"]]],
    ["response", "headers", [["x-name", "bad\nvalue"]]],
    ["request", "body", 123],
    ["request", "body", "!invalid!"],
    ["response", "body", "not base64"],
    ["response", "status", 200.5],
    ["response", "status", 199],
    ["response", "status", 600],
    ["response", "statusText", null],
    ["response", "statusText", "bad\rtext"],
    ["response", "redirected", null],
    ["response", "status", 204],
    ["request", "method", "HEAD"],
    ["request", "method", "head"],
    ["request", "body", encode("invalid GET body")],
  ].map(([side, key, value]) => {
    const entry = fixture();
    return {
      ...entry,
      [side as string]: { ...entry[side as "request" | "response"], [key as string]: value },
    };
  }),
];
describe("fixture loading and validation", () => {
  test.each(
    invalidValues.map((value, index) => ({ index, value })),
  )("rejects malformed fixture $index without echoing data", ({ value }) => {
    expect(() => createReplayFetch([value as HttpFixture])).toThrow(
      new TypeError("Invalid HTTP fixture"),
    );
  });

  test("loads only numbered JSON files, orders numeric filenames and rejects corrupt JSON", async () => {
    const dir = await directory();
    const first = fixture();
    const second = fixture();
    second.response.body = encode("second");
    await Promise.all([
      writeFile(join(dir, "1000000.json"), JSON.stringify(second)),
      writeFile(join(dir, "999999.json"), JSON.stringify(first)),
      writeFile(join(dir, "README.md"), "Ignored"),
      writeFile(join(dir, "other.json"), "Not a fixture"),
    ]);
    expect(await loadFixtures(dir)).toEqual([first, second]);
    await writeFile(join(dir, "000001.json"), "{bad-json");
    await expect(loadFixtures(dir)).rejects.toBeInstanceOf(SyntaxError);
    await writeFile(join(dir, "000001.json"), "{}");
    await expect(loadFixtures(dir)).rejects.toThrow("Invalid HTTP fixture");
  });
});

// T-021–T-024 synthetic exchanges go through the public recorder, persisted JSON and strict
// replayer. These are protocol fixtures, not captures from a deployed server.
describe("backend fixture round-trips", () => {
  test.each([
    "solid",
    "lws",
  ] as const)("replays %s reads and mutations through the public helpers", async (protocol) => {
    vi.stubEnv("RECORD", "1");
    const dir = await directory();
    const solid = protocol === "solid";
    const root = solid ? CSS_ROOT : LWS_ROOT;
    const container = solid ? `${root}notes/` : LWS_CONTAINER;
    const url = solid ? `${container}today.ttl` : `${container}note-0000.ttl`;
    const exchanges = solid
      ? { ...cssReadExchanges, ...cssWriteExchanges }
      : { ...lwsReadExchanges, ...lwsWriteExchanges };
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const req = input as Request;
      const reply = exchanges[`${req.method} ${req.url}`];
      if (!reply) throw new Error("Missing synthetic exchange");
      return new Response(req.method === "HEAD" ? null : (reply.body ?? null), {
        status: reply.status,
        headers: reply.headers,
      });
    });
    const backend = solid ? createSolidBackend : createLwsBackend;
    const run = async (fetch: typeof globalThis.fetch) => {
      const storage = backend({ root, fetch });
      const listed = [];
      for await (const entry of storage.listAll(container)) listed.push(entry.url);
      expect(listed).toHaveLength(solid ? 3 : 1500);
      expect((await storage.head(url)).etag).not.toBeNull();
      expect((await storage.readRdf(url)).dataset.size).toBeGreaterThan(0);
      expect((await storage.metadata(url)).links.size).toBeGreaterThan(0);
      const writeUrl = solid ? url : LWS_WRITE_RESOURCE;
      const etag = solid ? '"1790937000000-text/turtle"' : '"resource"';
      expect(
        (
          await storage.create(container, "new", {
            name: "new note.ttl",
            contentType: "text/plain",
          })
        ).created,
      ).toBe(true);
      const result = await storage.write(writeUrl, "body", {
        ifMatch: etag,
        contentType: "text/plain",
      });
      expect(result.etag).not.toBeNull();
      await storage.patch(
        writeUrl,
        { kind: "raw", mediaType: "text/plain", body: "patch" },
        { ifMatch: etag },
      );
      await storage.delete(writeUrl, { ifMatch: etag });
      if (solid) {
        await expect(
          storage.write(`${container}stale.ttl`, "stale", {
            ifMatch: etag,
            contentType: "text/plain",
          }),
        ).rejects.toMatchObject({ code: "precondition-failed", status: 412 });
        await expect(storage.delete(container, { ifMatch: etag })).rejects.toMatchObject({
          code: "conflict",
          status: 409,
        });
      }
    };
    await run(createRecordingFetch({ fetch, directory: dir }));
    const replay = createReplayFetch(await loadFixtures(dir));
    const networkCalls = fetch.mock.calls.length;
    await run(replay);
    replay.assertDone();
    expect(fetch).toHaveBeenCalledTimes(networkCalls);
  });
});
