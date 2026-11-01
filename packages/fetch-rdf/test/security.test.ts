// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFetchDocumentLoader,
  fetchRdf,
  type ParseRdfOptions,
  parseRdf,
  RdfFetchError,
} from "../src/index.js";

const encode = (value: string) => new TextEncoder().encode(value);
const triple = '<https://ex/s> <https://ex/p> "value" .\n';
const context = { "@context": { name: "https://schema.org/name" } };
const contextUrl = "https://contexts.example/name";
afterEach(() => {
  vi.useRealTimers();
});
const jsonld = (contexts: string | string[]) =>
  JSON.stringify({ "@context": contexts, "@id": "https://ex/s", name: "Alice" });
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function heldBody(text: string) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode(text));
    },
    cancel,
  });
  return { body, cancel };
}

describe("parse budgets", () => {
  it.each([
    "buffered",
    "stream",
  ])("bounds quads during %s parsing, including duplicates", async (backend) => {
    const held = heldBody(triple.repeat(3));
    await expect(
      parseRdf(backend === "stream" ? held.body : triple.repeat(3), "text/turtle", {
        maxQuads: 2,
      }),
    ).rejects.toMatchObject({ name: "RdfFetchError", code: "PARSE_LIMIT" });
    if (backend === "stream") {
      expect(held.cancel).toHaveBeenCalledOnce();
      expect(held.body.locked).toBe(false);
    }
  });

  it("parses once on the engine path and checks its result against maxQuads", async () => {
    const distinct = "<https://ex/s> <https://ex/p> 1, 2, 3 .\n";
    const parse = vi.fn(async () => parseRdf(distinct, "text/turtle"));
    await expect(
      parseRdf(distinct, "text/turtle", { maxQuads: 2, engine: { parse } }),
    ).rejects.toMatchObject({ name: "RdfFetchError", code: "PARSE_LIMIT" });
    expect(parse).toHaveBeenCalledOnce();
    await expect(
      parseRdf(distinct, "text/turtle", { maxQuads: 3, engine: { parse } }),
    ).resolves.toMatchObject({ size: 3 });
  });

  it.each([
    "text/turtle",
    "application/ld+json",
  ])("bounds expanded terms while parsing held %s input", async (mediaType) => {
    const text =
      mediaType === "text/turtle"
        ? `@prefix : <https://ex/${"x".repeat(80)}/> . :s :p :o .\n`
        : JSON.stringify({
            "@context": { "@vocab": `https://ex/${"x".repeat(80)}/` },
            "@id": "https://ex/s",
            name: "a",
          });
    const { body, cancel } = heldBody(text);
    await expect(parseRdf(body, mediaType, { maxTermLength: 64 })).rejects.toMatchObject({
      name: "RdfFetchError",
      code: "PARSE_LIMIT",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds term construction even when no quads are emitted", async () => {
    const text = ["a", "b", "c"]
      .map((prefix) => `@prefix ${prefix}: <https://ex/${"x".repeat(200)}/> .\n`)
      .join("");
    const { body, cancel } = heldBody(text);
    await expect(
      parseRdf(body, "text/turtle", {
        maxTermLength: 512,
        maxTotalTermLength: 500,
      }),
    ).rejects.toMatchObject({ code: "PARSE_LIMIT" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds literal values and datatype IRIs", async () => {
    for (const object of [`"${"x".repeat(65)}"`, `"x"^^<https://ex/${"x".repeat(65)}>`]) {
      await expect(
        parseRdf(`<https://ex/s> <https://ex/p> ${object} .`, "text/turtle", {
          maxTermLength: 64,
        }),
      ).rejects.toMatchObject({ code: "PARSE_LIMIT" });
    }
  });

  it("bounds aggregate expanded characters even when each term is small", async () => {
    const text = JSON.stringify({
      "@context": { "@vocab": `https://ex/${"x".repeat(200)}/` },
      "@id": "https://ex/s",
      a: "a",
      b: "b",
      c: "c",
    });
    await expect(
      parseRdf(text, "application/ld+json", {
        maxTermLength: 512,
        maxTotalTermLength: 500,
      }),
    ).rejects.toMatchObject({ code: "PARSE_LIMIT" });
  });

  it.each([
    "stream",
    "engine",
    "fetch",
  ])("bounds UTF-8 input bytes before completing %s input", async (backend) => {
    const { body, cancel } = heldBody(`# ${"é".repeat(40)}\n`);
    const parse = vi.fn(async () => parseRdf("", "text/turtle"));
    const options = { maxBytes: 64 };
    const result =
      backend === "fetch"
        ? fetchRdf("https://ex/doc", {
            ...options,
            fetch: async () => new Response(body, { headers: { "content-type": "text/turtle" } }),
          })
        : parseRdf(body, "text/turtle", {
            ...options,
            ...(backend === "engine" && { engine: { parse } }),
          });
    await expect(result).rejects.toMatchObject({ name: "RdfFetchError", code: "PARSE_LIMIT" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(parse).not.toHaveBeenCalled();
  });

  it("defaults to a 1 MiB per-term limit", async () => {
    await expect(
      parseRdf(`<urn:s> <urn:p> "${"x".repeat(1024 * 1024 + 1)}" .`, "text/turtle"),
    ).rejects.toMatchObject({ code: "PARSE_LIMIT" });
  });

  it("defaults to a 16 MiB body limit before invoking an engine", async () => {
    const { body, cancel } = heldBody(`# ${"x".repeat(16 * 1024 * 1024)}`);
    const parse = vi.fn(async () => parseRdf("", "text/turtle"));
    await expect(parseRdf(body, "text/turtle", { engine: { parse } })).rejects.toMatchObject({
      code: "PARSE_LIMIT",
    });
    expect(parse).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("accepts exact budget boundaries and lets callers raise limits", async () => {
    const text = "<urn:s> <urn:p> <urn:o> .";
    const options = {
      maxBytes: encode(text).length,
      maxQuads: 1,
      maxTermLength: 5,
      maxTotalTermLength: 15,
    };
    expect((await parseRdf(text, "text/turtle", options)).size).toBe(1);
    await expect(
      parseRdf(text, "text/turtle", { ...options, maxBytes: options.maxBytes - 1 }),
    ).rejects.toMatchObject({ code: "PARSE_LIMIT" });
  });
});

describe("caller-header redirects", () => {
  it("keeps same-origin headers and permanently drops all but Accept across origins", async () => {
    const calls: { url: string; headers: Headers; redirect?: RequestRedirect }[] = [];
    const locations = ["/second", "https://other.example/third", "https://pod.example/final"];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      calls.push({
        url: String(input),
        headers: new Headers(init?.headers),
        redirect: init?.redirect,
      });
      const location = locations.shift();
      return location
        ? new Response(null, { status: 302, headers: { location } })
        : new Response('<#s> <urn:p> "ok" .', { headers: { "content-type": "text/turtle" } });
    });
    const result = await fetchRdf("https://pod.example/start", {
      fetch,
      headers: {
        DPoP: "proof",
        "X-API-Key": "secret",
        "X-Custom": "value",
        Authorization: "Bearer secret",
      },
    });
    expect(calls.map((call) => call.redirect)).toEqual(["manual", "manual", "manual", "manual"]);
    expect(calls[1]?.headers.get("dpop")).toBe("proof");
    for (const call of calls.slice(2)) expect([...call.headers.keys()]).toEqual(["accept"]);
    expect(result.url).toBe("https://pod.example/final");
    expect([...result.dataset][0]?.subject.value).toBe("https://pod.example/final#s");
  });

  it.each([
    301, 302, 303, 307, 308,
  ])("follows HTTP %s as GET and cancels redirect bodies", async (status) => {
    const cancel = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(new ReadableStream({ cancel }), { status, headers: { location: "/final" } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect((await fetchRdf("https://ex/start", { fetch, headers: { DPoP: "proof" } })).url).toBe(
      "https://ex/final",
    );
    expect(fetch.mock.calls[1]?.[1]?.method ?? "GET").toBe("GET");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    "data:text/plain,x",
    "file:///private",
    "ftp://ex/private",
  ])("refuses a non-HTTP Location: %s", async (location) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { status: 302, headers: { location } }),
    );
    await expect(
      fetchRdf("https://ex/start", { fetch, headers: { DPoP: "proof" } }),
    ).rejects.toMatchObject({ name: "RdfFetchError", code: "REDIRECT" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses opaque redirects without retrying with credentials", async () => {
    const response = new Response(null, { status: 200 });
    Object.defineProperty(response, "type", { value: "opaqueredirect" });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
    await expect(
      fetchRdf("https://ex/start", { fetch, headers: { DPoP: "proof" } }),
    ).rejects.toMatchObject({ name: "RdfFetchError", code: "REDIRECT" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stops after ten redirect hops", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { status: 302, headers: { location: "/again" } }),
    );
    await expect(
      fetchRdf("https://ex/start", { fetch, headers: { "X-Key": "secret" } }),
    ).rejects.toMatchObject({ code: "REDIRECT" });
    expect(fetch).toHaveBeenCalledTimes(11);
  });

  it("retains native follow when only Accept is supplied", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    await fetchRdf("https://ex/start", { fetch, headers: { Accept: "anything" } });
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBeUndefined();
  });
});

describe("context budgets and cancellation", () => {
  it("preserves a custom loader's refusal in the direct parse cause", async () => {
    const failure = new Error(`Remote JSON-LD context refused: ${contextUrl}.`);
    await expect(
      parseRdf(jsonld(contextUrl), "application/ld+json", {
        documentLoader: {
          async load() {
            throw failure;
          },
        },
      }),
    ).rejects.toMatchObject({ cause: failure, contentType: "application/ld+json" });
  });

  it("retains resource parse metadata and the original typed context failure", async () => {
    const failure = new RdfFetchError("Context refused", { url: contextUrl });
    await expect(
      parseRdf(jsonld(contextUrl), "application/ld+json", {
        baseIRI: "https://ex/doc",
        documentLoader: {
          async load() {
            throw failure;
          },
        },
      }),
    ).rejects.toMatchObject({
      name: "RdfFetchError",
      url: "https://ex/doc",
      contentType: "application/ld+json",
      cause: failure,
    });
  });

  it("coalesces repeated in-flight context URLs", async () => {
    const hold = deferred<Response>();
    const started = deferred<void>();
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      started.resolve();
      return hold.promise;
    });
    const documentLoader = createFetchDocumentLoader(fetch, { allow: () => true });
    const result = parseRdf(jsonld(Array(20).fill(contextUrl)), "application/ld+json", {
      documentLoader,
    });
    await started.promise;
    hold.resolve(Response.json(context));
    expect((await result).size).toBe(1);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("caps unique context requests per parse, including nested contexts", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
      Response.json({ "@context": `${url}/next` }),
    );
    const documentLoader = createFetchDocumentLoader(fetch, { allow: () => true });
    await expect(
      parseRdf(jsonld(contextUrl), "application/ld+json", {
        documentLoader,
        maxContextRequests: 2,
      }),
    ).rejects.toMatchObject({ name: "RdfFetchError", code: "PARSE_LIMIT" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("defaults to at most 32 context requests", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(context));
    await expect(
      parseRdf(
        jsonld(Array.from({ length: 33 }, (_, index) => `${contextUrl}/${index}`)),
        "application/ld+json",
        {
          documentLoader: createFetchDocumentLoader(fetch, { allow: () => true }),
        },
      ),
    ).rejects.toMatchObject({ code: "PARSE_LIMIT" });
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(32);
  });

  it.each([
    undefined,
    2,
  ])("bounds context concurrency with deferred requests (limit=%s)", async (configured) => {
    const concurrency = configured ?? 4;
    const holds = Array.from({ length: 6 }, () => deferred<Response>());
    const atCapacity = deferred<void>();
    let active = 0;
    let peak = 0;
    let count = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const index = count++;
      peak = Math.max(peak, ++active);
      if (count === concurrency) atCapacity.resolve();
      try {
        const hold = holds[index];
        if (!hold) throw new Error("Unexpected context request");
        return await hold.promise;
      } finally {
        active--;
      }
    });
    const result = parseRdf(
      jsonld(holds.map((_, index) => `${contextUrl}/${index}`)),
      "application/ld+json",
      {
        documentLoader: createFetchDocumentLoader(fetch, { allow: () => true }),
        maxContextConcurrency: configured,
      },
    );
    await atCapacity.promise;
    for (const hold of holds) hold.resolve(Response.json(context));
    expect((await result).size).toBe(1);
    expect(peak).toBe(concurrency);
  });

  it.each([
    "parse",
    "fetch",
  ])("aborts a held context during %s and signals its transport", async (mode) => {
    const hold = deferred<Response>();
    const started = deferred<void>();
    const controller = new AbortController();
    let contextSignal: AbortSignal | null | undefined;
    const documentLoader = createFetchDocumentLoader(
      async (_url, init) => {
        contextSignal = init?.signal;
        started.resolve();
        return hold.promise;
      },
      { allow: () => true },
    );
    const options = { signal: controller.signal, documentLoader };
    const result =
      mode === "parse"
        ? parseRdf(jsonld(contextUrl), "application/ld+json", options)
        : fetchRdf("https://ex/doc", {
            ...options,
            fetch: async () =>
              new Response(jsonld(contextUrl), {
                headers: { "content-type": "application/ld+json" },
              }),
          });
    // Like native fetch, the operation rejects with the caller's own abort reason.
    const assertion = expect(result).rejects.toThrow("caller abort reason");
    await started.promise;
    controller.abort(new Error("caller abort reason"));
    try {
      expect(contextSignal?.aborted).toBe(true);
      await assertion;
    } finally {
      hold.resolve(Response.json(context));
    }
  });

  it("propagates a loader deadline to parsing with AbortError", async () => {
    vi.useFakeTimers();
    const started = deferred<void>();
    const hold = deferred<Response>();
    const loader = createFetchDocumentLoader(
      async () => {
        started.resolve();
        return hold.promise;
      },
      {
        allow: () => true,
        timeoutMs: 100,
      },
    );
    const assertion = expect(
      parseRdf(jsonld(contextUrl), "application/ld+json", { documentLoader: loader }),
    ).rejects.toMatchObject({ name: "AbortError" });
    try {
      await started.promise;
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
    } finally {
      hold.resolve(Response.json(context));
      vi.useRealTimers();
    }
  });

  it.each([
    false,
    true,
  ])("aborts a held input reader (engine=%s) without waiting for cancellation", async (engine) => {
    const read = deferred<void>();
    const neverCancel = deferred<void>();
    const cancel = vi.fn(() => neverCancel.promise);
    const body = new ReadableStream<Uint8Array>({
      pull() {
        read.resolve();
      },
      cancel,
    });
    const controller = new AbortController();
    const options: ParseRdfOptions = {
      signal: controller.signal,
      ...(engine && { engine: { parse: async () => parseRdf("", "text/turtle") } }),
    };
    const assertion = expect(parseRdf(body, "text/turtle", options)).rejects.toMatchObject({
      name: "AbortError",
    });
    await read.promise;
    controller.abort();
    try {
      await assertion;
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    } finally {
      neverCancel.resolve();
    }
  });

  it("keeps separate parses isolated when they share a helper", async () => {
    const holds = [deferred<Response>(), deferred<Response>()];
    const started = deferred<void>();
    let count = 0;
    const loader = createFetchDocumentLoader(
      async () => {
        const hold = holds[count++];
        if (count === 2) started.resolve();
        if (!hold) throw new Error("Unexpected request");
        return hold.promise;
      },
      { allow: () => true },
    );
    const controller = new AbortController();
    const first = expect(
      parseRdf(jsonld(contextUrl), "application/ld+json", {
        documentLoader: loader,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const second = parseRdf(jsonld(contextUrl), "application/ld+json", { documentLoader: loader });
    await started.promise;
    controller.abort();
    await first;
    for (const hold of holds) hold.resolve(Response.json(context));
    expect((await second).size).toBe(1);
    expect(count).toBe(2);
  });

  it("cancels a held context response body when parsing aborts", async () => {
    const reading = deferred<void>();
    const cancel = vi.fn();
    const controller = new AbortController();
    let contextSignal: AbortSignal | null | undefined;
    const loader = createFetchDocumentLoader(
      async (_url, init) => {
        contextSignal = init?.signal;
        return new Response(
          new ReadableStream<Uint8Array>(
            {
              pull() {
                reading.resolve();
              },
              cancel,
            },
            { highWaterMark: 0 },
          ),
        );
      },
      { allow: () => true },
    );
    const result = expect(
      parseRdf(jsonld(contextUrl), "application/ld+json", {
        documentLoader: loader,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await reading.promise;
    controller.abort();
    await result;
    expect(contextSignal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("caps context response bytes while the body is held", async () => {
    const { body, cancel } = heldBody(" ".repeat(65));
    const loader = createFetchDocumentLoader(async () => new Response(body), {
      allow: () => true,
      maxBytes: 64,
    });
    await expect(loader.load(contextUrl)).rejects.toMatchObject({ code: "PARSE_LIMIT" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("operation cancellation", () => {
  it("rejects a pre-aborted operation before invoking a transport or engine", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const parse = vi.fn(async () => parseRdf("", "text/turtle"));
    await expect(
      fetchRdf("https://ex/doc", { signal: controller.signal, fetch }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const { body, cancel } = heldBody(triple);
    await expect(
      parseRdf(body, "text/turtle", { signal: controller.signal, engine: { parse } }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const custom = new AbortController();
    custom.abort("caller reason");
    await expect(fetchRdf("https://ex/doc", { signal: custom.signal, fetch })).rejects.toBe(
      "caller reason",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a held transport promptly and cancels its late response", async () => {
    const hold = deferred<Response>();
    const cancelled = deferred<void>();
    const started = deferred<void>();
    const controller = new AbortController();
    const result = expect(
      fetchRdf("https://ex/doc", {
        signal: controller.signal,
        fetch: async () => {
          started.resolve();
          return hold.promise;
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await started.promise;
    controller.abort();
    await result;
    hold.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled.resolve();
          },
        }),
      ),
    );
    await cancelled.promise;
  });

  it("rejects an engine's held result promptly", async () => {
    const started = deferred<void>();
    const hold = deferred<Awaited<ReturnType<typeof parseRdf>>>();
    const controller = new AbortController();
    const result = expect(
      parseRdf(triple, "text/turtle", {
        signal: controller.signal,
        engine: {
          parse() {
            started.resolve();
            return hold.promise;
          },
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await started.promise;
    controller.abort();
    try {
      await result;
    } finally {
      hold.resolve(await parseRdf("", "text/turtle"));
    }
  });
});

describe("error URL redaction", () => {
  const privateUrl = "https://user:PASS@pod.example/doc?token=SECRET#PRIVATE";
  const safeUrl = "https://pod.example/doc";
  function inspect(error: unknown) {
    expect(error).toBeInstanceOf(RdfFetchError);
    const value = error as RdfFetchError;
    expect(value.url).toBe(safeUrl);
    for (let current: unknown = value; current; ) {
      const message =
        current instanceof Error ? `${current.message}\n${current.stack}` : String(current);
      for (const secret of ["user:", "PASS", "SECRET", "PRIVATE"])
        expect(message).not.toContain(secret);
      current = current instanceof Error ? current.cause : undefined;
    }
  }

  it.each([
    "http",
    "network",
    "parse",
    "context",
  ])("redacts URLs through the %s error chain", async (kind) => {
    const result =
      kind === "parse"
        ? parseRdf("bad turtle .", "text/turtle", { baseIRI: privateUrl })
        : kind === "context"
          ? createFetchDocumentLoader(globalThis.fetch, { allow: () => false }).load(privateUrl)
          : fetchRdf(privateUrl, {
              fetch: async () => {
                if (kind === "network")
                  throw new Error(`network failed for ${privateUrl}`, {
                    cause: new Error(`nested ${privateUrl}`),
                  });
                return new Response(null, { status: 403 });
              },
            });
    inspect(await result.catch((error: unknown) => error));
  });

  it("redacts non-hierarchical base URLs and copies unsafe nested causes", async () => {
    const error = await parseRdf("bad turtle .", "text/turtle", {
      baseIRI: "urn:document?token=SECRET#PRIVATE",
    }).catch((error: unknown) => error);
    expect(error).toMatchObject({ url: "urn:document" });
    expect((error as Error).message).not.toMatch(/SECRET|PRIVATE/);
    const original = Object.assign(new Error(`Failed ${privateUrl}`), { url: privateUrl });
    const wrapped = new RdfFetchError(`Failed ${privateUrl}`, { cause: original, url: privateUrl });
    expect(wrapped.cause).toMatchObject({ url: safeUrl });
    inspect(wrapped);
    expect(original.url).toBe(privateUrl);
    expect(original.message).toContain("SECRET");
  });

  it("redacts parser-generated context errors containing private URLs", async () => {
    const error = await parseRdf(jsonld(privateUrl), "application/ld+json").catch(
      (error: unknown) => error,
    );
    for (let current: unknown = error; current instanceof Error; current = current.cause) {
      expect(current.message).not.toMatch(/PASS|SECRET|PRIVATE/);
    }
  });
});

it.each([
  ["application/n-quads", '<https://ex/s> <https://ex/p> "café" <https://ex/g> .', "https://ex/g"],
  ["application/trig", '<#g> { <#s> <#p> "café" . }', "https://pod.example/doc#g"],
])("preserves named graphs in chunked %s streams", async (mediaType, text, graph) => {
  const bytes = encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1));
      controller.close();
    },
  });
  const dataset = await parseRdf(body, mediaType, { baseIRI: "https://pod.example/doc" });
  expect(dataset.size).toBe(1);
  expect([...dataset][0]?.graph.value).toBe(graph);
  expect([...dataset][0]?.object.value).toBe("café");
});
