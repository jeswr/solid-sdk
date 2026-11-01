// AUTHORED-BY Codex GPT-6.1-Sol
import { createPodClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RdfLimitError } from "../src/bounded-rdf.js";
import { search } from "../src/pod.js";
import { createSolidMcpServer } from "../src/server.js";
import { createStoragePodPort } from "../src/storage-pod-port.js";

vi.mock("@jeswr/storage-client", async (original) => {
  const actual = await original<typeof import("@jeswr/storage-client")>();
  return { ...actual, createPodClient: vi.fn(actual.createPodClient) };
});
beforeEach(() => {
  vi.mocked(createPodClient).mockReset();
});
const ROOT = "https://storage-port.example/alice/";
const FILE = `${ROOT}note.txt`;
function fixture(protocol: "solid" | "lws" = "solid", readOnly = false) {
  const storage = createMemoryStorage({ protocol, root: ROOT, pageSize: 1 });
  vi.mocked(createPodClient).mockResolvedValueOnce({ storage } as Awaited<
    ReturnType<typeof createPodClient>
  >);
  const fetch = vi.fn<typeof globalThis.fetch>();
  const pod = createStoragePodPort({ fetch, podRoot: ROOT, webId: `${ROOT}profile#me`, readOnly });
  return { pod, storage, fetch };
}

describe("storage-client PodPort", () => {
  it.each([
    "solid",
    "lws",
  ] as const)("reads and paginates %s without losing bytes, validators or metadata", async (protocol) => {
    const { pod, storage } = fixture(protocol);
    const first = await storage.create(ROOT, new Uint8Array([0, 255]), {
      name: "note.txt",
      contentType: "image/png",
    });
    await storage.create(ROOT, "second", { name: "other.txt", contentType: "text/plain" });
    const read = await pod.read(first.url);
    expect(read).toMatchObject({
      body: new Uint8Array([0, 255]),
      contentType: "image/png",
      etag: first.etag,
      isContainer: false,
    });
    const entries = await pod.list(ROOT);
    expect(entries).toHaveLength(2);
    expect(entries.some((entry) => entry.url === first.url && entry.mimeType === "image/png")).toBe(
      true,
    );
    const spy = vi.spyOn(storage, "read");
    await pod.read(first.url, { accept: "text/turtle" });
    expect(spy).toHaveBeenCalledWith(first.url, { accept: "text/turtle" });
  });

  it("creates exact Solid resources and containers and forwards conditional updates/deletes", async () => {
    const { pod, storage } = fixture();
    const created = await pod.write(FILE, new TextEncoder().encode("first"), "text/plain", {
      ifNoneMatch: "*",
    });
    expect((await storage.read(FILE)).etag).toBe(created.etag);
    await expect(
      pod.write(FILE, new Uint8Array(), "text/plain", { ifNoneMatch: "*" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await pod.write(FILE, new TextEncoder().encode("second"), "text/plain", {
      ifMatch: created.etag,
    });
    await expect(pod.delete(FILE, { ifMatch: created.etag })).rejects.toMatchObject({
      status: 412,
    });
    await pod.delete(FILE);
    await expect(storage.read(FILE)).rejects.toMatchObject({ status: 404 });
    await pod.write(`${ROOT}folder/`, new Uint8Array(), "text/turtle", { ifNoneMatch: "*" });
    expect((await pod.read(`${ROOT}folder/`)).isContainer).toBe(true);
  });

  it("refuses LWS name hints for exact create-only writes before any mutation", async () => {
    const { pod, storage } = fixture("lws");
    const create = vi.spyOn(storage, "create");
    await expect(
      pod.write(FILE, new Uint8Array(), "text/plain", { ifNoneMatch: "*" }),
    ).rejects.toThrow("unsupported");
    expect(create).not.toHaveBeenCalled();
    const existing = await storage.create(ROOT, "existing", { contentType: "text/plain" });
    await pod.write(existing.url, new TextEncoder().encode("update"), "text/plain", {
      ifMatch: existing.etag as string,
    });
    expect(await (await storage.read(existing.url)).text()).toBe("update");
    await pod.delete(existing.url, { ifMatch: (await storage.head(existing.url)).etag as string });
  });

  it("rejects off-pod operations, root mutations and conflicting conditions", async () => {
    const { pod, fetch } = fixture();
    for (const target of ["https://evil.example/", `${ROOT}../bob/secret`, `${ROOT}%2Fsecret`]) {
      await expect(pod.read(target)).rejects.toThrow("scope");
      await expect(pod.list(target)).rejects.toThrow("scope");
    }
    for (const target of [ROOT, ROOT.slice(0, -1), `${ROOT}?view=1`]) {
      await expect(pod.write(target, new Uint8Array(), "text/plain", {})).rejects.toThrow();
      await expect(pod.delete(target)).rejects.toThrow();
    }
    await expect(
      pod.write(FILE, new Uint8Array(), "text/plain", { ifMatch: '"v1"', ifNoneMatch: "*" }),
    ).rejects.toThrow("Conflicting");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("defaults the adapter and server to read-only", async () => {
    const pod = createStoragePodPort({ fetch: vi.fn(), podRoot: ROOT });
    expect(pod.webId).toBe("");
    await expect(pod.write(FILE, new Uint8Array(), "text/plain", {})).rejects.toThrow("read-only");
    await expect(pod.delete(FILE)).rejects.toThrow("read-only");
    expect(createSolidMcpServer({ pod })).toBeDefined();
  });

  it("permits only the configured off-pod WebID and refuses its redirects", async () => {
    const webId = "https://identity-port.example/card#me";
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    const pod = createStoragePodPort({ fetch, podRoot: ROOT, webId });
    await expect(pod.read(webId, { accept: "text/turtle" })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(pod.read("https://identity-port.example/other")).rejects.toThrow("scope");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("smokes sparq LWS through the shared storage wire fixtures, including all 1500 paginated members", async () => {
  const { lwsReadExchanges, LWS_ROOT, LWS_CONTAINER } = await import(
    "../../storage-client/src/fixtures/lws.js"
  );
  const actual =
    await vi.importActual<typeof import("@jeswr/storage-client")>("@jeswr/storage-client");
  vi.mocked(createPodClient).mockImplementationOnce(actual.createPodClient);
  const calls: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push(request);
    if (request.method === "HEAD" && request.url === LWS_ROOT)
      return new Response(null, {
        headers: { link: `<${LWS_ROOT}>; rel="https://www.w3.org/ns/lws#storage"` },
      });
    if (request.method === "GET" && request.url === LWS_ROOT)
      return Response.json(
        {
          id: LWS_ROOT,
          type: "Storage",
          service: [{ type: "StorageRoot", serviceEndpoint: LWS_ROOT }],
        },
        { headers: { "content-type": "application/lws+cid" } },
      );
    const recorded = lwsReadExchanges[`${request.method} ${request.url}`];
    if (!recorded) throw new Error("Unexpected LWS fixture request");
    return new Response(recorded.body ?? null, {
      status: recorded.status,
      headers: recorded.headers,
    });
  };
  const pod = createStoragePodPort({ fetch, podRoot: LWS_ROOT });
  const entries = await pod.list(LWS_CONTAINER);
  expect(entries).toHaveLength(1500);
  expect(entries[0]).toMatchObject({
    url: `${LWS_CONTAINER}note-0000.ttl`,
    isContainer: false,
    mimeType: "text/turtle",
    size: 17,
  });
  expect((await pod.read(entries[0]!.url)).contentType).toBe("text/turtle");
  expect(calls.filter((r) => r.url.includes("?page="))).toHaveLength(2);
  expect(calls.every((r) => r.redirect === "manual")).toBe(true);
  expect(calls.every((r) => !r.headers.has("authorization"))).toBe(true);
});

it("keeps public same-origin storage discovery anonymous and propagates discovery errors", async () => {
  const { storage } = fixture();
  vi.mocked(createPodClient).mockReset();
  const authenticated = vi.fn<typeof fetch>();
  const publicFetch = vi.fn<typeof fetch>(async () => new Response("description"));
  vi.mocked(createPodClient).mockImplementationOnce(async (options) => {
    await options.fetch("https://storage-port.example/.well-known/storage");
    for (const target of [
      "https://foreign.example/metadata",
      "https://storage-port.example/metadata",
    ]) {
      await expect(options.fetch(target, { method: "POST" })).rejects.toThrow("scope");
    }
    for (const name of ["authorization", "dpop", "cookie"]) {
      await expect(
        options.fetch("https://storage-port.example/metadata", { headers: { [name]: "fixture" } }),
      ).rejects.toThrow("credentials");
    }
    return { storage } as Awaited<ReturnType<typeof createPodClient>>;
  });
  const pod = createStoragePodPort({ fetch: authenticated, podRoot: ROOT }, publicFetch);
  await pod.list(ROOT);
  expect(authenticated).not.toHaveBeenCalled();
  expect(publicFetch).toHaveBeenCalledTimes(1);
  const [request, init] = publicFetch.mock.calls[0]!;
  expect(new Request(request, init)).toMatchObject({ credentials: "omit", redirect: "manual" });
  vi.mocked(createPodClient).mockRejectedValueOnce(new Error("fixture discovery failure"));
  await expect(
    createStoragePodPort({ fetch: authenticated, podRoot: ROOT }).read(FILE),
  ).rejects.toThrow("fixture discovery failure");
});

it("retains exact names, refuses unsupported conditions and requires a validator for deletion", async () => {
  const { pod, storage } = fixture();
  const create = vi.spyOn(storage, "create");
  for (const target of [`${ROOT}a:b`, `${FILE}?`, `${FILE}#`]) {
    await expect(
      pod.write(target, new Uint8Array(), "text/plain", { ifNoneMatch: "*" }),
    ).rejects.toThrow();
  }
  expect(create).not.toHaveBeenCalled();
  await pod.write(`${ROOT}space%20name`, new Uint8Array([1]), "application/octet-stream", {
    ifNoneMatch: "*",
  });
  expect((await storage.read(`${ROOT}space%20name`)).body).not.toBeNull();
  await expect(
    pod.write(FILE, new Uint8Array(), "text/plain", { ifNoneMatch: "other" as "*" }),
  ).rejects.toThrow("Unsupported");
  await expect(pod.delete(FILE, { ifNoneMatch: "*" })).rejects.toThrow("Unsupported");
  vi.spyOn(storage, "head").mockResolvedValueOnce({ etag: null } as Awaited<
    ReturnType<typeof storage.head>
  >);
  await expect(pod.delete(FILE)).rejects.toThrow("ETag");
});

it("accepts a 205 delete response during a bounded memory operation", async () => {
  const { createSolidBackend } = await import("@jeswr/storage-client/solid");
  const { withPodReadLimits } = await import("../src/pod-operation.js");
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 205 }));
  vi.mocked(createPodClient).mockImplementationOnce(
    async (options) =>
      ({
        storage: createSolidBackend({ root: ROOT, fetch: options.fetch }),
      }) as Awaited<ReturnType<typeof createPodClient>>,
  );
  const pod = createStoragePodPort({ fetch, podRoot: ROOT, readOnly: false });
  await expect(
    withPodReadLimits(() => pod.delete(FILE, { ifMatch: '"v1"' })),
  ).resolves.toBeUndefined();
  expect(new Request(...fetch.mock.calls[0]!).headers.get("if-match")).toBe('"v1"');
});

it("applies the MCP RDF parser budget before Solid listing expansion", async () => {
  const { createSolidBackend } = await import("@jeswr/storage-client/solid");
  const fetch: typeof globalThis.fetch = async () =>
    new Response('<> <urn:test> "x" .\n'.repeat(16_385), {
      headers: { "content-type": "text/turtle" },
    });
  vi.mocked(createPodClient).mockImplementationOnce(
    async (options) =>
      ({
        storage: createSolidBackend({ root: ROOT, fetch: options.fetch }),
      }) as Awaited<ReturnType<typeof createPodClient>>,
  );
  const pod = createStoragePodPort({ fetch, podRoot: ROOT });
  await expect(pod.list(ROOT)).rejects.toMatchObject({ cause: expect.any(RdfLimitError) });
});

it.each([
  "valid",
  "overflow",
  "error",
  "non-RDF",
])("guards actual Solid listings (%s)", async (variant) => {
  const { createSolidBackend } = await import("@jeswr/storage-client/solid");
  const fetch: typeof globalThis.fetch = async () => {
    if (variant === "overflow")
      return new Response("x".repeat(1024 * 1024 + 1), {
        headers: { "content-type": "text/turtle" },
      });
    if (variant === "error") return new Response(null, { status: 403 });
    if (variant === "non-RDF")
      return new Response("{}", { headers: { "content-type": "application/json" } });
    return new Response("<> a <http://www.w3.org/ns/ldp#BasicContainer> .", {
      headers: { "content-type": "text/turtle" },
    });
  };
  vi.mocked(createPodClient).mockImplementationOnce(
    async (options) =>
      ({ storage: createSolidBackend({ root: ROOT, fetch: options.fetch }) }) as Awaited<
        ReturnType<typeof createPodClient>
      >,
  );
  const pod = createStoragePodPort({ fetch, podRoot: ROOT });
  if (variant === "valid") expect(await pod.list(ROOT)).toEqual([]);
  else await expect(pod.list(ROOT)).rejects.toThrow();
});

it("retains absent metadata and drops foreign listing entries", async () => {
  const { pod, storage } = fixture();
  vi.spyOn(storage, "listAll").mockImplementation(async function* () {
    for (const url of ["https://foreign.example/entry", `${ROOT}folder/`])
      yield { url, kind: "container", types: [], contentType: null, size: null, modified: null };
  });
  expect(await pod.list(ROOT)).toEqual([{ url: `${ROOT}folder/`, isContainer: true, type: [] }]);
});

it("preserves missing media type/validators and unconditional write semantics", async () => {
  const { createSolidBackend } = await import("@jeswr/storage-client/solid");
  const calls: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push(request);
    return new Response(null, { status: request.method === "PUT" ? 201 : 200 });
  };
  vi.mocked(createPodClient).mockImplementationOnce(
    async (options) =>
      ({
        storage: createSolidBackend({ root: ROOT, fetch: options.fetch, etagFollowUp: false }),
      }) as Awaited<ReturnType<typeof createPodClient>>,
  );
  const pod = createStoragePodPort({ fetch, podRoot: ROOT, readOnly: false });
  expect(await pod.read(FILE)).toMatchObject({ contentType: "", etag: undefined });
  expect(await pod.write(FILE, new Uint8Array([1]), "application/octet-stream", {})).toEqual({
    etag: undefined,
  });
  expect(calls.at(-1)?.headers.has("if-match")).toBe(false);
});

it.each([
  ["<> a <http://www.w3.org/ns/ldp#BasicContainer> .", true],
  ["<https://foreign.example/> a <http://www.w3.org/ns/ldp#BasicContainer> .", false],
  ["<> <urn:extra> <http://www.w3.org/ns/ldp#BasicContainer> .", false],
  ['<> a "Container" .', false],
  ["<> a <urn:other> .", false],
  ["<urn:graph> { <> a <http://www.w3.org/ns/ldp#BasicContainer> . }", false],
] as const)("refuses loss of container creation metadata: %s", async (body, allowed) => {
  const { pod, storage } = fixture();
  const create = vi.spyOn(storage, "create");
  const write = pod.write(`${ROOT}described/`, new TextEncoder().encode(body), "application/trig", {
    ifNoneMatch: "*",
  });
  if (allowed) await expect(write).resolves.toHaveProperty("etag");
  else {
    await expect(write).rejects.toThrow("cannot preserve");
    expect(create).not.toHaveBeenCalled();
  }
});

it("retains a snapshot of operator search caps on the storage adapter", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const searchLimits = { maxResources: 0 };
  const pod = createStoragePodPort({ fetch, podRoot: ROOT, searchLimits });
  searchLimits.maxResources = 100;
  expect(await search(pod, "note")).toEqual([]);
  expect(createPodClient).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("retries discovery after an operation-local failure without guessing a backend", async () => {
  const { storage } = fixture();
  vi.mocked(createPodClient).mockReset();
  vi.mocked(createPodClient)
    .mockRejectedValueOnce(new Error("fixture aborted discovery"))
    .mockResolvedValueOnce({ storage } as Awaited<ReturnType<typeof createPodClient>>);
  const pod = createStoragePodPort({ fetch: vi.fn(), podRoot: ROOT });
  await expect(pod.list(ROOT)).rejects.toThrow("fixture aborted discovery");
  expect(await pod.list(ROOT)).toEqual([]);
});
