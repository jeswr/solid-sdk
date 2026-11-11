// AUTHORED-BY Codex GPT-6.1-Sol
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { createChatPodPort } from "../src/chat-tools.js";
import { PodOutput } from "../src/output.js";
import { writeResource } from "../src/pod.js";
import { createFetchPodPort } from "../src/pod-port.js";
import { createSolidMcpServer } from "../src/server.js";

const ROOT = "https://pod.example/";
const FILE = `${ROOT}notes/memo.txt`;
const PARENT = `${ROOT}notes/`;
const ACP = "http://www.w3.org/ns/solid/acp#accessControl";

function fixture() {
  const requests: Request[] = [];
  const links = new Map<string, string>();
  const statuses = new Map<string, number>();
  const resources = new Map<string, { body: string; etag: string; contentType: string }>();
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const resource = resources.get(request.url);
    const headers = new Headers({ link: links.get(request.url) ?? "" });
    if (resource) {
      headers.set("etag", resource.etag);
      headers.set("content-type", resource.contentType);
    }
    if (request.method === "HEAD")
      return new Response(null, {
        status: statuses.get(request.url) ?? (resource || request.url.endsWith("/") ? 200 : 404),
        headers,
      });
    if (request.method === "PUT") {
      if (
        (request.headers.get("if-none-match") === "*" && resource) ||
        (request.headers.has("if-match") && request.headers.get("if-match") !== resource?.etag)
      )
        return new Response(null, { status: 412 });
      resources.set(request.url, {
        body: await request.text(),
        contentType: request.headers.get("content-type") ?? "text/plain",
        etag: '"new"',
      });
      return new Response(null, { status: 201, headers: { etag: '"new"' } });
    }
    if (request.method === "DELETE") return new Response(null, { status: 205 });
    return new Response(resource?.body ?? null, { status: resource ? 200 : 404, headers });
  });
  const config = { podRoot: ROOT, webId: "", fetch, readOnly: false };
  const pod = createFetchPodPort(config);
  const mutations = () => requests.filter((request) => ["PUT", "DELETE"].includes(request.method));
  return { config, pod, requests, links, statuses, resources, mutations };
}

const reserved = [
  ".acl",
  "notes/%2Eacl",
  "notes/.ACL",
  "notes/doc.acr",
  "notes/doc.meta",
  "private/chats/.acl",
  "profile/.acl",
  "notes/%252EAcL",
  "notes/.acl/",
];

describe("generic mutation safety", () => {
  it.each(
    reserved.flatMap((path) => ["write", "delete", "chat"].map((kind) => ({ path, kind }))),
  )("refuses $kind of $path before mutation", async ({ path, kind }) => {
    const f = fixture();
    const target = `${ROOT}${path}`;
    const output = new PodOutput(f.pod);
    const operation =
      kind === "delete"
        ? output.delete(target)
        : kind === "chat"
          ? createChatPodPort(f.config, f.pod).write(target, new Uint8Array(), "text/plain", {})
          : output.write(target, new Uint8Array(), "text/plain", { ifNoneMatch: "*" });
    await expect(operation).rejects.toThrow(/access-control|description/i);
    expect(f.mutations()).toEqual([]);
  });

  it.each(
    ["acl", "describedby", ACP].flatMap((rel) =>
      [FILE, PARENT].flatMap((advertiser) =>
        ["write", "delete"].map((kind) => ({ rel, advertiser, kind })),
      ),
    ),
  )("refuses $kind of a resource advertised by $advertiser as $rel", async ({
    rel,
    advertiser,
    kind,
  }) => {
    const f = fixture();
    f.links.set(advertiser, `<memo.txt>; title="a, b"; rel="alternate ${rel}"`);
    const output = new PodOutput(f.pod);
    await expect(
      kind === "delete" ? output.delete(FILE) : writeResource(f.pod, FILE, "x", "text/plain"),
    ).rejects.toThrow(/access-control|description/i);
    expect(f.mutations()).toEqual([]);
  });

  it.each(
    [301, 302, 401, 403, 405, 429, 500].flatMap((status) =>
      [FILE, PARENT].map((target) => ({ status, target })),
    ),
  )("fails closed on HEAD $status at $target", async ({ status, target }) => {
    const f = fixture();
    f.statuses.set(target, status);
    await expect(writeResource(f.pod, FILE, "x", "text/plain")).rejects.toThrow();
    expect(f.mutations()).toEqual([]);
  });

  it.each([
    '<memo.txt>; rel="acl", <other>; rel="acl"',
    '<memo.txt>; rel="acl"; anchor="other"',
    '<memo.txt>; rel="acl"; rel="alternate"',
    '<memo.txt>; rel="describedby", malformed',
  ])("refuses malformed, anchored or multiple advertised links: %s", async (link) => {
    const f = fixture();
    f.links.set(PARENT, link);
    await expect(writeResource(f.pod, FILE, "x", "text/plain")).rejects.toThrow();
    expect(f.mutations()).toEqual([]);
  });

  it("requires complete HEAD metadata from portable ports and uses current decorators", async () => {
    const f = fixture();
    const write = vi.spyOn(f.pod, "write");
    f.pod.head = undefined;
    await expect(writeResource(f.pod, FILE, "x", "text/plain")).rejects.toThrow();
    f.pod.head = vi.fn(async () => ({}));
    await expect(writeResource(f.pod, FILE, "x", "text/plain")).rejects.toThrow();
    f.pod.head = vi.fn(async () => {
      throw new Error("denied");
    });
    await expect(new PodOutput(f.pod).delete(FILE)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(f.mutations()).toEqual([]);
  });

  it("keeps internal personal-data ACL mutations on their dedicated path", async () => {
    const f = fixture();
    const target = `${ROOT}private/pkg/policy.acl`;
    f.pod.head = undefined;
    await new PodOutput(f.pod, true).write(target, new Uint8Array(), "text/plain", {
      ifNoneMatch: "*",
    });
    await new PodOutput(f.pod, true).delete(target, { ifMatch: '"new"' });
    expect(f.mutations().map((request) => request.method)).toEqual(["PUT", "DELETE"]);
  });

  it("fails closed when HEAD discovery never completes", async () => {
    vi.useFakeTimers();
    const f = fixture();
    try {
      f.pod.head = async () => new Promise(() => {});
      const refused = expect(writeResource(f.pod, FILE, "x", "text/plain")).rejects.toThrow(
        "Access-control and description discovery unavailable; mutation refused",
      );
      await vi.advanceTimersByTimeAsync(5000);
      await refused;
      expect(f.mutations()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("conditional pod_write and read ETags", () => {
  it.each([
    "pod_write",
    "solid_write",
  ])("makes %s create-only and requires a read ETag for replacement", async (name) => {
    const f = fixture();
    const server = createSolidMcpServer({ pod: f.pod, readOnly: false });
    const client = new Client({ name: "mutation-safety", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      for (const path of reserved) {
        const result = await client.callTool({
          name,
          arguments: {
            url: `${ROOT}${path}`,
            content: "x",
            contentType: "text/plain",
          },
        });
        expect(result.isError).toBe(true);
        expect(f.mutations()).toEqual([]);
      }
      const args = { url: FILE, content: "first", contentType: "text/plain" };
      expect((await client.callTool({ name, arguments: args })).isError).toBeFalsy();
      expect(f.mutations()[0]?.headers.get("if-none-match")).toBe("*");
      const count = f.mutations().length;
      const refused = await client.callTool({ name, arguments: { ...args, content: "overwrite" } });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused)).toMatch(/read.*ETag.*ifMatch/i);
      expect(f.mutations()).toHaveLength(count);
      for (const read of ["pod_read", "solid_read", "fetch"]) {
        const result = await client.callTool({ name: read, arguments: { url: FILE, id: FILE } });
        const content = result.content as Array<{ text: string }>;
        if (read === "fetch") expect(JSON.parse(content[0].text).metadata.etag).toBe('"new"');
        else expect(content[1]?.text).toBe('ETag: "new"');
      }
      expect(
        (await client.callTool({ name, arguments: { ...args, ifMatch: '"new"' } })).isError,
      ).toBeFalsy();
      expect(f.mutations().at(-1)?.headers.get("if-match")).toBe('"new"');
      expect(f.mutations().at(-1)?.headers.has("if-none-match")).toBe(false);
      const stale = await client.callTool({ name, arguments: { ...args, ifMatch: '"stale"' } });
      expect(stale.isError).toBe(true);
      expect(f.resources.get(FILE)?.body).toBe("first");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each([
    "*",
    "",
    'W/"weak"',
    '"a", "b"',
    "invalid",
  ])("refuses unsafe replacement validator %s", async (ifMatch) => {
    const f = fixture();
    const { createPodToolRegistry } = await import("../src/tools.js");
    const tool = createPodToolRegistry(f.pod, false).find((entry) => entry.name === "pod_write");
    expect(
      (await tool?.handler({ url: FILE, content: "x", contentType: "text/plain", ifMatch }))
        ?.isError,
    ).toBe(true);
    expect(f.mutations()).toEqual([]);
  });

  it("refuses generic PodOutput writes without explicit conditions", async () => {
    const f = fixture();
    await expect(
      new PodOutput(f.pod).write(FILE, new Uint8Array(), "text/plain", {}),
    ).rejects.toThrow(/ETag/);
    expect(f.mutations()).toEqual([]);
  });

  it("does not overwrite a resource created between HEAD and PUT", async () => {
    const f = fixture();
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await f.config.fetch(input, init);
      const request = new Request(input, init);
      if (request.method === "HEAD" && request.url === FILE)
        f.resources.set(FILE, {
          body: "concurrent writer",
          contentType: "text/plain",
          etag: '"other"',
        });
      return response;
    };
    await expect(
      writeResource({ ...f.config, fetch }, FILE, "overwrite", "text/plain"),
    ).rejects.toThrow(/read.*ETag.*ifMatch/i);
    expect(f.mutations()[0]?.headers.get("if-none-match")).toBe("*");
    expect(f.resources.get(FILE)?.body).toBe("concurrent writer");
  });
});
