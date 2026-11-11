// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { serialize } from "@jeswr/rdf-serialize";
import { type ChatConversation, ChatWriter } from "@jeswr/solid-chat-interop";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { Authorization } from "@solid/object";
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
const input: ChatConversation = {
  provider: "claude",
  conversationId: "session-1",
  title: "Session",
  messages: [
    { id: "m1", role: "user", text: "Question", createdAt: DAY1 },
    { id: "m2", role: "assistant", text: "Answer", createdAt: DAY2 },
  ],
};

// Existing chats are provisioned by the owner outside the generic MCP boundary.
async function seedChat(pod: ReturnType<typeof fakePod>, conversation: ChatConversation = input) {
  const config = { fetch: pod.fetch, podRoot: ROOT, webId: OWNER, readOnly: false };
  const port = createFetchPodPort(config);
  async function operation<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof Error)
        Object.assign(error, { status: Number(/HTTP (\d+)/u.exec(error.message)?.[1]) });
      throw error;
    }
  }
  return new ChatWriter({
    ...port,
    discoverAcl: createChatPodPort(config).discoverAcl,
    read: (url) => operation(() => port.read(url)),
    write: (...args) => operation(() => port.write(...args)),
  }).save(conversation);
}

describe("MCP chat tools over the scoped fetch port", () => {
  it("preserves ChatWriter's atomic create-conflict requests on replay", async () => {
    const f = fakePod();
    const url = `${ROOT}private/chats/claude/chat/m-message.ttl`;
    f.resources.set(url, { body: "existing", contentType: "text/plain" });
    const port = createChatPodPort({
      fetch: f.fetch,
      podRoot: ROOT,
      webId: OWNER,
      readOnly: false,
    });
    await expect(
      port.write(url, new TextEncoder().encode("replacement"), "text/plain", { ifNoneMatch: "*" }),
    ).rejects.toMatchObject({ status: 412 });
    expect(f.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
    expect(f.resources.get(url)?.body).toBe("existing");
  });

  it("allows only the exact owner-only ACL body on a discovered chat ACL", async () => {
    const f = fakePod();
    const config = { fetch: f.fetch, podRoot: ROOT, webId: OWNER, readOnly: false };
    const port = createChatPodPort(config);
    const target = `${ROOT}private/chats/`;
    const acl = await port.discoverAcl(target);
    for (const [owner, scope] of [
      ["https://evil.example/#me", target],
      [OWNER, `${ROOT}other/`],
    ]) {
      const store = new Store();
      const auth = new Authorization(`${acl}#owner`, store, DataFactory);
      auth.type.add("http://www.w3.org/ns/auth/acl#Authorization");
      auth.accessTo = scope;
      auth.default = scope;
      auth.agent.add(owner);
      auth.canRead = true;
      auth.canWrite = true;
      auth.canReadWriteAcl = true;
      await expect(
        port.write(
          acl,
          new TextEncoder().encode(
            await serialize([...store], {
              format: "text/turtle",
            }),
          ),
          "text/turtle",
          {},
        ),
      ).rejects.toThrow();
    }
    expect(f.requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("uses the current port's ACL discovery and refuses ACLs outside private/chats", async () => {
    const f = fakePod();
    const config = { fetch: f.fetch, podRoot: ROOT, webId: OWNER, readOnly: false };
    const pod = createFetchPodPort(config);
    const port = createChatPodPort(config, pod);
    for (const acl of [
      `${ROOT}other.acl`,
      `${ROOT}private/chats%2Fescape/.acl`,
      `${ROOT}private/chats/.acr`,
    ]) {
      pod.head = vi.fn(async () => ({ acl, auxiliaryResources: [acl] }));
      await expect(port.discoverAcl(`${ROOT}private/chats/`)).rejects.toThrow();
      expect(pod.head).toHaveBeenCalledOnce();
    }
    pod.head = undefined;
    await expect(port.discoverAcl(`${ROOT}private/chats/`)).rejects.toThrow();
    expect(f.requests).toEqual([]);
  });

  it.each([
    "chat_list",
    "chat_get",
    "chat_export",
  ])("%s projects only authorized resource descriptions", async (name) => {
    const fixture = fakePod();
    const config = { fetch: fixture.fetch, podRoot: ROOT, webId: OWNER, readOnly: false };
    const pod = createFetchPodPort(config);
    const client = await connect(config, pod);
    const deniedUrl = `${ROOT}private/chats/claude/sensitive-record/`;
    const allowedUrl = `${ROOT}private/chats/claude/allowed-record/`;
    try {
      for (const conversationId of ["sensitive-record", "allowed-record"]) {
        await seedChat(fixture, {
          ...input,
          conversationId,
          title:
            conversationId === "sensitive-record"
              ? "private medical history"
              : "allowed conversation",
        });
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
      if (name === "chat_get" || name === "chat_export") expect(denied.isError).toBe(true);
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

  it("saves and reads chats for each provider and pages with since", async () => {
    const pod = fakePod();
    const client = await connect({
      fetch: pod.fetch,
      podRoot: ROOT,
      webId: OWNER,
      readOnly: false,
    });
    try {
      for (const provider of ["claude", "chatgpt", "codex"] as const) {
        const saved = await client.callTool({
          name: "chat_save",
          arguments: { ...input, provider },
        });
        expect(saved.isError).toBeFalsy();
        const got = await client.callTool({
          name: "chat_get",
          arguments: { provider, conversationId: input.conversationId },
        });
        expect(got.isError).toBeFalsy();
        expect(json(got)).toMatchObject({ ...input, provider });
      }
      const replay = await client.callTool({ name: "chat_save", arguments: input });
      expect(replay.isError).toBeFalsy();
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

  // AUTHORED-BY Claude Opus 5.5
  it("reads and exports redacted chats provisioned outside MCP", async () => {
    const pod = fakePod();
    const client = await connect({
      fetch: pod.fetch,
      podRoot: ROOT,
      webId: OWNER,
      readOnly: false,
    });
    const token = "sk-fixture-mcp-token";
    try {
      await seedChat(pod, {
        ...input,
        title: `Key ${token}`,
        messages: [{ id: "m1", role: "user", text: `My key is ${token}`, createdAt: DAY1 }],
      });
      for (const resource of pod.resources.values()) expect(resource.body).not.toContain(token);
      const got = json(
        await client.callTool({
          name: "chat_get",
          arguments: { provider: "claude", conversationId: input.conversationId },
        }),
      );
      expect(got.title).toBe("Key [REDACTED TOKEN]");
      expect(got.messages[0].text).toBe("My key is [REDACTED TOKEN]");
      const exported = json(
        await client.callTool({
          name: "chat_export",
          arguments: { provider: "claude", conversationId: input.conversationId },
        }),
      );
      expect(exported.url).toBe(`${ROOT}private/chats/claude/session-1/`);
      expect(exported.markdown).toContain("# Key \\[REDACTED TOKEN\\]");
      expect(exported.markdown).toContain("```\nMy key is [REDACTED TOKEN]\n```");
      expect(exported.markdown).not.toContain(token);
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
    expect(await port.write(target, new Uint8Array(), "text/turtle", { ifMatch: '"old"' })).toEqual(
      { etag: undefined },
    );
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

  it("saves chats through a nonstandard advertised ACL confined to the chat area", async () => {
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
      expect(pod.resources.has(`${target}owner-permissions`)).toBe(true);
      expect(pod.resources.has(`${target}.acl`)).toBe(false);
    } finally {
      await client.close();
    }
  });

  it.each([
    "",
    '<.acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"',
    '<.acl>; rel="acl", <.acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"',
    '<.acl>; rel="acl", <.acr>; rel="HTTP://WWW.W3.ORG/NS/SOLID/ACP#ACCESSCONTROL"',
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
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `${ROOT}private/chats/`,
      expect.objectContaining({
        method: "HEAD",
        redirect: "manual",
      }),
    );
  });

  it.each([
    301, 302, 303, 307, 308,
  ])("refuses every chat PUT redirect (%s) without a second request", async (status) => {
    for (const location of [ROOT, ROOT.slice(0, -1), `${ROOT}other`, "https://evil.example/x"]) {
      const fetch = vi.fn(async (_input, init?: RequestInit) =>
        init?.method === "HEAD"
          ? new Response(null, { status: 404 })
          : new Response(null, { status, headers: { location } }),
      );
      const port = createChatPodPort({ fetch, podRoot: ROOT, webId: OWNER, readOnly: false });
      const target = `${ROOT}private/chats/message.ttl`;
      await expect(
        port.write(target, new Uint8Array(), "text/turtle", { ifNoneMatch: "*" }),
      ).rejects.toThrow(/redirect/);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(fetch.mock.calls[2]).toEqual([
        target,
        expect.objectContaining({ method: "PUT", redirect: "manual" }),
      ]);
    }
  });

  it("refuses chat ACL PUT redirects without creating content", async () => {
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
