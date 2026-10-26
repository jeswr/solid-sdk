// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad } from "@jeswr/fetch-rdf";
import type { Features } from "@jeswr/storage-capabilities";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, test, vi } from "vitest";
import { StorageError } from "./errors.js";
import { cssWriteExchanges, type RecordedResponse, CSS_ROOT as ROOT } from "./fixtures/css.js";
import { serializeQuads } from "./rdf.js";
import { buildN3Patch, createSolidBackend } from "./solid.js";
import type { Body, CreateOptions, MetadataOp, Patch, WriteOptions } from "./types.js";

const NOTES = `${ROOT}notes/`;
const URL = `${NOTES}today.ttl`;
const META = `${URL}.meta`;
const TAG = '"1790937000000-text/turtle"';
const MTAG = '"1790937000001-text/turtle"';
const { namedNode: nn, literal, quad, variable, blankNode, defaultGraph } = DataFactory;
const s = nn("urn:s"),
  p = nn("urn:p");
const q = quad(s, p, literal("new"));
const old = quad(s, p, literal("old"));
const n3 = (
  inserts: readonly Quad[] = [q],
  deletes: readonly Quad[] = [],
  where?: readonly Quad[],
): Extract<Patch, { kind: "rdf" }> => ({
  kind: "rdf",
  inserts,
  deletes,
  ...(where ? { where } : {}),
});
const raw: Patch = { kind: "raw", mediaType: "text/plain", body: "patch" };
const response = (
  status = 205,
  headers: Record<string, string> = { etag: '"new"' },
  body?: string,
): RecordedResponse => ({ status, headers, body });
interface Call {
  method: string;
  url: string;
  headers: Headers;
  body: unknown;
  signal: AbortSignal | null | undefined;
  redirect: string | undefined;
  duplex: unknown;
}
type TestResponse = Omit<RecordedResponse, "body"> & {
  body?: string | ReadableStream<Uint8Array>;
};
type Exchange = TestResponse | ((call: Call) => TestResponse | Promise<TestResponse>);
function backend(
  overrides: Record<string, Exchange> = {},
  options: { etagFollowUp?: boolean; features?: Features } = {},
) {
  const calls: Call[] = [];
  const exchanges: Record<string, Exchange> = { ...cssWriteExchanges, ...overrides };
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: new Headers(init?.headers),
      body: init?.body,
      signal: init?.signal,
      redirect: init?.redirect,
      duplex: (init as { duplex?: unknown })?.duplex,
    };
    calls.push(call);
    const exchange = exchanges[`${call.method} ${call.url}`];
    const recorded =
      typeof exchange === "function" ? await exchange(call) : (exchange ?? response(404, {}));
    // Conditional responses reflect the current resource's recorded read ETag.
    const current = exchanges[`GET ${call.url}`];
    const currentTag = typeof current === "object" ? current.headers.etag : undefined;
    const match = call.headers.get("if-match");
    if (match !== null && currentTag !== undefined && match !== currentTag)
      return new Response(null, { status: 412, headers: { etag: currentTag } });
    return new Response(
      call.method === "HEAD" || recorded.body === undefined
        ? null
        : typeof recorded.body === "string"
          ? new TextEncoder().encode(recorded.body)
          : recorded.body,
      recorded,
    );
  });
  return {
    storage: createSolidBackend({ root: ROOT, fetch, ...options }),
    fetch,
    calls,
    exchanges,
  };
}
async function rejection(promise: Promise<unknown>, code: string) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code });
  return error as StorageError;
}
function withFormats(
  formats: Record<string, string[]>,
  state: "available" | "unknown" | "unavailable" = "available",
): Features {
  const { storage } = backend();
  return { ...storage.features, patch: { state, evidence: "fixture", detail: { formats } } };
}
function writes(storage: ReturnType<typeof createSolidBackend>, url = URL) {
  return [
    () => storage.write(url, "body", { contentType: "text/plain", ifMatch: "*" }),
    () => storage.writeRdf(url, [q], { ifMatch: "*" }),
    () => storage.create(url, "body", { contentType: "text/plain" }),
    () => storage.patch(url, raw, { ifMatch: TAG }),
    () => storage.delete(url, { ifMatch: TAG }),
    () => storage.move(url, NOTES, { ifMatch: TAG }),
    () => storage.setMetadata(url, [], { ifMatch: MTAG }),
  ];
}

describe("CSS write fixtures and HTTP plumbing", () => {
  test("PUT exact headers, weak ETags, wildcard, created and RDF bytes", async () => {
    const { storage, calls } = backend();
    expect(
      await storage.write(URL, "body", {
        contentType: 'text/plain; charset="utf-8"',
        ifMatch: TAG,
      }),
    ).toEqual({ url: URL, created: false, etag: '"updated"' });
    expect(calls[0]).toMatchObject({ method: "PUT", url: URL, body: "body", redirect: "manual" });
    expect(Object.fromEntries(calls[0]?.headers ?? [])).toEqual({
      "content-type": 'text/plain; charset="utf-8"',
      "if-match": TAG,
    });
    await storage.write(URL, "", { contentType: "text/plain", ifMatch: "*" });
    expect(calls[1]?.headers.has("if-match")).toBe(false);
    expect(calls[1]?.headers.has("if-none-match")).toBe(false);
    await storage.writeRdf(URL, [q], { ifMatch: "*" });
    expect(calls[2]?.body).toBe('<urn:s> <urn:p> "new".\n');
    expect(calls[2]?.headers.get("content-type")).toBe("text/turtle");
    await storage.writeRdf(URL, [q], {
      ifMatch: "*",
      contentType: "application/n-triples" as "text/turtle",
    });
    expect(calls[3]?.body).toBe('<urn:s> <urn:p> "new" .\n');
    const weak = backend({ [`GET ${URL}`]: response(200, { etag: 'W/"weak"' }) });
    await weak.storage.write(URL, "x", { ifMatch: 'W/"weak"', contentType: "text/plain" });
    expect(weak.calls[0]?.headers.get("if-match")).toBe('W/"weak"');
  });

  test.each([200, 201, 204, 205])("accepts mutation status %i", async (status) => {
    const { storage } = backend({ [`PUT ${URL}`]: response(status) });
    expect(
      await storage.write(URL, "x", { ifMatch: "*", contentType: "text/plain" }),
    ).toMatchObject({ created: status === 201, etag: '"new"' });
  });
  test.each([
    202, 206, 207, 301, 302, 303, 304, 307, 308,
  ])("refuses status %i without following Location", async (status) => {
    const { storage, calls } = backend({
      [`PUT ${URL}`]: response(status, { location: "https://foreign.example/" }),
    });
    expect(
      await rejection(
        storage.write(URL, "x", { ifMatch: "*", contentType: "text/plain" }),
        "invalid-response",
      ),
    ).toMatchObject({ status });
    expect(calls).toHaveLength(1);
  });
  test.each([
    [400, "bad-request"],
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not-found"],
    [405, "method-not-allowed"],
    [409, "conflict"],
    [410, "not-found"],
    [412, "precondition-failed"],
    [413, "payload-too-large"],
    [415, "unsupported-media-type"],
    [422, "bad-request"],
    [428, "precondition-required"],
    [429, "rate-limited"],
    [500, "server"],
    [502, "server"],
    [503, "server"],
    [507, "insufficient-storage"],
  ] as const)("maps %i to %s", async (status, code) => {
    const { storage } = backend({
      [`PUT ${URL}`]: response(
        status,
        { etag: '"current"', "content-type": "application/problem+json" },
        '{"title":"Fixture failure"}',
      ),
    });
    expect(
      await rejection(storage.write(URL, "x", { ifMatch: "*", contentType: "text/plain" }), code),
    ).toMatchObject({
      status,
      etag: status === 412 ? '"current"' : null,
      problem: { title: "Fixture failure" },
    });
  });
  test("fixture 412 and 409 keep current ETag/status", async () => {
    const { storage } = backend();
    expect(
      await rejection(
        storage.write(URL, "x", { contentType: "text/plain", ifMatch: '"stale"' }),
        "precondition-failed",
      ),
    ).toMatchObject({ status: 412, etag: TAG });
    expect(
      await rejection(
        storage.delete(NOTES, { ifMatch: '"1790850000000-text/turtle"' }),
        "conflict",
      ),
    ).toMatchObject({ status: 409 });
    await rejection(
      storage.write(`${NOTES}stale.ttl`, "x", { contentType: "text/plain", ifMatch: "*" }),
      "precondition-failed",
    );
  });
  test("ETag follow-up succeeds, fails, redirects, aborts, is disabled, or is unnecessary", async () => {
    for (const head of [
      response(200, { etag: '"head"' }),
      response(200, {}),
      response(404, {}),
      response(302, { location: "https://foreign.example/" }),
      () => {
        throw new Error("offline");
      },
    ]) {
      const { storage, calls } = backend({
        [`PUT ${URL}`]: response(205, {}),
        [`HEAD ${URL}`]: head,
      });
      const result = await storage.write(URL, "x", { ifMatch: "*", contentType: "text/plain" });
      expect(result.etag).toBe(typeof head === "object" ? (head.headers.etag ?? null) : null);
      expect(calls).toHaveLength(2);
      expect(calls[1]).toMatchObject({ method: "HEAD", redirect: "manual", url: URL });
    }
    const disabled = backend({ [`PUT ${URL}`]: response(205, {}) }, { etagFollowUp: false });
    expect(
      (await disabled.storage.write(URL, "x", { ifMatch: "*", contentType: "text/plain" })).etag,
    ).toBeNull();
    expect(disabled.calls).toHaveLength(1);
    const c = new AbortController();
    const aborted = backend({
      [`PUT ${URL}`]: () => {
        c.abort();
        return response(205, {});
      },
    });
    expect(
      (
        await aborted.storage.write(URL, "x", {
          ifMatch: "*",
          contentType: "text/plain",
          signal: c.signal,
        })
      ).etag,
    ).toBeNull();
    expect(aborted.calls).toHaveLength(1);
  });
  test("passes every body directly, sets duplex only on streams, and never retries spent bodies", async () => {
    for (const body of [
      "abc",
      new Uint8Array([0, 255]),
      new Blob(["abc"]),
      new Blob(["abc"]).stream(),
    ] satisfies Body[]) {
      const { storage, calls } = backend();
      await storage.write(URL, body, { contentType: "application/octet-stream", ifMatch: "*" });
      expect(calls[0]?.body).toBe(body);
      expect(calls[0]?.duplex).toBe(body instanceof ReadableStream ? "half" : undefined);
      const failing = backend({
        [`PUT ${URL}`]: () => {
          throw new TypeError("transport");
        },
      });
      expect(
        await rejection(
          failing.storage.write(URL, body, { contentType: "text/plain", ifMatch: "*" }),
          "network",
        ),
      ).toMatchObject({ retryable: !(body instanceof ReadableStream) });
    }
    const c = new AbortController();
    const late = backend({
      [`PUT ${URL}`]: () => {
        c.abort();
        throw new Error("aborted");
      },
    });
    expect(
      await rejection(
        late.storage.write(URL, "x", { contentType: "text/plain", ifMatch: "*", signal: c.signal }),
        "network",
      ),
    ).toMatchObject({ retryable: false });
    const before = backend();
    await rejection(
      before.storage.write(URL, "x", { contentType: "text/plain", ifMatch: "*", signal: c.signal }),
      "network",
    );
    expect(before.calls).toHaveLength(0);
  });
  test.each([
    429, 503,
  ])("consumed upload streams cannot retry HTTP %i on write or create", async (status) => {
    for (const operation of ["write", "create-named", "create-unnamed"] as const) {
      const method = operation === "create-unnamed" ? "POST" : "PUT";
      const url = operation === "create-unnamed" ? NOTES : URL;
      const { storage } = backend({
        [`${method} ${url}`]: async (call) => {
          expect(call.body).toBeInstanceOf(ReadableStream);
          expect(await new Response(call.body as ReadableStream).text()).toBe("upload");
          return response(
            status,
            {
              "retry-after": "7",
              "content-type": "application/problem+json",
            },
            '{"title":"Busy"}',
          );
        },
      });
      const body = new Blob(["upload"]).stream();
      const error = await rejection(
        operation === "write"
          ? storage.write(URL, body, { contentType: "text/plain", ifMatch: "*" })
          : storage.create(NOTES, body, {
              contentType: "text/plain",
              ...(operation === "create-named" ? { name: "today.ttl" } : {}),
            }),
        status === 429 ? "rate-limited" : "server",
      );
      expect(error).toMatchObject({
        status,
        method,
        url,
        retryable: false,
        retryAfterMs: 7000,
        problem: { title: "Busy" },
      });
      expect(body.locked).toBe(true);
    }
  });
});

describe("mutation validation before requests", () => {
  test("all targets reject queries/fragments (including empty delimiters) and foreign scope", async () => {
    const { storage, calls } = backend();
    for (const url of [`${URL}?`, `${URL}#`, `${URL}?x`, `${NOTES}#x`, `${ROOT}?`])
      for (const write of writes(storage, url)) await rejection(write(), "bad-request");
    for (const url of [
      "relative",
      "https://foreign.example/x",
      "https://user:secret@css.example/alice/x",
    ])
      for (const write of writes(storage, url)) {
        const error = await rejection(write(), "scope");
        expect(error.message + error.url).not.toContain("secret");
      }
    expect(calls).toHaveLength(0);
  });
  test("strict conditionals and required content types", async () => {
    const { storage, calls } = backend();
    for (const ifMatch of [
      undefined,
      null,
      5,
      "",
      "*",
      " *",
      "*\t",
      "\t*",
      "* ",
      ` ${TAG}`,
      `${TAG}\t`,
      "\v*",
      "*\f",
      "\u00a0*",
      "bad\rheader",
      "bad\nheader",
      "bad\0header",
      "€",
    ]) {
      if (ifMatch !== "*") {
        await expect(
          storage.write(URL, "x", { contentType: "text/plain", ifMatch } as WriteOptions),
        ).rejects.toThrow(TypeError);
        await expect(storage.writeRdf(URL, [q], { ifMatch } as WriteOptions)).rejects.toThrow(
          TypeError,
        );
      }
      await expect(storage.patch(URL, raw, { ifMatch } as { ifMatch: string })).rejects.toThrow(
        TypeError,
      );
      await expect(storage.delete(URL, { ifMatch } as { ifMatch: string })).rejects.toThrow(
        TypeError,
      );
      await expect(storage.move(URL, NOTES, { ifMatch } as { ifMatch: string })).rejects.toThrow(
        TypeError,
      );
      await expect(
        storage.setMetadata(URL, [], { ifMatch } as { ifMatch: string }),
      ).rejects.toThrow(TypeError);
    }
    for (const type of [
      undefined,
      null,
      12,
      "",
      "text",
      "text/plain\rX:y",
      "text/plain\n",
      "text/plain\0",
      "text/€",
      "text/plain; charset",
      'text/plain; x="unterminated',
      "text/plain; x=a b",
      " text/plain",
      "text/plain ",
      "\ttext/plain",
      "text/plain\t",
    ]) {
      await expect(
        storage.write(URL, "x", { contentType: type, ifMatch: "*" } as WriteOptions),
      ).rejects.toThrow(TypeError);
      await expect(
        storage.create(NOTES, "x", { contentType: type } as CreateOptions),
      ).rejects.toThrow(TypeError);
      await expect(
        storage.patch(URL, { kind: "raw", body: "x", mediaType: type } as Patch, { ifMatch: TAG }),
      ).rejects.toThrow(TypeError);
    }
    await rejection(
      storage.write(NOTES, "x", { contentType: "text/plain", ifMatch: "*" }),
      "method-not-allowed",
    );
    await rejection(
      storage.writeRdf(URL, [], { ifMatch: "*", contentType: "application/ld+json" }),
      "unsupported",
    );
    await expect(
      storage.writeRdf(URL, [quad(s, p, s, nn("urn:g"))], { ifMatch: "*" }),
    ).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
  test("RDF write content types reject surrounding whitespace before serialization", async () => {
    const { storage, calls } = backend();
    for (const contentType of [" text/turtle", "text/turtle ", "\ttext/turtle", "text/turtle\t"])
      await expect(
        storage.writeRdf(URL, [q], { ifMatch: "*", contentType: contentType as "text/turtle" }),
      ).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});

describe("create (CSS fixtures)", () => {
  test("named PUT encodes names, protects existing targets, ignores links, and creates empty containers", async () => {
    const { storage, calls } = backend();
    expect(
      await storage.create(NOTES, "body", {
        name: "new note.ttl",
        contentType: "text/turtle",
        links: [{ rel: "type", target: "urn:ignored" }],
      }),
    ).toEqual({ url: `${NOTES}new%20note.ttl`, etag: '"created"', created: true });
    expect(calls[0]?.body).toBe("body");
    expect(Object.fromEntries(calls[0]?.headers ?? [])).toEqual({
      "content-type": "text/turtle",
      "if-none-match": "*",
    });
    await storage.create(NOTES, "ignored", { name: "folder", kind: "container" });
    expect(calls[1]?.body).toBe("");
    expect(Object.fromEntries(calls[1]?.headers ?? [])).toEqual({
      "content-type": "text/turtle",
      "if-none-match": "*",
      link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
    });
    const clash = backend({ [`PUT ${NOTES}taken`]: response(412, { etag: '"taken"' }) });
    expect(
      await rejection(
        clash.storage.create(NOTES, null, { name: "taken", contentType: "text/plain" }),
        "conflict",
      ),
    ).toMatchObject({ status: 412, etag: '"taken"', message: "name taken" });
  });
  test("POST uses random 16-char base32 Slugs, Link types, empty body, and resolves Location", async () => {
    const { storage, calls } = backend();
    expect((await storage.create(NOTES, null, { contentType: "text/plain" })).url).toBe(
      `${NOTES}generated.ttl`,
    );
    expect(calls[0]?.headers.get("slug")).toMatch(/^[a-z2-7]{16}$/);
    expect(calls[0]?.headers.get("link")).toBe('<http://www.w3.org/ns/ldp#Resource>; rel="type"');
    expect(calls[0]?.body).toBe("");
    const folder = backend({
      [`POST ${NOTES}`]: response(201, { location: `${NOTES}generated/`, etag: '"folder"' }),
    });
    await folder.storage.create(NOTES, null, { kind: "container" });
    expect(folder.calls[0]?.headers.get("link")).toBe(
      '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
    );
    expect(folder.calls[0]?.body).toBe("");
    expect(folder.calls[0]?.headers.get("content-type")).toBe("text/turtle");
  });
  test.each([
    undefined,
    "https://evil.example/x",
    "https://user:pass@css.example/alice/notes/x",
    "../x",
    "child/grandchild",
    "file?",
    "file#",
    "file?x",
    "wrong/",
    NOTES,
    "http://[",
  ])("refuses unsafe resource Location %s without fetching it", async (location) => {
    const { storage, calls } = backend({
      [`POST ${NOTES}`]: response(201, location === undefined ? {} : { location }),
    });
    await rejection(storage.create(NOTES, null, { contentType: "text/plain" }), "invalid-response");
    expect(calls).toHaveLength(1);
  });
  test.each([
    "https://user:location-secret@[",
    "https://user:location-secret@evil.example/x",
    "https://user:location-secret@css.example/alice/notes/x",
  ])("Location errors discard credentials and parsing causes: %s", async (location) => {
    const { storage, calls } = backend({
      [`POST ${NOTES}`]: response(201, { location }),
    });
    const error = await rejection(
      storage.create(NOTES, null, { contentType: "text/plain" }),
      "invalid-response",
    );
    expect(error).toMatchObject({ message: "Invalid Location", url: NOTES });
    expect(error.cause).toBeUndefined();
    // Include non-enumerable Error fields and every nested cause in the disclosure check.
    const serialized = JSON.stringify(error, (_key, value) =>
      value instanceof Error ? { ...value, message: value.message, cause: value.cause } : value,
    );
    expect(serialized).not.toContain("location-secret");
    expect(serialized).not.toContain(location);
    expect(calls).toHaveLength(1);
  });
  test("wrong container Location, missing content type and invalid names/kinds", async () => {
    const wrong = backend({ [`POST ${NOTES}`]: response(201, { location: "file" }) });
    await rejection(wrong.storage.create(NOTES, null, { kind: "container" }), "invalid-response");
    const { storage, calls } = backend();
    await rejection(storage.create(URL, null, { kind: "container" }), "bad-request");
    await expect(storage.create(NOTES, null)).rejects.toThrow(TypeError);
    await expect(storage.create(NOTES, null, { kind: "wrong" } as CreateOptions)).rejects.toThrow(
      TypeError,
    );
    await expect(
      storage.create(NOTES, null, { kind: "container", contentType: "invalid" }),
    ).rejects.toThrow(TypeError);
    for (const name of ["", ".", "..", "a/b", "a\0b", "a\nb", "a\u007fb"]) {
      await rejection(storage.create(NOTES, null, { kind: "container", name }), "bad-request");
      await rejection(storage.move(URL, NOTES, { ifMatch: TAG, name }), "bad-request");
    }
    await expect(
      storage.create(NOTES, null, { kind: "container", name: 5 } as unknown as CreateOptions),
    ).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});

describe("N3 Patch exact bytes and formulas", () => {
  test("insert-only is byte-exact", async () => {
    expect(await buildN3Patch(n3())).toBe(
      '@prefix solid: <http://www.w3.org/ns/solid/terms#>.\n_:patch a solid:InsertDeletePatch;\n  solid:inserts {\n<urn:s> <urn:p> "new" .\n};\n.\n',
    );
  });
  test("delete+insert is byte-exact", async () => {
    expect(await buildN3Patch(n3([q], [old]))).toBe(
      '@prefix solid: <http://www.w3.org/ns/solid/terms#>.\n_:patch a solid:InsertDeletePatch;\n  solid:deletes {\n<urn:s> <urn:p> "old" .\n};\n  solid:inserts {\n<urn:s> <urn:p> "new" .\n};\n.\n',
    );
  });
  test("where is byte-exact and every built patch parses with matching formula quads", async () => {
    const bound = quad(variable("subject"), p, variable("value"));
    const input = n3([quad(variable("subject"), p, literal("new"))], [bound], [bound]);
    expect(await buildN3Patch(input)).toBe(
      '@prefix solid: <http://www.w3.org/ns/solid/terms#>.\n_:patch a solid:InsertDeletePatch;\n  solid:where {\n?subject <urn:p> ?value .\n};\n  solid:deletes {\n?subject <urn:p> ?value .\n};\n  solid:inserts {\n?subject <urn:p> "new" .\n};\n.\n',
    );
    for (const patch of [
      n3(),
      n3([], [old]),
      n3([q], [old]),
      input,
      n3([quad(variable("_x1"), p, literal('a\n"b'))], [], [quad(variable("_x1"), p, s)]),
      n3(
        [quad(variable("élève·"), p, literal("oui"))],
        [],
        [quad(variable("élève·"), p, variable("value"))],
      ),
    ]) {
      const parsed = new Store(
        new Parser({ format: "text/n3", blankNodePrefix: "" }).parse(await buildN3Patch(patch)),
      );
      for (const name of ["where", "deletes", "inserts"] as const) {
        const expected = patch[name] ?? [];
        const link = parsed.getQuads(
          null,
          nn(`http://www.w3.org/ns/solid/terms#${name}`),
          null,
          defaultGraph(),
        )[0];
        if (expected.length === 0) expect(link).toBeUndefined();
        else {
          const formula = new Store(
            parsed.getQuads(null, null, null, link?.object).map((q) => {
              const local = (t: typeof q.subject | typeof q.object) =>
                t.termType === "BlankNode" ? blankNode(t.value.slice(q.graph.value.length + 1)) : t;
              return quad(
                local(q.subject) as Quad["subject"],
                q.predicate,
                local(q.object) as Quad["object"],
              );
            }),
          );
          expect(formula.size).toBe(expected.length);
          for (const q of expected) expect(formula.has(q)).toBe(true);
        }
      }
    }
  });
  test("validation rejects named graphs, blank nodes in every formula, unbound/unsafe variables and tags", async () => {
    const { storage, calls } = backend();
    const invalid = [
      n3([quad(s, p, s, nn("urn:g"))]),
      n3([q], [quad(s, p, s, nn("urn:g"))]),
      n3([q], [], [quad(s, p, s, nn("urn:g"))]),
      n3([quad(blankNode("b"), p, s)]),
      n3([quad(s, p, blankNode("b"))]),
      n3([q], [quad(blankNode("b"), p, s)]),
      n3([q], [], [quad(s, p, blankNode("b"))]),
      n3([quad(variable("unbound"), p, s)]),
      n3([], [quad(s, p, variable("unbound"))]),
      n3([q], [], [quad(variable("x } . <urn:evil>"), p, s)]),
      n3([q], [], [quad(variable("x-y"), p, s)]),
      n3([quad(s, p, literal("x", "en; injected"))]),
    ];
    for (const patch of invalid) {
      expect(await rejection(buildN3Patch(patch), "bad-request")).toMatchObject({ status: null });
      expect(
        await rejection(storage.patch(URL, patch, { ifMatch: TAG }), "bad-request"),
      ).toMatchObject({ status: null, url: URL });
    }
    await expect(buildN3Patch(n3([], []))).rejects.toThrow("empty patch");
    await expect(storage.patch(URL, n3([], []), { ifMatch: TAG })).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
  test("escapes IRIs/datatypes/literals and keeps languages", async () => {
    const inserts = [
      quad(s, nn("urn:p> <urn:forged"), literal('"\n} . evil', nn("urn:d>t"))),
      quad(s, p, literal("bonjour", "fr")),
    ];
    const body = await buildN3Patch(n3(inserts));
    expect(body).toBe(await buildN3Patch(n3(inserts)));
    expect(body).toContain("<urn:p%3E%20%3Curn:forged>");
    expect(body).toContain("<urn:d%3Et>");
    const parsed = new Parser({ format: "text/n3" }).parse(body);
    expect(parsed.filter((q) => q.graph.termType !== "DefaultGraph")).toHaveLength(2);
    expect(parsed.filter((q) => q.graph.termType === "DefaultGraph")).toHaveLength(2);
  });
});

describe("patch format selection", () => {
  test("default N3 and advertised N3 take precedence over SPARQL", async () => {
    for (const features of [
      undefined,
      withFormats({ "text/turtle": ["text/n3", "application/sparql-update"] }),
      withFormats({}, "unknown"),
      withFormats({}, "unavailable"),
    ]) {
      const { storage, calls } = backend({}, { features });
      expect((await storage.patch(URL, n3(), { ifMatch: TAG })).etag).toBe('"patched"');
      expect(calls[0]?.headers.get("content-type")).toBe("text/n3");
      expect(calls[0]?.headers.get("if-match")).toBe(TAG);
      expect(calls[0]?.body).toBe(await buildN3Patch(n3()));
    }
  });
  test("SPARQL DATA envelopes are exact, only without where/variables", async () => {
    const features = withFormats({ "text/turtle": ["application/sparql-update"] });
    for (const [patch, expected] of [
      [n3(), 'INSERT DATA {\n<urn:s> <urn:p> "new" .\n}'],
      [n3([], [old]), 'DELETE DATA {\n<urn:s> <urn:p> "old" .\n}'],
      [
        n3([quad(blankNode("safe"), p, literal("new"))]),
        'INSERT DATA {\n_:safe <urn:p> "new" .\n}',
      ],
      [
        n3([q], [old]),
        'DELETE DATA {\n<urn:s> <urn:p> "old" .\n};\nINSERT DATA {\n<urn:s> <urn:p> "new" .\n}',
      ],
    ] as const) {
      const { storage, calls } = backend({}, { features });
      await storage.patch(URL, patch, { ifMatch: TAG });
      expect(calls[0]?.headers.get("content-type")).toBe("application/sparql-update");
      expect(calls[0]?.body).toBe(expected);
    }
    for (const patch of [
      n3([q], [], [q]),
      n3([quad(variable("x"), p, s)], [], [quad(variable("x"), p, s)]),
    ]) {
      const { storage, calls } = backend({}, { features });
      expect(
        await rejection(storage.patch(URL, patch, { ifMatch: TAG }), "unsupported"),
      ).toMatchObject({ feature: "patch" });
      expect(calls).toHaveLength(0);
    }
    const unavailable = backend({}, { features: withFormats({}) });
    await rejection(unavailable.storage.patch(URL, n3(), { ifMatch: TAG }), "unsupported");
  });
  test("SPARQL inserts relabel reserved/unsafe blanks, while deletes and where refuse blanks", async () => {
    const features = withFormats({ "text/turtle": ["application/sparql-update"] });
    const inserts = [
      quad(blankNode("patch"), p, blankNode("unsafe label")),
      quad(blankNode("unsafe label"), p, blankNode("x0")),
    ];
    const { storage, calls } = backend({}, { features });
    for (let i = 0; i < 2; i++) await storage.patch(URL, n3(inserts), { ifMatch: TAG });
    expect(calls[0]?.body).toBe("INSERT DATA {\n_:x1 <urn:p> _:x2 .\n_:x2 <urn:p> _:x0 .\n}");
    expect(calls[1]?.body).toBe(calls[0]?.body);
    for (const patch of [n3([q], inserts), n3([q], [], inserts)])
      expect(
        await rejection(storage.patch(URL, patch, { ifMatch: TAG }), "bad-request"),
      ).toMatchObject({ status: null });
    expect(calls).toHaveLength(2);
    for (const features of [
      undefined,
      withFormats({ "text/turtle": ["text/n3", "application/sparql-update"] }),
    ]) {
      const n3Backend = backend({}, { features });
      await rejection(n3Backend.storage.patch(URL, n3(inserts), { ifMatch: TAG }), "bad-request");
      expect(n3Backend.calls).toHaveLength(0);
    }
  });
  test("JSON support comes from any format entry, raw sends the validated body unchanged", async () => {
    const { storage } = backend();
    expect(
      await rejection(
        storage.patch(URL, { kind: "json", ops: [] }, { ifMatch: TAG }),
        "unsupported",
      ),
    ).toMatchObject({ feature: "patch" });
    const json = backend(
      {},
      { features: withFormats({ "application/json": ["application/json-patch+json"] }) },
    );
    const ops = [{ op: "add" as const, path: "/field", value: "data" }];
    await json.storage.patch(URL, { kind: "json", ops }, { ifMatch: TAG });
    expect(json.calls[0]?.headers.get("content-type")).toBe("application/json-patch+json");
    expect(json.calls[0]?.body).toBe('[{"op":"add","path":"/field","value":"data"}]');
    await json.storage.patch(
      URL,
      { kind: "raw", mediaType: "text/custom; charset=utf-8", body: "raw bytes" },
      { ifMatch: TAG },
    );
    expect(json.calls[1]?.body).toBe("raw bytes");
    expect(json.calls[1]?.headers.get("content-type")).toBe("text/custom; charset=utf-8");
    for (const ops of [
      null,
      {},
      [null],
      [1],
      [{ op: "invalid", path: "/a" }],
      [{ op: "add" }],
      [{ op: "test", path: 1 }],
    ]) {
      await expect(
        json.storage.patch(URL, { kind: "json", ops } as Patch, { ifMatch: TAG }),
      ).rejects.toThrow(TypeError);
    }
  });
});

// Server tree expressed with the same serializer as real RDF; request/response fixtures remain
// synthetic. Conditional source/copy failures are injected by method and URL.
const SRC = `${ROOT}source/`,
  DEST = `${ROOT}dest/`,
  COPY = `${DEST}source/`;
async function treeBackend(
  overrides: Record<string, Exchange> = {},
  options: { etagFollowUp?: boolean } = {},
) {
  const nodes = [SRC, `${SRC}a`, `${SRC}sub/`, `${SRC}sub/b`];
  const exchanges: Record<string, Exchange> = {};
  for (const url of nodes) {
    const folder = url.endsWith("/");
    exchanges[`HEAD ${url}`] = response(200, {
      etag: '"source"',
      "content-type": folder ? "text/turtle" : "text/plain",
    });
    exchanges[`GET ${url}`] = response(
      200,
      { etag: '"source"', "content-type": folder ? "text/turtle" : "text/plain" },
      folder
        ? await serializeQuads(
            nodes
              .filter(
                (u) =>
                  u !== url && new globalThis.URL(u.endsWith("/") ? ".." : ".", u).href === url,
              )
              .map((u) => quad(nn(url), nn("http://www.w3.org/ns/ldp#contains"), nn(u))),
            "text/turtle",
          )
        : `bytes:${url}`,
    );
    exchanges[`DELETE ${url}`] = response();
    const copy = COPY + url.slice(SRC.length);
    exchanges[`PUT ${copy}`] = response(201, { etag: `"copy:${url}"` });
    exchanges[`DELETE ${copy}`] = response();
  }
  exchanges[`HEAD ${COPY}`] = response(200, { etag: '"completed-container"' });
  return backend({ ...exchanges, ...overrides }, options);
}

describe("delete", () => {
  test("non-recursive and recursive resources use the given If-Match", async () => {
    const { storage, calls } = backend();
    await storage.delete(URL, { ifMatch: TAG });
    await storage.delete(URL, { ifMatch: TAG, recursive: true });
    expect(calls.map((c) => [c.method, c.headers.get("if-match")])).toEqual([
      ["DELETE", TAG],
      ["DELETE", TAG],
    ]);
    await rejection(storage.delete(ROOT, { ifMatch: TAG }), "method-not-allowed");
  });
  test("recursive checks the top ETag before deleting; removes descendants before containers, unconditionally", async () => {
    const { storage, calls } = await treeBackend();
    await rejection(
      storage.delete(SRC, { ifMatch: '"stale"', recursive: true }),
      "precondition-failed",
    );
    expect(calls).toHaveLength(1);
    await storage.delete(SRC, { ifMatch: '"source"', recursive: true });
    expect(
      calls.filter((c) => c.method === "DELETE").map((c) => [c.url, c.headers.get("if-match")]),
    ).toEqual([
      [`${SRC}sub/b`, null],
      [`${SRC}sub/`, null],
      [`${SRC}a`, null],
      [SRC, null],
    ]);
  });
  test("concurrent addition surfaces the final 409, and aborts stop between requests", async () => {
    const { storage } = await treeBackend({ [`DELETE ${SRC}`]: response(409, {}) });
    await rejection(storage.delete(SRC, { ifMatch: '"source"', recursive: true }), "conflict");
    const c = new AbortController();
    const aborted = await treeBackend({
      [`DELETE ${SRC}sub/b`]: () => {
        c.abort();
        return response();
      },
    });
    expect(
      await rejection(
        aborted.storage.delete(SRC, { ifMatch: '"source"', recursive: true, signal: c.signal }),
        "network",
      ),
    ).toMatchObject({ retryable: false });
    expect(aborted.calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
  });
});

describe("emulated move", () => {
  test("resources preserve bytes, Content-Type and raw encoded names, then conditionally delete", async () => {
    const src = `${ROOT}%FF.bin`,
      dest = `${DEST}%FF.bin`;
    const { storage, calls } = backend({
      [`GET ${src}`]: response(200, { etag: '"source"', "content-type": "image/png" }, "raw bytes"),
      [`PUT ${dest}`]: response(201, { etag: '"copy"' }),
      [`DELETE ${src}`]: response(),
    });
    expect(await storage.move(src, DEST, { ifMatch: '"source"' })).toEqual({
      url: dest,
      etag: '"copy"',
      created: true,
    });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["GET", src],
      ["PUT", dest],
      ["DELETE", src],
    ]);
    expect(calls[0]?.headers.get("accept")).toBe("*/*");
    expect(calls[1]?.body).toBeInstanceOf(ReadableStream);
    expect(calls[1]?.duplex).toBe("half");
    expect(await new Response(calls[1]?.body as ReadableStream).text()).toBe("raw bytes");
    expect(calls[1]?.headers.get("content-type")).toBe("image/png");
    expect(calls[1]?.headers.get("if-none-match")).toBe("*");
    expect(calls[2]?.headers.get("if-match")).toBe('"source"');
    expect(storage.features.move.detail.native).toBe(false);
  });
  test("validates root, destination, cycles, scope, name and current ETag before writes", async () => {
    const { storage, calls } = backend();
    await rejection(storage.move(ROOT, DEST, { ifMatch: TAG }), "method-not-allowed");
    await rejection(storage.move(SRC, SRC, { ifMatch: TAG }), "conflict");
    await rejection(storage.move(SRC, `${SRC}sub/`, { ifMatch: TAG }), "conflict");
    await rejection(storage.move(URL, URL, { ifMatch: TAG }), "bad-request");
    await rejection(storage.move(URL, `${DEST}?`, { ifMatch: TAG }), "bad-request");
    await rejection(storage.move(URL, "https://foreign.example/", { ifMatch: TAG }), "scope");
    expect(calls).toHaveLength(0);
    expect(
      await rejection(storage.move(URL, DEST, { ifMatch: '"stale"' }), "precondition-failed"),
    ).toMatchObject({ etag: TAG, status: 412 });
    expect(calls).toHaveLength(1);
  });
  test("containers copy breadth-first, delete depth-first and refresh their ETag", async () => {
    const { storage, calls } = await treeBackend();
    expect(await storage.move(SRC, DEST, { ifMatch: '"source"' })).toEqual({
      url: COPY,
      etag: '"completed-container"',
      created: true,
    });
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.url)).toEqual([
      COPY,
      `${COPY}a`,
      `${COPY}sub/`,
      `${COPY}sub/b`,
    ]);
    expect(
      calls.filter((c) => c.method === "DELETE").map((c) => [c.url, c.headers.get("if-match")]),
    ).toEqual([
      [`${SRC}sub/b`, '"source"'],
      [`${SRC}sub/`, null],
      [`${SRC}a`, '"source"'],
      [SRC, null],
    ]);
    expect(calls.at(-1)?.method).toBe("HEAD");
  });
  test("a stale top-container ETag rejects the move before preflight or writes", async () => {
    const { storage, calls } = await treeBackend();
    expect(
      await rejection(storage.move(SRC, DEST, { ifMatch: '"stale"' }), "precondition-failed"),
    ).toMatchObject({ status: 412, etag: '"source"' });
    expect(calls.map((c) => [c.method, c.url])).toEqual([["HEAD", SRC]]);
  });
  test("copy failure rolls back all completed copies, deepest first, and rethrows the original", async () => {
    const { storage, calls } = await treeBackend({ [`PUT ${COPY}sub/b`]: response(403, {}) });
    await rejection(storage.move(SRC, DEST, { ifMatch: '"source"' }), "forbidden");
    expect(
      calls.filter((c) => c.method === "DELETE").map((c) => [c.url, c.headers.get("if-match")]),
    ).toEqual([
      [`${COPY}sub/`, null],
      [`${COPY}a`, `"copy:${SRC}a"`],
      [COPY, null],
    ]);
  });
  test("resource source-delete failure rolls back the copy with its create ETag", async () => {
    const dest = `${DEST}renamed`;
    const { storage, calls } = backend({
      [`PUT ${dest}`]: response(201, { etag: '"copied"' }),
      [`DELETE ${URL}`]: response(412, { etag: '"changed"' }),
      [`DELETE ${dest}`]: response(),
    });
    const error = await rejection(
      storage.move(URL, DEST, { ifMatch: TAG, name: "renamed" }),
      "conflict",
    );
    expect(error.cause).toMatchObject({ code: "precondition-failed", etag: '"changed"' });
    expect(error.message).toBe("Source delete failed; the copy was rolled back");
    expect(calls.at(-2)).toMatchObject({ method: "HEAD", url: URL, signal: undefined });
    expect(calls.at(-1)?.url).toBe(dest);
    expect(calls.at(-1)?.headers.get("if-match")).toBe('"copied"');
  });
  test("source delete failure before any deletion rolls back the entire container copy", async () => {
    const { storage, calls } = await treeBackend({ [`DELETE ${SRC}sub/b`]: response(403, {}) });
    const error = await rejection(storage.move(SRC, DEST, { ifMatch: '"source"' }), "conflict");
    expect(error.cause).toMatchObject({ code: "forbidden" });
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      `${SRC}sub/b`,
      `${COPY}sub/b`,
      `${COPY}sub/`,
      `${COPY}a`,
      COPY,
    ]);
  });
  test("partial source deletion retains deleted resources and ancestors, rolls back only extant sources", async () => {
    const { storage, calls } = await treeBackend({ [`DELETE ${SRC}sub/`]: response(409, {}) });
    const error = await rejection(storage.move(SRC, DEST, { ifMatch: '"source"' }), "conflict");
    expect(error.message).toContain("partial");
    expect(error.cause).toMatchObject({ code: "conflict", status: 409 });
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      `${SRC}sub/b`,
      `${SRC}sub/`,
      `${COPY}a`,
    ]);
  });
  test("partial cleanup retains copies when source HEAD fails or a source is concurrently absent", async () => {
    for (const status of [404, 403]) {
      let heads = 0;
      const { storage, calls } = await treeBackend({
        [`DELETE ${SRC}sub/`]: response(409, {}),
        [`HEAD ${SRC}a`]: () => response(++heads > 1 ? status : 200, { etag: '"source"' }),
      });
      await rejection(storage.move(SRC, DEST, { ifMatch: '"source"' }), "conflict");
      expect(calls.filter((c) => c.method === "DELETE" && c.url.startsWith(COPY))).toHaveLength(0);
    }
  });
  test("rollback failure contains the original plus cleanup failures, without stopping cleanup", async () => {
    for (const phase of ["copy", "delete"] as const) {
      const { storage, calls } = await treeBackend({
        [phase === "copy" ? `PUT ${COPY}sub/b` : `DELETE ${SRC}sub/b`]: response(403, {}),
        [`DELETE ${COPY}a`]: response(412, { etag: '"concurrent"' }),
      });
      const error = await rejection(storage.move(SRC, DEST, { ifMatch: '"source"' }), "conflict");
      expect(error.cause).toBeInstanceOf(AggregateError);
      expect((error.cause as AggregateError).errors).toMatchObject([
        { code: "forbidden" },
        { code: "precondition-failed" },
      ]);
      if (phase === "delete") expect(error.message).toContain("partial");
      expect(calls.at(-1)?.url).toBe(COPY);
    }
  });
  test.each([
    true,
    false,
  ])("preserves unvalidated copies despite concurrent edits (etagFollowUp=%s)", async (etagFollowUp) => {
    const dest = `${DEST}today.ttl`;
    const { storage, calls } = backend(
      {
        [`PUT ${dest}`]: response(201, {}),
        [`HEAD ${dest}`]: response(200, { etag: '"concurrent"' }),
        [`DELETE ${URL}`]: response(403, {}),
        [`DELETE ${dest}`]: response(),
      },
      { etagFollowUp },
    );
    const error = await rejection(storage.move(URL, DEST, { ifMatch: TAG }), "conflict");
    expect(error.message).toContain("partial");
    expect(calls.some((call) => call.method === "DELETE" && call.url === dest)).toBe(false);
  });
  test("abort during copy cleans completed copies without the spent signal", async () => {
    const c = new AbortController();
    const { storage, calls } = await treeBackend({
      [`PUT ${COPY}`]: () => {
        c.abort();
        return response(201);
      },
    });
    const error = await rejection(
      storage.move(SRC, DEST, { ifMatch: '"source"', signal: c.signal }),
      "network",
    );
    expect(error.retryable).toBe(false);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: COPY, signal: undefined });
  });
  test("the 2000-resource cap counts the top container and fails before any writes", async () => {
    const body = await serializeQuads(
      Array.from({ length: 2000 }, (_, i) =>
        quad(nn(SRC), nn("http://www.w3.org/ns/ldp#contains"), nn(`${SRC}file${i}`)),
      ),
      "text/turtle",
    );
    const { storage, calls } = await treeBackend({
      [`GET ${SRC}`]: response(200, { "content-type": "text/turtle" }, body),
    });
    expect(
      await rejection(storage.move(SRC, DEST, { ifMatch: '"source"' }), "unsupported"),
    ).toMatchObject({ feature: "move" });
    expect(calls.every((c) => ["HEAD", "GET"].includes(c.method))).toBe(true);
  });
  test("ACLs, ACRs and advertised describedby documents are excluded from copying", async () => {
    const nodes = [`${SRC}a`, `${SRC}a.acl`, `${SRC}a.acr`, `${SRC}meta`];
    const body = await serializeQuads(
      nodes.map((u) => quad(nn(SRC), nn("http://www.w3.org/ns/ldp#contains"), nn(u))),
      "text/turtle",
    );
    const { storage, calls } = await treeBackend({
      [`GET ${SRC}`]: response(200, { "content-type": "text/turtle" }, body),
      [`HEAD ${SRC}a`]: response(200, {
        etag: '"source"',
        link: `<${SRC}meta>; rel="describedby"`,
      }),
      [`HEAD ${SRC}meta`]: response(200, {}),
      [`HEAD ${SRC}a.acl`]: response(200, {}),
      [`HEAD ${SRC}a.acr`]: response(200, {}),
      [`DELETE ${SRC}a.acl`]: response(),
      [`DELETE ${SRC}a.acr`]: response(),
      [`DELETE ${SRC}meta`]: response(),
    });
    await storage.move(SRC, DEST, { ifMatch: '"source"' });
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.url)).toEqual([COPY, `${COPY}a`]);
  });
  test("container follow-up can be disabled, or fail after a committed move", async () => {
    const disabled = await treeBackend({}, { etagFollowUp: false });
    expect((await disabled.storage.move(SRC, DEST, { ifMatch: '"source"' })).etag).toBe(
      `"copy:${SRC}"`,
    );
    const failed = await treeBackend({ [`HEAD ${COPY}`]: response(403, {}) });
    expect((await failed.storage.move(SRC, DEST, { ifMatch: '"source"' })).etag).toBeNull();
  });
});

describe("setMetadata", () => {
  test("deduplicates add/remove against the fetched document, no-op never patches", async () => {
    const { storage, calls } = backend();
    const existing = { rel: "https://schema.example/license", href: "https://license.example/cc0" };
    expect(
      await storage.setMetadata(
        URL,
        [
          { op: "add", ...existing },
          { op: "remove", rel: "absent", href: "urn:absent" },
          { op: "add", rel: "cancel", href: "urn:x" },
          { op: "remove", rel: "cancel", href: "urn:x" },
        ],
        { ifMatch: MTAG },
      ),
    ).toEqual({ etag: MTAG });
    expect(calls.map((c) => c.method)).toEqual(["HEAD", "GET"]);
    expect(
      await storage.setMetadata(
        URL,
        [
          { op: "add", rel: "License", href: "urn:license" },
          { op: "add", rel: "license", href: "urn:license" },
          { op: "remove", ...existing },
          { op: "remove", ...existing },
        ],
        { ifMatch: MTAG },
      ),
    ).toEqual({ etag: '"metadata"' });
    const call = calls.at(-1);
    expect(call?.url).toBe(META);
    expect(call?.headers.get("if-match")).toBe(MTAG);
    expect(call?.headers.get("content-type")).toBe("text/n3");
    expect(call?.body).toBe(
      `@prefix solid: <http://www.w3.org/ns/solid/terms#>.\n_:patch a solid:InsertDeletePatch;\n  solid:deletes {\n<${URL}> <https://schema.example/license> <https://license.example/cc0> .\n};\n  solid:inserts {\n<${URL}> <http://www.iana.org/assignments/relation/license> <urn:license> .\n};\n.\n`,
    );
  });
  test("metadata ETag mismatch, server 412, 405 and missing describedby", async () => {
    const ops: MetadataOp[] = [{ op: "add", rel: "related", href: "urn:x" }];
    const stale = backend();
    expect(
      await rejection(
        stale.storage.setMetadata(URL, ops, { ifMatch: '"stale"' }),
        "precondition-failed",
      ),
    ).toMatchObject({ status: 412, etag: MTAG });
    expect(stale.calls.map((c) => c.method)).toEqual(["HEAD", "GET"]);
    for (const [status, code] of [
      [412, "precondition-failed"],
      [405, "method-not-allowed"],
    ] as const) {
      const { storage } = backend({ [`PATCH ${META}`]: response(status, { etag: '"changed"' }) });
      await rejection(storage.setMetadata(URL, ops, { ifMatch: MTAG }), code);
    }
    const none = backend({ [`HEAD ${URL}`]: response(200, {}) });
    await rejection(none.storage.setMetadata(URL, ops, { ifMatch: MTAG }), "unsupported");
  });
  test("anchors scope-check, hrefs/relations are absolute IRIs or registered tokens", async () => {
    const { storage, calls } = backend();
    await rejection(
      storage.setMetadata(
        URL,
        [{ op: "add", anchor: "https://evil.example/", rel: "x", href: "urn:x" }],
        { ifMatch: MTAG },
      ),
      "scope",
    );
    for (const href of ["relative", "#x", "urn:x> <urn:injected", "\nurn:x", 1])
      await expect(
        storage.setMetadata(URL, [{ op: "add", rel: "x", href }] as MetadataOp[], {
          ifMatch: MTAG,
        }),
      ).rejects.toThrow(TypeError);
    for (const rel of ["bad rel", "#rel", "1rel", "bad/rel", "urn:bad>iri"])
      await expect(
        storage.setMetadata(URL, [{ op: "add", rel, href: "urn:x" }], { ifMatch: MTAG }),
      ).rejects.toThrow(TypeError);
    await expect(
      storage.setMetadata(
        URL,
        [{ op: "replace", rel: "x", href: "urn:x" }] as unknown as MetadataOp[],
        { ifMatch: MTAG },
      ),
    ).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
    await storage.setMetadata(
      URL,
      [{ op: "add", anchor: `${URL}#part`, rel: "urn:relation", href: "urn:x" }],
      { ifMatch: MTAG },
    );
    expect(calls.at(-1)?.body).toContain(`<${URL}#part> <urn:relation> <urn:x>`);
  });
  test("foreign describedby fails closed and metadata HEAD follow-up targets its document", async () => {
    const foreign = backend({
      [`HEAD ${URL}`]: response(200, { link: '<https://evil.example/meta>; rel="describedby"' }),
    });
    await rejection(foreign.storage.setMetadata(URL, [], { ifMatch: MTAG }), "scope");
    expect(foreign.calls).toHaveLength(1);
    const { storage, calls } = backend({
      [`PATCH ${META}`]: response(205, {}),
      [`HEAD ${META}`]: response(200, { etag: '"after"' }),
    });
    expect(
      await storage.setMetadata(URL, [{ op: "add", rel: "related", href: "urn:x" }], {
        ifMatch: MTAG,
      }),
    ).toEqual({ etag: '"after"' });
    expect(calls.at(-1)?.url).toBe(META);
    expect(calls.at(-1)?.method).toBe("HEAD");
  });
});

describe("additional adversarial cases", () => {
  test("quoted RDF terms cannot escape a formula", async () => {
    const quoted = quad(quad(s, p, s) as unknown as Quad["subject"], p, s);
    const { storage, calls } = backend();
    await rejection(storage.patch(URL, n3([quoted]), { ifMatch: TAG }), "bad-request");
    expect(calls).toHaveLength(0);
  });
  test("deletion follows whole subtrees even when breadth-first discovery orders grandchildren last", async () => {
    const early = `${SRC}early/`,
      late = `${SRC}late`,
      deep = `${early}deep`;
    const extra: Record<string, Exchange> = {
      [`GET ${SRC}`]: response(
        200,
        { "content-type": "text/turtle" },
        await serializeQuads(
          [early, late].map((u) => quad(nn(SRC), nn("http://www.w3.org/ns/ldp#contains"), nn(u))),
          "text/turtle",
        ),
      ),
      [`GET ${early}`]: response(
        200,
        { "content-type": "text/turtle" },
        await serializeQuads(
          [quad(nn(early), nn("http://www.w3.org/ns/ldp#contains"), nn(deep))],
          "text/turtle",
        ),
      ),
    };
    for (const u of [early, late, deep]) {
      extra[`HEAD ${u}`] = response(200, { etag: '"source"' });
      if (u !== early)
        extra[`GET ${u}`] = response(
          200,
          { etag: '"source"', "content-type": "text/plain" },
          "bytes",
        );
      extra[`PUT ${COPY}${u.slice(SRC.length)}`] = response(201);
      extra[`DELETE ${u}`] = response();
    }
    const deletion = await treeBackend(extra);
    await deletion.storage.delete(SRC, { ifMatch: '"source"', recursive: true });
    expect(deletion.calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      late,
      deep,
      early,
      SRC,
    ]);
    const move = await treeBackend(extra);
    await move.storage.move(SRC, DEST, { ifMatch: '"source"' });
    expect(move.calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      late,
      deep,
      early,
      SRC,
    ]);
  });
});

describe("move data preservation", () => {
  test.each([
    { members: 1, chunks: 64, chunkSize: 1024 * 1024 },
    { members: 1999, chunks: 1, chunkSize: 8 * 1024 * 1024 },
  ])("streams $members resources of $chunks × $chunkSize bytes without collecting bodies", async ({
    members,
    chunks,
    chunkSize,
  }) => {
    const isTree = members > 1;
    const urls = Array.from({ length: members }, (_, i) => (isTree ? `${SRC}file${i}` : URL));
    const chunk = new Uint8Array(chunkSize);
    let uploading = false,
      activeBodies = 0,
      completed = 0,
      bytes = 0,
      rootCreated = !isTree;
    const exchanges: Record<string, Exchange> = {};
    for (const url of urls) {
      const dest = isTree ? COPY + url.slice(SRC.length) : `${DEST}today.ttl`;
      exchanges[`HEAD ${url}`] = response(200, { etag: '"source"' });
      exchanges[`GET ${url}`] = () => {
        expect(rootCreated).toBe(true);
        expect(activeBodies++).toBe(0);
        let sent = 0;
        return {
          status: 200,
          headers: { etag: '"source"', "content-type": "application/octet-stream" },
          body: new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                // No client-side collection, including collection of a single large resource.
                expect(uploading).toBe(true);
                if (sent++ < chunks) controller.enqueue(chunk);
                else {
                  activeBodies--;
                  controller.close();
                }
              },
            },
            { highWaterMark: 0 },
          ),
        };
      };
      exchanges[`PUT ${dest}`] = async (call) => {
        expect(call.body).toBeInstanceOf(ReadableStream);
        expect(call.duplex).toBe("half");
        expect(activeBodies).toBe(1);
        uploading = true;
        const reader = (call.body as ReadableStream<Uint8Array>).getReader();
        let size = 0;
        for (let item = await reader.read(); !item.done; item = await reader.read())
          size += item.value.byteLength;
        expect(size).toBe(chunks * chunkSize);
        bytes += size;
        completed++;
        uploading = false;
        return response(201);
      };
      exchanges[`DELETE ${url}`] = (call) => {
        expect(completed).toBe(members);
        expect(call.headers.get("if-match")).toBe('"source"');
        return response();
      };
    }
    if (isTree) {
      exchanges[`GET ${SRC}`] = response(
        200,
        { "content-type": "text/turtle" },
        await serializeQuads(
          urls.map((url) => quad(nn(SRC), nn("http://www.w3.org/ns/ldp#contains"), nn(url))),
          "text/turtle",
        ),
      );
      exchanges[`PUT ${COPY}`] = () => {
        rootCreated = true;
        return response(201);
      };
    }
    const { storage } = isTree ? await treeBackend(exchanges) : backend(exchanges);
    await storage.move(isTree ? SRC : URL, DEST, { ifMatch: '"source"' });
    expect(bytes).toBe(members * chunks * chunkSize);
    expect(activeBodies).toBe(0);
  });
  test("a concurrent child update fails its DELETE with the copied GET ETag and preserves the new source", async () => {
    const child = `${SRC}sub/b`;
    const fixture = await treeBackend({
      [`GET ${child}`]: response(
        200,
        { etag: '"read-version"', "content-type": "text/plain" },
        "original",
      ),
      [`PUT ${COPY}sub/b`]: async (call) => {
        expect(await new Response(call.body as ReadableStream).text()).toBe("original");
        fixture.exchanges[`GET ${child}`] = response(
          200,
          { etag: '"updated"', "content-type": "text/plain" },
          "concurrent update",
        );
        return response(201, { etag: '"copy"' });
      },
    });
    const error = await rejection(
      fixture.storage.move(SRC, DEST, { ifMatch: '"source"' }),
      "conflict",
    );
    expect(error.cause).toMatchObject({
      code: "precondition-failed",
      status: 412,
      etag: '"updated"',
    });
    expect(
      fixture.calls.find((c) => c.method === "DELETE" && c.url === child)?.headers.get("if-match"),
    ).toBe('"read-version"');
    expect(fixture.calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      child,
      `${COPY}sub/b`,
      `${COPY}sub/`,
      `${COPY}a`,
      COPY,
    ]);
    expect(await (await fixture.storage.read(child)).text()).toBe("concurrent update");
  });
  test.each([
    "resource",
    "container",
  ])("a missing source ETag rejects a %s move before writes", async (kind) => {
    const url = kind === "resource" ? URL : SRC;
    const method = kind === "resource" ? "GET" : "HEAD";
    const { storage, calls } = backend({
      [`${method} ${url}`]: response(200, { "content-type": "text/plain" }, "bytes"),
    });
    expect(
      await rejection(storage.move(url, DEST, { ifMatch: TAG }), "invalid-response"),
    ).toMatchObject({ method, url });
    expect(calls.map((c) => c.method)).toEqual([method]);
  });
  test("preflight rejects unversioned members before creating the tree", async () => {
    const { storage, calls } = await treeBackend({ [`HEAD ${SRC}a`]: response(200, {}) });
    expect(
      await rejection(storage.move(SRC, DEST, { ifMatch: '"source"' }), "invalid-response"),
    ).toMatchObject({ method: "HEAD", url: `${SRC}a` });
    expect(calls.every((c) => c.method === "HEAD" || c.method === "GET")).toBe(true);
    expect(calls.some((c) => c.method === "GET" && !c.url.endsWith("/"))).toBe(false);
  });
  test("a member GET losing its ETag after HEAD rolls back completed copies without deleting sources", async () => {
    const { storage, calls } = await treeBackend({
      [`GET ${SRC}sub/b`]: response(200, { "content-type": "text/plain" }, "bytes"),
    });
    expect(
      await rejection(storage.move(SRC, DEST, { ifMatch: '"source"' }), "invalid-response"),
    ).toMatchObject({ method: "GET", url: `${SRC}sub/b` });
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      `${COPY}sub/`,
      `${COPY}a`,
      COPY,
    ]);
  });
  test.each([
    "copy",
    "delete",
  ] as const)("%s failure preserves unvalidated copies and ancestors for every follow-up configuration", async (phase) => {
    for (const etagFollowUp of [true, false])
      for (const headStatus of [200, 503]) {
        const { storage, calls } = await treeBackend(
          {
            [`PUT ${COPY}a`]: response(201, {}),
            [`HEAD ${COPY}a`]: response(headStatus, { etag: '"concurrent-edit"' }),
            [phase === "copy" ? `PUT ${COPY}sub/b` : `DELETE ${SRC}sub/b`]: response(403, {}),
          },
          { etagFollowUp },
        );
        const error = await rejection(storage.move(SRC, DEST, { ifMatch: '"source"' }), "conflict");
        expect(error.message).toContain("partial");
        expect(error.cause).toMatchObject({ code: "forbidden" });
        expect(
          calls.filter((c) => c.method === "DELETE" && c.url.startsWith(COPY)).map((c) => c.url),
        ).toEqual(phase === "copy" ? [`${COPY}sub/`] : [`${COPY}sub/b`, `${COPY}sub/`]);
      }
  });
  test("a successful resource move retains follow-up ETag behavior", async () => {
    const dest = `${DEST}today.ttl`;
    const { storage } = backend({
      [`PUT ${dest}`]: response(201, {}),
      [`HEAD ${dest}`]: response(200, { etag: '"observed"' }),
      [`DELETE ${URL}`]: response(),
    });
    expect((await storage.move(URL, DEST, { ifMatch: TAG })).etag).toBe('"observed"');
  });
  test("a bodyless resource still moves with its content type and conditional DELETE", async () => {
    const dest = `${DEST}today.ttl`;
    const { storage, calls } = backend({
      [`GET ${URL}`]: response(200, { etag: TAG, "content-type": "text/plain" }),
      [`PUT ${dest}`]: response(201),
      [`DELETE ${URL}`]: response(),
    });
    await storage.move(URL, DEST, { ifMatch: TAG });
    expect(calls[1]?.body).toBe("");
    expect(calls[2]?.headers.get("if-match")).toBe(TAG);
  });
  test("a failed streamed PUT rolls back earlier copies and never deletes sources", async () => {
    const { storage, calls } = await treeBackend({
      [`GET ${SRC}sub/b`]: {
        status: 200,
        headers: { etag: '"source"', "content-type": "text/plain" },
        body: new ReadableStream(
          {
            pull(controller) {
              controller.error(new Error("source stream failed"));
            },
          },
          { highWaterMark: 0 },
        ),
      },
      [`PUT ${COPY}sub/b`]: async (call) => {
        await new Response(call.body as ReadableStream).arrayBuffer();
        return response(201);
      },
    });
    expect(
      await rejection(storage.move(SRC, DEST, { ifMatch: '"source"' }), "network"),
    ).toMatchObject({ retryable: false });
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      `${COPY}sub/`,
      `${COPY}a`,
      COPY,
    ]);
  });
  test("a 504 after a committed source DELETE preserves its copy and ancestor containers", async () => {
    const fixture = await treeBackend({
      [`DELETE ${SRC}sub/b`]: () => {
        fixture.exchanges[`HEAD ${SRC}sub/b`] = response(404, {});
        return response(504, {});
      },
    });
    const error = await rejection(
      fixture.storage.move(SRC, DEST, { ifMatch: '"source"' }),
      "conflict",
    );
    expect(error.cause).toMatchObject({ code: "server", status: 504 });
    expect(error.message).toContain("partial");
    expect(fixture.calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([
      `${SRC}sub/b`,
      `${COPY}a`,
    ]);
    expect(
      fixture.calls.findLast((c) => c.method === "HEAD" && c.url === `${SRC}sub/b`),
    ).toMatchObject({
      signal: undefined,
    });
  });
  test("a 404 source DELETE preserves the copy when HEAD confirms the source is absent", async () => {
    const dest = `${DEST}today.ttl`;
    const { storage, calls } = backend({
      [`PUT ${dest}`]: response(201),
      [`DELETE ${URL}`]: response(404, {}),
      [`HEAD ${URL}`]: response(404, {}),
    });
    const error = await rejection(storage.move(URL, DEST, { ifMatch: TAG }), "conflict");
    expect(error.cause).toMatchObject({ code: "not-found", status: 404 });
    expect(error.message).toContain("partial");
    expect(calls.at(-1)).toMatchObject({ method: "HEAD", url: URL, signal: undefined });
    expect(calls.some((c) => c.method === "DELETE" && c.url === dest)).toBe(false);
  });
  test.each([
    403, 500, 504, 302,
  ])("a failed source HEAD (%i) preserves a copy even after a 412 DELETE", async (status) => {
    const dest = `${DEST}today.ttl`;
    const { storage, calls } = backend({
      [`PUT ${dest}`]: response(201),
      [`DELETE ${URL}`]: response(412, {}),
      [`HEAD ${URL}`]: response(status, {}),
    });
    const error = await rejection(storage.move(URL, DEST, { ifMatch: TAG }), "conflict");
    expect(error.cause).toMatchObject({ code: "precondition-failed", status: 412 });
    expect(error.message).toContain("partial");
    expect(calls.some((c) => c.method === "DELETE" && c.url === dest)).toBe(false);
  });
  test.each([
    "network",
    "scope",
  ] as const)("a source HEAD %s error preserves the copy", async (code) => {
    const dest = `${DEST}today.ttl`;
    const { storage, calls } = backend({
      [`PUT ${dest}`]: response(201),
      [`DELETE ${URL}`]: response(412, {}),
    });
    const head = vi
      .spyOn(storage, "head")
      .mockRejectedValueOnce(new StorageError(code, { method: "HEAD", url: URL }));
    const error = await rejection(storage.move(URL, DEST, { ifMatch: TAG }), "conflict");
    expect(error.message).toContain("partial");
    expect(head).toHaveBeenCalledExactlyOnceWith(URL);
    expect(calls.some((c) => c.method === "DELETE" && c.url === dest)).toBe(false);
  });
  test("a lost DELETE response preserves the copy when the source disappeared or cannot be verified", async () => {
    for (const status of [404, 403])
      for (const failure of ["transport", "unexpected-response"] as const) {
        const dest = `${DEST}today.ttl`;
        const { storage, calls } = backend({
          [`PUT ${dest}`]: response(201),
          [`DELETE ${URL}`]: () => {
            if (failure === "transport") throw new Error("connection lost after commit");
            return response(202, {});
          },
          [`HEAD ${URL}`]: response(status, {}),
        });
        const error = await rejection(storage.move(URL, DEST, { ifMatch: TAG }), "conflict");
        expect(error.message).toContain("partial");
        expect(error.cause).toMatchObject({
          code: failure === "transport" ? "network" : "invalid-response",
        });
        expect(calls.some((c) => c.method === "DELETE" && c.url === dest)).toBe(false);
      }
  });
  test("an aborted source deletion rolls back when a fresh HEAD verifies the source still exists", async () => {
    const dest = `${DEST}today.ttl`;
    const c = new AbortController();
    const { storage, calls } = backend({
      [`PUT ${dest}`]: response(201),
      [`DELETE ${URL}`]: () => {
        c.abort();
        throw new Error("aborted");
      },
      [`DELETE ${dest}`]: response(),
    });
    const error = await rejection(
      storage.move(URL, DEST, { ifMatch: TAG, signal: c.signal }),
      "conflict",
    );
    expect(error.cause).toMatchObject({ code: "network", retryable: false });
    expect(error.message).not.toContain("partial");
    expect(calls.at(-2)).toMatchObject({ method: "HEAD", url: URL, signal: undefined });
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: dest, signal: undefined });
  });
  test("describedby members discovered after their own listing entry do not need a Content-Type", async () => {
    const meta = `${SRC}a-meta`,
      resource = `${SRC}z-resource`;
    const body = await serializeQuads(
      [meta, resource].map((u) => quad(nn(SRC), nn("http://www.w3.org/ns/ldp#contains"), nn(u))),
      "text/turtle",
    );
    const { storage, calls } = await treeBackend({
      [`GET ${SRC}`]: response(200, { "content-type": "text/turtle" }, body),
      [`HEAD ${meta}`]: response(200, {}),
      [`HEAD ${resource}`]: response(200, {
        etag: '"source"',
        link: `<${meta}>; rel="describedby"`,
      }),
      [`GET ${resource}`]: response(
        200,
        { etag: '"source"', "content-type": "text/plain", link: `<${meta}>; rel="describedby"` },
        "bytes",
      ),
      [`PUT ${COPY}z-resource`]: response(201),
      [`DELETE ${resource}`]: response(),
      [`DELETE ${meta}`]: response(),
    });
    await storage.move(SRC, DEST, { ifMatch: '"source"' });
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.url)).toEqual([
      COPY,
      `${COPY}z-resource`,
    ]);
    expect(calls.some((c) => c.method === "GET" && c.url === meta)).toBe(false);
  });
  test("a resource can describe itself; access-control URLs are excluded only from implicit subtree copies", async () => {
    const src = `${ROOT}explicit.acl`,
      dest = `${DEST}explicit.acl`;
    const { storage, calls } = backend({
      [`GET ${src}`]: response(
        200,
        { etag: '"source"', "content-type": "text/plain", link: `<${src}>; rel="describedby"` },
        "explicit bytes",
      ),
      [`PUT ${dest}`]: response(201),
      [`DELETE ${src}`]: response(),
    });
    expect((await storage.move(src, DEST, { ifMatch: '"source"' })).url).toBe(dest);
    expect(calls[1]?.body).toBeInstanceOf(ReadableStream);
    expect(await new Response(calls[1]?.body as ReadableStream).text()).toBe("explicit bytes");
  });
  test.each([
    undefined,
    "broken",
    'text/plain; charset="unterminated',
  ])("invalid source Content-Type %s is a GET invalid-response", async (type) => {
    const { storage, calls } = backend({
      [`GET ${URL}`]: response(
        200,
        { etag: TAG, ...(type === undefined ? {} : { "content-type": type }) },
        "bytes",
      ),
    });
    expect(
      await rejection(storage.move(URL, DEST, { ifMatch: TAG }), "invalid-response"),
    ).toMatchObject({ method: "GET", url: URL });
    expect(calls).toHaveLength(1);
  });
  test("a target collision never deletes the existing destination", async () => {
    const dest = `${DEST}today.ttl`;
    const { storage, calls } = backend({ [`PUT ${dest}`]: response(412, { etag: '"existing"' }) });
    expect(await rejection(storage.move(URL, DEST, { ifMatch: TAG }), "conflict")).toMatchObject({
      status: 412,
    });
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
  });
  test("JSON operations must be records, including arrays with forged op/path fields", async () => {
    const { storage, calls } = backend(
      {},
      { features: withFormats({ "application/json": ["application/json-patch+json"] }) },
    );
    const forged = Object.assign([], { op: "remove", path: "/x" });
    await expect(
      storage.patch(URL, { kind: "json", ops: [forged] } as Patch, { ifMatch: TAG }),
    ).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});

test("JSON patch holes are invalid operations and cannot become null in the request body", async () => {
  const { storage, calls } = backend(
    {},
    { features: withFormats({ "application/json": ["application/json-patch+json"] }) },
  );
  await expect(
    storage.patch(URL, { kind: "json", ops: new Array(1) }, { ifMatch: TAG }),
  ).rejects.toThrow(TypeError);
  expect(calls).toHaveLength(0);
});

test.each([
  "0",
  "1x",
  "9value",
])("refuses digit-leading variable %s before any request", async (name) => {
  const statement = quad(variable(name), p, s);
  const patch = n3([statement], [], [statement]);
  expect(await rejection(buildN3Patch(patch), "bad-request")).toMatchObject({ status: null });
  const { storage, calls } = backend();
  expect(await rejection(storage.patch(URL, patch, { ifMatch: TAG }), "bad-request")).toMatchObject(
    { status: null },
  );
  expect(calls).toHaveLength(0);
});

describe("round-4 write regressions", () => {
  const unusableEtags = [
    "*",
    'W/"weak"',
    '"one", "two"',
    "unquoted",
    '"has space"',
    '"has\ttab"',
    '"has\x7Fdel"',
    '"embedded"quote"',
  ];

  test.each(
    unusableEtags,
  )("rollback preserves a concurrent edit after creation ETag %s", async (etag) => {
    const dest = `${DEST}today.ttl`;
    let bytes = "copied";
    const { storage, calls } = backend({
      [`PUT ${dest}`]: response(201, { etag }),
      [`DELETE ${URL}`]: () => {
        bytes = "concurrent edit";
        return response(403, {});
      },
      [`DELETE ${dest}`]: () => {
        bytes = "deleted";
        return response();
      },
    });
    const error = await rejection(storage.move(URL, DEST, { ifMatch: TAG }), "conflict");
    expect(error.message).toContain("partial");
    expect(error.cause).toMatchObject({ code: "forbidden" });
    expect(calls.at(-1)).toMatchObject({ method: "HEAD", url: URL });
    expect(calls.some((call) => call.method === "DELETE" && call.url === dest)).toBe(false);
    expect(bytes).toBe("concurrent edit");
  });

  test("an unusable creation ETag also preserves ancestor containers", async () => {
    const { storage, calls } = await treeBackend({
      [`PUT ${COPY}sub/b`]: response(201, { etag: "*" }),
      [`DELETE ${SRC}sub/b`]: response(403, {}),
    });
    expect(
      (await rejection(storage.move(SRC, DEST, { ifMatch: '"source"' }), "conflict")).message,
    ).toContain("partial");
    expect(
      calls
        .filter((call) => call.method === "DELETE" && call.url.startsWith(COPY))
        .map((call) => call.url),
    ).toEqual([`${COPY}a`]);
  });

  test.each(
    unusableEtags,
  )("unusable source ETag %s is refused in initial reads, preflight and GET rechecks", async (etag) => {
    for (const [method, url] of [
      ["GET", URL],
      ["HEAD", SRC],
    ] as const) {
      const { storage, calls } = backend({
        [`${method} ${url}`]: response(200, { etag, "content-type": "text/plain" }, "bytes"),
      });
      expect(
        await rejection(storage.move(url, DEST, { ifMatch: TAG }), "invalid-response"),
      ).toMatchObject({ method, url, status: null });
      expect(calls.map((call) => call.method)).toEqual([method]);
    }
    const preflight = await treeBackend({ [`HEAD ${SRC}a`]: response(200, { etag }) });
    expect(
      await rejection(
        preflight.storage.move(SRC, DEST, { ifMatch: '"source"' }),
        "invalid-response",
      ),
    ).toMatchObject({ method: "HEAD", url: `${SRC}a` });
    expect(preflight.calls.every((call) => ["HEAD", "GET"].includes(call.method))).toBe(true);
    const recheck = await treeBackend({
      [`GET ${SRC}a`]: response(200, { etag, "content-type": "text/plain" }, "bytes"),
    });
    expect(
      await rejection(recheck.storage.move(SRC, DEST, { ifMatch: '"source"' }), "invalid-response"),
    ).toMatchObject({ method: "GET", url: `${SRC}a` });
    expect(recheck.calls.filter((call) => call.method === "PUT").map((call) => call.url)).toEqual([
      COPY,
    ]);
    expect(
      recheck.calls.filter((call) => call.method === "DELETE").map((call) => call.url),
    ).toEqual([COPY]);
  });

  test.each([
    '""',
    '"!#~\x80\xFF\\"',
  ])("strong ETag %s is used verbatim for conditional source deletion", async (etag) => {
    const { storage, calls } = backend({
      [`GET ${URL}`]: response(200, { etag, "content-type": "text/plain" }, "bytes"),
      [`PUT ${DEST}today.ttl`]: response(201, { etag }),
      [`DELETE ${URL}`]: response(),
    });
    expect((await storage.move(URL, DEST, { ifMatch: etag })).etag).toBe(etag);
    expect(calls.at(-1)?.headers.get("if-match")).toBe(etag);
  });

  test("a reported creation ETag remains verbatim even when unusable for rollback", async () => {
    const { storage } = backend({
      [`PUT ${DEST}today.ttl`]: response(201, { etag: "*" }),
      [`DELETE ${URL}`]: response(),
    });
    expect((await storage.move(URL, DEST, { ifMatch: TAG })).etag).toBe("*");
  });

  test.each([
    [SRC, `${ROOT}%73ource/sub/`],
    [SRC, `${ROOT}%73ource/`],
    [`${ROOT}%73ource/`, `${SRC}sub/`],
    [`${ROOT}%FF/`, `${ROOT}%FF/sub/`],
  ])("encoded container cycle %s into %s is refused before requests", async (source, parent) => {
    const { storage, calls } = backend();
    expect(
      await rejection(storage.move(source, parent, { ifMatch: TAG }), "conflict"),
    ).toMatchObject({ status: null });
    expect(calls).toHaveLength(0);
  });

  test.each([
    [SRC, `${ROOT}source-other/`],
    [SRC, ROOT],
    [`${ROOT}%FF/`, `${ROOT}%FE/`],
  ])("cycle comparison retains segment boundaries and raw request spelling for %s into %s", async (source, parent) => {
    const { storage, calls } = backend({ [`HEAD ${source}`]: response(403, {}) });
    await rejection(storage.move(source, parent, { ifMatch: TAG }), "forbidden");
    expect(calls.map((call) => [call.method, call.url])).toEqual([["HEAD", source]]);
  });

  test.each([
    [`${ROOT}source%2Fpart/`, `${ROOT}source/part/`],
    [`${ROOT}source/part/`, `${ROOT}source%2Fpart/`],
  ])("scope already refuses encoded path delimiters for %s into %s", async (source, parent) => {
    const { storage, calls } = backend();
    await rejection(storage.move(source, parent, { ifMatch: TAG }), "scope");
    expect(calls).toHaveLength(0);
  });

  test("all advertised ACL/ACP targets are excluded even when discovered after their listing entries", async () => {
    const access = `${SRC}access`,
      policy = `${SRC}access-policy`,
      resource = `${SRC}file`;
    const body = await serializeQuads(
      [access, policy, resource].map((url) =>
        quad(nn(SRC), nn("http://www.w3.org/ns/ldp#contains"), nn(url)),
      ),
      "text/turtle",
    );
    const { storage, calls } = await treeBackend({
      [`GET ${SRC}`]: response(200, { "content-type": "text/turtle" }, body),
      [`HEAD ${access}`]: response(200, { etag: '"access"' }),
      [`HEAD ${policy}`]: response(200, { etag: '"policy"' }),
      [`HEAD ${resource}`]: response(200, {
        etag: '"source"',
        link: `<${access}>; rel="acl", <${policy}>; rel="acl"`,
      }),
      [`GET ${access}`]: response(
        200,
        { etag: '"access"', "content-type": "text/plain" },
        "access rules",
      ),
      [`GET ${policy}`]: response(
        200,
        { etag: '"policy"', "content-type": "text/plain" },
        "policy rules",
      ),
      [`GET ${resource}`]: response(
        200,
        { etag: '"source"', "content-type": "text/plain" },
        "bytes",
      ),
      [`PUT ${COPY}access`]: response(201),
      [`PUT ${COPY}access-policy`]: response(201),
      [`PUT ${COPY}file`]: response(201),
      [`DELETE ${resource}`]: response(),
      [`DELETE ${policy}`]: response(),
      [`DELETE ${access}`]: response(),
    });
    await storage.move(SRC, DEST, { ifMatch: '"source"' });
    expect(calls.filter((call) => call.method === "PUT").map((call) => call.url)).toEqual([
      COPY,
      `${COPY}file`,
    ]);
    expect(calls.some((call) => call.method === "GET" && [access, policy].includes(call.url))).toBe(
      false,
    );
    expect(
      calls
        .find((call) => call.method === "DELETE" && call.url === policy)
        ?.headers.get("if-match"),
    ).toBe('"policy"');
  });

  test("an unusable auxiliary HEAD ETag is refused before conditional teardown or writes", async () => {
    const { storage, calls } = await treeBackend({
      [`HEAD ${SRC}a`]: response(200, { etag: "*", link: `<${SRC}a>; rel="acl"` }),
    });
    expect(
      await rejection(storage.move(SRC, DEST, { ifMatch: '"source"' }), "invalid-response"),
    ).toMatchObject({ method: "HEAD", url: `${SRC}a` });
    expect(calls.every((call) => ["HEAD", "GET"].includes(call.method))).toBe(true);
  });

  test("an explicitly moved advertised auxiliary resource is kept as the move source", async () => {
    const source = `${ROOT}access`,
      dest = `${DEST}access`;
    const { storage, calls } = backend({
      [`GET ${source}`]: response(
        200,
        { etag: TAG, "content-type": "text/plain", link: `<${source}>; rel="acl"` },
        "explicit access policy",
      ),
      [`PUT ${dest}`]: response(201),
      [`DELETE ${source}`]: response(),
    });
    expect((await storage.move(source, DEST, { ifMatch: TAG })).url).toBe(dest);
    expect(await new Response(calls[1]?.body as ReadableStream).text()).toBe(
      "explicit access policy",
    );
  });

  test.each([
    "ltr",
    "rtl",
  ] as const)("SPARQL refuses directional %s inserts and deletes before HTTP", async (direction) => {
    const statement = quad(s, p, literal("example", { language: "en", direction }));
    const { storage, calls } = backend(
      {},
      { features: withFormats({ "text/turtle": ["application/sparql-update"] }) },
    );
    for (const patch of [n3([statement]), n3([], [statement])])
      expect(
        await rejection(storage.patch(URL, patch, { ifMatch: TAG }), "bad-request"),
      ).toMatchObject({ status: null, url: URL });
    expect(calls).toHaveLength(0);
  });

  test("N3 preserves directional terms supported by CSS's installed n3 parser", async () => {
    for (const direction of ["ltr", "rtl"] as const) {
      const statement = quad(s, p, literal("example", { language: "en", direction }));
      const patch = n3([statement], [statement], [statement]);
      const body = await buildN3Patch(patch);
      expect(body).toContain(`"example"@en--${direction}`);
      const parsed = new Parser({ format: "text/n3" })
        .parse(body)
        .filter((q) => q.predicate.equals(p));
      expect(parsed).toHaveLength(3);
      for (const q of parsed) expect(q.object.equals(statement.object)).toBe(true);
      const { storage, calls } = backend();
      await storage.patch(URL, patch, { ifMatch: TAG });
      expect(calls[0]?.body).toBe(body);
    }
  });

  test("invalid RDF term positions are refused in every formula before serialization or HTTP", async () => {
    const base = { subject: q.subject, predicate: q.predicate, object: q.object, graph: q.graph };
    const malformed = [
      { ...base, subject: literal("example") },
      { ...base, subject: defaultGraph() },
      { ...base, predicate: literal("example") },
      { ...base, predicate: blankNode("predicate") },
      { ...base, predicate: defaultGraph() },
      { ...base, object: defaultGraph() },
      { ...base, graph: variable("graph") },
    ] as Quad[];
    for (const statement of malformed) {
      for (const patch of [n3([statement]), n3([], [statement]), n3([q], [], [statement])]) {
        expect(await rejection(buildN3Patch(patch), "bad-request")).toMatchObject({ status: null });
        for (const features of [
          undefined,
          withFormats({ "text/turtle": ["application/sparql-update"] }),
        ]) {
          const { storage, calls } = backend({}, { features });
          expect(
            await rejection(storage.patch(URL, patch, { ifMatch: TAG }), "bad-request"),
          ).toMatchObject({ status: null });
          expect(calls).toHaveLength(0);
        }
      }
    }
  });

  test("bound variables remain valid in every triple position", async () => {
    const statement = quad(variable("s"), variable("p"), variable("o"));
    const body = await buildN3Patch(n3([statement], [statement], [statement]));
    expect(body.match(/\?s \?p \?o \./g)).toHaveLength(3);
  });
});
