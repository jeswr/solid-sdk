// AUTHORED-BY Codex GPT-6.1-Sol
import { deriveFeatures, type Features } from "@jeswr/storage-capabilities";
import type { Store } from "n3";
import { describe, expect, test, vi } from "vitest";
import { createLwsBackend } from "./lws.js";
import { createMemoryStorage } from "./memory.js";
import { isTrashEndpoint, serviceEtag, trashCommand, versionHistoryQuery } from "./services.js";
import { createSolidBackend } from "./solid.js";
import { createTrashClient, type TrashEntry } from "./trash.js";
import type { ReadResult } from "./types.js";
import { createVersionsClient, type VersionEntry } from "./versions.js";

const ROOT = "https://pod.example/alice/";
const LIVE = `${ROOT}note`;
const TRASH = `${ROOT}.trash/`;
const COPY = `${TRASH}copy`;
const HISTORY = `${ROOT}.versions/`;
const VERSION = `${HISTORY}v1`;
const AT = "Sat, 31 Oct 2026 10:00:00 GMT";
function features(protocol: "solid" | "lws"): Features {
  const value = deriveFeatures({
    protocol,
    id: ROOT,
    root: ROOT,
    descriptionUrl: null,
    services: [],
    capabilities: [],
    sources: ["probe"],
    fetchedAt: 0,
    etag: null,
    maxAgeMs: 0,
    verificationMethods: [],
  });
  value.trash = { state: "available", detail: { endpoint: TRASH }, evidence: "test" };
  value.versioning = {
    state: "available",
    detail: { endpoint: `${HISTORY}?resource={resource}` },
    evidence: "test",
  };
  return value;
}
function network(protocol: "solid" | "lws", responses: Response[], f = features(protocol)) {
  const fetcher = vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error("Unexpected request");
    return response;
  });
  return {
    storage:
      protocol === "solid"
        ? createSolidBackend({ fetch: fetcher, root: ROOT, features: f })
        : createLwsBackend({ fetch: fetcher, root: ROOT, features: f }),
    fetcher,
  };
}
function listing(protocol: "solid" | "lws", urls: string[], base = TRASH) {
  return protocol === "solid"
    ? new Response(
        `<${base}> a <http://www.w3.org/ns/ldp#Container> .\n${urls.map((url) => `<${base}> <http://www.w3.org/ns/ldp#contains> <${url}> .`).join("\n")}`,
        { headers: { "Content-Type": "text/turtle" } },
      )
    : Response.json(
        { type: "Container", items: urls.map((id) => ({ id })) },
        { headers: { "Content-Type": "application/lws+json" } },
      );
}
function metadataResponses(
  protocol: "solid" | "lws",
  original = LIVE,
  modified: string | null = AT,
  copy = COPY,
) {
  const meta = `${copy}.meta`;
  return [
    new Response(null, {
      headers: { Link: `<${meta}>; rel="${protocol === "solid" ? "describedby" : "linkset"}"` },
    }),
    protocol === "solid"
      ? new Response(
          `<${copy}> <http://www.iana.org/assignments/relation/original> <${original}> ${modified === null ? "." : `; <http://purl.org/dc/terms/modified> ${JSON.stringify(modified)} .`}`,
          { headers: { "Content-Type": "text/turtle" } },
        )
      : Response.json(
          {
            linkset: [
              {
                anchor: copy,
                original: [{ href: original, ...(modified === null ? {} : { modified }) }],
              },
            ],
          },
          { headers: { "Content-Type": "application/linkset+json" } },
        ),
  ];
}

for (const protocol of ["solid", "lws"] as const) {
  describe(protocol, () => {
    test("trash, list, restore, and purge use server identities and preserve bytes", async () => {
      const storage = createMemoryStorage({
        protocol,
        root: ROOT,
        trash: true,
        versioning: true,
        pageSize: 1,
        clock: () => Date.parse(AT),
      });
      const trash = createTrashClient(storage);
      const item = await storage.create(ROOT, "hello", { name: "note", contentType: "text/plain" });
      const other = await storage.create(ROOT, "other", { contentType: "text/plain" });
      const copy = await trash.trash(item.url);
      await trash.trash(other.url);
      expect(copy.url).not.toBe(item.url);
      await expect(storage.head(item.url)).rejects.toMatchObject({ code: "not-found" });
      expect(await trash.listTrash()).toEqual(
        expect.arrayContaining([
          {
            url: copy.url,
            original: item.url,
            trashedAt: new Date(AT),
            size: 5,
            contentType: "text/plain",
          },
        ]),
      );
      const restored = await trash.restore(copy.url);
      if (protocol === "solid") expect(restored.url).toBe(item.url);
      else expect(restored.url).not.toBe(item.url);
      expect(await (await storage.read(restored.url)).text()).toBe("hello");
      const [remaining] = await trash.listTrash();
      await trash.purge((remaining as TrashEntry).url);
      expect(await trash.listTrash()).toEqual([]);
      await expect(trash.purge((remaining as TrashEntry).url)).rejects.toMatchObject({
        code: "not-found",
      });
      await expect(trash.restore((remaining as TrashEntry).url)).rejects.toMatchObject({
        code: "not-found",
      });
      await expect(trash.purge(restored.url)).rejects.toMatchObject({ code: "not-found" });
    });
    test("trash shadows user original links and restores them without losing other metadata", async () => {
      const storage = createMemoryStorage({
        protocol,
        root: ROOT,
        trash: true,
        clock: () => Date.parse(AT),
      });
      const trash = createTrashClient(storage);
      const item = await storage.create(ROOT, "hello", { contentType: "text/plain" });
      const rel =
        protocol === "solid" ? "http://www.iana.org/assignments/relation/original" : "original";
      const originals = [`${ROOT}previous`, "https://source.example/previous"];
      const userTargets = originals.map((href) => ({ href, params: {} }));
      await storage.setMetadata(
        item.url,
        [
          ...originals.map((href) => ({ op: "add" as const, rel: "original", href })),
          { op: "add", rel: "original", anchor: `${item.url}#part`, href: LIVE },
          { op: "add", rel: "original", anchor: ROOT, href: LIVE },
          { op: "add", rel: "https://example.org/related", href: LIVE },
        ],
        { ifMatch: (await storage.metadata(item.url)).etag as string },
      );
      expect((await storage.metadata(item.url)).links.get(item.url)?.get(rel)).toEqual(userTargets);
      const copy = await trash.trash(item.url);
      expect(await trash.listTrash()).toEqual([
        {
          url: copy.url,
          original: item.url,
          trashedAt: new Date(AT),
          size: 5,
          contentType: "text/plain",
        },
      ]);
      const metadata = await storage.metadata(copy.url);
      const serviceTarget = {
        href: item.url,
        params: protocol === "lws" ? { modified: new Date(AT).toISOString() } : {},
      };
      expect(metadata.links.get(copy.url)?.get(rel)).toEqual([serviceTarget]);
      expect(metadata.links.get(`${copy.url}#part`)?.get(rel)).toEqual([
        { href: LIVE, params: {} },
      ]);
      expect(metadata.links.get(ROOT)?.get(rel)).toEqual([{ href: LIVE, params: {} }]);
      expect(metadata.links.get(copy.url)?.get("https://example.org/related")).toEqual([
        { href: LIVE, params: {} },
      ]);
      if (protocol === "solid") {
        expect(
          (metadata.raw as Store).getQuads(copy.url, rel, null, null).map((q) => q.object.value),
        ).toEqual([item.url]);
      } else {
        const raw = metadata.raw as { linkset: Record<string, unknown>[] };
        expect(raw.linkset.find((context) => context.anchor === copy.url)?.original).toEqual([
          { href: item.url, modified: new Date(AT).toISOString() },
        ]);
      }
      const restored = await trash.restore(copy.url);
      const restoredMetadata = await storage.metadata(restored.url);
      expect(restoredMetadata.links.get(restored.url)?.get(rel)).toEqual(userTargets);
      expect(restoredMetadata.links.get(`${restored.url}#part`)?.get(rel)).toEqual([
        { href: LIVE, params: {} },
      ]);
      expect(await (await storage.read(restored.url)).text()).toBe("hello");
      const retrash = await trash.trash(restored.url);
      await trash.purge(retrash.url);
      await expect(storage.head(retrash.url)).rejects.toMatchObject({ code: "not-found" });
      expect(await trash.listTrash()).toEqual([]);
    });
    test("purge removes a populated folder and its nested descendants, preserving live folders", async () => {
      const storage = createMemoryStorage({ protocol, root: ROOT, trash: true, pageSize: 1 });
      const trash = createTrashClient(storage);
      const folder = await storage.create(ROOT, null, { kind: "container", name: "folder" });
      await storage.create(folder.url, "direct", { contentType: "text/plain" });
      const nested = await storage.create(folder.url, null, { kind: "container" });
      await storage.create(nested.url, "nested", { contentType: "text/plain" });
      const live = await storage.create(ROOT, null, { kind: "container", name: "live" });
      const liveFile = await storage.create(live.url, "keep", { contentType: "text/plain" });
      const copy = await trash.trash(folder.url);
      const removed = [copy.url];
      for await (const entry of storage.listAll(copy.url)) {
        removed.push(entry.url);
        if (entry.kind === "container")
          for await (const child of storage.listAll(entry.url)) removed.push(child.url);
      }
      expect(removed).toHaveLength(4);
      const head = vi.spyOn(storage, "head");
      const remove = vi.spyOn(storage, "delete");
      await expect(trash.purge(live.url)).rejects.toMatchObject({ code: "not-found" });
      expect(head).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      await trash.purge(copy.url);
      for (const url of removed)
        await expect(storage.head(url)).rejects.toMatchObject({ code: "not-found" });
      expect(await trash.listTrash()).toEqual([]);
      expect((await storage.head(live.url)).kind).toBe("container");
      expect(await (await storage.read(liveFile.url)).text()).toBe("keep");
    });
    test("three content writes create three immutable versions; restore creates a fourth", async () => {
      const storage = createMemoryStorage({ protocol, root: ROOT, versioning: true });
      const client = createVersionsClient(storage);
      const item = await storage.create(ROOT, "one", { contentType: "text/plain" });
      await storage.write(item.url, "two", {
        contentType: "text/plain",
        ifMatch: item.etag as string,
      });
      await storage.write(item.url, "three", {
        contentType: "text/plain",
        ifMatch: (await storage.head(item.url)).etag as string,
      });
      const versions = await client.versions(item.url);
      expect(versions).toHaveLength(3);
      const first = (
        await Promise.all(
          versions.map(async (version) => ({
            ...version,
            text: await (await storage.read(version.url)).text(),
          })),
        )
      ).find((v) => v.text === "one") as VersionEntry & { text: string };
      expect(first.at).toBeInstanceOf(Date);
      await client.restoreVersion(item.url, first.url);
      expect(await (await storage.read(item.url)).text()).toBe("one");
      expect(await client.versions(item.url)).toHaveLength(4);
      const history = (await storage.head(item.url)).links.get("version-history")?.[0]
        ?.target as string;
      const before = await storage.head(first.url);
      for (const operation of [
        () =>
          storage.write(first.url, "bad", {
            contentType: "text/plain",
            ifMatch: before.etag as string,
          }),
        () =>
          storage.patch(
            first.url,
            { kind: "raw", mediaType: "text/n3", body: "" },
            { ifMatch: before.etag as string },
          ),
        () => storage.delete(first.url, { ifMatch: before.etag as string }),
        () => storage.move(first.url, ROOT, { ifMatch: before.etag as string }),
        () => storage.move(item.url, history, { ifMatch: item.etag as string }),
        () => storage.create(history, "bad", { contentType: "text/plain" }),
        () => storage.setMetadata(first.url, [], { ifMatch: before.etag as string }),
      ])
        await expect(operation()).rejects.toMatchObject({ code: "method-not-allowed" });
      expect(await (await storage.read(first.url)).text()).toBe("one");
      await expect(client.restoreVersion(item.url, item.url)).rejects.toMatchObject({
        code: "not-found",
      });
      await expect(client.restoreVersion(item.url, `${ROOT}unrelated`)).rejects.toMatchObject({
        code: "not-found",
      });
    });
    test("unavailable and unknown services reject every operation before I/O", async () => {
      const { storage, fetcher } = network(protocol, []);
      for (const state of ["unknown", "unavailable", "available"] as const) {
        storage.features.trash = { state, detail: {}, evidence: "test" };
        storage.features.versioning = { state, detail: {}, evidence: "test" };
        const trash = createTrashClient(storage);
        const versions = createVersionsClient(storage);
        for (const operation of [
          () => trash.trash(LIVE),
          () => trash.listTrash(),
          () => trash.restore(COPY),
          () => trash.purge(COPY),
          () => versions.versions(LIVE),
          () => versions.restoreVersion(LIVE, VERSION),
        ])
          await expect(operation()).rejects.toMatchObject({ code: "unsupported" });
      }
      expect(fetcher).not.toHaveBeenCalled();
      const memory = createMemoryStorage({ protocol });
      await expect(createTrashClient(memory).listTrash()).rejects.toMatchObject({
        code: "unsupported",
        feature: "trash",
      });
      await expect(createVersionsClient(memory).versions(LIVE)).rejects.toMatchObject({
        code: "unsupported",
        feature: "versioning",
      });
    });
    test.each([
      TRASH,
      "https://POD.example:443/alice/.trash/",
    ])("trash sends only the JSON command to canonical endpoint %s", async (endpoint) => {
      const f = features(protocol);
      f.trash.detail.endpoint = endpoint;
      const { storage, fetcher } = network(
        protocol,
        [new Response(null, { status: 201, headers: { Location: COPY } })],
        f,
      );
      expect(await createTrashClient(storage).trash(LIVE)).toEqual({
        url: COPY,
        etag: null,
        created: true,
      });
      expect(fetcher).toHaveBeenCalledExactlyOnceWith(TRASH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: LIVE }),
        redirect: "manual",
      });
    });
    test.each([
      { status: 200, endpoint: TRASH },
      { status: 201, endpoint: TRASH },
      { status: 200, endpoint: "https://POD.example:443/alice/.trash/" },
      { status: 201, endpoint: "https://POD.example:443/alice/.trash/" },
    ])("restore accepts $status from $endpoint", async ({ status, endpoint }) => {
      const restored = protocol === "solid" ? LIVE : `${ROOT}new-id`;
      const f = features(protocol);
      f.trash.detail.endpoint = endpoint;
      const { storage, fetcher } = network(
        protocol,
        [
          listing(protocol, [COPY]),
          ...metadataResponses(protocol),
          new Response(null, { status, headers: { Location: restored } }),
        ],
        f,
      );
      expect((await createTrashClient(storage).restore(COPY)).url).toBe(restored);
      expect(fetcher).toHaveBeenLastCalledWith(TRASH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: COPY }),
        redirect: "manual",
      });
    });
    test("purge HEADs and conditionally DELETEs only a listed trash entry", async () => {
      const { storage, fetcher } = network(protocol, [
        listing(protocol, [COPY]),
        ...metadataResponses(protocol),
        new Response(null, { headers: { ETag: '"copy"' } }),
        new Response(null, { status: 204 }),
      ]);
      await createTrashClient(storage).purge(COPY);
      expect(fetcher).toHaveBeenLastCalledWith(
        COPY,
        expect.objectContaining({ method: "DELETE", headers: { "If-Match": '"copy"' } }),
      );
    });
    test("purge traverses a populated container before deleting it", async () => {
      const copy = protocol === "solid" ? `${COPY}/` : COPY;
      const child = protocol === "solid" ? `${copy}child` : `${ROOT}opaque-child`;
      const link = `<${protocol === "solid" ? "http://www.w3.org/ns/ldp#Container" : "https://www.w3.org/ns/lws#Container"}>; rel="type", <${TRASH}>; rel="up"`;
      const containerHead = (etag = '"copy"') =>
        new Response(null, { headers: { ETag: etag, Link: link } });
      const { storage, fetcher } = network(protocol, [
        listing(protocol, [copy]),
        ...metadataResponses(protocol, LIVE, AT, copy),
        containerHead(),
        containerHead(),
        listing(protocol, [child], copy),
        ...(protocol === "lws"
          ? [
              new Response(null, {
                headers: { ETag: '"child"', Link: `<${copy}>; rel="up"` },
              }),
            ]
          : []),
        new Response(null, { status: 204 }),
        ...(protocol === "lws" ? [containerHead('"empty"')] : []),
        new Response(null, { status: 204 }),
      ]);
      await createTrashClient(storage).purge(copy);
      const deletes = (fetcher.mock.calls as unknown as [string, RequestInit][]).filter(
        ([, init]) => init.method === "DELETE",
      );
      expect(deletes.map(([url]) => url)).toEqual([child, copy]);
      if (protocol === "lws") {
        expect(deletes[0]?.[1].headers).toEqual({ "If-Match": '"child"' });
        expect(deletes[1]?.[1].headers).toEqual({ "If-Match": '"empty"' });
      }
    });
    test.each([
      null,
      'W/"copy"',
      '"stale"',
    ])("purge refuses a missing, weak or stale container ETag (%s) before deletion", async (etag) => {
      const copy = protocol === "solid" ? `${COPY}/` : COPY;
      const link = `<${protocol === "solid" ? "http://www.w3.org/ns/ldp#Container" : "https://www.w3.org/ns/lws#Container"}>; rel="type"`;
      const { storage, fetcher } = network(protocol, [
        listing(protocol, [copy]),
        ...metadataResponses(protocol, LIVE, AT, copy),
        new Response(null, { headers: { Link: link, ...(etag === null ? {} : { ETag: etag }) } }),
        new Response(null, { headers: { Link: link, ETag: '"current"' } }),
      ]);
      await expect(createTrashClient(storage).purge(copy)).rejects.toMatchObject({
        code: etag === '"stale"' ? "precondition-failed" : "invalid-response",
      });
      expect(fetcher).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    test("template history listing and Memento-Datetime support conditional restore", async () => {
      const history = `${HISTORY}?resource=${encodeURIComponent(LIVE)}`;
      const { storage, fetcher } = network(protocol, [
        new Response(null),
        new Response(null),
        listing(protocol, [VERSION], history),
        new Response(null, { headers: { "Memento-Datetime": AT, ETag: '"v1"' } }),
        new Response(null, { headers: { ETag: '"live"' } }),
        new Response("old bytes", {
          headers: { "Memento-Datetime": AT, "Content-Type": "text/plain" },
        }),
        new Response(null, { status: 204, headers: { ETag: '"new"' } }),
      ]);
      await createVersionsClient(storage).restoreVersion(LIVE, VERSION);
      expect(fetcher).toHaveBeenCalledWith(history, expect.objectContaining({ method: "GET" }));
      expect(fetcher).toHaveBeenLastCalledWith(
        LIVE,
        expect.objectContaining({
          method: "PUT",
          headers: { "Content-Type": "text/plain", "If-Match": '"live"' },
        }),
      );
      const call = fetcher.mock.calls.at(-1) as unknown as [string, RequestInit];
      expect(await new Response(call[1].body).text()).toBe("old bytes");
    });
    test.each([
      "https://POD.example:443/alice/.versions/?resource={resource}",
      "https://POD.example:443/alice/.versions/?before=é&resource={resource}&after=é",
    ])("version listing matches canonical template literals in %s", async (template) => {
      const f = features(protocol);
      f.versioning.detail.endpoint = template;
      const history = new URL(template.replace("{resource}", encodeURIComponent(LIVE))).href;
      const { storage, fetcher } = network(
        protocol,
        [
          new Response(null),
          listing(protocol, [VERSION], history),
          new Response(null, { headers: { "Memento-Datetime": AT, ETag: '"v1"' } }),
        ],
        f,
      );
      expect(await createVersionsClient(storage).versions(LIVE)).toEqual([
        { url: VERSION, at: new Date(AT), etag: '"v1"' },
      ]);
      expect(fetcher).toHaveBeenCalledWith(history, expect.objectContaining({ method: "GET" }));
    });
    test("foreign and credentialed inputs fail before requests and redact credentials", async () => {
      const { storage, fetcher } = network(protocol, []);
      const trash = createTrashClient(storage);
      for (const url of [
        "https://evil.example/file",
        "https://user:secret@pod.example/alice/file",
        `${ROOT}file?`,
        `${ROOT}file#`,
      ]) {
        await expect(trash.trash(url)).rejects.toMatchObject({
          code: url.includes("?") || url.includes("#") ? "bad-request" : "scope",
        });
      }
      storage.features.trash.detail.endpoint = "https://user:secret@evil.example/";
      const error = await trash.listTrash().catch((error) => error);
      expect(error.code).toBe("scope");
      expect(JSON.stringify(error)).not.toContain("secret");
      expect(fetcher).not.toHaveBeenCalled();
    });
    test.each([
      200, 202, 204, 302, 404, 412, 503,
    ])("trash rejects unexpected status %s", async (status) => {
      const { storage } = network(protocol, [new Response(null, { status })]);
      await expect(createTrashClient(storage).trash(LIVE)).rejects.toMatchObject({
        code:
          status === 404
            ? "not-found"
            : status === 412
              ? "precondition-failed"
              : status === 503
                ? "server"
                : "invalid-response",
      });
    });
    test.each([
      null,
      "",
      "https://user:secret@evil.example/x",
      `${ROOT}x?`,
      ROOT,
      TRASH,
      LIVE,
    ])("trash refuses an invalid Location (%s)", async (location) => {
      const { storage } = network(protocol, [
        new Response(null, {
          status: 201,
          headers: location === null ? {} : { Location: location },
        }),
      ]);
      const error = await createTrashClient(storage)
        .trash(LIVE)
        .catch((error) => error);
      expect(error.code).toBe("invalid-response");
      expect(JSON.stringify(error)).not.toContain("secret");
    });
    test.each([null, "garbage"])("malformed trash time %s fails closed", async (modified) => {
      const { storage } = network(protocol, [
        listing(protocol, [COPY]),
        ...metadataResponses(protocol, LIVE, modified),
      ]);
      await expect(createTrashClient(storage).listTrash()).rejects.toMatchObject({
        code: "invalid-response",
      });
    });
    test("wrong restore identity fails closed", async () => {
      const { storage } = network(protocol, [
        listing(protocol, [COPY]),
        ...metadataResponses(protocol),
        new Response(null, {
          status: 201,
          headers: { Location: protocol === "solid" ? `${ROOT}wrong` : LIVE },
        }),
      ]);
      await expect(createTrashClient(storage).restore(COPY)).rejects.toMatchObject({
        code: "invalid-response",
      });
    });
    test("missing original and missing Memento-Datetime fail closed", async () => {
      const { storage } = network(protocol, [
        listing(protocol, [COPY]),
        new Response(null, {
          headers: {
            Link: `<${COPY}.meta>; rel="${protocol === "solid" ? "describedby" : "linkset"}"`,
          },
        }),
        protocol === "solid"
          ? new Response("", { headers: { "Content-Type": "text/turtle" } })
          : Response.json(
              { linkset: [] },
              { headers: { "Content-Type": "application/linkset+json" } },
            ),
      ]);
      await expect(createTrashClient(storage).listTrash()).rejects.toMatchObject({
        code: "invalid-response",
      });
      const second = network(protocol, [
        new Response(null, { headers: { Link: `<${HISTORY}>; rel="version-history"` } }),
        listing(protocol, [VERSION], HISTORY),
        new Response(null),
      ]);
      await expect(createVersionsClient(second.storage).versions(LIVE)).rejects.toMatchObject({
        code: "invalid-response",
      });
    });
  });
}

test("command validation accepts exactly one string-valued operation", () => {
  for (const body of [
    null,
    new Uint8Array(),
    "{",
    "null",
    "[]",
    "{}",
    '{"resource":1}',
    '{"restore":false}',
    '{"resource":"x","restore":"y"}',
  ])
    expect(() => trashCommand(body)).toThrow(TypeError);
  expect(trashCommand('{"restore":"url"}')).toEqual({ restore: "url" });
});

test("service validators reject wildcard, weak, list, empty and malformed ETags", () => {
  for (const etag of [null, "", "*", 'W/"v"', '"v", "w"', '"v"\r\n'])
    expect(() => serviceEtag({ url: LIVE, etag } as ReadResult)).toThrow();
  expect(serviceEtag({ url: LIVE, etag: '""' } as ReadResult)).toBe('""');
});

test("trash endpoint matching uses scoped canonical identities and fails closed", () => {
  const { storage } = network("solid", []);
  expect(isTrashEndpoint(storage, "https://POD.example:443/alice/.trash/")).toBe(true);
  for (const endpoint of [
    undefined,
    "invalid",
    "https://pod.example:8443/alice/.trash/",
    "https://foreign.example/alice/.trash/",
    `${TRASH}?`,
  ]) {
    storage.features.trash.detail.endpoint = endpoint;
    expect(isTrashEndpoint(storage, TRASH)).toBe(false);
  }
  storage.features.trash.detail.endpoint = TRASH;
  expect(isTrashEndpoint(storage, `${ROOT}other/`)).toBe(false);
  expect(isTrashEndpoint(storage, "invalid")).toBe(false);
});

test("initial query listing is limited to the exact advertised template and scoped resource", () => {
  const f = features("solid");
  expect(versionHistoryQuery(f, ROOT, `${HISTORY}?resource=${encodeURIComponent(LIVE)}`)).toBe(
    true,
  );
  for (const url of [
    `${HISTORY}?resource=${encodeURIComponent("https://evil.example/x")}`,
    `${HISTORY}?resource=%zz`,
    `${HISTORY}?resource=${encodeURIComponent(LIVE)}&extra=x`,
    `${HISTORY}?other=x`,
    `${HISTORY}?resource=${encodeURIComponent(`${LIVE}?q`)}`,
  ])
    expect(versionHistoryQuery(f, ROOT, url)).toBe(false);
  for (const template of [
    undefined,
    HISTORY,
    `${HISTORY}{resource}?x`,
    `${HISTORY}?x={resource}{resource}`,
    "invalid?resource={resource}",
    "https://foreign.example/.versions/?resource={resource}",
  ]) {
    f.versioning.detail.endpoint = template;
    expect(versionHistoryQuery(f, ROOT, HISTORY)).toBe(false);
  }
});

test("canonical version template matching preserves exact literal queries and resource encoding", () => {
  const f = features("solid");
  f.versioning.detail.endpoint =
    "https://POD.example:443/alice/.versions/?before=é&resource={resource}&after=é";
  const history = `${HISTORY}?before=%C3%A9&resource=${encodeURIComponent(LIVE)}&after=%C3%A9`;
  expect(versionHistoryQuery(f, ROOT, history)).toBe(true);
  expect(versionHistoryQuery(f, ROOT, history.replace("pod.example", "POD.example:443"))).toBe(
    true,
  );
  for (const url of [
    `${history}&extra=x`,
    history.replace("after=%C3%A9", "after=other"),
    history.replace("pod.example", "pod.example:8443"),
    history.replace(encodeURIComponent(LIVE), encodeURIComponent(LIVE).toLowerCase()),
  ])
    expect(versionHistoryQuery(f, ROOT, url)).toBe(false);
});

for (const protocol of ["solid", "lws"] as const) {
  test(`${protocol}: memory services reject root, service, repeated trash and non-trash restore`, async () => {
    const storage = createMemoryStorage({ protocol, root: ROOT, trash: true, versioning: true });
    const trash = createTrashClient(storage);
    const item = await storage.create(ROOT, "body", { contentType: "text/plain" });
    await expect(trash.trash(ROOT)).rejects.toMatchObject({ code: "method-not-allowed" });
    await expect(trash.trash(TRASH)).rejects.toMatchObject({ code: "method-not-allowed" });
    await expect(
      storage.create(TRASH, JSON.stringify({ restore: item.url })),
    ).rejects.toMatchObject({ code: "not-found" });
    const copy = await trash.trash(item.url);
    await expect(trash.trash(copy.url)).rejects.toMatchObject({ code: "conflict" });
    const body = await storage.head(copy.url);
    await storage.write(copy.url, "edited in trash", {
      contentType: "text/plain",
      ifMatch: body.etag as string,
    });
    const restored = await trash.restore(copy.url);
    expect(await (await storage.read(restored.url)).text()).toBe("edited in trash");
    const historyUrl = (await storage.head(item.url).catch(() => null))?.links.get(
      "version-history",
    )?.[0]?.target;
    if (historyUrl) expect((await storage.list(historyUrl)).items).toHaveLength(1);
    const other = await storage.create(ROOT, null, { kind: "container", name: "folder" });
    const folder = await trash.trash(other.url);
    expect((await trash.listTrash())[0]?.size).toBeNull();
    await trash.restore(folder.url);
  });
  test(`${protocol}: memory query templates return ordinary immutable history containers`, async () => {
    const storage = createMemoryStorage({ protocol, root: ROOT, versioning: true });
    const created = await storage.create(ROOT, "v1", { contentType: "text/plain" });
    const query = `${HISTORY}?resource=${encodeURIComponent(created.url)}`;
    expect((await storage.list(query)).items).toHaveLength(1);
    expect((await storage.read(query)).kind).toBe("container");
    expect((await storage.head(query)).kind).toBe("container");
  });
  test(`${protocol}: network trash service rejects invalid commands before I/O`, async () => {
    const { storage, fetcher } = network(protocol, []);
    for (const source of [ROOT, TRASH])
      await expect(
        storage.create(TRASH, JSON.stringify({ resource: source })),
      ).rejects.toMatchObject({ code: "bad-request" });
    storage.features.trash.detail.endpoint = TRASH.slice(0, -1);
    await expect(
      storage.create(TRASH.slice(0, -1), JSON.stringify({ resource: LIVE })),
    ).rejects.toMatchObject({ code: "bad-request" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  test(`${protocol}: version restore fails before writing when live validators are missing`, async () => {
    const storage = createMemoryStorage({ protocol, root: ROOT, versioning: true });
    const item = await storage.create(ROOT, "first", { contentType: "text/plain" });
    const client = createVersionsClient(storage);
    const [version] = await client.versions(item.url);
    const head = storage.head.bind(storage);
    vi.spyOn(storage, "head").mockImplementation(async (url) => ({
      ...(await head(url)),
      etag: null,
    }));
    const write = vi.spyOn(storage, "write");
    await expect(
      client.restoreVersion(item.url, (version as VersionEntry).url),
    ).rejects.toMatchObject({
      code: "invalid-response",
    });
    expect(write).not.toHaveBeenCalled();
  });
  test(`${protocol}: concurrent live edit produces 412 without retry or overwrite`, async () => {
    const storage = createMemoryStorage({ protocol, root: ROOT, versioning: true });
    const item = await storage.create(ROOT, "first", { contentType: "text/plain" });
    const client = createVersionsClient(storage);
    const [version] = await client.versions(item.url);
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementation(async (url, options) => {
      if (url === (version as VersionEntry).url)
        await storage.write(item.url, "concurrent", {
          contentType: "text/plain",
          ifMatch: item.etag as string,
        });
      return read(url, options);
    });
    await expect(
      client.restoreVersion(item.url, (version as VersionEntry).url),
    ).rejects.toMatchObject({
      code: "precondition-failed",
    });
    expect(await (await storage.read(item.url)).text()).toBe("concurrent");
    expect(await client.versions(item.url)).toHaveLength(2);
  });
}

test("Solid restore conflicts rather than replacing either resource or container at original", async () => {
  for (const kind of ["resource", "container"] as const) {
    const storage = createMemoryStorage({ root: ROOT, trash: true });
    const trash = createTrashClient(storage);
    const item = await storage.create(ROOT, "old", { name: "note", contentType: "text/plain" });
    const copy = await trash.trash(item.url);
    await storage.create(ROOT, "new", { name: "note", kind, contentType: "text/plain" });
    await expect(trash.restore(copy.url)).rejects.toMatchObject({ code: "conflict" });
    expect(await (await storage.read(copy.url)).text()).toBe("old");
  }
});

test("Solid trash time rejects a non-literal RDF term", async () => {
  const { storage } = network("solid", [
    listing("solid", [COPY]),
    new Response(null, { headers: { Link: `<${COPY}.meta>; rel="describedby"` } }),
    new Response(
      `<${COPY}> <http://www.iana.org/assignments/relation/original> <${LIVE}>; <http://purl.org/dc/terms/modified> <urn:not-a-literal> .`,
      { headers: { "Content-Type": "text/turtle" } },
    ),
  ]);
  await expect(createTrashClient(storage).listTrash()).rejects.toMatchObject({
    code: "invalid-response",
  });
});

test("version templates and history links reject ambiguity, foreign scope and encoded path delimiters", async () => {
  for (const template of [
    HISTORY,
    `${HISTORY}{resource}{extra}`,
    `${HISTORY}{resource}{resource}`,
  ]) {
    const { storage, fetcher } = network("solid", []);
    storage.features.versioning.detail.endpoint = template;
    await expect(createVersionsClient(storage).versions(LIVE)).rejects.toMatchObject({
      code: "invalid-response",
    });
    expect(fetcher).not.toHaveBeenCalled();
  }
  for (const link of [
    `<${HISTORY}>; rel="version-history", <${HISTORY}>; rel="version-history"`,
    '<https://evil.example/>; rel="version-history"',
  ]) {
    const { storage } = network("solid", [new Response(null, { headers: { Link: link } })]);
    await expect(createVersionsClient(storage).versions(LIVE)).rejects.toMatchObject({
      code: link.includes("evil") ? "scope" : "invalid-response",
    });
  }
  const { storage } = network("solid", [new Response(null)]);
  storage.features.versioning.detail.endpoint = `${HISTORY}{resource}/`;
  await expect(createVersionsClient(storage).versions(LIVE)).rejects.toMatchObject({
    code: "scope",
  });
});

test("version restore validates the GET as well as HEAD, and supports empty bodies", async () => {
  for (const changed of [
    { status: 304 },
    { contentType: null },
    { mementoDatetime: null },
    { mementoDatetime: new Date(NaN) },
    { body: null },
  ]) {
    const storage = createMemoryStorage({ root: ROOT, versioning: true });
    const item = await storage.create(ROOT, "old", { contentType: "text/plain" });
    const client = createVersionsClient(storage);
    const [version] = await client.versions(item.url);
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementation(
      async (url, opts) => ({ ...(await read(url, opts)), ...changed }) as Promise<ReadResult>,
    );
    if (Object.hasOwn(changed, "body")) {
      await client.restoreVersion(item.url, (version as VersionEntry).url);
      expect(await (await read(item.url)).text()).toBe("");
    } else
      await expect(
        client.restoreVersion(item.url, (version as VersionEntry).url),
      ).rejects.toMatchObject({
        code: "invalid-response",
      });
  }
  const storage = createMemoryStorage({ root: ROOT, versioning: true });
  const item = await storage.create(ROOT, "v1", { contentType: "text/plain" });
  const head = storage.head.bind(storage);
  vi.spyOn(storage, "head").mockImplementation(async (url) => ({
    ...(await head(url)),
    mementoDatetime: new Date(NaN),
  }));
  await expect(createVersionsClient(storage).versions(item.url)).rejects.toMatchObject({
    code: "invalid-response",
  });
});

test("Solid trash rejects a new Location outside its trash container", async () => {
  const { storage } = network("solid", [
    new Response(null, { status: 201, headers: { Location: `${ROOT}other-live-resource` } }),
  ]);
  await expect(createTrashClient(storage).trash(LIVE)).rejects.toMatchObject({
    code: "invalid-response",
  });
});

test("Solid trash rejects a malformed metadata dataset from a storage implementation", async () => {
  const storage = createMemoryStorage({ root: ROOT, trash: true });
  const item = await storage.create(ROOT, "one", { contentType: "text/plain" });
  const trash = createTrashClient(storage);
  const copy = await trash.trash(item.url);
  const metadata = await storage.metadata(copy.url);
  vi.spyOn(storage, "metadata").mockResolvedValue({ ...metadata, raw: null });
  await expect(trash.listTrash()).rejects.toMatchObject({ code: "invalid-response" });
});

test("LWS TrashService POST validates storage binding and bounded Link headers", async () => {
  for (const link of [
    '<https://foreign.example/>; rel="https://www.w3.org/ns/lws#storage"',
    `<${ROOT}>; rel="type"; title="${"x".repeat(65536)}"`,
  ]) {
    const { storage } = network("lws", [
      new Response(null, { status: 201, headers: { Link: link, Location: COPY } }),
    ]);
    await expect(createTrashClient(storage).trash(LIVE)).rejects.toMatchObject({
      code: link.includes("foreign") ? "scope" : "invalid-response",
    });
  }
});

test("memory service flags leave ordinary dot containers writable when disabled", async () => {
  const storage = createMemoryStorage({ root: ROOT });
  const dot = await storage.create(ROOT, null, { kind: "container", name: ".trash" });
  await storage.delete(dot.url, { ifMatch: dot.etag as string });
  await expect(storage.head(dot.url)).rejects.toMatchObject({ code: "not-found" });
});

test("memory version namespace rejects fabricated snapshots and subcontainers", async () => {
  const storage = createMemoryStorage({ root: ROOT, versioning: true });
  const created = await storage.create(ROOT, "v1", { contentType: "text/plain" });
  const [version] = await createVersionsClient(storage).versions(created.url);
  await expect(
    storage.write(`${(version as VersionEntry).url}-fake`, "bad", {
      contentType: "text/plain",
      ifMatch: "*",
    }),
  ).rejects.toMatchObject({ code: "method-not-allowed" });
  await expect(
    storage.write(`${HISTORY}new/foo`, "bad", { contentType: "text/plain", ifMatch: "*" }),
  ).rejects.toMatchObject({ code: "method-not-allowed" });
});

test("three Solid PUTs produce three versions and restoring produces a fourth", async () => {
  const storage = createMemoryStorage({ root: ROOT, versioning: true });
  let etag = "*";
  for (const text of ["one", "two", "three"]) {
    etag = (await storage.write(LIVE, text, { contentType: "text/plain", ifMatch: etag }))
      .etag as string;
  }
  const client = createVersionsClient(storage);
  const versions = await client.versions(LIVE);
  expect(versions).toHaveLength(3);
  await client.restoreVersion(LIVE, (versions[0] as VersionEntry).url);
  expect(await client.versions(LIVE)).toHaveLength(4);
});

for (const protocol of ["solid", "lws"] as const) {
  test(`${protocol}: committed patches snapshot exact content; failed patches and reads do not`, async () => {
    const storage = createMemoryStorage({ protocol, root: ROOT, versioning: true });
    const item = await storage.create(ROOT, '{"count":1}', { contentType: "application/json" });
    const patch = {
      kind: "json" as const,
      ops: [{ op: "replace" as const, path: "/count", value: 2 }],
    };
    await storage.patch(item.url, patch, { ifMatch: item.etag as string });
    await expect(
      storage.patch(item.url, patch, { ifMatch: item.etag as string }),
    ).rejects.toMatchObject({ code: "precondition-failed" });
    const client = createVersionsClient(storage);
    const versions = await client.versions(item.url);
    expect(versions).toHaveLength(2);
    const texts = await Promise.all(
      versions.map(async (version) => (await storage.read(version.url)).text()),
    );
    expect(texts.sort()).toEqual(['{"count":1}', '{"count":2}']);
    expect(await client.versions(item.url)).toHaveLength(2);
  });
  test(`${protocol}: abort and transport failure preserve service error semantics`, async () => {
    const { storage, fetcher } = network(protocol, []);
    const controller = new AbortController();
    controller.abort();
    await expect(
      storage.create(TRASH, JSON.stringify({ resource: LIVE }), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "network", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRejectedValueOnce(new TypeError("offline"));
    await expect(createTrashClient(storage).trash(LIVE)).rejects.toMatchObject({
      code: "network",
      retryable: true,
    });
  });
}

test("LWS restore always allocates a new identifier even when random names repeat", async () => {
  const random = vi.spyOn(crypto, "getRandomValues").mockReturnValue(new Uint8Array(16));
  try {
    const storage = createMemoryStorage({ protocol: "lws", root: ROOT, trash: true });
    const trash = createTrashClient(storage);
    const item = await storage.create(ROOT, "one", { contentType: "text/plain" });
    const copy = await trash.trash(item.url);
    const restored = await trash.restore(copy.url);
    expect(restored.url).not.toBe(item.url);
    expect(await (await storage.read(restored.url)).text()).toBe("one");
  } finally {
    random.mockRestore();
  }
});

test("repeated random names cannot mix version histories of different resources", async () => {
  const random = vi.spyOn(crypto, "getRandomValues").mockReturnValue(new Uint8Array(16));
  try {
    const storage = createMemoryStorage({ root: ROOT, versioning: true });
    const a = await storage.create(ROOT, "a", { name: "a", contentType: "text/plain" });
    const b = await storage.create(ROOT, "b", { name: "b", contentType: "text/plain" });
    const client = createVersionsClient(storage);
    const [av] = await client.versions(a.url);
    const [bv] = await client.versions(b.url);
    expect((av as VersionEntry).url).not.toBe((bv as VersionEntry).url);
    expect(await (await storage.read((av as VersionEntry).url)).text()).toBe("a");
    expect(await (await storage.read((bv as VersionEntry).url)).text()).toBe("b");
    await expect(client.restoreVersion(a.url, (bv as VersionEntry).url)).rejects.toMatchObject({
      code: "not-found",
    });
  } finally {
    random.mockRestore();
  }
});

for (const protocol of ["solid", "lws"] as const) {
  test(`${protocol}: simple template expansion percent-encodes all reserved characters`, async () => {
    const resource = `${ROOT}a!b'c(d)e*f`;
    const history = `${HISTORY}?resource=https%3A%2F%2Fpod.example%2Falice%2Fa%21b%27c%28d%29e%2Af`;
    const { storage, fetcher } = network(protocol, [
      new Response(null),
      listing(protocol, [VERSION], history),
      new Response(null, { headers: { "Memento-Datetime": AT } }),
    ]);
    expect(await createVersionsClient(storage).versions(resource)).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(history, expect.objectContaining({ method: "GET" }));
    const memory = createMemoryStorage({ root: ROOT, protocol, versioning: true });
    const item = await memory.create(ROOT, "version", {
      name: "a!b'c(d)e*f",
      contentType: "text/plain",
    });
    expect(item.url).toBe(resource);
    expect((await memory.list(history)).items).toHaveLength(1);
  });
}
