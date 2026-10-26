// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { readResource, search } from "../src/pod.js";
import type { PodPort } from "../src/pod-port.js";
import { createSolidMcpServer } from "../src/server.js";
import { createPodToolRegistry } from "../src/tools.js";

const ROOT = "https://alice.example/pod/";
const FILE = `${ROOT}memo.txt`;

function portablePod() {
  return {
    root: ROOT,
    webId: "",
    read: vi.fn<PodPort["read"]>(async () => ({
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain",
    })),
    list: vi.fn<PodPort["list"]>(async () => [
      { url: FILE, isContainer: false },
      { url: "https://evil.example/leak", isContainer: false },
    ]),
    write: vi.fn<PodPort["write"]>(async () => ({ etag: '"v2"' })),
    delete: vi.fn<PodPort["delete"]>(async () => {}),
  } satisfies PodPort;
}

async function connect(pod: PodPort, readOnly?: boolean) {
  const server = createSolidMcpServer({ pod, readOnly });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "portable-test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("tool registry over a fetch-free portable pod", () => {
  it("owns pod and ChatGPT schemas, handlers, aliases and read-only flags", () => {
    const tools = createPodToolRegistry(portablePod());
    expect(tools.map(({ name, readOnly, aliases }) => ({ name, readOnly, aliases }))).toEqual([
      { name: "search", aliases: [], readOnly: true },
      { name: "fetch", aliases: [], readOnly: true },
      { name: "pod_list", aliases: ["solid_list"], readOnly: true },
      { name: "pod_read", aliases: ["solid_read"], readOnly: true },
      { name: "solid_search", aliases: [], readOnly: true },
      { name: "pod_write", aliases: ["solid_write"], readOnly: false },
    ]);
    for (const tool of tools) expect(tool.inputSchema.toJSONSchema().type).toBe("object");
  });

  it("validates direct registry calls and wraps Error and non-Error failures", async () => {
    const pod = portablePod();
    const read = createPodToolRegistry(pod).find((tool) => tool.name === "pod_read");
    if (!read) throw new Error("pod_read missing from registry");
    expect((await read.handler({ url: 42 })).isError).toBe(true);
    expect(pod.read).not.toHaveBeenCalled();
    pod.read.mockRejectedValueOnce(new Error("unreadable")).mockRejectedValueOnce("offline");
    expect(await read.handler({ url: FILE })).toMatchObject({
      isError: true,
      content: [{ text: "unreadable" }],
    });
    expect(await read.handler({ url: FILE })).toMatchObject({
      isError: true,
      content: [{ text: "offline" }],
    });
  });

  it("serves portable lists, reads, search and resources without a fetch dependency", async () => {
    const pod = portablePod();
    const client = await connect(pod);
    try {
      const listing = await client.callTool({ name: "pod_list", arguments: { container: ROOT } });
      expect(listing).toMatchObject({
        content: [{ type: "text", text: expect.stringContaining('"name": "memo.txt"') }],
      });
      expect(JSON.stringify(listing)).not.toContain("evil.example");
      expect(await client.callTool({ name: "pod_read", arguments: { url: FILE } })).toMatchObject({
        content: [{ text: "hello" }],
      });
      expect(await client.callTool({ name: "search", arguments: { query: "memo" } })).toMatchObject(
        {
          content: [
            { text: JSON.stringify({ results: [{ id: FILE, title: "memo.txt", url: FILE }] }) },
          ],
        },
      );
      const legacy = await client.callTool({
        name: "solid_search",
        arguments: { query: "memo", scope: ROOT },
      });
      expect(JSON.parse((legacy.content as Array<{ text: string }>)[0].text)).toEqual([
        { url: FILE, name: "memo.txt", snippet: "name/url match" },
      ]);
      expect(await client.callTool({ name: "fetch", arguments: { id: FILE } })).toMatchObject({
        content: [
          {
            text: JSON.stringify({
              id: FILE,
              title: "memo.txt",
              text: "hello",
              url: FILE,
              metadata: { contentType: "text/plain", truncated: false },
            }),
          },
        ],
      });
      expect((await client.listResources()).resources.map((resource) => resource.uri)).toEqual([
        FILE,
      ]);
      expect(await client.readResource({ uri: FILE })).toMatchObject({
        contents: [{ text: "hello" }],
      });
    } finally {
      await client.close();
    }
  });

  it("normalizes injected media types and renders parameterized JSON-LD as Turtle", async () => {
    const pod = portablePod();
    pod.read.mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({ "@id": FILE, "http://schema.org/name": "Portable RDF" }),
      ),
      contentType: " APPLICATION/LD+JSON; charset=utf-8 ",
      etag: '"rdf"',
    });
    expect(await readResource(pod, FILE)).toMatchObject({
      contentType: "application/ld+json",
      text: expect.stringContaining("Portable RDF"),
      etag: '"rdf"',
    });
    const client = await connect(pod);
    try {
      for (const name of ["pod_read", "solid_read"]) {
        expect(await client.callTool({ name, arguments: { url: FILE } })).toMatchObject({
          content: [{ text: expect.stringContaining(' "Portable RDF"') }],
        });
      }
      expect(await client.readResource({ uri: FILE })).toMatchObject({
        contents: [{ mimeType: "text/turtle", text: expect.stringContaining(' "Portable RDF"') }],
      });
    } finally {
      await client.close();
    }
  });

  it("scope-checks all client-selected URLs, including an off-pod configured identity", async () => {
    const pod = portablePod();
    pod.webId = "https://identity.example/card#me";
    const client = await connect(pod, false);
    try {
      for (const url of ["https://evil.example/x", pod.webId]) {
        for (const name of [
          "pod_read",
          "solid_read",
          "pod_list",
          "solid_list",
          "pod_write",
          "solid_write",
          "fetch",
        ]) {
          expect(
            (
              await client.callTool({
                name,
                arguments: {
                  id: url,
                  url,
                  container: url,
                  content: "no",
                  contentType: "text/plain",
                },
              })
            ).isError,
          ).toBe(true);
        }
        await expect(client.readResource({ uri: url })).rejects.toThrow();
      }
      expect(pod.read).not.toHaveBeenCalled();
      expect(pod.list).not.toHaveBeenCalled();
      expect(pod.write).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("shares the portable search budget across profile, index, direct instance and listing reads", async () => {
    const pod = portablePod();
    pod.webId = `${ROOT}profile/card#me`;
    const index = `${ROOT}index.ttl`;
    const note = `${ROOT}note`;
    pod.read.mockImplementation(async (url) => ({
      body: new TextEncoder().encode(
        url === pod.webId
          ? `<${pod.webId}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${index}> .`
          : url === index
            ? `<#reg> <http://www.w3.org/ns/solid/terms#instance> <${note}> .`
            : '<> <http://schema.org/text> "portable needle" .',
      ),
      contentType: "text/turtle",
    }));
    expect(await search(pod, "needle", { maxResources: 2 })).toEqual([]);
    expect(pod.read.mock.calls.map(([url]) => url)).toEqual([pod.webId, index]);
    expect(pod.list).not.toHaveBeenCalled();
    pod.read.mockClear();
    expect(await search(pod, "needle", { maxResources: 4 })).toEqual([
      { url: note, name: "note", snippet: "literal: portable needle" },
    ]);
    expect(pod.read.mock.calls.map(([url]) => url)).toEqual([pod.webId, index, note]);
    expect(pod.read).toHaveBeenLastCalledWith(note, {
      accept: "text/turtle, application/ld+json;q=0.9",
    });
    expect(pod.list).toHaveBeenCalledWith(ROOT);
  });

  it("bounds portable fetch output and refuses remote JSON-LD and off-pod response URLs", async () => {
    const pod = portablePod();
    const fetchTool = createPodToolRegistry(pod).find((tool) => tool.name === "fetch");
    if (!fetchTool) throw new Error("fetch missing from registry");
    pod.read.mockResolvedValueOnce({
      body: new TextEncoder().encode("x".repeat(1024 * 1024 + 1)),
      contentType: "text/plain",
    });
    const capped = await fetchTool.handler({ id: FILE });
    const result = JSON.parse((capped.content[0] as { text: string }).text);
    expect(result.text.length).toBe(1024 * 1024);
    expect(result.metadata.truncated).toBe(true);
    pod.read.mockResolvedValueOnce({
      body: new TextEncoder().encode('{"@context":"https://evil.example/context"}'),
      contentType: "application/ld+json",
    });
    expect((await fetchTool.handler({ id: FILE })).isError).toBe(true);
    pod.read.mockResolvedValueOnce({
      body: new TextEncoder().encode('<#item> <http://schema.org/name> "portable" .'),
      contentType: "text/turtle",
      url: `${ROOT}redirected/file`,
    });
    const rdf = await fetchTool.handler({ id: FILE });
    expect(JSON.parse((rdf.content[0] as { text: string }).text).text).toContain(
      `${ROOT}redirected/file#item`,
    );
    pod.read.mockResolvedValueOnce({
      body: new Uint8Array(),
      contentType: "text/plain",
      url: "https://evil.example/file",
    });
    expect((await fetchTool.handler({ id: FILE })).isError).toBe(true);
  });

  it("enforces server read-only even if the injected backend allows writes", async () => {
    const pod = portablePod();
    const client = await connect(pod);
    try {
      for (const name of ["pod_write", "solid_write"]) {
        expect(
          (
            await client.callTool({
              name,
              arguments: { url: FILE, content: "hello", contentType: "text/plain" },
            })
          ).isError,
        ).toBe(true);
      }
      expect(pod.write).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("passes opt-in writes through both tool names and rejects root aliases", async () => {
    const pod = portablePod();
    const client = await connect(pod, false);
    try {
      for (const name of ["pod_write", "solid_write"]) {
        const result = await client.callTool({
          name,
          arguments: { url: FILE, content: "hello", contentType: "text/plain" },
        });
        expect(result.isError).toBeFalsy();
        expect(pod.write).toHaveBeenLastCalledWith(
          FILE,
          new TextEncoder().encode("hello"),
          "text/plain",
          {},
        );
        for (const url of [ROOT, ROOT.slice(0, -1)]) {
          expect(
            (
              await client.callTool({
                name,
                arguments: { url, content: "bad", contentType: "text/plain" },
              })
            ).isError,
          ).toBe(true);
        }
      }
      expect(pod.write).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
    }
  });

  it("renders binary tool/resource reads and wraps RDF failures", async () => {
    const pod = portablePod();
    pod.read.mockResolvedValue({ body: new Uint8Array([0, 255]), contentType: "image/png" });
    const client = await connect(pod);
    try {
      expect(await client.callTool({ name: "pod_read", arguments: { url: FILE } })).toMatchObject({
        content: [{ text: "[binary image/png, base64]\nAP8=" }],
      });
      expect(await client.readResource({ uri: FILE })).toMatchObject({
        contents: [{ blob: "AP8=", mimeType: "image/png" }],
      });
      pod.read.mockResolvedValue({
        body: new TextEncoder().encode("not valid turtle"),
        contentType: "text/turtle",
      });
      expect((await client.callTool({ name: "pod_read", arguments: { url: FILE } })).isError).toBe(
        true,
      );
    } finally {
      await client.close();
    }
  });
});
