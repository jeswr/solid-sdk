// AUTHORED-BY Claude Opus 5.5
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import {
  containsCardNumber,
  createContextToolRegistry,
  readSharedContext,
  SHARED_CONTEXT_PATH,
  sharedContextUrl,
} from "../src/context-tools.js";
import type { PodPort } from "../src/pod-port.js";
import { createSolidMcpServer } from "../src/server.js";
import { makeFakePod } from "./fake-pod.js";

const ROOT = "https://alice.example/pod/";
const CONTEXT = `${ROOT}${SHARED_CONTEXT_PATH}`;
const MARKDOWN = "# How I work\n\n- Reply in British English.\n";

function portablePod(read: PodPort["read"]) {
  return {
    root: ROOT,
    webId: "",
    read: vi.fn<PodPort["read"]>(read),
    list: vi.fn<PodPort["list"]>(async () => []),
    write: vi.fn<PodPort["write"]>(async () => ({})),
    delete: vi.fn<PodPort["delete"]>(async () => {}),
  } satisfies PodPort;
}

function markdownPod(contentType = "text/markdown") {
  return portablePod(async () => ({
    body: new TextEncoder().encode(MARKDOWN),
    contentType,
    etag: '"v1"',
  }));
}

async function connect(config: Parameters<typeof createSolidMcpServer>[0]) {
  const server = createSolidMcpServer(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "context-test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function parse(result: Awaited<ReturnType<Client["callTool"]>>) {
  const [first] = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(first?.text ?? "null");
}

describe("shared context", () => {
  it("resolves the conventional path under the pod root", () => {
    expect(sharedContextUrl(ROOT)).toBe(CONTEXT);
    expect(sharedContextUrl("https://alice.example/")).toBe(
      "https://alice.example/agent/context/shared-context.md",
    );
  });

  it("returns the owner's Markdown with its URL and ETag", async () => {
    const pod = markdownPod();
    expect(await readSharedContext(pod)).toEqual({
      status: "ok",
      url: CONTEXT,
      contentType: "text/markdown",
      etag: '"v1"',
      text: MARKDOWN,
    });
    expect(pod.read).toHaveBeenCalledWith(CONTEXT, undefined);
  });

  it("accepts plain text and omits a missing ETag", async () => {
    const pod = portablePod(async () => ({
      body: new TextEncoder().encode("plain"),
      contentType: "text/plain",
    }));
    expect(await readSharedContext(pod)).toEqual({
      status: "ok",
      url: CONTEXT,
      contentType: "text/plain",
      text: "plain",
    });
  });

  it("reports a missing document as not set up, for status and message forms", async () => {
    const byStatus = portablePod(async () => {
      throw Object.assign(new Error("absent"), { status: 404 });
    });
    const byMessage = portablePod(async () => {
      throw new Error(`failed to read ${CONTEXT}: HTTP 404 Not Found`);
    });
    for (const pod of [byStatus, byMessage])
      expect(await readSharedContext(pod)).toMatchObject({ status: "not_found", url: CONTEXT });
  });

  it("propagates other failures and refuses non-text representations", async () => {
    await expect(
      readSharedContext(
        portablePod(async () => {
          throw new Error(`failed to read ${CONTEXT}: HTTP 500 Internal Server Error`);
        }),
      ),
    ).rejects.toThrow("HTTP 500");
    await expect(
      readSharedContext(
        portablePod(async () => {
          throw "offline";
        }),
      ),
    ).rejects.toBe("offline");
    await expect(
      readSharedContext(
        portablePod(async () => {
          throw null;
        }),
      ),
    ).rejects.toBeNull();
    await expect(readSharedContext(markdownPod("text/html"))).rejects.toThrow("unreadable");
    await expect(
      readSharedContext(
        portablePod(async () => ({ body: new Uint8Array([0, 1]), contentType: "" })),
      ),
    ).rejects.toThrow("unreadable");
  });

  it("treats only structured or exact fetch-adapter 404/410 failures as absent", async () => {
    const gone = portablePod(async () => {
      throw Object.assign(new Error("gone"), { status: 410 });
    });
    expect(await readSharedContext(gone)).toMatchObject({ status: "not_found" });
    const unrelated = portablePod(async () => {
      throw new Error("ACL lookup for https://alice.example/pod/.acl failed: HTTP 404");
    });
    await expect(readSharedContext(unrelated)).rejects.toThrow("ACL lookup");
  });

  it("refuses a context that redirects or aliases to another resource", async () => {
    const aliased = portablePod(async (url) => ({
      body: new TextEncoder().encode("secret"),
      contentType: "text/markdown",
      url: url === CONTEXT ? `${ROOT}secret/health.md` : url,
    }));
    await expect(readSharedContext(aliased)).rejects.toThrow("redirect refused");
    const offPod = portablePod(async () => ({
      body: new TextEncoder().encode("secret"),
      contentType: "text/markdown",
      url: "https://evil.example/context.md",
    }));
    await expect(readSharedContext(offPod)).rejects.toThrow("pod-scope");
    const same = portablePod(async () => ({
      body: new TextEncoder().encode(MARKDOWN),
      contentType: "text/markdown",
      url: CONTEXT,
    }));
    expect(await readSharedContext(same)).toMatchObject({ status: "ok", text: MARKDOWN });
  });

  it("refuses invalid UTF-8", async () => {
    const pod = portablePod(async () => ({
      body: new Uint8Array([0xff, 0xfe]),
      contentType: "text/markdown",
    }));
    await expect(readSharedContext(pod)).rejects.toThrow();
  });

  it("refuses a context containing a payment card number, without echoing it", async () => {
    for (const card of ["4111111111111111", "4111 1111 1111 1111", "5500-0000-0000-0004"]) {
      const pod = portablePod(async () => ({
        body: new TextEncoder().encode(`My card is ${card}.`),
        contentType: "text/markdown",
      }));
      const result = await readSharedContext(pod);
      expect(result).toMatchObject({ status: "refused", url: CONTEXT });
      expect(JSON.stringify(result)).not.toContain(card.slice(-4));
    }
  });

  it("detects only Luhn-valid 12-19 digit runs", () => {
    expect(containsCardNumber("4111111111111111")).toBe(true);
    expect(containsCardNumber("4111111111111112")).toBe(false);
    expect(containsCardNumber("phone 07700 900123, born 1990")).toBe(false);
    expect(containsCardNumber("12345678901")).toBe(false);
    expect(containsCardNumber("")).toBe(false);
  });

  it("registers one read-only tool that takes no arguments", async () => {
    const [tool, ...rest] = createContextToolRegistry(markdownPod());
    expect(rest).toEqual([]);
    expect(tool).toMatchObject({ name: "context_read", aliases: [], readOnly: true });
    expect((await tool?.handler({ url: "https://evil.example/" }))?.isError).toBe(true);
  });

  it("serves context_read over MCP on a read-only server", async () => {
    const client = await connect({ pod: markdownPod() });
    const { tools } = await client.listTools();
    expect(tools.find(({ name }) => name === "context_read")?.annotations).toMatchObject({
      readOnlyHint: true,
    });
    expect(parse(await client.callTool({ name: "context_read", arguments: {} }))).toMatchObject({
      status: "ok",
      text: MARKDOWN,
    });
  });

  it("works over the fetch configuration, including a missing document and 401", async () => {
    const present = makeFakePod({
      [CONTEXT]: { contentType: "text/markdown; charset=utf-8", body: MARKDOWN, etag: '"e"' },
    });
    const client = await connect({ podRoot: ROOT, fetch: present.fetch });
    expect(parse(await client.callTool({ name: "context_read", arguments: {} }))).toMatchObject({
      status: "ok",
      contentType: "text/markdown",
      etag: '"e"',
      text: MARKDOWN,
    });
    const absent = await connect({ podRoot: ROOT, fetch: makeFakePod({}).fetch });
    expect(parse(await absent.callTool({ name: "context_read", arguments: {} }))).toMatchObject({
      status: "not_found",
    });
    const denied = await connect({
      podRoot: ROOT,
      fetch: makeFakePod({ [CONTEXT]: { contentType: "text/plain", body: "", status: 401 } }).fetch,
    });
    const result = await denied.callTool({ name: "context_read", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain(CONTEXT);
  });
});
