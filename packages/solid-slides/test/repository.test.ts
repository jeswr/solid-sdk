// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { TypeIndex } from "@jeswr/pod-type-index";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { newDeck } from "../src/deck.js";
import { createDeckRepository, DeckConflictError } from "../src/repository.js";

const root = "https://pod.example/";
function setup(protocol: "solid" | "lws" = "solid") {
  const storage = createMemoryStorage({ root, protocol });
  const index = { register: vi.fn(async () => undefined) } as unknown as TypeIndex;
  const repo = createDeckRepository(storage, { profile: `${root}profile/card#me`, index });
  return { storage, index, repo };
}
describe.each(["solid", "lws"] as const)("%s deck storage", (protocol) => {
  it("initialises and registers idempotently, then creates, lists, edits and deletes atomically", async () => {
    const { storage, index, repo } = setup(protocol);
    await repo.initialise();
    await repo.initialise();
    expect(index.register).toHaveBeenCalledWith("http://schema.org/PresentationDigitalDocument", {
      container: repo.container,
    });
    const a = await repo.create(newDeck("First", new Date(0)), "a.ttl");
    const b = await repo.create(newDeck("Second", new Date(1000)));
    expect((await repo.list()).map((entry) => entry.deck.name)).toEqual(["Second", "First"]);
    await storage.create(repo.container, "binary", { name: "asset.png", contentType: "image/png" });
    await storage.create(repo.container, null, { name: "folder", kind: "container" });
    expect(await repo.list()).toHaveLength(2);
    const changed = await repo.save(a, { ...a.deck, name: "Changed" }, true);
    expect((await repo.read(changed.url)).deck.name).toBe("Changed");
    await expect(repo.save(a, { ...a.deck, name: "Stale" })).rejects.toBeInstanceOf(
      DeckConflictError,
    );
    await repo.remove(changed);
    expect(await repo.list()).toHaveLength(1);
    await repo.remove(b);
    expect(await repo.list()).toEqual([]);
  });
});
it("validates image types and size and uses returned upload URLs", async () => {
  const { repo } = setup();
  await repo.initialise();
  const image = await repo.uploadImage(new Blob(["image"], { type: "image/png" }), "a ? moon.png");
  expect(image).toContain("a___moon.png");
  await expect(
    repo.uploadImage(new Blob(["<svg/>"], { type: "image/svg+xml" }), "bad.svg"),
  ).rejects.toThrow(TypeError);
  await expect(
    repo.uploadImage(
      new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "image/png" }),
      "big.png",
    ),
  ).rejects.toThrow(RangeError);
});
it("does not swallow access errors or invalid records", async () => {
  const { repo, storage } = setup();
  vi.spyOn(storage, "head").mockRejectedValueOnce(new Error("offline"));
  await expect(repo.initialise()).rejects.toThrow("offline");
  await repo.initialise();
  const invalid = await storage.create(repo.container, "", {
    name: "invalid.ttl",
    contentType: "text/turtle",
  });
  await expect(repo.read(invalid.url)).rejects.toThrow("valid presentation");
});
it("handles a concurrent collection create, but propagates other create failures", async () => {
  const { repo, storage } = setup();
  const create = storage.create.bind(storage);
  vi.spyOn(storage, "create").mockImplementationOnce(async (...args) => {
    await create(...args);
    throw new StorageError("conflict", { url: root, method: "POST" });
  });
  await repo.initialise();
  expect(repo.container).toBe(`${root}slides/`);
  const second = setup();
  vi.spyOn(second.storage, "create").mockRejectedValueOnce(new Error("denied"));
  await expect(second.repo.initialise()).rejects.toThrow("denied");
});
it("refuses missing or weak validators and a claimed non-empty new resource", async () => {
  const { repo, storage } = setup();
  await repo.initialise();
  const original = storage.read.bind(storage);
  for (const etag of [null, 'W/"weak"']) {
    vi.spyOn(storage, "read").mockImplementationOnce(async (...args) => ({
      ...(await original(...args)),
      etag,
    }));
    await expect(repo.create(newDeck())).rejects.toThrow("strong version");
  }
  vi.spyOn(storage, "read").mockImplementationOnce(async (...args) => ({
    ...(await original(...args)),
    bytes: async () => new Uint8Array([1]),
  }));
  await expect(repo.create(newDeck())).rejects.toThrow("changed before");
  const item = await repo.create(newDeck());
  const readRdf = storage.readRdf.bind(storage);
  vi.spyOn(storage, "readRdf").mockImplementationOnce(async (...args) => ({
    ...(await readRdf(...args)),
    etag: null,
  }));
  await expect(repo.read(item.url)).rejects.toThrow("strong version");
});
it("rechecks snapshots when a write returns only a follow-up ETag, and detects an intervening writer", async () => {
  const { repo, storage } = setup();
  await repo.initialise();
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => ({
    ...(await write(...args)),
    etagSource: "follow-up",
  }));
  const item = await repo.create(newDeck());
  vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => ({
    ...(await write(...args)),
    etagSource: "follow-up",
  }));
  const updated = await repo.save(item, { ...item.deck, name: "safe" });
  expect(updated.deck.name).toBe("safe");
  vi.spyOn(storage, "write").mockRejectedValueOnce(new Error("offline"));
  await expect(repo.save(updated, updated.deck)).rejects.toThrow("offline");
  const read = storage.readRdf.bind(storage);
  vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => {
    const saved = await write(...args);
    const newer = await import("../src/model.js");
    await write(
      saved.url,
      await newer.serializeDeck(saved.url, { ...updated.deck, name: "remote" }),
      { contentType: "text/turtle", ifMatch: saved.etag as string },
    );
    return { ...saved, etagSource: "follow-up" };
  });
  await expect(repo.save(updated, { ...updated.deck, name: "mine" })).rejects.toBeInstanceOf(
    DeckConflictError,
  );
  expect((await read(updated.url)).etag).toBeTruthy();
});
it("opens an explicitly known Solid session without requiring description discovery", async () => {
  const { openSolidDeckRepository } = await import("../src/repository.js");
  const fetch = vi.fn(async () => {
    throw new Error("offline");
  });
  const repo = await openSolidDeckRepository(fetch, root, `${root}profile#me`);
  expect(repo.container).toBe(`${root}slides/`);
  await expect(repo.initialise()).rejects.toThrow();
});
it("treats an identical raced save as acknowledged, without overwriting intervening content", async () => {
  const { repo } = setup();
  await repo.initialise();
  const current = await repo.create(newDeck());
  const next = { ...current.deck, name: "Latest" };
  const saved = await repo.save(current, next);
  const raced = await repo.save(current, next);
  expect(raced).toEqual(saved);
});
it("skips unfinished empty creates, but surfaces malformed non-empty presentation files", async () => {
  const { repo, storage } = setup();
  await repo.initialise();
  await storage.create(repo.container, "", { name: "unfinished.ttl", contentType: "text/turtle" });
  expect(await repo.list()).toEqual([]);
  await storage.create(
    repo.container,
    '<https://example.org/a> <https://example.org/b> "unrelated".',
    { name: "invalid.ttl", contentType: "text/turtle" },
  );
  await expect(repo.list()).rejects.toThrow("valid presentation");
});
it("uses the extension when listing metadata omits a content type", async () => {
  const { repo, storage } = setup();
  await repo.initialise();
  const deck = await repo.create(newDeck(), "plain.ttl");
  vi.spyOn(storage, "listAll").mockImplementation(async function* () {
    yield {
      url: deck.url,
      kind: "resource",
      contentType: null,
      size: null,
      modified: null,
      types: [],
    };
    yield {
      url: `${repo.container}unknown.png`,
      kind: "resource",
      contentType: null,
      size: null,
      modified: null,
      types: [],
    };
  });
  expect((await repo.list()).map((entry) => entry.url)).toEqual([deck.url]);
});
