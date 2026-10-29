// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDocument } from "../src/fetch.js";
import { listContainer, readRdf, readResource, search } from "../src/pod.js";
import { createFetchPodPort, type PodPort } from "../src/pod-port.js";
import { createSolidMcpServer } from "../src/server.js";
import { containerTurtle, type FakeResource, makeFakePod } from "./fake-pod.js";

const ROOT = "https://pod.example.org/data/";
const SECRET = `${ROOT}sensitive-record.ttl`;
const ALLOWED = `${ROOT}allowed-record.ttl`;
const PRIVATE = "private medical description";
const PARENTS = [
  ROOT,
  ROOT.slice(0, -1),
  `${ROOT}?view=listing`,
  `${ROOT}listing`,
  `${ROOT}redirect`,
];
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function fixture(adapter: string) {
  const parent = `${containerTurtle(ROOT, [
    { name: "sensitive-record.ttl" },
    { name: "allowed-record.ttl" },
  ])}
    <${SECRET}> <urn:description> "${PRIVATE}".
    <${ROOT}> <urn:description> "sensitive-record.ttl".
    <${ROOT}> <urn:alias> <${SECRET}>.
  `;
  const resources: Record<string, FakeResource> = {
    [SECRET]: { contentType: "text/turtle", body: `<> <urn:text> "${PRIVATE}".` },
    [ALLOWED]: { contentType: "text/turtle", body: '<> <urn:text> "allowed record".' },
  };
  for (const url of PARENTS) resources[url] = { contentType: "text/turtle", body: parent };
  resources[PARENTS[4]] = { contentType: "text/turtle", body: "", redirectTo: ROOT };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await makeFakePod(resources).fetch(input, init);
    if (init?.method === "PUT") {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      resources[url] = {
        body: await new Response(init.body).text(),
        contentType: new Headers(init.headers).get("content-type") ?? "text/plain",
      };
    }
    return response;
  };
  const pod: PodPort =
    adapter === "decorated fetch"
      ? createFetchPodPort({ fetch, podRoot: ROOT, readOnly: false })
      : {
          root: ROOT,
          webId: "",
          async read(url) {
            const resource = resources[url];
            if (!resource) throw new Error(`HTTP 404 ${url}`);
            return {
              body: new TextEncoder().encode(resource.body),
              contentType: resource.contentType,
              etag: '"version"',
              ...(url === PARENTS[4] ? { url: ROOT } : {}),
            };
          },
          async list() {
            return [SECRET, ALLOWED].map((url) => ({ url, isContainer: false }));
          },
          async write(url, body, contentType) {
            resources[url] = { body: new TextDecoder().decode(body), contentType };
            return { etag: '"version"' };
          },
          async delete() {},
        };
  const server = createSolidMcpServer({ pod, readOnly: false });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "purpose-output-matrix", version: "1" });
  clients.push(client);
  await Promise.all([client.connect(a), server.connect(b)]);
  let denied = true;
  const read = pod.read;
  const write = pod.write;
  // Deliberately installed after server construction, with a verbose private error.
  pod.read = vi.fn(async (url, options) => {
    const result = await read(url, options);
    if (url === SECRET && denied) throw new Error(`purpose denied ${SECRET}: ${PRIVATE}`);
    return result;
  });
  pod.write = vi.fn<PodPort["write"]>(async (...args) => {
    if (args[0] === SECRET && denied) throw new Error(`purpose denied ${SECRET}: ${PRIVATE}`);
    return write(...args);
  });
  return {
    pod,
    client,
    resources,
    allow: () => {
      denied = false;
    },
  };
}

function noSecret(result: unknown) {
  const output = JSON.stringify(result);
  expect(output).not.toContain(SECRET);
  expect(output).not.toContain("sensitive-record");
  expect(output).not.toContain(PRIVATE);
}

describe.each(["decorated fetch", "portable"])("shared output authorization: %s", (adapter) => {
  describe.each(PARENTS)("container and alias %s", (parent) => {
    it.each([
      "fetch",
      "pod_read",
      "solid_read",
      "pod_list",
      "solid_list",
    ])("%s omits the purpose-denied child and preserves the allowed child", async (name) => {
      const { client, allow } = await fixture(adapter);
      const arguments_ = { id: parent, url: parent, container: parent };
      const result = await client.callTool({ name, arguments: arguments_ });
      expect(result.isError).toBeFalsy();
      noSecret(result);
      expect(JSON.stringify(result)).toContain(ALLOWED);
      allow();
      const permitted = await client.callTool({ name, arguments: arguments_ });
      expect(permitted.isError).toBeFalsy();
      expect(JSON.stringify(permitted)).toContain(SECRET);
    });

    it("MCP resource reads apply the same policy", async () => {
      const { client, allow } = await fixture(adapter);
      const result = await client.readResource({ uri: parent });
      noSecret(result);
      expect(JSON.stringify(result)).toContain(ALLOWED);
      allow();
      expect(JSON.stringify(await client.readResource({ uri: parent }))).toContain(SECRET);
    });

    it("public read helpers return rebuilt, parseable RDF with filtered membership", async () => {
      const { pod } = await fixture(adapter);
      const rdf = await readRdf(pod, parent);
      noSecret(rdf.turtle);
      const parsed = await parseRdf(rdf.turtle, "text/turtle", { baseIRI: parent });
      expect(
        [...(new ContainerDataset(parsed, DataFactory).container?.contains ?? [])].map((r) => r.id),
      ).toEqual([ALLOWED]);
      for (const result of [
        await readResource(pod, parent),
        await fetchDocument(pod, parent),
        await listContainer(pod, parent),
      ]) {
        noSecret(result);
        expect(JSON.stringify(result)).toContain(ALLOWED);
      }
    });
  });

  it.each([
    "search",
    "solid_search",
  ])("%s authorizes both hits and their descriptions", async (name) => {
    const { client, pod, allow } = await fixture(adapter);
    const result = await client.callTool({ name, arguments: { query: "record" } });
    noSecret(result);
    expect(JSON.stringify(result)).toContain(ALLOWED);
    noSecret(await search(pod, "record"));
    allow();
    expect(
      JSON.stringify(await client.callTool({ name, arguments: { query: "record" } })),
    ).toContain(SECRET);
  });

  it("resource enumeration authorizes every description", async () => {
    const { client, allow } = await fixture(adapter);
    const result = await client.listResources();
    noSecret(result);
    expect(result.resources.map(({ uri }) => uri)).toEqual([ALLOWED]);
    allow();
    expect((await client.listResources()).resources.map(({ uri }) => uri)).toEqual([
      SECRET,
      ALLOWED,
    ]);
  });

  it.each([
    "fetch",
    "pod_read",
    "solid_read",
    "pod_write",
    "solid_write",
  ])("%s does not echo rejected resources through errors, and allows the permitted resource", async (name) => {
    const { client } = await fixture(adapter);
    const args = (url: string) => ({
      id: url,
      url,
      content: '<> <urn:text> "allowed record".',
      contentType: "text/turtle",
    });
    const denied = await client.callTool({ name, arguments: args(SECRET) });
    expect(denied.isError).toBe(true);
    noSecret(denied);
    const allowed = await client.callTool({ name, arguments: args(ALLOWED) });
    expect(allowed.isError).toBeFalsy();
    expect(JSON.stringify(allowed)).toContain(ALLOWED);
  });

  it("MCP resource errors do not echo rejected URLs or values", async () => {
    const { client } = await fixture(adapter);
    const error = await client.readResource({ uri: SECRET }).catch((error: Error) => error.message);
    expect(error).toContain("purpose denied");
    noSecret(error);
    expect(JSON.stringify(await client.readResource({ uri: ALLOWED }))).toContain(ALLOWED);
  });

  it.each([
    "url",
    "uri",
    "id",
    "@id",
  ])("preserves authorized JSON data with %s fields", async (key) => {
    const { client, pod, resources } = await fixture(adapter);
    const body = JSON.stringify(
      {
        url: "https://example.org/article",
        title: "Public article",
        resources: [{ [key]: SECRET, description: PRIVATE }],
      },
      null,
      2,
    ).replaceAll("/", "\\/");
    resources[ALLOWED] = { contentType: "application/json", body, etag: '"bookmark"' };
    vi.mocked(pod.read).mockClear();
    expect(await readResource(pod, ALLOWED)).toMatchObject({ text: body });
    for (const name of ["pod_read", "solid_read"]) {
      const result = await client.callTool({ name, arguments: { url: ALLOWED } });
      expect(result.isError).toBeFalsy();
      expect(result.content).toEqual([{ type: "text", text: body }]);
    }
    const result = await client.readResource({ uri: ALLOWED });
    expect(result.contents[0]).toMatchObject({ text: body });
    expect(vi.mocked(pod.read).mock.calls.every(([url]) => url === ALLOWED)).toBe(true);
  });

  it("preserves prose links, filenames and trailing punctuation without following them", async () => {
    const { client, pod, resources } = await fixture(adapter);
    const body = `See ${SECRET}. Also (${ROOT}report.txt), sensitive-record.ttl!`;
    resources[ALLOWED] = { contentType: "text/plain", body, etag: `"${SECRET}"` };
    vi.mocked(pod.read).mockClear();
    expect(await readResource(pod, ALLOWED)).toMatchObject({ text: body });
    expect(await fetchDocument(pod, ALLOWED)).toMatchObject({ text: body });
    for (const name of ["pod_read", "solid_read"]) {
      const result = await client.callTool({ name, arguments: { url: ALLOWED } });
      expect(result.content).toEqual([{ type: "text", text: body }]);
    }
    const fetched = await client.callTool({ name: "fetch", arguments: { id: ALLOWED } });
    const content = fetched.content as { text: string }[];
    expect(JSON.parse(content[0].text).text).toBe(body);
    expect((await client.readResource({ uri: ALLOWED })).contents[0]).toMatchObject({ text: body });
    expect(vi.mocked(pod.read).mock.calls.every(([url]) => url === ALLOWED)).toBe(true);
  });

  it("preserves all terms and attached descriptions in an authorized RDF document", async () => {
    const { client, pod, resources } = await fixture(adapter);
    const body = `<${SECRET}> <urn:detail> _:a.
      _:a <urn:next> _:b. _:b <urn:value> "${PRIVATE}".
      <${ALLOWED}> <urn:link> <${SECRET}>; <urn:value> "record ${SECRET}".`;
    resources[ALLOWED] = { contentType: "text/turtle", body };
    vi.mocked(pod.read).mockClear();
    expect((await readResource(pod, ALLOWED)).text).toBe(body);
    const rdf = await readRdf(pod, ALLOWED);
    expect(rdf.dataset.size).toBe(5);
    for (const name of ["fetch", "pod_read", "solid_read"]) {
      const result = await client.callTool({ name, arguments: { url: ALLOWED, id: ALLOWED } });
      expect(result.isError).toBeFalsy();
      expect(JSON.stringify(result)).toContain(PRIVATE);
      expect(JSON.stringify(result)).toContain(SECRET);
    }
    expect(JSON.stringify(await client.readResource({ uri: ALLOWED }))).toContain(PRIVATE);
    expect(vi.mocked(pod.read).mock.calls.every(([url]) => url === ALLOWED)).toBe(true);
    for (const name of ["search", "solid_search"]) {
      const result = await client.callTool({ name, arguments: { query: "private medical" } });
      expect(result.isError).toBeFalsy();
      const content = result.content as { text: string }[];
      const parsed = JSON.parse(content[0].text);
      expect(
        name === "search"
          ? parsed.results.map((hit: { id: string }) => hit.id)
          : parsed.map((hit: { url: string }) => hit.url),
      ).toEqual([ALLOWED]);
      if (name === "solid_search") expect(content[0].text).toContain(PRIVATE);
    }
  });

  it("keeps server-managed descriptions only for authorized container children", async () => {
    const { pod } = await fixture(adapter);
    const list = pod.list;
    pod.list = async (url) =>
      (await list(url)).map((entry) => ({
        ...entry,
        name: entry.url === SECRET ? PRIVATE : "Allowed description",
        size: 123,
        modified: "2026-10-01T00:00:00.000Z",
        type: ["urn:Document"],
      }));
    const result = await readRdf(pod, ROOT);
    noSecret(result.turtle);
    const children = [
      ...(new ContainerDataset(result.dataset, DataFactory).container?.contains ?? []),
    ];
    expect(children).toHaveLength(1);
    expect(children[0].name).toBe("Allowed description");
    expect(children[0].size).toBe(123);
    expect(children[0].modified?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect([...children[0].type]).toContain("urn:Document");
  });

  it("authorizes an alias's final resource before returning any of its content", async () => {
    const { pod, client } = await fixture(adapter);
    const read = pod.read;
    pod.read = async (url, options) =>
      url === ALLOWED
        ? { body: new TextEncoder().encode(PRIVATE), contentType: "text/plain", url: SECRET }
        : read(url, options);
    for (const name of ["fetch", "pod_read", "solid_read"]) {
      const result = await client.callTool({ name, arguments: { id: ALLOWED, url: ALLOWED } });
      expect(result.isError).toBe(true);
      noSecret(result);
    }
    const error = await client
      .readResource({ uri: ALLOWED })
      .catch((error: Error) => error.message);
    noSecret(error);
    expect(error).toContain("purpose denied");
  });

  it("never passes verbose list or arbitrary backend errors through MCP", async () => {
    const { pod, client } = await fixture(adapter);
    pod.list = async () => {
      throw new Error(`listing failed ${SECRET}: ${PRIVATE}`);
    };
    for (const name of ["pod_list", "solid_list"]) {
      const result = await client.callTool({ name, arguments: { container: ROOT } });
      expect(result.isError).toBe(true);
      noSecret(result);
    }
    for (const operation of [
      () => client.listResources(),
      () => client.readResource({ uri: ROOT }),
    ]) {
      const error = await operation().catch((error: Error) => error.message);
      expect(error).toContain("Pod operation failed");
      noSecret(error);
    }
    pod.read = async () => {
      throw { message: SECRET, data: PRIVATE };
    };
    const result = await client.callTool({ name: "fetch", arguments: { id: SECRET } });
    expect(result.isError).toBe(true);
    noSecret(result);
  });

  it("does not expose a write-only resource or its backend metadata in a receipt", async () => {
    const { pod, client } = await fixture(adapter);
    pod.write = vi.fn(async () => ({ etag: `"${SECRET}"`, privateDescription: PRIVATE }));
    for (const name of ["pod_write", "solid_write"]) {
      const result = await client.callTool({
        name,
        arguments: { url: SECRET, content: "record", contentType: "text/plain" },
      });
      expect(result.isError).toBe(true);
      noSecret(result);
    }
    expect(pod.write).toHaveBeenCalledTimes(2);
  });

  it.each([
    "text/turtle",
    "application/ld+json",
    "application/n-triples",
    "application/n-quads",
    "application/trig",
  ])("rebuilds %s container aliases through the same filtered graph", async (contentType) => {
    const { client, resources, pod } = await fixture(adapter);
    const source = await parseRdf(resources[ROOT].body, "text/turtle", { baseIRI: ROOT });
    const body =
      contentType === "application/ld+json"
        ? JSON.stringify([
            {
              "@id": ROOT,
              "@type": ["http://www.w3.org/ns/ldp#Container"],
              "http://www.w3.org/ns/ldp#contains": [{ "@id": SECRET }, { "@id": ALLOWED }],
              "urn:description": [{ "@value": "sensitive-record.ttl" }],
            },
            { "@id": SECRET, "urn:description": [{ "@value": PRIVATE }] },
            { "@id": ALLOWED, "@type": ["http://www.w3.org/ns/ldp#Resource"] },
          ])
        : await serialize([...source], { format: contentType, emptyAsEmptyString: false });
    resources[ROOT] = { contentType, body };
    const alias = PARENTS[3];
    resources[alias] = { contentType, body };
    noSecret(await fetchDocument(pod, alias));
    for (const name of ["fetch", "pod_read", "solid_read"]) {
      const result = await client.callTool({ name, arguments: { id: alias, url: alias } });
      expect(result.isError).toBeFalsy();
      noSecret(result);
      expect(JSON.stringify(result)).toContain(ALLOWED);
    }
    const result = await client.readResource({ uri: alias });
    noSecret(result);
    expect(JSON.stringify(result)).toContain(ALLOWED);
  });
});
