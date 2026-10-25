// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SolidMcpConfig } from "../src/auth.js";
import { fetchDocument } from "../src/fetch.js";
import { createSolidMcpServer } from "../src/server.js";
import { containerTurtle, makeFakePod } from "./fake-pod.js";

const POD = "https://alice.example/pod/";
const CAP = 1024 * 1024;
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.unstubAllGlobals();
});

async function connect(
  fetch: typeof globalThis.fetch,
  searchLimits?: SolidMcpConfig["searchLimits"],
) {
  const server = createSolidMcpServer({ fetch, podRoot: POD, searchLimits });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "fixture", version: "1" });
  clients.push(client);
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function streamed(body: Uint8Array, contentType = "text/plain", headers: HeadersInit = {}) {
  const cancel = vi.fn();
  const fetch = vi.fn(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(body);
          },
          cancel,
        }),
        { headers: { "content-type": contentType, ...headers } },
      ),
  );
  return { config: { fetch, podRoot: POD }, cancel, fetch };
}

describe("ChatGPT tool contracts", () => {
  it("advertises exact inputs and read-only annotations", async () => {
    const client = await connect(makeFakePod({}).fetch);
    const { tools } = await client.listTools();
    for (const [name, argument] of [
      ["search", "query"],
      ["fetch", "id"],
    ]) {
      const tool = tools.find((tool) => tool.name === name);
      expect(tool?.inputSchema.required).toEqual([argument]);
      expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual([argument]);
      expect(tool?.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("search emits exactly {results:[{id,title,url}]} and deduplicates URLs", async () => {
    const pod = makeFakePod({
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, [{ name: "avocado.ttl" }]) },
      [`${POD}avocado.ttl`]: {
        contentType: "text/turtle",
        body: '<> <http://schema.org/text> "avocado" .',
      },
    });
    const result = await (await connect(pod.fetch)).callTool({
      name: "search",
      arguments: { query: "avocado" },
    });
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          results: [{ id: `${POD}avocado.ttl`, title: "avocado.ttl", url: `${POD}avocado.ttl` }],
        }),
      },
    ]);
    const empty = await (await connect(pod.fetch)).callTool({
      name: "search",
      arguments: { query: " " },
    });
    expect(empty.content).toEqual([{ type: "text", text: '{"results":[]}' }]);
  });

  it("fetch emits exactly {id,title,text,url,metadata}", async () => {
    const pod = makeFakePod({
      [`${POD}hello%20world.txt`]: {
        contentType: "text/plain; charset=utf-8",
        body: "Hello",
        etag: '"v1"',
      },
    });
    const id = `${POD}hello%20world.txt`;
    const result = await (await connect(pod.fetch)).callTool({ name: "fetch", arguments: { id } });
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          id,
          title: "hello world.txt",
          text: "Hello",
          url: id,
          metadata: { contentType: "text/plain", truncated: false, etag: '"v1"' },
        }),
      },
    ]);
  });

  it("returns tool errors for fetch failures and invalid search limits", async () => {
    const client = await connect(makeFakePod({}).fetch, { maxResources: -1 });
    expect((await client.callTool({ name: "search", arguments: { query: "x" } })).isError).toBe(
      true,
    );
    expect(
      (await client.callTool({ name: "fetch", arguments: { id: `${POD}missing` } })).isError,
    ).toBe(true);
  });

  it.each([
    "https://evil.example/x",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "file:///etc/passwd",
    "https://alice.example/elsewhere",
    "https://alice.example/pod-other/x",
    `${POD}../secret`,
    `${POD}%2e%2e/secret`,
    `${POD}a%2fb`,
    `${POD}a%5cb`,
    "https://user:password@alice.example/pod/x",
    "//evil.example/x",
    "relative.txt",
    "not a URL",
  ])("rejects out-of-scope/invalid id %s without fetching", async (id) => {
    const fetch = vi.fn(makeFakePod({}).fetch);
    const result = await (await connect(fetch)).callTool({ name: "fetch", arguments: { id } });
    expect(result.isError).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects redirect SSRF without following the target", async () => {
    const fetch = vi.fn(
      makeFakePod({
        [`${POD}redirect`]: {
          contentType: "text/plain",
          body: "",
          redirectTo: "http://127.0.0.1/private",
        },
      }).fetch,
    );
    const result = await (await connect(fetch)).callTool({
      name: "fetch",
      arguments: { id: `${POD}redirect` },
    });
    expect(result.isError).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });
});

describe("fetch representations and byte cap", () => {
  it.each([
    [
      "application/trig",
      '<https://example.org/g> { <https://example.org/s> <https://example.org/p> "named" . }',
    ],
    [
      "application/n-quads",
      '<https://example.org/s> <https://example.org/p> "named" <https://example.org/g> .',
    ],
  ])("renders named graphs from %s as a Turtle union view", async (contentType, body) => {
    const pod = makeFakePod({ [`${POD}data`]: { contentType, body } });
    const result = await fetchDocument({ fetch: pod.fetch, podRoot: POD }, `${POD}data`);
    const dataset = await parseRdf(result.text, "text/turtle");
    expect(dataset.size).toBe(1);
    expect(dataset.getGraphs(null, null, null).map((graph) => graph.termType)).toEqual([
      "DefaultGraph",
    ]);
    expect(result.text).toContain('"named"');
  });
  it.each([
    "text/turtle",
    "application/x-turtle",
    "application/n-triples",
    "application/n-quads",
    "application/trig",
  ])("serializes %s as Turtle using the resource base", async (contentType) => {
    const id = `${POD}data`;
    const body = '<https://alice.example/pod/data> <http://schema.org/name> "Alice" .';
    const pod = makeFakePod({ [id]: { contentType, body } });
    const result = await fetchDocument({ fetch: pod.fetch, podRoot: POD }, id);
    expect(result.metadata.truncated).toBe(false);
    expect((await parseRdf(result.text, "text/turtle")).size).toBe(1);
  });

  it("parses inline JSON-LD and relative Turtle identifiers", async () => {
    const id = `${POD}data`;
    for (const [contentType, body] of [
      [
        "application/ld+json",
        JSON.stringify({
          "@context": { name: "http://schema.org/name" },
          "@id": "#me",
          name: "Alice",
        }),
      ],
      ["text/turtle", '<#me> <http://schema.org/name> "Alice" .'],
    ]) {
      const pod = makeFakePod({ [id]: { contentType, body } });
      const result = await fetchDocument({ fetch: pod.fetch, podRoot: POD }, id);
      expect(result.text).toContain(`${id}#me`);
      expect(result.text).toContain('"Alice"');
    }
  });

  it.each([
    { "@context": "http://127.0.0.1/context" },
    { "@context": [null, "https://evil.example/context"] },
    { "@context": { "@import": "https://evil.example/context" } },
    { nested: [{ "@context": { term: { "@context": "https://evil.example/context" } } }] },
  ])("refuses remote JSON-LD contexts without parser network access: %j", async (document) => {
    const network = vi.fn(() => {
      throw new Error("Unexpected network");
    });
    vi.stubGlobal("fetch", network);
    const pod = makeFakePod({
      [`${POD}data`]: { contentType: "application/ld+json", body: JSON.stringify(document) },
    });
    await expect(fetchDocument({ fetch: pod.fetch, podRoot: POD }, `${POD}data`)).rejects.toThrow(
      /SSRF/,
    );
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    "application/octet-stream",
    "image/png",
    "application/json",
  ])("omits %s bytes and cancels the body", async (contentType) => {
    const fixture = streamed(new Uint8Array([0, 1, 2]), contentType);
    const result = await fetchDocument(fixture.config, `${POD}binary`);
    expect(result.text).toBe("");
    expect(result.metadata).toEqual({ contentType, truncated: false });
    expect(fixture.cancel).toHaveBeenCalledOnce();
  });

  it("treats absent Content-Type as binary and handles an empty response", async () => {
    const fetch = vi.fn(async () => new Response(null));
    const result = await fetchDocument({ fetch, podRoot: POD }, POD);
    expect(result).toMatchObject({
      title: "pod",
      text: "",
      metadata: { contentType: "application/octet-stream", truncated: false },
    });
    const empty = vi.fn(
      async () => new Response(null, { headers: { "content-type": "text/plain" } }),
    );
    expect((await fetchDocument({ fetch: empty, podRoot: POD }, `${POD}bad%zz`)).title).toBe(
      "bad%zz",
    );
  });

  it("keeps exactly 1 MiB without truncation", async () => {
    const pod = makeFakePod({
      [`${POD}text`]: { contentType: "text/plain", body: "x".repeat(CAP) },
    });
    const result = await fetchDocument({ fetch: pod.fetch, podRoot: POD }, `${POD}text`);
    expect(Buffer.byteLength(result.text)).toBe(CAP);
    expect(result.metadata.truncated).toBe(false);
  });

  it.each([
    {},
    { "content-length": "1" },
  ])("caps streamed text independently of advertised length: %j", async (headers) => {
    const fixture = streamed(Buffer.from(`${"x".repeat(CAP - 1)}🌱tail`), "text/plain", headers);
    const result = await fetchDocument(fixture.config, `${POD}text`);
    expect(result.text).toBe("x".repeat(CAP - 1));
    expect(result.metadata.truncated).toBe(true);
    expect(fixture.cancel).toHaveBeenCalledOnce();
  });

  it("caps output when invalid UTF-8 expands during decoding", async () => {
    const fixture = streamed(new Uint8Array(CAP + 1).fill(255));
    const result = await fetchDocument(fixture.config, `${POD}text`);
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(CAP);
    expect(result.metadata.truncated).toBe(true);
  });

  it("does not parse an oversized partial RDF document", async () => {
    const fixture = streamed(Buffer.from('"'.repeat(CAP + 1)), "text/turtle");
    const result = await fetchDocument(fixture.config, `${POD}rdf`);
    expect(result.text).toBe("");
    expect(result.metadata.truncated).toBe(true);
  });

  it("caps RDF whose Turtle serialization expands beyond 1 MiB", async () => {
    const body =
      "@prefix s: <https://schema.org/> .\n" +
      Array.from({ length: 12_000 }, (_, i) => `<#${i}> s:name "a" .`).join("\n");
    const id = `${POD}${"long".repeat(25)}`;
    const pod = makeFakePod({ [id]: { contentType: "text/turtle", body } });
    expect(Buffer.byteLength(body)).toBeLessThan(CAP);
    const result = await fetchDocument({ fetch: pod.fetch, podRoot: POD }, id);
    expect(result.text).toBe("");
    expect(result.metadata.truncated).toBe(true);
  });

  it.each([401, 403, 404, 500])("fails closed on HTTP %s", async (status) => {
    const pod = makeFakePod({
      [`${POD}data`]: { contentType: "text/plain", body: "private", status },
    });
    await expect(fetchDocument({ fetch: pod.fetch, podRoot: POD }, `${POD}data`)).rejects.toThrow(
      `HTTP ${status}`,
    );
  });

  it("rejects malformed RDF", async () => {
    const pod = makeFakePod({
      [`${POD}data`]: { contentType: "text/turtle", body: '"unterminated' },
    });
    await expect(fetchDocument({ fetch: pod.fetch, podRoot: POD }, `${POD}data`)).rejects.toThrow();
  });
});
