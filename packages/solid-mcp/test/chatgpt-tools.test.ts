// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SolidMcpConfig } from "../src/auth.js";
import { fetchDocument as fetchSourceDocument } from "../src/fetch.js";
import { createFetchPodPort } from "../src/pod-port.js";
import { createSolidMcpServer } from "../src/server.js";
import { containerTurtle, makeFakePod } from "./fake-pod.js";

const POD = "https://alice.example/pod/";
const CAP = 1024 * 1024;
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.unstubAllGlobals();
});

async function connectClient(
  fetch: typeof globalThis.fetch,
  searchLimits: SolidMcpConfig["searchLimits"],
  portable: boolean,
) {
  const config = { fetch, podRoot: POD, searchLimits };
  const server = createSolidMcpServer(portable ? { pod: createFetchPodPort(config) } : config);
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

describe.each([false, true])("ChatGPT tool contracts (fetch PodPort: %s)", (portable) => {
  const connect = (fetch: typeof globalThis.fetch, searchLimits?: SolidMcpConfig["searchLimits"]) =>
    connectClient(fetch, searchLimits, portable);
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

  it("fetch and search preserve RDF ending in a Unicode comment without a newline", async () => {
    const id = `${POD}data.ttl`;
    const pod = makeFakePod({
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, [{ name: "data.ttl" }]) },
      [id]: { contentType: "text/turtle", body: '<urn:s> <urn:p> "avocado". # café' },
    });
    const client = await connect(pod.fetch);
    const fetched = await client.callTool({ name: "fetch", arguments: { id } });
    expect(fetched.isError).toBeUndefined();
    const content = fetched.content as { type: "text"; text: string }[];
    const document = JSON.parse(content[0]?.text ?? "{}");
    expect(document.metadata.truncated).toBe(false);
    expect(
      (await parseRdf(document.text, "text/turtle")).getQuads("urn:s", "urn:p", null, null)[0]
        ?.object.value,
    ).toBe("avocado");
    const searched = await client.callTool({ name: "search", arguments: { query: "avocado" } });
    expect(searched.isError).toBeUndefined();
    expect(searched.content).toEqual([
      { type: "text", text: JSON.stringify({ results: [{ id, title: "data.ttl", url: id }] }) },
    ]);
  });

  it.each([
    ["nesting", "text/turtle", `${"[ <urn:p> ".repeat(2_000)}"x"${"]".repeat(2_000)} .`],
    ["empty nodes", "text/turtle", "<urn:s> <urn:p> [] .\n".repeat(10_000)],
    ["empty graphs", "application/trig", "{}\n".repeat(20_000)],
  ])("fetch truncates and search skips excessive N3 %s", async (_kind, contentType, expansion) => {
    const id = `${POD}data.ttl`;
    const body = `<urn:s> <urn:p> "avocado" .\n${expansion}`;
    expect(Buffer.byteLength(body)).toBeLessThan(CAP);
    const pod = makeFakePod({
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, [{ name: "data.ttl" }]) },
      [id]: { contentType, body },
    });
    const client = await connect(pod.fetch);
    const fetched = await client.callTool({ name: "fetch", arguments: { id } });
    expect(fetched.isError).toBeUndefined();
    const content = fetched.content as { type: "text"; text: string }[];
    expect(JSON.parse(content[0]?.text ?? "{}")).toMatchObject({
      text: "",
      metadata: { contentType, truncated: true },
    });
    const searched = await client.callTool({ name: "search", arguments: { query: "avocado" } });
    expect(searched.isError).toBeUndefined();
    expect(searched.content).toEqual([{ type: "text", text: '{"results":[]}' }]);
  });

  it.each([
    ["text/turtle", '?s <urn:p> "avocado".'],
    ["text/turtle", '<urn:s> = "avocado".'],
    ["application/x-turtle", '?s <urn:p> "avocado".'],
    ["application/x-turtle", '<urn:s> = "avocado".'],
    ["application/trig", '?s <urn:p> "avocado".'],
    ["application/trig", '<urn:s> = "avocado".'],
  ])("fetch rejects and search skips N3 extensions in %s: %s", async (contentType, body) => {
    const id = `${POD}data.ttl`;
    const pod = makeFakePod({
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, [{ name: "data.ttl" }]) },
      [id]: { contentType, body },
    });
    const client = await connect(pod.fetch);
    expect((await client.callTool({ name: "fetch", arguments: { id } })).isError).toBe(true);
    const searched = await client.callTool({ name: "search", arguments: { query: "avocado" } });
    expect(searched.isError).toBeUndefined();
    expect(searched.content).toEqual([{ type: "text", text: '{"results":[]}' }]);
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

describe.each([
  false,
  true,
])("fetch representations and byte cap (fetch PodPort: %s)", (portable) => {
  const fetchDocument = (config: SolidMcpConfig, id: string) =>
    fetchSourceDocument(portable ? createFetchPodPort(config) : config, id);
  it("uses the hostname as the title when the pod root has no path segment", async () => {
    const root = "https://alice.example/";
    const pod = makeFakePod({ [root]: { contentType: "text/plain", body: "Hello" } });
    expect((await fetchDocument({ fetch: pod.fetch, podRoot: root }, root)).title).toBe(
      "alice.example",
    );
  });
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
    [42, "integer", "42"],
    [0, "integer", "0"],
    [12.5, "double", "1.25E1"],
    [1e21, "double", "1.0E21"],
    [0, "double", "0.0E0"],
    [42, "double", "4.2E1"],
    ["12.5", "double", "12.5"],
    [true, "boolean", "true"],
    [false, "boolean", "false"],
  ])("fetch and search preserve typed JSON-LD scalar %s", async (value, type, lexical) => {
    const id = `${POD}data.jsonld`;
    const datatype = `http://www.w3.org/2001/XMLSchema#${type}`;
    const pod = makeFakePod({
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, [{ name: "data.jsonld" }]) },
      [id]: {
        contentType: "application/ld+json",
        body: JSON.stringify({ "@id": id, "urn:value": { "@value": value, "@type": datatype } }),
      },
    });
    const client = await connectClient(pod.fetch, undefined, portable);
    const fetched = await client.callTool({ name: "fetch", arguments: { id } });
    expect(fetched.isError).toBeUndefined();
    const content = fetched.content as { type: "text"; text: string }[];
    const document = JSON.parse(content[0]?.text ?? "{}");
    expect(document.metadata).toEqual({ contentType: "application/ld+json", truncated: false });
    const dataset = await parseRdf(document.text, "text/turtle");
    expect(dataset.size).toBe(1);
    expect(dataset.getQuads(id, "urn:value", null, null)[0]?.object).toMatchObject({
      termType: "Literal",
      value: lexical,
      datatype: { value: datatype },
    });
    const searched = await client.callTool({ name: "search", arguments: { query: lexical } });
    expect(searched.isError).toBeUndefined();
    expect(searched.content).toEqual([
      { type: "text", text: JSON.stringify({ results: [{ id, title: "data.jsonld", url: id }] }) },
    ]);
  });

  it.each([
    "explicit",
    "coerced",
    "aliased",
  ])("preserves opaque JSON literals with %s typing", async (typing) => {
    const network = vi.fn(() => {
      throw new Error("Unexpected network");
    });
    vi.stubGlobal("fetch", network);
    const id = `${POD}data`;
    const value = {
      "@context": "https://evil.example/context",
      "@import": "http://127.0.0.1/context",
      nested: [{ "@context": { "@import": "https://evil.example/nested" } }],
    };
    const document = {
      "@context": {
        data: typing === "coerced" ? { "@id": "urn:data", "@type": "@json" } : "urn:data",
        ...(typing === "aliased" ? { value: "@value", type: "@type" } : {}),
      },
      "@id": id,
      data:
        typing === "coerced"
          ? value
          : typing === "aliased"
            ? { value, type: "@json" }
            : { "@value": value, "@type": "@json" },
    };
    const pod = makeFakePod({
      [id]: { contentType: "application/ld+json", body: JSON.stringify(document) },
    });
    const result = await fetchDocument({ fetch: pod.fetch, podRoot: POD }, id);
    expect(result.metadata).toEqual({ contentType: "application/ld+json", truncated: false });
    const dataset = await parseRdf(result.text, "text/turtle");
    expect(dataset.size).toBe(1);
    const literal = dataset.getQuads(id, "urn:data", null, null)[0]?.object;
    expect(literal?.termType).toBe("Literal");
    expect(literal).toMatchObject({
      datatype: { value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON" },
    });
    expect(JSON.parse(literal?.value ?? "null")).toEqual(value);
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    '"@context":"https://evil.example/context"',
    '"@context":{"@import":"https://evil.example/context"}',
  ])("normalizes duplicate context keys before parsing: %s", async (discarded) => {
    const network = vi.fn(() => {
      throw new Error("Unexpected network");
    });
    vi.stubGlobal("fetch", network);
    const id = `${POD}data`;
    const pod = makeFakePod({
      [id]: {
        contentType: "application/ld+json",
        body: `{${discarded},"@context":{"name":"http://schema.org/name"},"@id":"#me","name":"Alice"}`,
      },
    });
    const result = await fetchDocument({ fetch: pod.fetch, podRoot: POD }, id);
    expect(result.text).toContain(`${id}#me`);
    expect(result.text).toContain('"Alice"');
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    ["text/turtle", '<#me> <http://schema.org/name> "Alice" .'],
    [
      "application/ld+json",
      '{"@context":{"name":"http://schema.org/name"},"@id":"#me","name":"Alice"}',
    ],
  ])("resolves redirected %s against the effective response URL", async (contentType, body) => {
    const id = `${POD}alias`;
    const finalUrl = `${POD}actual/data`;
    const pod = makeFakePod({
      [id]: { contentType: "text/plain", body: "", redirectTo: finalUrl },
      [finalUrl]: { contentType, body },
    });
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await pod.fetch(input, init);
      Object.defineProperty(response, "url", { value: String(input) });
      return response;
    });
    const result = await fetchDocument({ fetch, podRoot: POD }, id);
    const dataset = await parseRdf(result.text, "text/turtle");
    expect(dataset.getSubjects(null, null, null).map((subject) => subject.value)).toEqual([
      `${finalUrl}#me`,
    ]);
    expect(result).toMatchObject({ id, url: id });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([id, finalUrl]);
  });

  it.each([
    { "@context": "http://127.0.0.1/context" },
    { "@context": [null, "https://evil.example/context"] },
    { "@context": { "@import": "https://evil.example/context" } },
    {
      "@context": { nested: "urn:nested" },
      nested: [
        {
          "@context": {
            term: { "@id": "urn:term", "@context": "https://evil.example/context" },
          },
          term: { "urn:value": "x" },
        },
      ],
    },
    {
      "@context": {
        term: {
          "@id": "urn:term",
          "@context": { "@import": "https://evil.example/context" },
        },
      },
      term: { "urn:value": "x" },
    },
    {
      "@context": "https://evil.example/context",
      "urn:data": { "@type": "@json", "@value": { "@context": "ordinary data" } },
    },
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

  it.each([
    "text/turtle",
    "application/ld+json",
  ])("bounds expanded terms while parsing %s", async (contentType) => {
    const iri = `https://example.org/${"long".repeat(4096)}`;
    const body =
      contentType === "text/turtle"
        ? `@prefix p: <${iri}> .\n${'<#s> p:name "a" .\n'.repeat(100)}"unterminated`
        : `{"@context":{"name":"${iri}"},"@graph":[${Array.from(
            { length: 100 },
            (_, i) => `{"@id":"#${i}","name":"a"}`,
          ).join(",")}]}`;
    expect(Buffer.byteLength(body)).toBeLessThan(CAP);
    const id = `${POD}data`;
    const pod = makeFakePod({ [id]: { contentType, body } });
    const result = await fetchDocument({ fetch: pod.fetch, podRoot: POD }, id);
    expect(result.text).toBe("");
    expect(result.metadata.truncated).toBe(true);
  });

  it("caps Turtle escaping even when parsed term bytes fit the budget", async () => {
    const id = `${POD}data`;
    const body = `<> <https://schema.org/text> "${"🌱".repeat(150_000)}" .`;
    expect(Buffer.byteLength(body)).toBeLessThan(CAP);
    const pod = makeFakePod({ [id]: { contentType: "text/turtle", body } });
    const result = await fetchDocument({ fetch: pod.fetch, podRoot: POD }, id);
    expect(result.text).toBe("");
    expect(result.metadata.truncated).toBe(true);
  });

  it.each([
    ["depth", `${"[".repeat(100)}null${"]".repeat(100)}`],
    ["structural work", `[${"{},".repeat(99_999)}{}]`],
  ])("marks excessive JSON-LD %s as truncated", async (_kind, body) => {
    const id = `${POD}data`;
    expect(Buffer.byteLength(body)).toBeLessThan(CAP);
    const pod = makeFakePod({ [id]: { contentType: "application/ld+json", body } });
    const result = await fetchDocument({ fetch: pod.fetch, podRoot: POD }, id);
    expect(result.text).toBe("");
    expect(result.metadata).toEqual({ contentType: "application/ld+json", truncated: true });
  });

  it("marks unused inline context expansion as truncated", async () => {
    const id = `${POD}data`;
    const context = {
      p: `https://example.org/${"long".repeat(4096)}/`,
      ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, "p:x"])),
    };
    const body = JSON.stringify({ "@context": context });
    expect(Buffer.byteLength(body)).toBeLessThan(CAP);
    const pod = makeFakePod({ [id]: { contentType: "application/ld+json", body } });
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
