// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { Container, Resource } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { describe, expect, it, vi } from "vitest";
import { parseContainerMembers, readContainerMembers } from "../src/index.js";

const SCOPE = "https://pod.example/pod/";
const LISTED = `${SCOPE}items/`;

function listing(ids: string[], containerUrl = LISTED): Store {
  const dataset = new Store();
  const container = new Container(containerUrl, dataset, DataFactory);
  for (const id of ids) container.contains.add(new Resource(id, dataset, DataFactory));
  return dataset;
}

function turtle(dataset: Store): Promise<string> {
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads([...dataset]);
  return new Promise((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

function responseFetch(body: string | null, status = 200, contentType = "text/turtle") {
  return vi.fn<typeof globalThis.fetch>(
    async () => new Response(body, { status, headers: { "content-type": contentType } }),
  );
}

describe("parseContainerMembers", () => {
  it("resolves relative identifiers and classifies containers by pathname", () => {
    expect(
      parseContainerMembers(
        listing(["a", "sub/?view=1#part", `${LISTED}../sibling`, "/pod/root-file"]),
        LISTED,
        {
          scope: SCOPE,
        },
      ),
    ).toEqual([
      { url: `${LISTED}a`, container: false },
      { url: `${LISTED}sub/?view=1#part`, container: true },
    ]);
  });

  it("preserves listing order and deduplicates by the canonical checked URL", () => {
    const dataset = listing([
      "z",
      "a",
      `${LISTED}z`,
      "https://POD.EXAMPLE:443/pod/items/a",
      "x/../z",
    ]);
    expect(parseContainerMembers(dataset, LISTED, { scope: SCOPE })).toEqual([
      { url: `${LISTED}z`, container: false },
      { url: `${LISTED}a`, container: false },
    ]);
  });

  it("always skips self, including query and fragment aliases", () => {
    const dataset = listing([
      LISTED,
      `${LISTED}?view=1`,
      `${LISTED}#part`,
      `${LISTED}./?x#y`,
      "ok",
    ]);
    for (const allowRoot of [undefined, true, false]) {
      expect(parseContainerMembers(dataset, LISTED, { scope: SCOPE, allowRoot })).toEqual([
        { url: `${LISTED}ok`, container: false },
      ]);
    }
  });

  it("skips ancestors and scope-root aliases regardless of allowRoot", () => {
    const dataset = listing([SCOPE, `${SCOPE}?q#f`, SCOPE.slice(0, -1), "ok"]);
    for (const allowRoot of [undefined, true, false]) {
      expect(parseContainerMembers(dataset, LISTED, { scope: SCOPE, allowRoot })).toEqual([
        { url: `${LISTED}ok`, container: false },
      ]);
    }
  });

  it("skips ../valuable siblings inside the broader pod scope", async () => {
    const dataset = await parseRdf(
      `@prefix ldp: <http://www.w3.org/ns/ldp#> . <> ldp:contains <before>, <../valuable>, <after> .`,
      "text/turtle",
      { baseIRI: LISTED },
    );
    expect(
      parseContainerMembers(dataset, LISTED, {
        scope: SCOPE,
      }),
    ).toEqual([
      { url: `${LISTED}before`, container: false },
      { url: `${LISTED}after`, container: false },
    ]);
  });

  it("breaks sibling-container cycles in both directions", () => {
    const sibling = `${SCOPE}sibling/`;
    expect(parseContainerMembers(listing([sibling]), LISTED, { scope: SCOPE })).toEqual([]);
    expect(parseContainerMembers(listing([LISTED], sibling), sibling, { scope: SCOPE })).toEqual(
      [],
    );
  });

  it("skips literal and blank-node members while keeping neighboring NamedNodes", async () => {
    const dataset = await parseRdf(
      `@prefix ldp: <http://www.w3.org/ns/ldp#> .
       <> ldp:contains <before>, "literal", _:blank, <after> .`,
      "text/turtle",
      { baseIRI: LISTED },
    );
    expect(parseContainerMembers(dataset, LISTED, { scope: SCOPE })).toEqual([
      { url: `${LISTED}before`, container: false },
      { url: `${LISTED}after`, container: false },
    ]);
  });

  it("uses the dataset's first container subject, even when it differs from containerUrl", () => {
    const dataset = listing([`${LISTED}first`], `${SCOPE}other/`);
    const container = new Container(LISTED, dataset, DataFactory);
    container.contains.add(new Resource(`${LISTED}second`, dataset, DataFactory));
    expect(parseContainerMembers(dataset, LISTED, { scope: SCOPE })).toEqual([
      { url: `${LISTED}first`, container: false },
    ]);
  });

  it.each([
    "http://[",
    "https://",
    "https://evil.example/pod/items/steal",
    "//evil.example/pod/items/steal",
    "http://pod.example/pod/items/downgrade",
    "https://pod.example:8443/pod/items/other-port",
    "https://user:password@pod.example/pod/items/userinfo",
    `${LISTED}../../escape`,
    `${LISTED}../../pod-sibling/escape`,
    "%2e%2e/%2E%2E/escape",
    "/pod-sibling/escape",
    "https://pod.example/elsewhere/escape",
    "mailto:attacker@example.org",
    "javascript:alert(1)",
    "data:text/plain,bad",
    "file:///pod/items/file",
    "a%2Fb",
    "a%2fb",
    "a%5Cb",
    "a%5cb/",
    "https://pod.example/pod/items/%2F..%2Fescape",
  ])("skips unsafe or unparseable entry %s and keeps both neighboring members", (id) => {
    expect(
      parseContainerMembers(listing(["before", id, "after"]), LISTED, { scope: SCOPE }),
    ).toEqual([
      { url: `${LISTED}before`, container: false },
      { url: `${LISTED}after`, container: false },
    ]);
  });

  it.each([
    "not a base",
    "ftp://pod.example/pod/",
    "https://user:secret@pod.example/pod/",
    `${SCOPE}a%2Fb/`,
  ])("fails closed for invalid scope %s", (scope) => {
    expect(parseContainerMembers(listing(["a"]), LISTED, { scope })).toEqual([]);
  });

  it("returns an empty array when there is no membership", () => {
    expect(parseContainerMembers(new Store(), LISTED, { scope: SCOPE })).toEqual([]);
  });

  it("keeps allowed encoded colons and percent signs", () => {
    expect(parseContainerMembers(listing(["a%3Ab", "100%25"]), LISTED, { scope: SCOPE })).toEqual([
      { url: `${LISTED}a%3Ab`, container: false },
      { url: `${LISTED}100%25`, container: false },
    ]);
  });
});

describe("readContainerMembers", () => {
  it("rejects a listing over the default 16 MiB byte limit with PARSE_LIMIT", async () => {
    const fetch = responseFetch(`#${"x".repeat(16 * 1024 * 1024)}`);
    await expect(readContainerMembers(fetch, LISTED, { scope: SCOPE })).rejects.toMatchObject({
      code: "PARSE_LIMIT",
    });
  });

  it("enforces maxBytes on the body stream and cancels on overflow", async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ < 5) controller.enqueue(new TextEncoder().encode("# oversized comment\n"));
        else controller.close();
      },
      cancel,
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body));
    const options = { scope: SCOPE, maxBytes: 16 };
    await expect(readContainerMembers(fetch, LISTED, options)).rejects.toMatchObject({
      code: "PARSE_LIMIT",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(pulls).toBeLessThan(5);
  });

  it("passes maxQuads to the streaming parser", async () => {
    const fetch = responseFetch(
      `@prefix ldp: <http://www.w3.org/ns/ldp#> . <> ldp:contains <a>, <b> .`,
    );
    const options = { scope: SCOPE, maxQuads: 1 };
    await expect(readContainerMembers(fetch, LISTED, options)).rejects.toMatchObject({
      code: "PARSE_LIMIT",
    });
  });

  it("forwards signal to fetch and aborts a stalled body even if cancellation stalls", async () => {
    const controller = new AbortController();
    let source: ReadableStreamDefaultController<Uint8Array> | undefined;
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        source = stream;
      },
      cancel,
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body));
    const options = { scope: SCOPE, signal: controller.signal };
    const result = readContainerMembers(fetch, LISTED, options);
    // Observe the rejection before aborting; a timeout explicitly detects the old stalled read.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const outcome = Promise.race([
      result.then(
        () => "resolved",
        (error: Error) => error.name,
      ),
      new Promise<string>((resolve) => {
        timeout = setTimeout(() => resolve("stalled"), 300);
      }),
    ]);
    try {
      await vi.waitFor(() => expect(body.locked).toBe(true));
      controller.abort();
      expect(await outcome).toBe("AbortError");
      expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
      expect(cancel).toHaveBeenCalledTimes(1);
    } finally {
      clearTimeout(timeout);
      // Release the pre-fix res.text() read if this regression fails.
      source?.error(new Error("test cleanup"));
    }
  });

  it("GETs and parses Turtle with relative IRIs and the exact Accept header", async () => {
    const fetch = responseFetch(`@prefix ldp: <http://www.w3.org/ns/ldp#> .
<> ldp:contains <b>, <sub/>, <../neighbor>, <../../escape>, <b> .`);
    expect(await readContainerMembers(fetch, LISTED, { scope: SCOPE })).toEqual([
      { url: `${LISTED}b`, container: false },
      { url: `${LISTED}sub/`, container: true },
    ]);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(LISTED, {
      method: "GET",
      headers: { accept: "text/turtle, application/ld+json;q=0.9" },
    });
  });

  it("parses JSON-LD using response content-type and the container base IRI", async () => {
    const body = JSON.stringify({
      "@context": { ldp: "http://www.w3.org/ns/ldp#" },
      "@id": LISTED,
      "ldp:contains": [
        { "@id": "child" },
        { "@id": "sub/" },
        { "@id": `${LISTED}?self#alias` },
        { "@id": "https://evil.example/steal" },
        { "@id": "child" },
      ],
    });
    const fetch = responseFetch(body, 200, "application/ld+json; charset=utf-8");
    expect(await readContainerMembers(fetch, LISTED, { scope: SCOPE })).toEqual([
      { url: `${LISTED}child`, container: false },
      { url: `${LISTED}sub/`, container: true },
    ]);
  });

  it("skips unparseable URLs in a real Turtle listing", async () => {
    const fetch = responseFetch(await turtle(listing(["http://[", `${LISTED}ok`])));
    expect(await readContainerMembers(fetch, LISTED, { scope: SCOPE })).toEqual([
      { url: `${LISTED}ok`, container: false },
    ]);
  });

  it.each([404, 410])("returns null on %s without parsing the body", async (status) => {
    expect(
      await readContainerMembers(responseFetch("invalid RDF", status), LISTED, { scope: SCOPE }),
    ).toBeNull();
  });

  it.each([
    404, 410, 500,
  ])("cancels an unread %s body without awaiting cancellation", async (status) => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body, { status }));
    const result = readContainerMembers(fetch, LISTED, { scope: SCOPE });
    if (status === 500) await expect(result).rejects.toThrow("500");
    else await expect(result).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([201, 204, 205])("treats an empty successful %s listing as empty", async (status) => {
    const body = status === 201 ? "" : null;
    expect(
      await readContainerMembers(responseFetch(body, status), LISTED, { scope: SCOPE }),
    ).toEqual([]);
  });

  it.each([
    300, 302, 304, 400, 401, 403, 409, 429, 500, 503,
  ])("throws on non-ok status %s with caller prefix", async (status) => {
    await expect(
      readContainerMembers(responseFetch(null, status), LISTED, {
        scope: SCOPE,
        package: "consumer",
      }),
    ).rejects.toThrow(`[consumer] listing container ${LISTED} failed: ${status}`);
  });

  it("defaults the error prefix to the shared package", async () => {
    await expect(
      readContainerMembers(responseFetch(null, 500), LISTED, { scope: SCOPE }),
    ).rejects.toThrow("[ldp-container]");
  });

  it.each([
    "https://evil.example/pod/items/",
    "/outside/",
    `${SCOPE}a%2Fb/`,
    "https://user:secret@pod.example/pod/items/",
    "http://[",
  ])("rejects unsafe container %s before fetching", async (url) => {
    const fetch = responseFetch("");
    await expect(readContainerMembers(fetch, url, { scope: SCOPE })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the checked canonical request target as both fetch URL and parse base", async () => {
    const fetch = responseFetch(
      `@prefix ldp: <http://www.w3.org/ns/ldp#> . <> ldp:contains <ok> .`,
    );
    const result = await readContainerMembers(fetch, "https://POD.EXAMPLE:443/pod/x/../items/", {
      scope: SCOPE,
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(LISTED);
    expect(result).toEqual([{ url: `${LISTED}ok`, container: false }]);
  });

  it("allows fetching the scope root itself", async () => {
    expect(await readContainerMembers(responseFetch(""), SCOPE, { scope: SCOPE })).toEqual([]);
  });

  it("propagates transport and RDF parser failures", async () => {
    const error = new Error("transport failed");
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(error);
    await expect(readContainerMembers(fetch, LISTED, { scope: SCOPE })).rejects.toBe(error);
    await expect(
      readContainerMembers(responseFetch("invalid RDF"), LISTED, { scope: SCOPE }),
    ).rejects.toThrow();
    await expect(
      readContainerMembers(responseFetch("{}", 200, "text/plain"), LISTED, { scope: SCOPE }),
    ).rejects.toThrow();
  });

  it("refuses remote JSON-LD contexts without an outbound context request", async () => {
    const fetch = responseFetch(
      JSON.stringify({ "@context": "https://evil.example/context", "@id": LISTED }),
      200,
      "application/ld+json",
    );
    await expect(readContainerMembers(fetch, LISTED, { scope: SCOPE })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("accepts an already parsed DatasetCore without an HTTP read", async () => {
    const dataset = await parseRdf(await turtle(listing([`${LISTED}a`])), "text/turtle");
    expect(parseContainerMembers(dataset, LISTED, { scope: SCOPE })).toEqual([
      { url: `${LISTED}a`, container: false },
    ]);
  });
});
