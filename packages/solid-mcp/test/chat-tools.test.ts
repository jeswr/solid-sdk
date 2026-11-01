// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { serialize } from "@jeswr/rdf-serialize";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import type { SolidMcpConfig } from "../src/auth.js";
import { createChatPodPort, registerChatTools } from "../src/chat-tools.js";
import { createFetchPodPort, type PodPort } from "../src/pod-port.js";
import { createSolidMcpServer } from "../src/server.js";

const ROOT = "https://alice.example/pod/";
const OWNER = `${ROOT}profile/card#me`;
const DAY1 = "2026-10-24T12:00:00.000Z";
const DAY2 = "2026-10-25T12:00:00.000Z";
const LDP = "http://www.w3.org/ns/ldp#";
class ContainerDoc extends TermWrapper {
  get types() {
    return SetFrom.subjectPredicate(
      this,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get contains() {
    return SetFrom.subjectPredicate(
      this,
      `${LDP}contains`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}
function fakePod() {
  const resources = new Map<string, { body: string; contentType: string }>();
  const requests: { url: string; method: string; headers: Headers }[] = [];
  const failures = new Map<string, number>();
  const redirects = new Map<string, string>();
  const aclLinks = new Map<string, string>();
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    requests.push({ url, method, headers });
    if (failures.has(url)) return new Response(null, { status: failures.get(url) });
    if (redirects.has(url))
      return new Response(null, { status: 302, headers: { location: redirects.get(url) ?? "" } });
    if (method === "HEAD")
      return new Response(null, {
        status: resources.has(url) ? 200 : 404,
        headers: { link: aclLinks.get(url) ?? `<${url}.acl>; rel="acl"` },
      });
    if (method === "PUT") {
      if (headers.get("if-none-match") === "*" && resources.has(url))
        return new Response(null, { status: 412 });
      const body = await new Response(init?.body).text();
      resources.set(url, { body, contentType: headers.get("content-type") ?? "text/turtle" });
      return new Response(null, { status: 201, headers: { etag: '"chat"' } });
    }
    const resource = resources.get(url);
    if (!resource) return new Response(null, { status: 404 });
    if (url.endsWith("/")) {
      const store = new Store();
      const container = new ContainerDoc(url, store, DataFactory);
      container.types.add(`${LDP}BasicContainer`);
      container.types.add(`${LDP}Container`);
      for (const childUrl of resources.keys()) {
        if (
          childUrl === url ||
          !childUrl.startsWith(url) ||
          childUrl.slice(url.length).replace(/\/$/, "").includes("/")
        )
          continue;
        container.contains.add(childUrl);
        const child = new ContainerDoc(childUrl, store, DataFactory);
        child.types.add(`${LDP}${childUrl.endsWith("/") ? "Container" : "Resource"}`);
      }
      return new Response(await serialize([...store], { format: "text/turtle" }), {
        headers: { "content-type": "text/turtle" },
      });
    }
    return new Response(resource.body, { headers: { "content-type": resource.contentType } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, resources, requests, failures, redirects, aclLinks };
}
async function connect(config: SolidMcpConfig, outputPod?: PodPort) {
  const server = outputPod
    ? new McpServer({ name: "chat-output-authorization", version: "1" })
    : createSolidMcpServer(config);
  if (outputPod) registerChatTools(server, config, outputPod);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "chat-test", version: "1.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}
function json(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0]?.text ?? "null");
}
const input = {
  provider: "claude",
  conversationId: "session-1",
  title: "Session",
  messages: [
    { id: "m1", role: "user", text: "Question", createdAt: DAY1 },
    { id: "m2", role: "assistant", text: "Answer", createdAt: DAY2 },
  ],
};

describe("MCP chat tools over the scoped fetch port", () => {
  it.each([
    "chat_save",
    "chat_list",
    "chat_get",
  ])("%s projects only authorized resource descriptions", async (name) => {
    const fixture = fakePod();
    const config = { fetch: fixture.fetch, podRoot: ROOT, webId: OWNER, readOnly: false };
    const pod = createFetchPodPort(config);
    const client = await connect(config, pod);
    const deniedUrl = `${ROOT}private/chats/claude/sensitive-record/`;
    const allowedUrl = `${ROOT}private/chats/claude/allowed-record/`;
    try {
      for (const conversationId of ["sensitive-record", "allowed-record"]) {
        const seeded = await client.callTool({
          name: "chat_save",
          arguments: {
            ...input,
            conversationId,
            title:
              conversationId === "sensitive-record"
                ? "private medical history"
                : "allowed conversation",
          },
        });
        expect(seeded.isError).toBeFalsy();
      }
      const read = pod.read;
      pod.read = async (url, options) => {
        if (url === deniedUrl)
          throw new Error(`purpose denied ${deniedUrl}: private medical history`);
        return read(url, options);
      };
      const args = (conversationId: string) =>
        name === "chat_list" ? { provider: "claude" } : { ...input, conversationId };
      const denied = await client.callTool({ name, arguments: args("sensitive-record") });
      if (name === "chat_get") expect(denied.isError).toBe(true);
      else expect(denied.isError).toBeFalsy();
      expect(JSON.stringify(denied)).not.toContain(deniedUrl);
      expect(JSON.stringify(denied)).not.toContain("sensitive-record");
      expect(JSON.stringify(denied)).not.toContain("private medical history");
      const allowed = await client.callTool({ name, arguments: args("allowed-record") });
      expect(allowed.isError).toBeFalsy();
      expect(JSON.stringify(allowed)).toContain(allowedUrl);
      // Individual message reads must also use the current port, before a chat
      // result can contain their text under an otherwise-readable conversation.
      pod.read = vi.fn(async (url, options) => {
        if (url === `${allowedUrl}m-m1.ttl`)
          throw new Error(`purpose denied ${deniedUrl}: private medical history`);
        return read(url, options);
      });
      const messageDenied = await client.callTool({
        name: "chat_get",
        arguments: { provider: "claude", conversationId: "allowed-record" },
      });
      expect(messageDenied.isError).toBe(true);
      expect(pod.read).toHaveBeenCalledWith(`${allowedUrl}m-m1.ttl`, { accept: "text/turtle" });
      expect(messageDenied.content).toEqual([{ type: "text", text: "purpose denied" }]);
      expect(JSON.stringify(messageDenied)).not.toContain(deniedUrl);
      expect(JSON.stringify(messageDenied)).not.toContain("private medical history");
      expect(JSON.stringify(messageDenied)).not.toContain("Question");
    } finally {
      await client.close();
    }
  });

  it("saves and gets each provider, replays idempotently, and pages with since", async () => {
    const pod = fakePod();
    const client = await connect({
      fetch: pod.fetch,
      podRoot: ROOT,
      webId: OWNER,
      readOnly: false,
    });
    try {
      for (const provider of ["claude", "chatgpt", "codex"]) {
        const saved = await client.callTool({
          name: "chat_save",
          arguments: { ...input, provider },
        });
        expect(saved.isError).toBeFalsy();
        expect(json(saved)).toMatchObject({ saved: 2, skipped: 0 });
        const got = await client.callTool({
          name: "chat_get",
          arguments: { provider, conversationId: input.conversationId },
        });
        expect(got.isError).toBeFalsy();
        expect(json(got)).toMatchObject({ ...input, provider });
      }
      const replay = await client.callTool({ name: "chat_save", arguments: input });
      expect(json(replay)).toMatchObject({ saved: 0, skipped: 2 });
      const first = json(
        await client.callTool({ name: "chat_list", arguments: { limit: 1, since: DAY1 } }),
      );
      expect(first.conversations).toHaveLength(1);
      const second = json(
        await client.callTool({
          name: "chat_list",
          arguments: { limit: 2, since: DAY1, cursor: first.nextCursor },
        }),
      );
      expect(second.conversations).toHaveLength(2);
      expect(second.nextCursor).toBeUndefined();
      const empty = json(await client.callTool({ name: "chat_list", arguments: { since: DAY2 } }));
      expect(empty.conversations).toEqual([]);
      expect(
        pod.requests
          .filter((r) => /m-m[12]\.ttl$/.test(r.url) && r.method === "PUT")
          .every((r) => r.headers.get("if-none-match") === "*"),
      ).toBe(true);
      const firstWrite = pod.requests.find((r) => r.method === "PUT");
      expect(firstWrite?.url).toBe(`${ROOT}private/chats/.acl`);
      const tools = (await client.listTools()).tools;
      expect(tools.find((t) => t.name === "chat_save")?.annotations?.readOnlyHint).toBe(false);
      expect(tools.find((t) => t.name === "chat_get")?.annotations?.readOnlyHint).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("retains the read-only default, including saves without an owner", async () => {
    const pod = fakePod();
    const client = await connect({ fetch: pod.fetch, podRoot: ROOT });
    try {
      const saved = await client.callTool({ name: "chat_save", arguments: input });
      expect(saved.isError).toBe(true);
      expect(saved.content).toEqual([
        expect.objectContaining({ text: expect.stringMatching(/read-only/) }),
      ]);
      expect(pod.requests).toEqual([]);
      for (const name of ["chat_get", "chat_list"]) {
        const result = await client.callTool({
          name,
          arguments: name === "chat_get" ? { provider: "claude", conversationId: "session-1" } : {},
        });
        expect(result.isError).toBe(true);
      }
    } finally {
      await client.close();
    }
  });

  it("requires a valid owner before the first save request", async () => {
    const pod = fakePod();
    const client = await connect({ fetch: pod.fetch, podRoot: ROOT, readOnly: false });
    try {
      expect((await client.callTool({ name: "chat_save", arguments: input })).isError).toBe(true);
      expect(pod.requests).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("fails closed on ACL denial, missing chats, and forbidden list", async () => {
    const pod = fakePod();
    pod.failures.set(`${ROOT}private/chats/.acl`, 403);
    const client = await connect({
      fetch: pod.fetch,
      podRoot: ROOT,
      webId: OWNER,
      readOnly: false,
    });
    try {
      expect((await client.callTool({ name: "chat_save", arguments: input })).isError).toBe(true);
      expect(pod.requests.filter((r) => r.method === "PUT")).toHaveLength(0);
      expect(
        (
          await client.callTool({
            name: "chat_get",
            arguments: { provider: "claude", conversationId: "missing" },
          })
        ).isError,
      ).toBe(true);
      pod.failures.set(`${ROOT}private/chats/claude/`, 403);
      expect(
        (await client.callTool({ name: "chat_list", arguments: { provider: "claude" } })).isError,
      ).toBe(true);
      pod.failures.delete(`${ROOT}private/chats/claude/`);
      expect(
        json(await client.callTool({ name: "chat_list", arguments: {} })).conversations,
      ).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it.each([
    "../escape",
    "%2e%2e",
    "https://evil.example/",
  ])("rejects unsafe conversation input: %s", async (conversationId) => {
    const pod = fakePod();
    const client = await connect({
      fetch: pod.fetch,
      podRoot: ROOT,
      webId: OWNER,
      readOnly: false,
    });
    try {
      expect(
        (await client.callTool({ name: "chat_save", arguments: { ...input, conversationId } }))
          .isError,
      ).toBe(true);
      expect(pod.requests).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("rejects JSON-LD contexts on resource and container reads", async () => {
    const fetch = vi.fn(
      async () =>
        new Response('{"@context":"https://evil.example/context"}', {
          headers: { "content-type": "application/ld+json" },
        }),
    ) as unknown as typeof globalThis.fetch;
    const port = createChatPodPort({ fetch, podRoot: ROOT, webId: OWNER });
    await expect(port.read(`${ROOT}private/chats/data.ttl`)).rejects.toThrow(/content type/);
    await expect(port.list(`${ROOT}private/chats/claude/`)).rejects.toThrow(/content type/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("accepts missing Content-Type and ETag, and reports primitive transport failures", async () => {
    const fetch: typeof globalThis.fetch = async () => new Response(null);
    const config = { fetch, podRoot: ROOT, webId: OWNER, readOnly: false };
    const port = createChatPodPort(config);
    const target = `${ROOT}private/chats/test.ttl`;
    expect(await port.write(target, new Uint8Array(), "text/turtle", {})).toEqual({});
    expect((await port.read(target)).contentType).toBe("text/turtle");
    const client = await connect({
      ...config,
      fetch: async () => {
        throw "offline";
      },
    });
    try {
      const saved = await client.callTool({ name: "chat_save", arguments: input });
      expect(saved.isError).toBe(true);
      expect(saved.content).toEqual([expect.objectContaining({ text: "offline" })]);
    } finally {
      await client.close();
    }
  });

  it("enforces scope and redirects and preserves conditional headers on the adapter", async () => {
    const pod = fakePod();
    const config = { fetch: pod.fetch, podRoot: ROOT, webId: OWNER, readOnly: false };
    const port = createChatPodPort(config);
    await expect(port.read("https://evil.example/x")).rejects.toThrow(/pod-scope/);
    await expect(
      port.write("https://evil.example/x", new Uint8Array(), "text/turtle", {}),
    ).rejects.toThrow(/pod-scope/);
    const target = `${ROOT}private/chats/test.ttl`;
    pod.redirects.set(target, "https://evil.example/x");
    await expect(port.read(target)).rejects.toThrow();
    expect(pod.requests.every((r) => r.url.startsWith(ROOT))).toBe(true);
    pod.redirects.clear();
    const written = await port.write(target, new TextEncoder().encode(""), "text/turtle", {
      ifMatch: '"old"',
    });
    expect(written.etag).toBe('"chat"');
    expect(pod.requests.at(-1)?.headers.get("if-match")).toBe('"old"');
    expect((await port.read(target)).body).toEqual(new Uint8Array());
    await expect(
      createChatPodPort({ ...config, readOnly: true }).write(
        target,
        new Uint8Array(),
        "text/turtle",
        {},
      ),
    ).rejects.toThrow(/read-only/);
  });

  it("discovers relative nonstandard ACL links on absent and existing containers", async () => {
    const pod = fakePod();
    const target = `${ROOT}private/chats/`;
    pod.aclLinks.set(target, '<owner-permissions>; title="private, owner"; rel="acl"');
    const client = await connect({
      fetch: pod.fetch,
      podRoot: ROOT,
      webId: OWNER,
      readOnly: false,
    });
    try {
      const saved = await client.callTool({ name: "chat_save", arguments: input });
      expect(saved.isError).toBeFalsy();
      expect(pod.requests.find((r) => r.method === "PUT")?.url).toBe(`${target}owner-permissions`);
      expect(pod.resources.has(`${target}.acl`)).toBe(false);
      expect(pod.requests.filter((r) => r.method === "HEAD" && r.url === target)).toHaveLength(2);
    } finally {
      await client.close();
    }
  });

  it.each([
    "",
    '<.acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"',
    '<.acl>; rel="acl", <.acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"',
    '<one>; rel="acl", <two>; rel="acl"',
    '<.acl>; rel="acl"; anchor="/elsewhere"',
    '<.acl>; rel="acl"; rel="type"',
    '<https://evil.example/acl>; rel="acl"',
    `<${ROOT}>; rel="acl"`,
    `<${ROOT.slice(0, -1)}>; rel="acl"`,
    '<./>; rel="acl"',
    '<.acl#owner>; rel="acl"',
    '<.acl?query>; rel="acl"',
    '<.acl>; rel="acl',
  ])("refuses unusable ACL discovery before any PUT: %s", async (link) => {
    const pod = fakePod();
    pod.aclLinks.set(`${ROOT}private/chats/`, link);
    const client = await connect({
      fetch: pod.fetch,
      podRoot: ROOT,
      webId: OWNER,
      readOnly: false,
    });
    try {
      expect((await client.callTool({ name: "chat_save", arguments: input })).isError).toBe(true);
      expect(pod.requests.map((r) => r.method)).toEqual(["HEAD"]);
      expect(pod.resources.size).toBe(0);
    } finally {
      await client.close();
    }
  });

  it.each([401, 403, 500, 302])("preserves ACL discovery failures (%s)", async (status) => {
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status,
          headers: { link: '<.acl>; rel="acl"', location: `${ROOT}other/` },
        }),
    );
    const port = createChatPodPort({ fetch, podRoot: ROOT, webId: OWNER, readOnly: false });
    await expect(port.discoverAcl(`${ROOT}private/chats/`)).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`${ROOT}private/chats/`, {
      method: "HEAD",
      redirect: "manual",
    });
  });

  it.each([
    301, 302, 303, 307, 308,
  ])("refuses every chat PUT redirect (%s) without a second request", async (status) => {
    for (const location of [ROOT, ROOT.slice(0, -1), `${ROOT}other`, "https://evil.example/x"]) {
      const fetch = vi.fn(async () => new Response(null, { status, headers: { location } }));
      const port = createChatPodPort({ fetch, podRoot: ROOT, webId: OWNER, readOnly: false });
      const target = `${ROOT}private/chats/.acl`;
      await expect(port.write(target, new Uint8Array(), "text/turtle", {})).rejects.toThrow(
        /redirect/,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]).toEqual([
        target,
        expect.objectContaining({ method: "PUT", redirect: "manual" }),
      ]);
    }
  });

  it("reports a redirected ACL write as a failed save without writing chat content", async () => {
    const pod = fakePod();
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "PUT")
        return new Response(null, { status: 303, headers: { location: ROOT } });
      return pod.fetch(input, init);
    };
    const client = await connect({ fetch, podRoot: ROOT, webId: OWNER, readOnly: false });
    try {
      const saved = await client.callTool({ name: "chat_save", arguments: input });
      expect(saved.isError).toBe(true);
      expect(saved.content).toEqual([
        expect.objectContaining({ text: expect.stringMatching(/redirect/) }),
      ]);
      expect(pod.resources.size).toBe(0);
      expect(pod.requests.some((r) => r.url === ROOT)).toBe(false);
    } finally {
      await client.close();
    }
  });
});
