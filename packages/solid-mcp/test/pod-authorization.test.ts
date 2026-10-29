// AUTHORED-BY Codex GPT-6
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDocument } from "../src/fetch.js";
import { readRdf, readResource, search } from "../src/pod.js";
import { createFetchPodPort, type PodPort } from "../src/pod-port.js";
import { createSolidMcpServer } from "../src/server.js";
import { containerTurtle, makeFakePod } from "./fake-pod.js";

const ROOT = "https://alice.example/pod/";
const WEBID = "https://identity.example/card#me";
const INDEX = `${ROOT}index.ttl`;
const NOTE = `${ROOT}note.ttl`;
const SOLID = "http://www.w3.org/ns/solid/terms#";
const clients: Client[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connect(pod: PodPort) {
  const server = createSolidMcpServer({ pod });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "authorization-fixture", version: "1" });
  clients.push(client);
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("injected fetch PodPort authorization boundary", () => {
  describe.each(["type-index", "listing"])("%s candidates", (discovery) => {
    it.each([
      [
        "filename",
        "sensitive-diagnosis.ttl",
        "text/turtle",
        '<> <urn:value> "unrelated".',
        "sensitive",
      ],
      ["URL", "medical/record.ttl", "text/turtle", '<> <urn:value> "unrelated".', "medical"],
      ["literal", "record.ttl", "text/turtle", '<> <urn:value> "sensitive".', "sensitive"],
      ["text filename", "sensitive.txt", "text/plain", "unrelated", "sensitive"],
      ["binary filename", "sensitive.png", "image/png", "unrelated", "sensitive"],
      ["malformed RDF filename", "sensitive.ttl", "text/turtle", "invalid RDF", "sensitive"],
    ])("requires a successful read for a %s match", async (_kind, path, contentType, body, query) => {
      const target = `${ROOT}${path}`;
      const fixture = makeFakePod({
        [WEBID]: {
          contentType: "text/turtle",
          body: `<${WEBID}> <${SOLID}privateTypeIndex> <${INDEX}>.`,
        },
        [INDEX]: { contentType: "text/turtle", body: `<#r> <${SOLID}instance> <${target}>.` },
        [ROOT]: {
          contentType: "text/turtle",
          body: containerTurtle(ROOT, discovery === "listing" ? [{ name: path }] : []),
        },
        [target]: { contentType, body },
      });
      const pod = createFetchPodPort({
        fetch: fixture.fetch,
        podRoot: ROOT,
        ...(discovery === "type-index" ? { webId: WEBID } : {}),
      });
      const client = await connect(pod);
      const read = pod.read;
      let deny = true;
      pod.read = vi.fn(async (url, options) => {
        const result = await read(url, options);
        // Content-based policy: the entire injected read must finish authorizing.
        if (url === target && deny) throw new Error("purpose denied");
        return result;
      });
      // Hints must not resurrect an entry hidden by a filtered listing.
      if (discovery === "type-index") pod.list = vi.fn(async () => []);

      for (const name of ["search", "solid_search"]) {
        const result = await client.callTool({ name, arguments: { query } });
        expect(result).toMatchObject({
          content: [{ text: name === "search" ? '{"results":[]}' : "[]" }],
        });
        expect(JSON.stringify(result)).not.toContain(target);
      }
      expect(await search(pod, query)).toEqual([]);
      expect(vi.mocked(pod.read).mock.calls.some(([url]) => url === target)).toBe(true);

      deny = false;
      // A successful read with no matching literal (or invalid/non-RDF content)
      // still permits a name/URL hit. A denial must remain a different outcome.
      for (const name of ["search", "solid_search"]) {
        const result = await client.callTool({ name, arguments: { query } });
        const hits = JSON.parse((result.content as { text: string }[])[0].text);
        expect(
          name === "search"
            ? hits.results.map((hit: { id: string }) => hit.id)
            : hits.map((hit: { url: string }) => hit.url),
        ).toEqual([target]);
      }
    });
  });

  it("authorizes container name matches even when maxDepth prevents descent", async () => {
    const target = `${ROOT}sensitive/`;
    const fixture = makeFakePod({
      [ROOT]: {
        contentType: "text/turtle",
        body: containerTurtle(ROOT, [{ name: "sensitive/", container: true }]),
      },
      [target]: { contentType: "text/turtle", body: containerTurtle(target, []) },
    });
    const pod = createFetchPodPort({ fetch: fixture.fetch, podRoot: ROOT });
    const read = pod.read;
    pod.read = vi.fn(async (url, options) => {
      if (url === target) throw new Error("purpose denied");
      return read(url, options);
    });
    expect(await search(pod, "sensitive", { maxDepth: 0 })).toEqual([]);
    expect(pod.read).toHaveBeenCalledWith(target, undefined);
    pod.read = read;
    expect(await search(pod, "sensitive", { maxDepth: 0 })).toEqual([
      { url: target, name: "sensitive", snippet: "name/url match" },
    ]);
  });

  it("filters unreadable child metadata from list tools and MCP resources", async () => {
    const secret = `${ROOT}sensitive-diagnosis.ttl`;
    const fixture = makeFakePod({
      [ROOT]: {
        contentType: "text/turtle",
        body: containerTurtle(ROOT, [{ name: "sensitive-diagnosis.ttl" }, { name: "note.ttl" }]),
      },
      [secret]: { contentType: "text/turtle", body: '<> <urn:medical> "private history".' },
      [NOTE]: { contentType: "text/turtle", body: '<> <urn:public> "guidance".' },
    });
    const pod = createFetchPodPort({ fetch: fixture.fetch, podRoot: ROOT });
    const client = await connect(pod);
    const read = pod.read;
    pod.read = vi.fn(async (url, options) => {
      if (url === secret) throw new Error("purpose denied");
      return read(url, options);
    });
    for (const name of ["pod_list", "solid_list"]) {
      const result = await client.callTool({ name, arguments: { container: ROOT } });
      expect(result.isError).toBeFalsy();
      const children = JSON.parse((result.content as { text: string }[])[0].text);
      expect(children.map((child: { url: string }) => child.url)).toEqual([NOTE]);
    }
    expect((await client.listResources()).resources.map(({ uri }) => uri)).toEqual([NOTE]);
    const result = await client.readResource({ uri: ROOT });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).toContain(NOTE);
  });

  it("discards a hinted match if a later scan read denies the same resource", async () => {
    const secret = `${ROOT}sensitive.ttl`;
    const fixture = makeFakePod({
      [WEBID]: {
        contentType: "text/turtle",
        body: `<${WEBID}> <${SOLID}privateTypeIndex> <${INDEX}>.`,
      },
      [INDEX]: { contentType: "text/turtle", body: `<#r> <${SOLID}instance> <${secret}>.` },
      [ROOT]: {
        contentType: "text/turtle",
        body: containerTurtle(ROOT, [{ name: "sensitive.ttl" }]),
      },
      [secret]: { contentType: "text/turtle", body: '<> <urn:value> "sensitive".' },
    });
    const pod = createFetchPodPort({ fetch: fixture.fetch, podRoot: ROOT, webId: WEBID });
    const read = pod.read;
    const client = await connect(pod);
    let reads = 0;
    pod.read = vi.fn(async (url, options) => {
      if (url === secret && ++reads > 1) throw new Error("purpose denied");
      return read(url, options);
    });
    for (const name of ["search", "solid_search"]) {
      reads = 0;
      expect(await client.callTool({ name, arguments: { query: "sensitive" } })).toMatchObject({
        content: [{ text: name === "search" ? '{"results":[]}' : "[]" }],
      });
      expect(reads).toBe(2);
    }
  });

  it.each([
    "type-index",
    "listing",
  ])("does not publish a %s match while authorization is pending", async (discovery) => {
    vi.useFakeTimers();
    const secret = `${ROOT}sensitive.ttl`;
    const fixture = makeFakePod({
      [WEBID]: {
        contentType: "text/turtle",
        body: `<${WEBID}> <${SOLID}privateTypeIndex> <${INDEX}>.`,
      },
      [INDEX]: { contentType: "text/turtle", body: `<#r> <${SOLID}instance> <${secret}>.` },
      [ROOT]: {
        contentType: "text/turtle",
        body: containerTurtle(ROOT, discovery === "listing" ? [{ name: "sensitive.ttl" }] : []),
      },
      [secret]: { contentType: "text/turtle", body: '<> <urn:value> "sensitive".' },
    });
    const pod = createFetchPodPort({
      fetch: fixture.fetch,
      podRoot: ROOT,
      ...(discovery === "type-index" ? { webId: WEBID } : {}),
    });
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = pod.read;
    pod.read = vi.fn(async (url, options) => {
      const result = await read(url, options);
      if (url === secret) await pending;
      return result;
    });
    const searching = search(pod, "sensitive", { maxTimeMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    const hits = await searching;
    expect(pod.read).toHaveBeenCalledWith(secret, {
      accept: "text/turtle, application/ld+json;q=0.9",
    });
    expect(hits).toEqual([]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(hits).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("denies container tools and resources when only list authorization succeeds", async () => {
    const fixture = makeFakePod({
      [ROOT]: { contentType: "text/turtle", body: containerTurtle(ROOT, [{ name: "note.ttl" }]) },
      [NOTE]: { contentType: "text/plain", body: "public note" },
    });
    const pod = createFetchPodPort({ fetch: fixture.fetch, podRoot: ROOT });
    const client = await connect(pod);
    pod.read = vi.fn(async () => {
      throw new Error("purpose denied");
    });
    for (const name of ["pod_list", "solid_list"]) {
      expect(await client.callTool({ name, arguments: { container: ROOT } })).toMatchObject({
        isError: true,
        content: [{ text: "purpose denied" }],
      });
    }
    await expect(client.listResources()).rejects.toThrow("purpose denied");
    await expect(client.readResource({ uri: ROOT })).rejects.toThrow("purpose denied");
  });

  it("validates injected response URLs before returning resource content", async () => {
    const pod = createFetchPodPort({ fetch: makeFakePod({}).fetch, podRoot: ROOT });
    pod.read = vi.fn(async () => ({
      body: new TextEncoder().encode('<> <urn:value> "private history".'),
      contentType: "text/turtle",
      url: "https://evil.example/secret.ttl",
    }));
    await expect(readResource(pod, NOTE)).rejects.toThrow(/pod-scope/);
    await expect(readRdf(pod, NOTE)).rejects.toThrow(/pod-scope/);
    const client = await connect(pod);
    for (const name of ["pod_read", "solid_read", "fetch"]) {
      const result = await client.callTool({ name, arguments: { url: NOTE, id: NOTE } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("private history");
    }
    await expect(client.readResource({ uri: NOTE })).rejects.toThrow(/pod-scope/);
  });

  it.each([
    "grant denied",
    "purpose denied",
  ])("fetch enforces current read authorization: %s", async (denial) => {
    const fixture = makeFakePod({
      [NOTE]: { contentType: "text/plain", body: "private medical history" },
    });
    const fetch = vi.fn(fixture.fetch);
    const pod = createFetchPodPort({ fetch, podRoot: ROOT });
    const client = await connect(pod);
    // Decorate after server construction: each call must use the current boundary.
    pod.read = vi.fn(async () => {
      throw new Error(denial);
    });

    for (const name of ["pod_read", "solid_read", "fetch"]) {
      expect(await client.callTool({ name, arguments: { id: NOTE, url: NOTE } })).toMatchObject({
        isError: true,
        content: [{ type: "text", text: denial }],
      });
    }
    expect(pod.read).toHaveBeenCalledTimes(3);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "profile",
    "index",
    "literal",
  ])("search enforces decorated %s read authorization", async (stage) => {
    const fixture = makeFakePod({
      [WEBID]: {
        contentType: "text/turtle",
        body: `<${WEBID}> <${SOLID}privateTypeIndex> <${INDEX}>.`,
      },
      [INDEX]: { contentType: "text/turtle", body: `<#r> <${SOLID}instance> <${NOTE}>.` },
      [ROOT]: {
        contentType: "text/turtle",
        body: containerTurtle(ROOT, stage === "literal" ? [{ name: "note.ttl" }] : []),
      },
      [NOTE]: { contentType: "text/turtle", body: '<> <urn:medical> "sensitive diagnosis".' },
    });
    const fetch = vi.fn(fixture.fetch);
    const pod = createFetchPodPort({ fetch, podRoot: ROOT, webId: WEBID });
    const read = pod.read;
    const denied = stage === "profile" ? WEBID : stage === "index" ? INDEX : NOTE;
    pod.read = vi.fn(async (url, options) => {
      if (url === denied) throw new Error("purpose denied");
      return read(url, options);
    });
    const client = await connect(pod);

    for (const name of ["search", "solid_search"]) {
      expect(await client.callTool({ name, arguments: { query: "sensitive" } })).toMatchObject({
        content: [{ type: "text", text: name === "search" ? '{"results":[]}' : "[]" }],
      });
    }
    expect(pod.read).toHaveBeenCalledWith(denied, {
      accept: "text/turtle, application/ld+json;q=0.9",
    });
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(denied);
  });

  it.each(["deny", "filter"])("search respects a decorated list that can %s", async (policy) => {
    const secret = `${ROOT}sensitive-diagnosis.ttl`;
    const publicNote = `${ROOT}sensitive-public.ttl`;
    const fixture = makeFakePod({
      [ROOT]: {
        contentType: "text/turtle",
        body: containerTurtle(ROOT, [
          { name: "sensitive-diagnosis.ttl" },
          { name: "sensitive-public.ttl" },
        ]),
      },
      [secret]: { contentType: "text/turtle", body: '<> <urn:medical> "private history".' },
      [publicNote]: { contentType: "text/turtle", body: '<> <urn:public> "public guidance".' },
    });
    const fetch = vi.fn(fixture.fetch);
    const pod = createFetchPodPort({ fetch, podRoot: ROOT });
    const list = pod.list;
    const client = await connect(pod);
    pod.list = vi.fn(async (url) => {
      if (policy === "deny") throw new Error("grant denied");
      return (await list(url)).filter((entry) => entry.url !== secret);
    });

    for (const name of ["search", "solid_search"]) {
      const result = await client.callTool({ name, arguments: { query: "sensitive" } });
      const hits = JSON.parse((result.content as { text: string }[])[0].text);
      expect(
        name === "search"
          ? hits.results.map((hit: { id: string }) => hit.id)
          : hits.map((hit: { url: string }) => hit.url),
      ).toEqual(policy === "deny" ? [] : [publicNote]);
    }
    expect(pod.list).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(secret);
    if (policy === "deny") expect(fetch).not.toHaveBeenCalled();
  });

  it("fetch and search use the representation returned by the decorated read", async () => {
    const fixture = makeFakePod({
      [ROOT]: { contentType: "text/turtle", body: containerTurtle(ROOT, [{ name: "note.ttl" }]) },
      [NOTE]: { contentType: "text/turtle", body: '<> <urn:medical> "sensitive diagnosis".' },
    });
    const pod = createFetchPodPort({ fetch: fixture.fetch, podRoot: ROOT });
    const read = pod.read;
    pod.read = vi.fn(async (url, options) => ({
      ...(await read(url, options)),
      body: new TextEncoder().encode('<> <urn:public> "redacted summary".'),
    }));
    const client = await connect(pod);

    const fetched = await client.callTool({ name: "fetch", arguments: { id: NOTE } });
    const document = JSON.parse((fetched.content as { text: string }[])[0].text);
    expect(document.text).toContain("redacted summary");
    expect(document.text).not.toContain("sensitive diagnosis");
    expect(
      await client.callTool({ name: "search", arguments: { query: "sensitive" } }),
    ).toMatchObject({
      content: [{ text: '{"results":[]}' }],
    });
    expect(
      await client.callTool({ name: "search", arguments: { query: "redacted" } }),
    ).toMatchObject({
      content: [
        { text: JSON.stringify({ results: [{ id: NOTE, title: "note.ttl", url: NOTE }] }) },
      ],
    });
  });

  it.each([
    [
      "oversized text",
      "text/plain",
      `private medical history\n${"x".repeat(1024 * 1024)}\npurpose denied`,
    ],
    ["binary", "image/png", "private medical history\npurpose denied"],
  ])("fails closed when a %s download would bypass a decorator's content check", async (_kind, contentType, body) => {
    const fixture = makeFakePod({
      [NOTE]: { contentType, body },
    });
    const pod = createFetchPodPort({ fetch: fixture.fetch, podRoot: ROOT });
    const read = pod.read;
    pod.read = vi.fn(async (...args) => {
      const result = await read(...args);
      if (new TextDecoder().decode(result.body).includes("purpose denied")) {
        throw new Error("purpose denied");
      }
      return result;
    });
    const client = await connect(pod);

    expect(await client.callTool({ name: "pod_read", arguments: { url: NOTE } })).toMatchObject({
      isError: true,
      content: [{ text: "purpose denied" }],
    });
    const fetched = await client.callTool({ name: "fetch", arguments: { id: NOTE } });
    expect(fetched.isError).toBe(true);
    expect(JSON.stringify(fetched)).not.toContain("private medical history");
  });

  it("isolates concurrent search deadlines and fetch limits through async decorators", async () => {
    vi.useFakeTimers();
    const fixture = makeFakePod({
      [ROOT]: { contentType: "text/turtle", body: containerTurtle(ROOT, [{ name: "note.ttl" }]) },
      [NOTE]: { contentType: "text/turtle", body: '<> <urn:public> "needle".' },
      [`${ROOT}large.txt`]: { contentType: "text/plain", body: "x".repeat(1024 * 1024 + 1) },
    });
    const pod = createFetchPodPort({ fetch: fixture.fetch, podRoot: ROOT });
    const list = pod.list;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    pod.list = vi.fn(async (url) => {
      await gate;
      return list(url);
    });

    const continuing = search(pod, "needle", { maxResources: 2, maxTimeMs: 100 });
    const expiring = search(pod, "needle", { maxResources: 1, maxTimeMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    expect(await expiring).toEqual([]);
    release();
    expect(await continuing).toEqual([{ url: NOTE, name: "note.ttl", snippet: "literal: needle" }]);
    expect(pod.list).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);

    const fetched = await fetchDocument(pod, `${ROOT}large.txt`);
    expect(fetched.metadata.truncated).toBe(true);
    expect(fetched.text.length).toBe(1024 * 1024);
    const read = pod.read;
    pod.read = vi.fn(async (...args) => {
      await Promise.resolve();
      return read(...args);
    });
    expect((await fetchDocument(pod, NOTE)).text).toContain("needle");
    // A normal read keeps its raw-byte contract after the limited calls finish.
    expect((await pod.read(`${ROOT}large.txt`)).body.length).toBe(1024 * 1024 + 1);
    expect(pod.read).toHaveBeenCalledTimes(2);
  });
});
