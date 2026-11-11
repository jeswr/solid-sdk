// AUTHORED-BY Codex (GPT-6.1 Sol)

import type { TypeIndex } from "@jeswr/pod-type-index";
import { createPodClient, type PodClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { beforeEach, expect, it, vi } from "vitest";
import { entryEntity } from "../src/model.js";
import { JournalPrivacyError, protectJournal, verifyJournalResource } from "../src/privacy.js";
import { createJournalStore, openJournal, validatePhoto } from "../src/store.js";

vi.mock("../src/privacy.js", async (original) => ({
  ...(await original<typeof import("../src/privacy.js")>()),
  protectJournal: vi.fn(async () => {}),
  verifyJournalResource: vi.fn(async () => {}),
}));
vi.mock("@jeswr/storage-client", async (original) => ({
  ...(await original<typeof import("@jeswr/storage-client")>()),
  createPodClient: vi.fn(),
}));
const root = "https://pod.example/";
const owner = `${root}profile#me`;
const data = { created: new Date("2026-11-11"), text: "A good day." };
function fixture(protocol: "solid" | "lws" = "solid") {
  const storage = createMemoryStorage({ root, protocol, pageSize: 2 });
  const index: TypeIndex = {
    register: vi.fn(async () => undefined),
    find: vi.fn(),
    findAll: vi.fn(),
    unregister: vi.fn(),
    listClasses: vi.fn(),
  };
  return { storage, index, store: createJournalStore(storage, index, owner, vi.fn()) };
}
beforeEach(() => vi.clearAllMocks());
it("initialises once, respects returned container URLs and registers privately", async () => {
  const { storage, index, store } = fixture();
  const create = vi.spyOn(storage, "create");
  await store.initialize();
  await store.initialize();
  expect(create).toHaveBeenCalledTimes(1);
  expect(index.register).toHaveBeenCalledWith(
    entryEntity.typeIri,
    { container: store.container },
    { index: "private" },
  );
  expect(protectJournal).toHaveBeenCalledWith(
    storage,
    store.container,
    owner,
    expect.any(Function),
    true,
  );
  const other = fixture("lws");
  await other.store.initialize();
  expect(other.store.container).toMatch(/^https:\/\/pod.example\//);
});
it("handles container creation races, and propagates non-404, failed create and privacy errors", async () => {
  const { storage, store } = fixture();
  const head = vi.spyOn(storage, "head");
  head.mockRejectedValueOnce(new Error("offline"));
  await expect(store.initialize()).rejects.toThrow("offline");
  vi.spyOn(storage, "create").mockImplementationOnce(async () => {
    throw new Error("quota");
  });
  await expect(store.initialize()).rejects.toThrow("quota");
  const originalCreate = storage.create;
  vi.spyOn(storage, "create").mockImplementationOnce(async (container, body, opts) => {
    await originalCreate(container, body, opts);
    throw new StorageError("conflict", { url: container, method: "PUT" });
  });
  await store.initialize();
  vi.mocked(protectJournal).mockRejectedValueOnce(new Error("shared"));
  await expect(store.list()).rejects.toThrow("shared");
});
it("round-trips and conditionally edits/deletes entries, preserving date order over all pages", async () => {
  const { storage, store } = fixture();
  await store.initialize();
  const first = await store.save(data);
  const later = await store.save({ ...data, created: new Date("2026-11-12") });
  await store.save({ ...data, text: "Third" });
  await storage.create(store.container, "photo", { name: "x.jpg", contentType: "image/jpeg" });
  await storage.create(store.container, null, { name: "folder", kind: "container" });
  const list = await store.list();
  expect(list).toHaveLength(3);
  expect(list[0]?.url).toBe(later.url);
  const next = await store.save({ ...data, text: "Edited" }, first);
  expect(next.text).toBe("Edited");
  await expect(store.save(data, first)).rejects.toMatchObject({ code: "precondition-failed" });
  await expect(store.save(data, { ...next, etag: null })).rejects.toThrow("Reload");
  await expect(store.remove({ ...next, etag: null })).rejects.toThrow("Reload");
  await store.remove(next);
  expect(await store.list()).toHaveLength(2);
  await expect(store.remove({ ...next, url: `${root}elsewhere.ttl` })).rejects.toThrow();
});
it("rejects invalid records, empty placeholder races, missing validators and partial list failures", async () => {
  const { storage, store } = fixture();
  await store.initialize();
  await expect(store.save({ ...data, text: " " })).rejects.toThrow();
  vi.spyOn(storage, "read").mockResolvedValueOnce({
    ...(await storage.head(store.container)),
    etag: null,
  });
  await expect(store.save(data)).rejects.toThrow("safely");
  vi.spyOn(storage, "read").mockResolvedValueOnce({
    ...(await storage.head(store.container)),
    text: async () => "not empty",
  });
  await expect(store.save(data)).rejects.toThrow();
  const url = `${store.container}malformed.ttl`;
  await storage.create(store.container, await entryEntity.serialize(url, { ...data, text: "" }), {
    name: "malformed.ttl",
    contentType: "text/turtle",
  });
  await expect(store.list()).rejects.toThrow("couldn't be read");
});
it("accepts only bounded inert photo types and confines all attachment URLs", async () => {
  const { storage, store } = fixture();
  await store.initialize();
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
    const url = await store.attach(new Blob(["photo"], { type }));
    expect((await store.photo(url)).type).toBe(type);
  }
  for (const photo of [
    new Blob([], { type: "image/png" }),
    new Blob(["svg"], { type: "image/svg+xml" }),
    new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "image/jpeg" }),
  ])
    expect(() => validatePhoto(photo)).toThrow();
  validatePhoto(new Blob([new Uint8Array(10 * 1024 * 1024)], { type: "image/png" }));
  for (const url of [
    "https://foreign.example/a.png",
    `${store.container}../profile/card`,
    `${store.container}photo.png?x=1`,
    `${store.container}photo.png#x`,
    `${store.container}nested/photo.png`,
    store.container,
  ])
    await expect(store.photo(url)).rejects.toThrow();
  const text = await storage.create(store.container, "text", {
    name: "text.txt",
    contentType: "text/plain",
  });
  await expect(store.photo(text.url)).rejects.toThrow("supported photo");
});
it("uses discovery for real pods and refuses unsupported private provisioning on LWS", async () => {
  const { storage } = fixture();
  vi.mocked(createPodClient).mockResolvedValue({
    storage,
    features: storage.features,
    description: { protocol: "solid" },
  } as PodClient);
  const store = await openJournal(vi.fn(), root, owner);
  expect(store.container).toBe(`${root}journal/`);
  vi.mocked(createPodClient).mockResolvedValue({
    storage,
    features: storage.features,
    description: { protocol: "lws" },
  } as PodClient);
  await expect(openJournal(vi.fn(), root, owner)).rejects.toThrow("Solid pod");
  expect((await openJournal(vi.fn(), root, owner, { solidFixture: true })).container).toBe(
    `${root}journal/`,
  );
});
it("retries a lost write response without creating a second entry", async () => {
  const { storage, store } = fixture();
  await store.initialize();
  const write = storage.write;
  vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => {
    await write(...args);
    throw new Error("response lost");
  });
  await expect(store.save(data)).rejects.toThrow("response lost");
  const recovered = await store.save(data);
  expect(recovered.text).toBe(data.text);
  expect(await store.list()).toHaveLength(1);
});

it("reads one private entry with its ETag without listing unrelated shared entries", async () => {
  const { storage, store } = fixture();
  await store.initialize();
  const saved = await store.save(data);
  const other = await store.save({ ...data, text: "Other" });
  vi.mocked(verifyJournalResource).mockImplementation(async (_, url) => {
    if (url === other.url) throw new JournalPrivacyError("shared");
  });
  const listing = vi.spyOn(storage, "listAll");
  const reads = vi.spyOn(storage, "readRdf");
  expect(await store.read(saved.url)).toEqual(saved);
  expect(listing).not.toHaveBeenCalled();
  expect(reads).toHaveBeenCalledExactlyOnceWith(saved.url);
  await expect(store.read(other.url)).rejects.toThrow("shared");
  expect(reads).toHaveBeenCalledOnce();
  await expect(store.read("https://foreign.example/one.ttl")).rejects.toThrow("escapes");
  await expect(store.read(`${store.container}nested/one.ttl`)).rejects.toThrow("outside");
  await expect(store.read(`${store.container}missing.ttl`)).rejects.toMatchObject({
    code: "not-found",
  });
  const empty = await storage.create(store.container, "", {
    name: "empty.ttl",
    contentType: "text/turtle",
  });
  await expect(store.read(empty.url)).rejects.toThrow("no longer available");
  const invalid = await storage.create(
    store.container,
    await entryEntity.serialize(`${store.container}invalid.ttl`, { ...data, text: "" }),
    { name: "invalid.ttl", contentType: "text/turtle" },
  );
  await expect(store.read(invalid.url)).rejects.toThrow("couldn't be read");
});
