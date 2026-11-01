// AUTHORED-BY Codex GPT-6
import { NanopubStore } from "@jeswr/pkg-memory";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatPodPort } from "../src/chat-tools.js";
import { PodOutput } from "../src/output.js";
import {
  auditContainer,
  PERSONAL_DATA_DENIED,
  personalAclOptions,
  personalDataRoot,
  requireGenericPodAccess,
} from "../src/personal-data.js";
import { containerCandidates, readResource, search, writeResource } from "../src/pod.js";
import { createFetchPodPort } from "../src/pod-port.js";
import { createSolidMcpServer } from "../src/server.js";
import { createPodToolRegistry } from "../src/tools.js";
import { poisonedContainerTurtle } from "./fake-pod.js";
import { createWacMemoryPodPort } from "./wac-memory-pod.js";

const ROOT = "https://example.org/pod/";
const OWNER = `${ROOT}profile/card#me`;
const CLIENT = "https://example.org/client";
const SECRET = "Confidential fictional medical condition";
const PD = "https://w3id.org/dpv/pd#MedicalHealth";
const SAFE = `${ROOT}ordinary.ttl`;
const INDEX = `${ROOT}type-index.ttl`;
const PURPOSE = "ServiceProvision";
const encoder = new TextEncoder();
const clients: Client[] = [];

it("accepts ACLs only when every path interpretation stays inside the generic exclusion boundary", () => {
  const pod = createWacMemoryPodPort({ root: ROOT, webId: OWNER });
  const area = personalDataRoot(pod);
  const { allowAclUrl } = personalAclOptions(pod);
  for (const url of [
    `${area}permissions/one`,
    `${area}.acl`,
    `${area.slice(0, -1)}.acl`,
    `${area}permissions/one`.replace("private/pkg", "PRIVATE/PkG"),
  ]) {
    expect(allowAclUrl(url)).toBe(true);
    expect(() => requireGenericPodAccess(pod, url, true)).toThrow(PERSONAL_DATA_DENIED);
  }
  for (const url of [
    `${ROOT}permissions/one`,
    `${ROOT}private/.acl`,
    `${ROOT}private/pkg-other/one`,
    `${area}%252e%252e/permissions/one`,
    `${area}permissions/one`.replace("example.org", "outside.example"),
  ])
    expect(allowAclUrl(url)).toBe(false);
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

function text(result: { content: unknown }): string {
  return (result.content as { text: string }[]).map((part) => part.text).join("\n");
}

function json(result: { content: unknown; isError?: unknown }) {
  expect(result.isError, text(result)).not.toBe(true);
  return JSON.parse(text(result));
}

function variants(url: string): string[] {
  return [
    url,
    `${url}?view=raw#fact`,
    url.replace("private/pkg", "PRIVATE/PkG"),
    url.replace("private/pkg", "%70rivate/p%6Bg"),
    url.replace("private/pkg", "%2570rivate/%2570kg"),
    url.replace("private/pkg", "private/elsewhere/%2e%2e/pkg"),
    url.replace("private/pkg", "private/elsewhere/%252e%252e/pkg"),
    url.replace("private/pkg", "private//pkg"),
    url.replace("private/pkg", "private%2fpkg"),
    url.replace("private/pkg", "private%255cpkg"),
    url.replace("private/pkg", "private/pkg;view=raw"),
    url.replace("private/pkg", "private/pkg%3Fview=raw"),
    url.replace("private/pkg", "private/pkg%23fact"),
  ];
}

async function fixture(adapter: string) {
  const backing = createWacMemoryPodPort({ root: ROOT, webId: OWNER });
  const store = new NanopubStore(backing);
  const registry = createPodToolRegistry(backing, false, { clientId: CLIENT });
  const call = async (name: string, args: unknown) => {
    const tool = registry.find((entry) => entry.name === name);
    if (!tool) throw new Error(`Missing tool ${name}`);
    return tool.handler(args);
  };
  const remembered = json(
    await call("memory_remember", {
      text: SECRET,
      quote: SECRET,
      fact: { template: "condition", value: { id: "urn:condition:fictional", name: SECRET } },
    }),
  );
  const health = store.url(remembered.id);
  const policy = await backing.read(store.policyUrl);
  const denied = await call("memory_recall", { purpose: PURPOSE });
  expect(denied.isError).toBe(true);
  expect(text(denied)).toBe("purpose denied: MedicalHealth");

  async function permit() {
    await backing.write(
      store.policyUrl,
      encoder.encode(`
      @prefix odrl: <http://www.w3.org/ns/odrl/2/> .
      <> a odrl:Set; odrl:permission [
        odrl:action odrl:read; odrl:target <${PD}>; odrl:assignee <${CLIENT}>;
        odrl:constraint [odrl:leftOperand odrl:purpose; odrl:operator odrl:eq;
          odrl:rightOperand <https://w3id.org/dpv#${PURPOSE}>]
      ].`),
      "text/turtle",
      {},
    );
  }
  await permit();
  expect(
    json(await call("health_query", { kind: "conditions", purpose: PURPOSE })).facts,
  ).toHaveLength(1);
  const audit = (await backing.list(auditContainer(backing))).find(({ url }) =>
    url.endsWith(".ttl"),
  )?.url;
  if (!audit) throw new Error("Expected a persisted audit");
  await backing.write(store.policyUrl, policy.body, policy.contentType, {});

  const area = personalDataRoot(backing);
  const protectedUrls = [
    ...new Set([
      // Fully decoding would escape the area; a backend that decodes fewer
      // times still addresses a child of the protected container.
      `${area}%252e%252e/ordinary.ttl`,
      `${area}%25252e%25252e/ordinary.ttl`,
      ...[
        health,
        audit,
        store.policyUrl,
        `${store.container}.write-lock`,
        area,
        area.slice(0, -1),
        `${area.slice(0, -1)}.acl`,
        store.container,
        auditContainer(backing),
      ].flatMap(variants),
    ]),
  ];
  const aliases = new Map([
    [`${ROOT}health-alias.ttl`, health],
    [`${ROOT}audit-alias.ttl`, audit],
    [`${ROOT}encoded-alias.ttl`, variants(health)[3]],
    [`${ROOT}via.ttl`, `${ROOT}health-alias.ttl`],
  ]);
  const projectedAlias = `${ROOT}pkg-listing.ttl`;
  const children = [SAFE, ...protectedUrls, ...aliases.keys(), projectedAlias];
  const listing = `${poisonedContainerTurtle(ROOT, children)}
    <${area}> <urn:description> "${SECRET}".
    <${ROOT}> <urn:description> "${SECRET}".`;
  await backing.write(ROOT, encoder.encode(listing), "text/turtle", {});
  await backing.write(
    SAFE,
    encoder.encode('<> <urn:text> "ordinary public record".'),
    "text/turtle",
    {},
  );
  await backing.write(
    OWNER,
    encoder.encode(`<${OWNER}>
    <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${INDEX}>, <${store.policyUrl}>.`),
    "text/turtle",
    {},
  );
  await backing.write(
    INDEX,
    encoder.encode(
      protectedUrls
        .map(
          (url, i) =>
            `<urn:registration:${i}> <http://www.w3.org/ns/solid/terms#instance> <${url}>;
      <http://www.w3.org/ns/solid/terms#instanceContainer> <${area}>.`,
        )
        .join("\n"),
    ),
    "text/turtle",
    {},
  );
  const originalRead = backing.read;
  const originalList = backing.list;
  const reads: string[] = [];
  backing.read = vi.fn(async (url, options) => {
    reads.push(url);
    if (aliases.has(url)) {
      const target = aliases.get(url) === `${ROOT}health-alias.ttl` ? health : aliases.get(url);
      return {
        ...(await originalRead(url.includes("audit-alias") ? audit : health, options)),
        url: target,
      };
    }
    if (url === projectedAlias)
      return {
        body: encoder.encode(poisonedContainerTurtle(area, [health, audit])),
        contentType: "text/turtle",
      };
    return originalRead(url, options);
  });
  backing.list = vi.fn(async (url) =>
    url === ROOT
      ? children.map((child) => ({
          url: child,
          isContainer: child.endsWith("/"),
          name: child === SAFE ? "ordinary" : SECRET,
        }))
      : originalList(url),
  );

  const fetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
    const request = new Request(input, init);
    const url = request.url;
    if (aliases.has(url))
      return new Response(null, { status: 302, headers: { location: aliases.get(url) as string } });
    try {
      if (request.method === "HEAD")
        return new Response(null, { headers: { link: `<${url}.acl>; rel="acl"` } });
      if (request.method !== "GET") throw new Error("Unexpected generic mutation");
      const read = await backing.read(url);
      return new Response(new Uint8Array(read.body), {
        headers: { "content-type": read.contentType, ...(read.etag ? { etag: read.etag } : {}) },
      });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 404)
        return new Response(null, { status: 404 });
      throw error;
    }
  });
  const pod =
    adapter === "fetch"
      ? createFetchPodPort({ podRoot: ROOT, webId: OWNER, fetch, readOnly: false })
      : backing;
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "personal-boundary", version: "1" });
  clients.push(client);
  await Promise.all([
    client.connect(a),
    createSolidMcpServer({ pod, readOnly: false, clientInfo: { clientId: CLIENT } }).connect(b),
  ]);
  reads.length = 0;
  vi.mocked(fetch).mockClear();
  return {
    pod,
    backing,
    store,
    health,
    audit,
    area,
    protectedUrls,
    aliases,
    projectedAlias,
    client,
    reads,
    fetch,
    call,
    permit,
    originalRead,
  };
}

function noPrivate(value: unknown, urls: string[]) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain(SECRET);
  expect(serialized).not.toContain("wasAssociatedWith");
  for (const url of urls) expect(serialized).not.toContain(url);
}

describe.each(["portable", "fetch"])("personal storage boundary: %s", (adapter) => {
  it("refuses direct, encoded, slashless and aliased reads without fetching protected data", async () => {
    const f = await fixture(adapter);
    const auditBefore = await f.originalRead(f.audit);
    const writes = vi.spyOn(f.backing, "write");
    for (const url of [...f.protectedUrls, ...f.aliases.keys(), f.projectedAlias]) {
      for (const name of ["pod_read", "solid_read", "fetch", "pod_list", "solid_list"]) {
        const result = await f.client.callTool({
          name,
          arguments: { url, id: url, container: url },
        });
        expect(result.isError, `${name} ${url}`).toBe(true);
        expect(text(result)).toMatch(
          /^(Personal data requires a purpose-limited tool|pod-scope violation)$/,
        );
        noPrivate(result, f.protectedUrls);
      }
      const error = await f.client
        .readResource({ uri: url })
        .catch((error: Error) => error.message);
      expect(typeof error).toBe("string");
      noPrivate(error, f.protectedUrls);
    }
    expect(f.reads.some((url) => f.protectedUrls.includes(url))).toBe(false);
    const targets = vi.mocked(f.fetch).mock.calls.map(([input]) => new Request(input).url);
    expect(targets.some((url) => f.protectedUrls.includes(url))).toBe(false);
    expect(text(await f.call("memory_recall", { purpose: PURPOSE }))).toBe(
      "purpose denied: MedicalHealth",
    );
    expect(writes).not.toHaveBeenCalled();
    expect((await f.originalRead(f.audit)).body).toEqual(auditBefore.body);
  });

  it("omits protected children and aliases from listings, projections, search and resources", async () => {
    const f = await fixture(adapter);
    for (const name of ["pod_list", "solid_list", "pod_read", "solid_read", "fetch"]) {
      const result = await f.client.callTool({
        name,
        arguments: { container: ROOT, url: ROOT, id: ROOT },
      });
      expect(result.isError, text(result)).not.toBe(true);
      noPrivate(result, f.protectedUrls);
      expect(JSON.stringify(result)).toContain(SAFE);
    }
    noPrivate(await f.client.listResources(), f.protectedUrls);
    noPrivate(await f.client.readResource({ uri: ROOT }), f.protectedUrls);
    const candidates = await containerCandidates(f.pod, ROOT);
    expect(candidates.some(({ url }) => f.protectedUrls.includes(url))).toBe(false);
    for (const query of [SECRET, "pkg", "audit", "MedicalHealth"]) {
      for (const name of ["search", "solid_search"]) {
        const result = await f.client.callTool({ name, arguments: { query } });
        expect(json(result)).toEqual(name === "search" ? { results: [] } : []);
      }
      expect(await search(f.pod, query)).toEqual([]);
    }
    expect((await search(f.pod, "ordinary")).map(({ url }) => url)).toEqual([SAFE]);
    expect(f.reads.some((url) => f.protectedUrls.includes(url))).toBe(false);
  });

  it("refuses generic writes/deletes before mutation, including policy, locks and ancestors", async () => {
    const f = await fixture(adapter);
    const write = vi.spyOn(f.pod, "write");
    const remove = vi.spyOn(f.pod, "delete");
    const output = new PodOutput(f.pod);
    for (const url of [...f.protectedUrls, `${ROOT}private/`, `${ROOT}private`]) {
      for (const name of ["pod_write", "solid_write"]) {
        const result = await f.client.callTool({
          name,
          arguments: { url, content: "tamper", contentType: "text/plain" },
        });
        expect(result.isError).toBe(true);
        noPrivate(result, f.protectedUrls);
      }
      await expect(writeResource(f.pod, url, "tamper", "text/plain")).rejects.toThrow();
      await expect(output.delete(url)).rejects.toThrow(PERSONAL_DATA_DENIED);
    }
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(new TextDecoder().decode((await f.originalRead(f.health)).body)).toContain(SECRET);
    expect((await f.originalRead(f.audit)).body.byteLength).toBeGreaterThan(0);
  });

  it("applies the boundary through chat reads, candidates, ACL writes and search scopes", async () => {
    const f = await fixture(adapter);
    const chat = createChatPodPort(
      { podRoot: ROOT, webId: OWNER, fetch: f.fetch, readOnly: false },
      f.pod,
    );
    for (const url of [f.health, f.audit, ...f.aliases.keys()]) {
      await expect(chat.read(url)).rejects.toThrow(PERSONAL_DATA_DENIED);
      await expect(chat.list(url)).rejects.toThrow(PERSONAL_DATA_DENIED);
    }
    await expect(
      chat.write(f.store.policyUrl, encoder.encode("tamper"), "text/turtle", {}),
    ).rejects.toThrow(PERSONAL_DATA_DENIED);
    await expect(search(f.pod, "health", { scope: f.area })).rejects.toThrow(PERSONAL_DATA_DENIED);
    await expect(new PodOutput(f.pod).head(f.audit)).rejects.toThrow(PERSONAL_DATA_DENIED);
  });
});

it("refuses protected redirect hops even when that hop would redirect back to ordinary data", async () => {
  const backing = createWacMemoryPodPort({ root: ROOT, webId: OWNER });
  const protectedHop = new URL("alias", personalDataRoot(backing)).href;
  const start = `${ROOT}redirect`;
  const fetch: typeof globalThis.fetch = vi.fn(async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === SAFE) return new Response(SECRET, { headers: { "content-type": "text/plain" } });
    return new Response(null, {
      status: 302,
      headers: { location: url === start ? protectedHop : SAFE },
    });
  });
  await expect(readResource({ podRoot: ROOT, fetch }, start)).rejects.toThrow(PERSONAL_DATA_DENIED);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("rejects an automatically followed fetch alias with a protected response URL", async () => {
  const backing = createWacMemoryPodPort({ root: ROOT, webId: OWNER });
  const finalUrl = new URL("opaque", personalDataRoot(backing)).href;
  const fetch: typeof globalThis.fetch = vi.fn(async () => {
    const response = new Response(SECRET, { headers: { "content-type": "text/plain" } });
    Object.defineProperty(response, "url", { value: finalUrl });
    return response;
  });
  await expect(readResource({ podRoot: ROOT, fetch }, SAFE)).rejects.toThrow(PERSONAL_DATA_DENIED);
});

it("retains policy-enforcing personal access and verifies audit while generic access stays denied", async () => {
  const f = await fixture("portable");
  await f.permit();
  const [health, generic] = await Promise.all([
    f.call("health_query", { kind: "conditions", purpose: PURPOSE }),
    readResource(f.pod, f.health).catch((error: Error) => error.message),
  ]);
  expect(json(health).facts[0].assertion).toContain(SECRET);
  expect(generic).toBe(PERSONAL_DATA_DENIED);
  expect(json(await f.call("memory_recall", { purpose: PURPOSE })).facts[0].text).toBe(SECRET);
  expect(new TextDecoder().decode((await f.originalRead(f.audit)).body)).toContain(
    "wasAssociatedWith",
  );
  json(
    await f.call("memory_forget", {
      id: f.health.replace(f.store.container, "urn:uuid:").replace(/\.trig$/, ""),
      mode: "retract",
    }),
  );
});
