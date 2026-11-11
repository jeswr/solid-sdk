// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { ownerOnlyWacAcl } from "@jeswr/pkg-memory";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DataFactory as df, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { serializeBoundedTurtle } from "../src/bounded-rdf.js";
import { parseCliArguments } from "../src/cli-config.js";
import {
  CARD_REDACTION,
  createContextToolRegistry,
  findCardNumbers,
  readSharedContext,
  redactCardNumbers,
  SHARED_CONTEXT_PATH,
  setupSharedContext,
  sharedContextUrl,
} from "../src/context-tools.js";
import { MemoryNode } from "../src/memory-context.js";
import { PodOutput } from "../src/output.js";
import { createFetchPodPort, type PodPort } from "../src/pod-port.js";
import { createSolidMcpServer } from "../src/server.js";
import { makeFakePod } from "./fake-pod.js";
import { createWacMemoryPodPort } from "./wac-memory-pod.js";

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
      redactedCardNumbers: 0,
      aclVerified: false,
    });
    expect(pod.read).toHaveBeenCalledExactlyOnceWith(CONTEXT, { redirect: "error" });
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
      redactedCardNumbers: 0,
      aclVerified: false,
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

  it("refuses an alias, off-pod URL or container without a second read", async () => {
    for (const reported of [`${ROOT}secret/health.md`, "https://evil.example/context.md"]) {
      const aliased = portablePod(async () => ({
        body: new TextEncoder().encode("secret"),
        contentType: "text/markdown",
        url: reported,
      }));
      await expect(readSharedContext(aliased)).rejects.toThrow("redirect refused");
      expect(aliased.read).toHaveBeenCalledOnce();
    }
    const container = portablePod(async () => ({
      body: new TextEncoder().encode("listing"),
      contentType: "text/plain",
      isContainer: true,
    }));
    await expect(readSharedContext(container)).rejects.toThrow("redirect refused");
    const same = portablePod(async () => ({
      body: new TextEncoder().encode(MARKDOWN),
      contentType: "text/markdown",
      url: CONTEXT,
    }));
    expect(await readSharedContext(same)).toMatchObject({ status: "ok", text: MARKDOWN });
  });

  it("refuses an over-limit document", async () => {
    const pod = portablePod(async () => ({
      body: new Uint8Array(1024 * 1024 + 1),
      contentType: "text/markdown",
    }));
    await expect(readSharedContext(pod)).rejects.toThrow("bounded read limit");
  });

  it("refuses a fetch-adapter redirect at the transport, without requesting its target", async () => {
    for (const [location, redirectStatus] of [
      [`${ROOT}secret/health.md`, 301],
      [`${ROOT}secret/health.md`, 303],
      [`${ROOT}secret/health.md`, 307],
      [`${ROOT}secret/health.md`, 308],
      ["https://evil.example/context.md", 302],
    ] as const) {
      const fake = makeFakePod({
        [CONTEXT]: { contentType: "text/markdown", body: "", redirectTo: location, redirectStatus },
        [`${ROOT}secret/health.md`]: { contentType: "text/markdown", body: "secret" },
      });
      const requested: string[] = [];
      const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        requested.push(input instanceof Request ? input.url : input.toString());
        return fake.fetch(input, init);
      }) as typeof globalThis.fetch;
      const client = await connect({ podRoot: ROOT, fetch });
      const result = await client.callTool({ name: "context_read", arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("secret");
      expect(requested).toEqual([CONTEXT]);
    }
  });

  it("refuses invalid UTF-8", async () => {
    const pod = portablePod(async () => ({
      body: new Uint8Array([0xff, 0xfe]),
      contentType: "text/markdown",
    }));
    await expect(readSharedContext(pod)).rejects.toThrow();
  });

  it("redacts payment card numbers without echoing them", async () => {
    for (const card of ["4111111111111111", "4111 1111 1111 1111", "5500-0000-0000-0004"]) {
      const pod = portablePod(async () => ({
        body: new TextEncoder().encode(`My card is ${card}. Reply in English.`),
        contentType: "text/markdown",
      }));
      const result = await readSharedContext(pod);
      expect(result).toEqual({
        status: "ok",
        url: CONTEXT,
        contentType: "text/markdown",
        text: `My card is ${CARD_REDACTION}. Reply in English.`,
        redactedCardNumbers: 1,
        aclVerified: false,
      });
    }
  });

  it("finds card numbers in every documented format and at every offset", () => {
    const found = (text: string) => findCardNumbers(text).length > 0;
    for (const formatted of [
      "4111111111111111",
      "4111 1111 1111 1111 12/27",
      "4111111111111111 2024",
      "ref 99 4111111111111111",
      "4111.1111.1111.1111",
      "4111\u00a01111\u00a01111\u00a01111",
      "4111  1111  1111  1111",
      "4111   -   1111 / 1111 , 1111",
      "4111\n1111\t1111\r\n1111",
      "378282246310005",
      "41111111111111112024",
      "acct 004111111111111111",
      "4111,1111,1111,1111",
      "4111_1111_1111_1111",
      "3530111333300000",
      "6011111111111117",
      "30569309025904",
      `${"0".repeat(70)}4111111111111111`,
      `${"0".repeat(70)} 4111111111111111`,
    ])
      expect(found(formatted), formatted).toBe(true);
    for (const plain of [
      "0000000000000000",

      "12345678901",
      "",
      "4111 1111 card 1111 1111",
    ])
      expect(found(plain), plain).toBe(false);
  });

  it("redacts every digit of a match and leaves surrounding text", () => {
    expect(redactCardNumbers("a 4111 1111 1111 1111 b 4111111111111111 c")).toEqual({
      text: `a ${CARD_REDACTION} b ${CARD_REDACTION} c`,
      count: 2,
    });
    // A 19-digit card whose 12-digit prefix also passes Luhn is still fully covered.
    const { text } = redactCardNumbers("6011000990139424123");
    expect(text).not.toMatch(/\d/);
    expect(redactCardNumbers("no digits")).toEqual({ text: "no digits", count: 0 });
    // A chance-valid match earlier in the same run must not hide the card that follows it.
    expect(redactCardNumbers("Contact 07524 455523, 4111 1111 1111 1111 exp 09/28").text).toBe(
      `Contact 0${CARD_REDACTION} exp 09/28`,
    );
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let n = 0; n < 2000; n += 1) {
      const prefix = Array.from({ length: 1 + Math.floor(random() * 18) }, () =>
        Math.floor(random() * 10),
      ).join("");
      expect(redactCardNumbers(`${prefix} 4570 1927 0436 2323`).text).toMatch(
        new RegExp(`${CARD_REDACTION.replace(/[[\]]/g, "\\$&")}$`),
      );
    }
  });

  it("scans a large digit document in linear time", () => {
    const big = "4".repeat(1024 * 1024);
    const started = process.cpuUsage();
    findCardNumbers(big);
    const used = process.cpuUsage(started);
    expect((used.user + used.system) / 1000).toBeLessThan(900);
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
      redactedCardNumbers: 0,
      aclVerified: false,
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

const OWNER = `${ROOT}profile/card#me`;
const PROFILE = OWNER.split("#")[0] as string;
const INDEX = `${ROOT}settings/privateTypeIndex.ttl`;
const OTHER_CONTEXT = `${ROOT}notes/preferences.md`;
const SOLID = "http://www.w3.org/ns/solid/terms#";
const ACL = "http://www.w3.org/ns/auth/acl#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const encode = (text: string) => new TextEncoder().encode(text);
function link(store: Store, subject: string, predicate: string, value: string) {
  new MemoryNode(subject, store, df).terms(predicate).add(df.namedNode(value));
}
async function seedRdf(pod: PodPort, url: string, store: Store) {
  await pod.write(url, encode(serializeBoundedTurtle(store)), "text/turtle", {});
}
function registration(targets: string[] = [OTHER_CONTEXT]) {
  const store = new Store();
  link(store, INDEX, RDF_TYPE, `${SOLID}TypeIndex`);
  link(store, `${INDEX}#context`, RDF_TYPE, `${SOLID}TypeRegistration`);
  link(store, `${INDEX}#context`, `${SOLID}forClass`, "https://jeswr.org/ns/agent#SharedContext");
  for (const target of targets) link(store, `${INDEX}#context`, `${SOLID}instance`, target);
  return store;
}
async function contextFixture(withIndex = true) {
  const base = createWacMemoryPodPort({ root: ROOT, webId: OWNER });
  const pod: PodPort = {
    ...base,
    read: (url, opts) => base.read(url === OWNER ? PROFILE : url, opts),
    head: async (target) => ({
      acl: `${target}.acl`,
      ...(target === ROOT ? { wacAllow: 'user="read write control",public=""' } : {}),
    }),
  };
  const profile = new Store();
  link(profile, OWNER, RDF_TYPE, "http://xmlns.com/foaf/0.1/Person");
  if (withIndex) link(profile, OWNER, `${SOLID}privateTypeIndex`, INDEX);
  await seedRdf(pod, PROFILE, profile);
  if (withIndex) await seedRdf(pod, INDEX, registration());
  for (const target of [CONTEXT, OTHER_CONTEXT]) {
    await pod.write(target, encode(MARKDOWN), "text/markdown", {});
    await seedRdf(pod, `${target}.acl`, ownerOnlyWacAcl(target, OWNER, `${target}.acl`));
  }
  return pod;
}

describe("private context discovery", () => {
  it("uses only the private index and ignores public registrations", async () => {
    const pod = await contextFixture();
    const profile = new Store();
    link(profile, OWNER, `${SOLID}privateTypeIndex`, INDEX);
    link(profile, OWNER, `${SOLID}publicTypeIndex`, "https://outside.example/SECRET");
    await seedRdf(pod, PROFILE, profile);
    const read = vi.spyOn(pod, "read");
    expect(await readSharedContext(pod)).toMatchObject({
      status: "ok",
      url: OTHER_CONTEXT,
      text: MARKDOWN,
      aclVerified: true,
    });
    expect(read.mock.calls.some(([url]) => url.includes("SECRET"))).toBe(false);
  });
  it("follows private preferences pointers on the owner subject", async () => {
    const pod = await contextFixture();
    const prefs = `${ROOT}settings/prefs.ttl`;
    const profile = new Store();
    link(profile, OWNER, "http://www.w3.org/ns/pim/space#preferencesFile", prefs);
    await seedRdf(pod, PROFILE, profile);
    const store = new Store();
    link(store, OWNER, `${SOLID}privateTypeIndex`, INDEX);
    await seedRdf(pod, prefs, store);
    expect(await readSharedContext(pod)).toMatchObject({ status: "ok", url: OTHER_CONTEXT });
  });
  it("falls back only when there is no private index or no registration", async () => {
    for (const withIndex of [false, true]) {
      const pod = await contextFixture(withIndex);
      if (withIndex) {
        const empty = new Store();
        link(empty, INDEX, RDF_TYPE, `${SOLID}TypeIndex`);
        await seedRdf(pod, INDEX, empty);
      }
      expect(await readSharedContext(pod)).toMatchObject({
        status: "ok",
        url: CONTEXT,
        text: MARKDOWN,
      });
    }
  });
  it.each([
    [[OTHER_CONTEXT, CONTEXT], "ambiguous_registration"],
    [["https://outside.example/SECRET"], "registration_outside_pod"],
    [["http://alice.example/pod/SECRET"], "registration_outside_pod"],
    [["file:///SECRET"], "registration_outside_pod"],
    [[`${ROOT}notes/`], "registration_container"],
    [[`${OTHER_CONTEXT}#SECRET`], "malformed_registration"],
    [[], "malformed_registration"],
  ])("refuses unsafe registration %j", async (targets, reason) => {
    const pod = await contextFixture();
    await seedRdf(pod, INDEX, registration(targets as string[]));
    const read = vi.spyOn(pod, "read");
    expect(await readSharedContext(pod)).toEqual({ status: "error", reason });
    expect(read.mock.calls.some(([url]) => [CONTEXT, OTHER_CONTEXT].includes(url))).toBe(false);
  });
  it.each([
    "container",
    "literal",
    "untyped",
    "duplicate",
    "multiple indexes",
  ])("refuses %s registrations", async (kind) => {
    const pod = await contextFixture();
    const store = registration();
    const node = new MemoryNode(`${INDEX}#context`, store, df);
    if (kind === "container")
      node.terms(`${SOLID}instanceContainer`).add(df.namedNode(`${ROOT}notes/`));
    if (kind === "literal") node.terms(`${SOLID}instance`).add(df.literal("SECRET"));
    if (kind === "untyped") node.terms(RDF_TYPE).clear();
    if (kind === "duplicate") {
      link(store, `${INDEX}#second`, RDF_TYPE, `${SOLID}TypeRegistration`);
      link(
        store,
        `${INDEX}#second`,
        `${SOLID}forClass`,
        "https://jeswr.org/ns/agent#SharedContext",
      );
      link(store, `${INDEX}#second`, `${SOLID}instance`, OTHER_CONTEXT);
    }
    if (kind === "multiple indexes") {
      const profile = new Store();
      for (const target of [INDEX, `${ROOT}other-index`])
        link(profile, OWNER, `${SOLID}privateTypeIndex`, target);
      await seedRdf(pod, PROFILE, profile);
    }
    await seedRdf(pod, INDEX, store);
    const result = await readSharedContext(pod);
    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it.each([
    "404",
    "403",
    "malformed",
    "untyped",
    "profile",
    "outside pointer",
    "alias",
  ])("fails closed for %s index evidence", async (kind) => {
    const pod = await contextFixture();
    const original = pod.read;
    if (["404", "403", "profile", "alias"].includes(kind))
      pod.read = async (url, opts) => {
        if (url === (kind === "profile" ? OWNER : INDEX)) {
          if (kind === "alias") return { ...(await original(url, opts)), url: `${ROOT}SECRET` };
          throw Object.assign(new Error("SECRET"), { status: kind === "403" ? 403 : 404 });
        }
        return original(url, opts);
      };
    if (kind === "malformed")
      await pod.write(INDEX, encode("invalid Turtle SECRET"), "text/turtle", {});
    if (kind === "untyped") await seedRdf(pod, INDEX, new Store());
    if (kind === "outside pointer") {
      const profile = new Store();
      link(profile, OWNER, `${SOLID}privateTypeIndex`, "https://outside.example/SECRET");
      await seedRdf(pod, PROFILE, profile);
    }
    expect(await readSharedContext(pod)).toEqual({
      status: "error",
      reason: "type_index_unreadable",
    });
  });
  it("refuses discovered redirects/aliases before any second resource read", async () => {
    const pod = await contextFixture();
    const original = pod.read;
    pod.read = vi.fn(async (url, opts) =>
      url === OTHER_CONTEXT
        ? { body: encode("SECRET"), contentType: "text/markdown", url: `${ROOT}alias` }
        : original(url, opts),
    );
    await expect(readSharedContext(pod)).rejects.toThrow("redirect refused");
    expect(pod.read).toHaveBeenCalledWith(OTHER_CONTEXT, { redirect: "error" });
    expect(vi.mocked(pod.read).mock.calls.filter(([url]) => url === OTHER_CONTEXT)).toHaveLength(1);
  });
});

describe("context write-authority verification", () => {
  it.each([
    "public write",
    "public append",
    "authenticated",
    "other agent",
    "group",
    "origin",
    "origin only",
    "public control",
    "public agent",
    "malformed",
    "unreadable",
    "unsafe link",
  ])("withholds text for %s", async (kind) => {
    const pod = await contextFixture();
    const store = ownerOnlyWacAcl(OTHER_CONTEXT, OWNER, `${OTHER_CONTEXT}.acl`);
    const node = new MemoryNode(`${OTHER_CONTEXT}.acl#owner`, store, df);
    if (["public write", "public append", "public control"].includes(kind)) {
      const mode = kind.split(" ")[1];
      pod.head = async () => ({ wacAllow: `user="read write control",public="${mode}"` });
    }
    if (kind === "authenticated") {
      node.terms(`${ACL}agentClass`).add(df.namedNode(`${ACL}AuthenticatedAgent`));
      node.terms(`${ACL}mode`).clear();
      node.terms(`${ACL}mode`).add(df.namedNode(`${ACL}Append`));
    }
    if (kind === "public agent")
      node.terms(`${ACL}agentClass`).add(df.namedNode("http://xmlns.com/foaf/0.1/Agent"));
    if (kind === "other agent")
      node.terms(`${ACL}agent`).add(df.namedNode("https://outside.example/SECRET"));
    if (kind === "group") node.terms(`${ACL}agentGroup`).add(df.namedNode(`${ROOT}group`));
    if (kind.startsWith("origin"))
      node.terms(`${ACL}origin`).add(df.namedNode("https://outside.example/SECRET"));
    if (kind === "origin only") node.terms(`${ACL}agent`).clear();
    await seedRdf(pod, `${OTHER_CONTEXT}.acl`, store);
    if (kind === "malformed")
      await pod.write(`${OTHER_CONTEXT}.acl`, encode("SECRET invalid"), "text/turtle", {});
    if (kind === "unreadable") {
      const read = pod.read;
      pod.read = (url, opts) => {
        if (url === `${OTHER_CONTEXT}.acl`) throw new Error("SECRET");
        return read(url, opts);
      };
    }
    if (kind === "unsafe link") pod.head = async () => ({ acl: "https://outside.example/SECRET" });
    const result = await readSharedContext(pod);
    expect(result.status).toBe("untrusted");
    expect(result).not.toHaveProperty("text");
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("accepts owner-only writes, and read-only public grants", async () => {
    const pod = await contextFixture();
    const store = ownerOnlyWacAcl(OTHER_CONTEXT, OWNER, `${OTHER_CONTEXT}.acl`);
    link(store, "urn:example:reader", RDF_TYPE, `${ACL}Authorization`);
    link(store, "urn:example:reader", `${ACL}accessTo`, OTHER_CONTEXT);
    link(store, "urn:example:reader", `${ACL}agentClass`, "http://xmlns.com/foaf/0.1/Agent");
    link(store, "urn:example:reader", `${ACL}mode`, `${ACL}Read`);
    await seedRdf(pod, `${OTHER_CONTEXT}.acl`, store);
    expect(await readSharedContext(pod)).toMatchObject({ status: "ok", aclVerified: true });
  });
  it("checks inherited default grants, including legacy defaultForNew", async () => {
    for (const legacy of [false, true])
      for (const unsafe of [false, true]) {
        const pod = await contextFixture();
        await pod.delete(`${OTHER_CONTEXT}.acl`);
        const parent = `${ROOT}notes/`;
        const acl = `${parent}.acl`;
        const store = ownerOnlyWacAcl(parent, OWNER, acl, true);
        const node = new MemoryNode(`${acl}#owner`, store, df);
        if (legacy) {
          node.terms(`${ACL}default`).clear();
          node.terms(`${ACL}defaultForNew`).add(df.namedNode(parent));
        }
        if (unsafe) node.terms(`${ACL}agentGroup`).add(df.namedNode(`${ROOT}group`));
        await seedRdf(pod, acl, store);
        expect(await readSharedContext(pod)).toMatchObject(
          unsafe ? { status: "untrusted" } : { status: "ok", aclVerified: true },
        );
      }
  });
  it("marks portable ports with no ACL capability as unverified", async () => {
    const pod = await contextFixture();
    delete pod.head;
    expect(await readSharedContext(pod)).toMatchObject({ status: "ok", aclVerified: false });
  });
  it("checks public write evidence even without a HEAD capability", async () => {
    const pod = markdownPod();
    pod.read = vi.fn(async () => ({
      body: encode("SECRET"),
      contentType: "text/plain",
      wacAllow: 'public="write"',
    }));
    expect(await readSharedContext(pod)).toEqual({
      status: "untrusted",
      url: CONTEXT,
      reason: "public_write",
    });
  });
});

describe("owner-only shared-context setup", () => {
  it("creates the document after its ACL, registers once, and reruns without writes", async () => {
    const pod = await contextFixture(false);
    await pod.delete(CONTEXT);
    await pod.delete(`${CONTEXT}.acl`);
    const write = vi.spyOn(pod, "write");
    expect(await setupSharedContext(pod, { webId: OWNER, initialText: MARKDOWN })).toEqual({
      status: "created",
      url: CONTEXT,
      registered: true,
    });
    expect(write.mock.calls.findIndex(([url]) => url === `${CONTEXT}.acl`)).toBeLessThan(
      write.mock.calls.findIndex(([url]) => url === CONTEXT),
    );
    expect(write.mock.calls.find(([url]) => url === CONTEXT)?.[3]).toEqual({ ifNoneMatch: "*" });
    write.mockClear();
    expect(await setupSharedContext(pod, { webId: OWNER, initialText: "replacement" })).toEqual({
      status: "already_exists",
      url: CONTEXT,
      registered: true,
    });
    expect(write).not.toHaveBeenCalled();
    expect(await readSharedContext(pod)).toMatchObject({
      status: "ok",
      text: MARKDOWN,
      aclVerified: true,
    });
  });
  it("preserves and registers an already existing owner document", async () => {
    const pod = await contextFixture(false);
    const before = await pod.read(CONTEXT);
    expect(
      await setupSharedContext(pod, { webId: OWNER, initialText: "replacement" }),
    ).toMatchObject({ status: "already_exists" });
    expect(await pod.read(CONTEXT)).toEqual(before);
  });
  it("refuses a different registration without mutation", async () => {
    const pod = await contextFixture();
    const write = vi.spyOn(pod, "write");
    expect(await setupSharedContext(pod, { webId: OWNER })).toEqual({
      status: "error",
      reason: "foreign_registration",
    });
    expect(write).not.toHaveBeenCalled();
  });
  it("refuses missing ACL capabilities, mismatched owners and oversized initial text", async () => {
    for (const kind of ["acl", "owner", "size"]) {
      const pod = await contextFixture(false);
      await pod.delete(CONTEXT);
      if (kind === "acl") delete pod.head;
      expect(
        await setupSharedContext(pod, {
          webId: kind === "owner" ? "https://outside.example/SECRET" : OWNER,
          initialText: kind === "size" ? "x".repeat(1024 * 1024 + 1) : undefined,
        }),
      ).toEqual({ status: "error", reason: "setup_failed" });
    }
  });
  it("parses only the explicit owner-facing CLI command and optional initial text", () => {
    expect(parseCliArguments([])).toEqual({ command: "serve" });
    expect(parseCliArguments(["context-init"])).toEqual({ command: "context-init" });
    expect(parseCliArguments(["context-init", "--initial-text", MARKDOWN])).toEqual({
      command: "context-init",
      initialText: MARKDOWN,
    });
    for (const args of [
      ["unknown"],
      ["context-init", "--url", "https://outside.example/SECRET"],
      ["context-init", "--initial-text"],
      ["context-init", "extra"],
    ])
      expect(() => parseCliArguments(args)).toThrow();
  });
});

describe("shared Unicode card redaction", () => {
  const pan = "4111111111111111";
  const scripts = [0xff10, 0x0660, 0x0966, 0x1d7ce];
  const digits = (zero: number) =>
    [...pan].map((digit) => String.fromCodePoint(zero + Number(digit))).join("");
  it("maps every decimal script and mixed scripts back to original UTF-16 offsets", () => {
    for (const value of [
      ...scripts.map(digits),
      [...pan]
        .map((digit, i) =>
          String.fromCodePoint((scripts[i % scripts.length] as number) + Number(digit)),
        )
        .join(""),
    ]) {
      const prefix = "😀 owner 🧠 ";
      const text = `${prefix}${value} end 🎉`;
      expect(findCardNumbers(text)).toEqual([[prefix.length, prefix.length + value.length]]);
      expect(redactCardNumbers(text, "[hidden]")).toEqual({
        text: `${prefix}[hidden] end 🎉`,
        count: 1,
      });
    }
  });
  it.each([
    "\u2009",
    "\u202f",
    "\u3000",
    "\u2011",
    "\u2013",
    "\u00b7",
    "\u2027",
    "\t\n",
    ".",
    ",",
    "_",
    "/",
  ])("redacts Unicode grouping %j", (separator) => {
    const grouped = ["４１１１", "١١١١", "११११", "𝟏𝟏𝟏𝟏"].join(separator);
    expect(redactCardNumbers(`😀 ${grouped} done`)).toEqual({
      text: "😀 [card number removed] done",
      count: 1,
    });
  });
  it("merges overlapping and adjacent matches and preserves non-card numbers", () => {
    expect(redactCardNumbers(pan + pan)).toEqual({ text: "[card number removed]", count: 1 });
    expect(redactCardNumbers(`${pan} ${pan}`)).toEqual({ text: "[card number removed]", count: 1 });
    expect(redactCardNumbers(`${pan}x${pan}`)).toEqual({
      text: "[card number removed]x[card number removed]",
      count: 2,
    });
    expect(redactCardNumbers("000000000000000000000000000000")).toEqual({
      text: "000000000000000000000000000000",
      count: 0,
    });
    expect(redactCardNumbers("999999999999999999999999")).toEqual({
      text: "999999999999999999999999",
      count: 0,
    });
    expect(redactCardNumbers("6011000990139424123").text).toBe("[card number removed]");
  });
  it("finishes a 1 MiB digit run well below one second", () => {
    const text = "4".repeat(1024 * 1024);
    // Count CPU work so concurrent suite workers do not turn scheduler delays into failures.
    const started = process.cpuUsage();
    findCardNumbers(text);
    const used = process.cpuUsage(started);
    expect((used.user + used.system) / 1000).toBeLessThan(900);
  });
});

it("refuses a redirect from a discovered URL at the fetch transport", async () => {
  const profile = new Store();
  link(profile, OWNER, `${SOLID}privateTypeIndex`, INDEX);
  const fake = makeFakePod({
    [PROFILE]: { body: serializeBoundedTurtle(profile), contentType: "text/turtle" },
    [OWNER]: { body: serializeBoundedTurtle(profile), contentType: "text/turtle" },
    [INDEX]: { body: serializeBoundedTurtle(registration()), contentType: "text/turtle" },
    [OTHER_CONTEXT]: {
      body: "",
      contentType: "text/markdown",
      redirectTo: `${ROOT}SECRET`,
      redirectStatus: 302,
    },
  });
  const requests: string[] = [];
  const client = await connect({
    podRoot: ROOT,
    webId: OWNER,
    fetch: async (input, init) => {
      requests.push(input instanceof Request ? input.url : input.toString());
      return fake.fetch(input, init);
    },
  });
  const result = await client.callTool({ name: "context_read", arguments: {} });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).not.toContain("SECRET");
  expect(requests).not.toContain(`${ROOT}SECRET`);
});

it("reads only the configured off-pod owner profile for private discovery", async () => {
  const pod = await contextFixture();
  const externalOwner = "https://identity.example/card#me";
  const profile = new Store();
  link(profile, externalOwner, `${SOLID}privateTypeIndex`, INDEX);
  const read = pod.read;
  const port = {
    ...pod,
    webId: externalOwner,
    read: vi.fn(async (url: string, opts?: Parameters<PodPort["read"]>[1]) =>
      url === externalOwner
        ? { body: encode(serializeBoundedTurtle(profile)), contentType: "text/turtle" }
        : read(url, opts),
    ),
  };
  // The resource ACL must agree with the configured owner too.
  await seedRdf(
    pod,
    `${OTHER_CONTEXT}.acl`,
    ownerOnlyWacAcl(OTHER_CONTEXT, externalOwner, `${OTHER_CONTEXT}.acl`),
  );
  expect(await readSharedContext(port)).toMatchObject({
    status: "ok",
    url: OTHER_CONTEXT,
    aclVerified: true,
  });
  expect(port.read).toHaveBeenCalledWith(externalOwner, {
    accept: "text/turtle",
    redirect: "error",
  });
});

it.each([
  "malformed header",
  "HEAD error",
  "missing ancestor ACL",
  "ACL alias",
  "ACL container",
  "ACL overflow",
])("withholds context for %s evidence", async (kind) => {
  const pod = await contextFixture();
  const read = pod.read;
  if (kind === "malformed header") pod.head = async () => ({ wacAllow: "unparseable SECRET" });
  if (kind === "HEAD error")
    pod.head = async () => {
      throw new Error("SECRET");
    };
  if (kind === "missing ancestor ACL") {
    await pod.delete(`${OTHER_CONTEXT}.acl`);
    pod.head = async (target) => (target === OTHER_CONTEXT ? { acl: `${target}.acl` } : {});
  }
  if (kind.startsWith("ACL "))
    pod.read = async (url, opts) => {
      const raw = await read(url, opts);
      if (url !== `${OTHER_CONTEXT}.acl`) return raw;
      return {
        ...raw,
        ...(kind === "ACL alias"
          ? { url: "https://outside.example/SECRET" }
          : kind === "ACL container"
            ? { isContainer: true }
            : { body: new Uint8Array(1024 * 1024 + 1) }),
      };
    };
  expect(await readSharedContext(pod)).toEqual({
    status: "untrusted",
    url: OTHER_CONTEXT,
    reason: "acl_unverifiable",
  });
});

it("setup preserves public pointers and unrelated profile RDF during index bootstrap", async () => {
  const pod = await contextFixture(false);
  const profile = new Store();
  link(profile, OWNER, `${SOLID}publicTypeIndex`, `${ROOT}public-index.ttl`);
  new MemoryNode(OWNER, profile, df).text("http://xmlns.com/foaf/0.1/name", "Fictional owner");
  await seedRdf(pod, PROFILE, profile);
  expect(await setupSharedContext(pod, { webId: OWNER })).toMatchObject({
    status: "already_exists",
  });
  const saved = new TextDecoder().decode((await pod.read(PROFILE)).body);
  expect(saved).toContain("public-index.ttl");
  expect(saved).toContain("Fictional owner");
});

it("setup never overwrites a document created concurrently", async () => {
  const pod = await contextFixture(false);
  await pod.delete(CONTEXT);
  const write = pod.write;
  pod.write = async (url, bytes, type, cond) => {
    if (url === CONTEXT && cond.ifNoneMatch === "*")
      await write(url, encode("Concurrent owner text"), type, {});
    return write(url, bytes, type, cond);
  };
  expect(await setupSharedContext(pod, { webId: OWNER, initialText: "replacement" })).toMatchObject(
    { status: "already_exists" },
  );
  expect(new TextDecoder().decode((await pod.read(CONTEXT)).body)).toBe("Concurrent owner text");
});

it("setup stops when a foreign registration appears during registration", async () => {
  const pod = await contextFixture();
  const empty = new Store();
  link(empty, INDEX, RDF_TYPE, `${SOLID}TypeIndex`);
  await seedRdf(pod, INDEX, empty);
  const read = pod.read;
  let indexReads = 0;
  pod.read = async (url, opts) => {
    if (url === INDEX && ++indexReads === 2) await seedRdf(pod, INDEX, registration());
    return read(url, opts);
  };
  const write = vi.spyOn(pod, "write");
  expect(await setupSharedContext(pod, { webId: OWNER })).toEqual({
    status: "error",
    reason: "ambiguous_registration",
  });
  expect(write.mock.calls.filter(([url]) => url === INDEX)).toHaveLength(1); // Only the competing fixture writer.
});

it("generic tools refuse mutations of the discovered context, pointers, ACLs and ancestors", async () => {
  const pod = await contextFixture();
  const write = vi.spyOn(pod, "write");
  const remove = vi.spyOn(pod, "delete");
  const output = new PodOutput(pod);
  for (const url of [
    OTHER_CONTEXT,
    `${OTHER_CONTEXT}.acl`,
    `${ROOT}notes/`,
    INDEX,
    `${INDEX}.acl`,
    OTHER_CONTEXT.replace("notes", "%6eotes"),
  ]) {
    await expect(output.write(url, encode("replacement"), "text/plain", {})).rejects.toThrow(
      "Personal data requires a purpose-limited tool",
    );
    await expect(output.delete(url)).rejects.toThrow(
      "Personal data requires a purpose-limited tool",
    );
  }
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it.each([
  '<one>; rel="acl", <two>; rel="acl"',
  '<one>; rel="acl"; anchor="other"',
  "malformed",
  '<one>; rel="http://www.w3.org/ns/solid/acp#accessControl"',
])("does not downgrade invalid ACL links to an unknown capability: %s", async (header) => {
  const pod = createFetchPodPort({
    podRoot: ROOT,
    fetch: async (_input, init) =>
      init?.method === "HEAD"
        ? new Response(null, { headers: { link: header } })
        : new Response(MARKDOWN, { headers: { "content-type": "text/markdown" } }),
  });
  expect(await readSharedContext(pod)).toEqual({
    status: "untrusted",
    url: CONTEXT,
    reason: "acl_unverifiable",
  });
});

it("setup removes an orphan public-Read grant before creating private context", async () => {
  const pod = await contextFixture(false);
  await pod.delete(CONTEXT);
  const store = ownerOnlyWacAcl(CONTEXT, OWNER, `${CONTEXT}.acl`);
  link(store, "urn:example:reader", RDF_TYPE, `${ACL}Authorization`);
  link(store, "urn:example:reader", `${ACL}accessTo`, CONTEXT);
  link(store, "urn:example:reader", `${ACL}agentClass`, "http://xmlns.com/foaf/0.1/Agent");
  link(store, "urn:example:reader", `${ACL}mode`, `${ACL}Read`);
  await seedRdf(pod, `${CONTEXT}.acl`, store);
  const write = vi.spyOn(pod, "write");
  expect(await setupSharedContext(pod, { webId: OWNER })).toMatchObject({ status: "created" });
  const aclWrite = write.mock.calls.find(([url]) => url === `${CONTEXT}.acl`);
  expect(aclWrite?.[3].ifMatch).toMatch(/^"/);
  expect(new TextDecoder().decode((await pod.read(`${CONTEXT}.acl`)).body)).not.toContain(
    "foaf/0.1/Agent",
  );
});

it.each([
  "shared ACL",
  "weak ETag",
  "denied ACL write",
  "changed association",
  "rewritten ACL",
])("setup withholds document creation for %s", async (kind) => {
  const pod = await contextFixture(false);
  await pod.delete(CONTEXT);
  const acl = `${CONTEXT}.acl`;
  const store = ownerOnlyWacAcl(CONTEXT, OWNER, acl);
  if (kind === "shared ACL") link(store, `${acl}#owner`, `${ACL}accessTo`, `${ROOT}other-private`);
  if (kind === "weak ETag") {
    link(store, "urn:example:reader", RDF_TYPE, `${ACL}Authorization`);
    link(store, "urn:example:reader", `${ACL}accessTo`, CONTEXT);
    link(store, "urn:example:reader", `${ACL}agentClass`, "http://xmlns.com/foaf/0.1/Agent");
    link(store, "urn:example:reader", `${ACL}mode`, `${ACL}Read`);
  }
  await seedRdf(pod, acl, store);
  if (kind === "weak ETag") {
    const read = pod.read;
    pod.read = async (url, opts) => ({
      ...(await read(url, opts)),
      ...(url === acl ? { etag: 'W/"one"' } : {}),
    });
  }
  if (["denied ACL write", "changed association", "rewritten ACL"].includes(kind))
    await pod.delete(acl);
  const original = pod.write;
  let changed = false;
  pod.write = async (url, bytes, type, cond) => {
    if (url === acl && kind === "denied ACL write")
      throw Object.assign(new Error("SECRET"), { status: 403 });
    const result = await original(url, bytes, type, cond);
    if (url === acl) changed = true;
    if (url === acl && kind === "rewritten ACL") {
      const exposed = ownerOnlyWacAcl(CONTEXT, OWNER, acl);
      link(exposed, "urn:example:reader", RDF_TYPE, `${ACL}Authorization`);
      link(exposed, "urn:example:reader", `${ACL}accessTo`, CONTEXT);
      link(exposed, "urn:example:reader", `${ACL}agentClass`, "http://xmlns.com/foaf/0.1/Agent");
      link(exposed, "urn:example:reader", `${ACL}mode`, `${ACL}Read`);
      await original(url, encode(serializeBoundedTurtle(exposed)), type, {});
    }
    return result;
  };
  if (kind === "changed association") {
    const head = pod.head as NonNullable<PodPort["head"]>;
    pod.head = (target) =>
      target === CONTEXT && changed
        ? Promise.resolve({ acl: `${ROOT}different.acl` })
        : head(target);
  }
  const write = vi.spyOn(pod, "write");
  expect(await setupSharedContext(pod, { webId: OWNER })).toEqual({
    status: "error",
    reason: "setup_failed",
  });
  expect(write.mock.calls.some(([url]) => url === CONTEXT)).toBe(false);
});

it.each([
  "profile index",
  "preferences index",
  "profile preferences",
])("refuses discovery document role aliases: %s", async (kind) => {
  const pod = await contextFixture();
  const profile = new Store();
  const prefs = `${ROOT}settings/prefs.ttl`;
  if (kind === "profile index") link(profile, OWNER, `${SOLID}privateTypeIndex`, PROFILE);
  if (kind === "profile preferences")
    link(profile, OWNER, "http://www.w3.org/ns/pim/space#preferencesFile", PROFILE);
  if (kind === "preferences index") {
    link(profile, OWNER, "http://www.w3.org/ns/pim/space#preferencesFile", prefs);
    const store = new Store();
    link(store, OWNER, `${SOLID}privateTypeIndex`, prefs);
    await seedRdf(pod, prefs, store);
  }
  await seedRdf(pod, PROFILE, profile);
  expect(await readSharedContext(pod)).toEqual({
    status: "error",
    reason: "type_index_unreadable",
  });
});

it("setup retains class/prototype-based port methods and their receiver", async () => {
  const pod = await contextFixture();
  await seedRdf(pod, INDEX, registration([CONTEXT]));
  const port: PodPort = Object.create({
    get root() {
      return pod.root;
    },
    get webId() {
      return pod.webId;
    },
    read: (url: string, opts?: Parameters<PodPort["read"]>[1]) => pod.read(url, opts),
    list: (url: string) => pod.list(url),
    write: (...args: Parameters<PodPort["write"]>) => pod.write(...args),
    delete: (...args: Parameters<PodPort["delete"]>) => pod.delete(...args),
    head: (url: string) => (pod.head as NonNullable<PodPort["head"]>)(url),
  });
  expect(await setupSharedContext(port, { webId: OWNER })).toEqual({
    status: "already_exists",
    url: CONTEXT,
    registered: true,
  });
});

it("returns structured discovery/setup errors on the shared deadline", async () => {
  vi.useFakeTimers();
  try {
    const pod = { ...portablePod(() => new Promise(() => {})), webId: OWNER };
    const read = readSharedContext(pod);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await read).toEqual({ status: "error", reason: "type_index_unreadable" });
    const setup = setupSharedContext(pod, { webId: OWNER });
    await vi.advanceTimersByTimeAsync(5001);
    expect(await setup).toEqual({ status: "error", reason: "setup_failed" });
  } finally {
    vi.useRealTimers();
  }
});

it("accepts an exact registered document URL with a query and no fragment", async () => {
  const pod = await contextFixture();
  const url = `${OTHER_CONTEXT}?view=owner`;
  const acl = `${ROOT}permissions/context-owner`;
  await seedRdf(pod, INDEX, registration([url]));
  await pod.write(url, encode(MARKDOWN), "text/markdown", {});
  await seedRdf(pod, acl, ownerOnlyWacAcl(url, OWNER, acl));
  const head = pod.head as NonNullable<PodPort["head"]>;
  pod.head = (target) => (target === url ? Promise.resolve({ acl }) : head(target));
  expect(await readSharedContext(pod)).toMatchObject({
    status: "ok",
    url,
    text: MARKDOWN,
    aclVerified: true,
  });
});

it("rejects a discovered slashless container identified by the backend", async () => {
  const pod = await contextFixture();
  const read = pod.read;
  pod.read = async (url, opts) => ({
    ...(await read(url, opts)),
    ...(url === OTHER_CONTEXT ? { isContainer: true } : {}),
  });
  expect(await readSharedContext(pod)).toEqual({
    status: "error",
    reason: "registration_container",
  });
});
