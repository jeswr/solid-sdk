// AUTHORED-BY Codex GPT-6
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDocument } from "../src/fetch.js";
import { search } from "../src/pod.js";
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
