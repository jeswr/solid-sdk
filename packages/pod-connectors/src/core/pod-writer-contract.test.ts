// AUTHORED-BY Codex GPT-6.1-Sol
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { createFetchPodWriter } from "./pod-writer.js";
import { createStoragePodWriter } from "./storage-pod-writer.js";
import {
  createMemoryPod,
  createStorageMemoryPod,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "./testing.js";
import type { NormalisedDoc } from "./types.js";

const container = `${TEST_POD_ROOT}integrations/toy/`;
const doc: NormalisedDoc = {
  slug: "media/system:inbox.ttl",
  category: "media",
  forClass: "https://schema.org/Thing",
  dataset: new Store(),
};
const binary = {
  slug: "media/original.bin",
  contentType: "application/octet-stream",
  body: new Uint8Array([0, 255, 128]),
};

describe.each(["fetch", "solid", "memory"])("%s PodWriter contract", (backend) => {
  async function setup() {
    const pod = backend === "memory" ? await createStorageMemoryPod() : createMemoryPod();
    const port =
      backend === "fetch"
        ? createFetchPodWriter({
            adapterId: "toy",
            webId: TEST_WEBID,
            profileDocumentUrl: TEST_PROFILE_DOC,
            podRoot: TEST_POD_ROOT,
            fetch: pod.fetch,
          })
        : createStoragePodWriter({
            storage: pod.storage ?? createSolidBackend({ fetch: pod.fetch, root: TEST_POD_ROOT }),
            container,
            webId: TEST_WEBID,
            typeIndex: { profileDocumentUrl: TEST_PROFILE_DOC },
          });
    return { pod, port };
  }
  it("round-trips RDF with exact paths, validators, metadata and stale-write rejection", async () => {
    const { port, pod } = await setup();
    expect(await port.read(doc.slug)).toBeUndefined();
    const written = await port.write(doc, { ifNoneMatch: "*" });
    expect(written).toEqual({
      url: `${container}${doc.slug}`,
      category: doc.category,
      forClass: doc.forClass,
      skipRegistration: undefined,
    });
    const current = await port.read(doc.slug);
    expect(current?.dataset.size).toBe(0);
    expect(current?.etag).toBeTruthy();
    await expect(port.write(doc, { ifNoneMatch: "*" })).rejects.toMatchObject({ status: 412 });
    await port.write(doc, { ifMatch: current?.etag as string });
    const saved = pod.get(written.url);
    await expect(port.write(doc, { ifMatch: current?.etag as string })).rejects.toMatchObject({
      status: 412,
    });
    expect(pod.get(written.url)).toBe(saved);
    expect((await port.read(doc.slug))?.etag).not.toBe(current?.etag);
  });
  it("stores opaque binary bytes, keeps create-only content and conditionally replaces it", async () => {
    const { port, pod } = await setup();
    expect(await port.writeBinary?.(binary)).toEqual({
      url: port.resolve(binary.slug),
      created: true,
    });
    expect(await port.writeBinary?.({ ...binary, body: new Uint8Array([1]) })).toMatchObject({
      created: false,
    });
    expect(pod.bytes(port.resolve(binary.slug))).toEqual(binary.body);
    await port.writeBinary?.({ ...binary, mode: "replace", body: new Uint8Array([2]) });
    expect(pod.bytes(port.resolve(binary.slug))).toEqual(new Uint8Array([2]));
    await port.writeBinary?.({ ...binary, slug: "media/missing.bin", mode: "replace" });
    for (const contentType of [
      "text/turtle",
      "application/ld+json; charset=utf-8",
      "invalid\r\nmedia",
    ])
      await expect(port.writeBinary?.({ ...binary, contentType })).rejects.toThrow();
  });
  it("deletes existing RDF and binaries, treating a missing resource as already deleted", async () => {
    const { port } = await setup();
    await port.write(doc, { ifNoneMatch: "*" });
    await port.remove?.(doc.slug, { ifMatch: (await port.read(doc.slug))?.etag as string });
    expect(await port.read(doc.slug)).toBeUndefined();
    await port.remove?.(doc.slug);
    await port.writeBinary?.(binary);
    await port.remove?.(binary.slug);
    expect(await port.read(binary.slug)).toBeUndefined();
  });
  it("bootstraps and reuses the Type Index outside the connector container", async () => {
    const { port, pod } = await setup();
    const registrations = [{ forClass: doc.forClass, container: port.resolve("media/") }];
    const first = await port.registerType(registrations);
    const puts = pod.putCount;
    expect(await port.registerType(registrations)).toMatchObject({ indexUrl: first.indexUrl });
    expect(pod.putCount).toBe(puts);
    expect(pod.get(first.indexUrl)).toContain(doc.forClass);
  });
  it.each([
    "../escape.ttl",
    "https://foreign.test/x",
    ".",
    "%2e%2e/escape",
    "encoded%2fescape",
  ])("confines every port for %s", async (slug) => {
    const { port } = await setup();
    expect(() => port.resolve(slug)).toThrow();
    await expect(port.read(slug)).rejects.toThrow();
    await expect(port.write({ ...doc, slug })).rejects.toThrow();
    await expect(port.writeBinary?.({ ...binary, slug })).rejects.toThrow();
    await expect(port.remove?.(slug)).rejects.toThrow();
  });
});

describe("storage writer safety", () => {
  function setup(overrides: Partial<StorageClient> = {}, signal?: AbortSignal) {
    const storage = { ...createMemoryStorage({ root: TEST_POD_ROOT }), ...overrides };
    const port = createStoragePodWriter({ storage, container, signal });
    return { storage, port };
  }
  it("requires a Solid backend and a valid confined container", () => {
    const storage = createMemoryStorage({ root: TEST_POD_ROOT });
    for (const bad of [
      "https://foreign.test/",
      `${container}?query`,
      `${container}#frag`,
      container.slice(0, -1),
    ])
      expect(() => createStoragePodWriter({ storage, container: bad })).toThrow();
    expect(() =>
      createStoragePodWriter({
        storage: createMemoryStorage({ root: TEST_POD_ROOT, protocol: "lws" }),
        container,
      }),
    ).toThrow();
  });
  it("requires registration configuration explicitly", async () => {
    await expect(setup().port.registerType([])).rejects.toThrow("WebID");
  });
  it.each([
    null,
    "*",
    'W/"weak"',
    "",
    '"one", "two"',
  ])("refuses unusable ETags %s before mutations", async (etag) => {
    const write = vi.fn(),
      create = vi.fn(),
      remove = vi.fn();
    const { port } = setup({
      head: vi.fn().mockResolvedValue({ etag }),
      write,
      create,
      delete: remove,
    });
    await expect(port.write(doc)).rejects.toThrow("strong ETag");
    await expect(port.writeBinary?.({ ...binary, mode: "replace" })).rejects.toThrow("strong ETag");
    await expect(port.remove?.(doc.slug)).rejects.toThrow("strong ETag");
    if (etag !== null) await expect(port.write(doc, { ifMatch: etag })).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it("rejects contradictory conditions and invalid binary modes", async () => {
    const { port } = setup();
    await expect(port.write(doc, { ifMatch: '"v1"', ifNoneMatch: "*" })).rejects.toThrow();
    await expect(port.writeBinary?.({ ...binary, mode: "invalid" as "create" })).rejects.toThrow();
  });
  it.each([
    403, 410, 500,
  ])("propagates %s from reads, HEADs, creates and deletes", async (status) => {
    const error = new StorageError(status === 410 ? "not-found" : "server", {
      method: "GET",
      url: container,
      status,
    });
    const fail = vi.fn().mockRejectedValue(error);
    const { port } = setup({ readRdf: fail, head: fail, create: fail, delete: fail });
    await expect(port.read(doc.slug)).rejects.toBe(error);
    await expect(port.write(doc)).rejects.toBe(error);
    await expect(port.write(doc, { ifNoneMatch: "*" })).rejects.toBe(error);
    await expect(port.writeBinary?.({ ...binary, mode: "replace" })).rejects.toBe(error);
    await expect(port.remove?.(doc.slug, { ifMatch: '"v1"' })).rejects.toBe(error);
  });
  it("surfaces replacement races and tolerates a concurrent delete only on 404", async () => {
    const fail = new StorageError("precondition-failed", {
      method: "PUT",
      url: container,
      status: 412,
    });
    const { port, storage } = setup({
      head: vi.fn().mockResolvedValue({ etag: '"v1"' }),
      write: vi.fn().mockRejectedValue(fail),
    });
    await expect(port.writeBinary?.({ ...binary, mode: "replace" })).rejects.toBe(fail);
    storage.delete = vi
      .fn()
      .mockRejectedValue(
        new StorageError("not-found", { method: "DELETE", url: container, status: 404 }),
      );
    await expect(port.remove?.(doc.slug, { ifMatch: '"v1"' })).resolves.toBeUndefined();
  });
  it("checks abort again after an awaited HEAD and before every port", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const write = vi.fn();
    const { port } = setup(
      {
        head: vi.fn(async () => {
          controller.abort(reason);
          return { etag: '"v1"' } as Awaited<ReturnType<StorageClient["head"]>>;
        }),
        write,
      },
      controller.signal,
    );
    await expect(port.writeBinary?.({ ...binary, mode: "replace" })).rejects.toBe(reason);
    await expect(port.write(doc)).rejects.toBe(reason);
    await expect(port.read(doc.slug)).rejects.toBe(reason);
    await expect(port.remove?.(doc.slug)).rejects.toBe(reason);
    await expect(port.registerType([])).rejects.toBe(reason);
    expect(write).not.toHaveBeenCalled();
  });
  it("uses the observed ETag when no conditions were supplied", async () => {
    const writeRdf = vi.fn().mockResolvedValue({});
    const { port } = setup({ head: vi.fn().mockResolvedValue({ etag: '"observed"' }), writeRdf });
    await port.write(doc);
    expect(writeRdf).toHaveBeenCalledWith(
      port.resolve(doc.slug),
      doc.dataset,
      expect.objectContaining({ ifMatch: '"observed"' }),
    );
  });
  it("refuses JSON-LD remote contexts without issuing context requests", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        { "@context": "https://context.test/leak", "@id": "urn:s" },
        { headers: { "content-type": "application/ld+json" } },
      ),
    );
    const port = createStoragePodWriter({
      storage: createSolidBackend({ root: TEST_POD_ROOT, fetch }),
      container,
    });
    await expect(port.read(doc.slug)).rejects.toMatchObject({ code: "not-rdf" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(port.resolve(doc.slug));
  });
  it.each([
    "read",
    "write",
    "binary",
    "remove",
    "register",
  ])("refuses redirects during %s without replay", async (operation) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { status: 307, headers: { location: `${container}other` } }),
    );
    const port = createStoragePodWriter({
      storage: createSolidBackend({ root: TEST_POD_ROOT, fetch }),
      container,
      webId: TEST_WEBID,
      typeIndex: { profileDocumentUrl: TEST_PROFILE_DOC },
    });
    const pending =
      operation === "read"
        ? port.read(doc.slug)
        : operation === "write"
          ? port.write(doc, { ifNoneMatch: "*" })
          : operation === "binary"
            ? port.writeBinary?.(binary)
            : operation === "remove"
              ? port.remove?.(doc.slug, { ifMatch: '"v1"' })
              : port.registerType([]);
    await expect(pending).rejects.toMatchObject({ status: 307 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });
  it("refuses named graphs before creating a Turtle resource", async () => {
    const create = vi.fn();
    const { port } = setup({ create });
    const dataset = new Store([
      DataFactory.quad(
        DataFactory.namedNode("urn:s"),
        DataFactory.namedNode("urn:p"),
        DataFactory.literal("value"),
        DataFactory.namedNode("urn:graph"),
      ),
    ]);
    await expect(port.write({ ...doc, dataset }, { ifNoneMatch: "*" })).rejects.toThrow(
      "named graphs",
    );
    expect(create).not.toHaveBeenCalled();
  });
  it("refuses a backend that changes an exact create URL", async () => {
    const { port } = setup({ create: vi.fn().mockResolvedValue({ url: `${container}changed` }) });
    await expect(port.write(doc, { ifNoneMatch: "*" })).rejects.toThrow("changed");
  });
  it("preserves RDF terms and provenance through a memory round trip", async () => {
    const pod = await createStorageMemoryPod();
    const port = createStoragePodWriter({ storage: pod.storage as StorageClient, container });
    const dataset = new Store([
      DataFactory.quad(
        DataFactory.namedNode(`${container}item`),
        DataFactory.namedNode("urn:predicate"),
        DataFactory.literal("opaque <&> value"),
      ),
    ]);
    await port.write({ ...doc, dataset }, { ifNoneMatch: "*" });
    expect([...(await port.read(doc.slug))!.dataset].map((q) => q.object.value)).toEqual([
      "opaque <&> value",
    ]);
  });
});
