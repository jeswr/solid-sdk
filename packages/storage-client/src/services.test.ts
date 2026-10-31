// AUTHORED-BY Codex GPT-6.1-Sol
import { deriveFeatures, type Features } from "@jeswr/storage-capabilities";
import { describe, expect, test, vi } from "vitest";
import { createLwsBackend } from "./lws.js";
import { createMemoryStorage } from "./memory.js";
import { serviceEtag, trashCommand, versionHistoryQuery } from "./services.js";
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
) {
  const meta = `${COPY}.meta`;
  return [
    new Response(null, {
      headers: { Link: `<${meta}>; rel="${protocol === "solid" ? "describedby" : "linkset"}"` },
    }),
    protocol === "solid"
      ? new Response(
          `<${COPY}> <http://www.iana.org/assignments/relation/original> <${original}> ${modified === null ? "." : `; <http://purl.org/dc/terms/modified> ${JSON.stringify(modified)} .`}`,
          { headers: { "Content-Type": "text/turtle" } },
        )
      : Response.json(
          {
            linkset: [
              {
                anchor: COPY,
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
    test("trash sends only the JSON command, no Slug or content copy", async () => {
      const { storage, fetcher } = network(protocol, [
        new Response(null, { status: 201, headers: { Location: COPY } }),
      ]);
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
      200, 201,
    ])("restore accepts %s and the protocol's returned Location", async (status) => {
      const restored = protocol === "solid" ? LIVE : `${ROOT}new-id`;
      const { storage } = network(protocol, [
        listing(protocol, [COPY]),
        ...metadataResponses(protocol),
        new Response(null, { status, headers: { Location: restored } }),
      ]);
      expect((await createTrashClient(storage).restore(COPY)).url).toBe(restored);
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
  ]) {
    f.versioning.detail.endpoint = template;
    expect(versionHistoryQuery(f, ROOT, HISTORY)).toBe(false);
  }
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
