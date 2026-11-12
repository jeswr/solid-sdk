// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import type { TypeIndex } from "@jeswr/pod-type-index";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import { newDeck } from "../src/deck.js";
import { serializeDeck } from "../src/model.js";
import {
  createDeckRepository,
  DECK_BYTE_LIMIT,
  DeckConflictError,
  DeckVersionError,
  isStrongEtag,
} from "../src/repository.js";

const root = "https://pod.example/";
const DAY = 24 * 60 * 60 * 1000;
function setup(protocol: "solid" | "lws" = "solid", now?: () => number) {
  const storage = createMemoryStorage({ root, protocol });
  const index = { register: vi.fn(async () => undefined) } as unknown as TypeIndex;
  const repo = createDeckRepository(storage, {
    profile: `${root}profile/card#me`,
    index,
    ...(now ? { now } : {}),
  });
  return { storage, index, repo };
}
const names = async (repo: ReturnType<typeof setup>["repo"]) =>
  (await repo.list()).decks.map((entry) => entry.deck.name);
/** Replace one response's ETag while keeping the rest of the memory backend's answer. */
function withEtag<T extends { etag: string | null }>(
  original: (url: string, opts?: never) => Promise<T>,
  etag: string | null,
): never {
  return (async (url: string, opts?: never) => ({ ...(await original(url, opts)), etag })) as never;
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
    expect(await names(repo)).toEqual(["Second", "First"]);
    await storage.create(repo.container, "binary", { name: "asset.png", contentType: "image/png" });
    await storage.create(repo.container, null, { name: "folder", kind: "container" });
    expect((await repo.list()).decks).toHaveLength(2);
    const changed = await repo.save(a, { ...a.deck, name: "Changed" }, true);
    expect((await repo.read(changed.url)).deck.name).toBe("Changed");
    await expect(repo.save(a, { ...a.deck, name: "Stale" })).rejects.toBeInstanceOf(
      DeckConflictError,
    );
    await repo.remove(changed);
    expect((await repo.list()).decks).toHaveLength(1);
    await repo.remove(b);
    expect(await repo.list()).toEqual({ decks: [], broken: [] });
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
  await expect(repo.read(invalid.url)).rejects.toThrow("not finished");
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
it("classifies strong and weak versions", () => {
  expect(isStrongEtag('"1"')).toBe(true);
  expect(isStrongEtag('W/"1"')).toBe(false);
  expect(isStrongEtag("")).toBe(false);
  expect(isStrongEtag(null)).toBe(false);
  expect(isStrongEtag(undefined)).toBe(false);
});
it("shows decks with weak or missing versions, but writes only with a strong one", async () => {
  const { repo, storage } = setup();
  await repo.initialise();
  const item = await repo.create(newDeck("Weak"));
  const read = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementationOnce(withEtag(read as never, `W/${item.etag}`));
  const weak = await repo.read(item.url);
  expect(weak).toMatchObject({ etag: `W/${item.etag}`, deck: { name: "Weak" } });
  // The weak tag names the current strong version: a HEAD recovers it.
  const saved = await repo.save(weak, { ...weak.deck, name: "Recovered" });
  expect(saved.deck.name).toBe("Recovered");
  // A weak tag for an older version never matches the current strong one.
  await expect(repo.save(weak, { ...weak.deck, name: "Stale" })).rejects.toBeInstanceOf(
    DeckVersionError,
  );
  const head = storage.head.bind(storage);
  vi.spyOn(storage, "head").mockImplementationOnce(withEtag(head as never, `W/${saved.etag}`));
  await expect(repo.save({ ...saved, etag: `W/${saved.etag}` }, saved.deck)).rejects.toBeInstanceOf(
    DeckVersionError,
  );
  vi.spyOn(storage, "read").mockImplementationOnce(withEtag(read as never, null));
  const missing = await repo.read(saved.url);
  expect(missing.etag).toBe("");
  await expect(repo.save(missing, missing.deck)).rejects.toBeInstanceOf(DeckVersionError);
  await expect(repo.remove(missing)).rejects.toBeInstanceOf(DeckVersionError);
  expect((await repo.read(saved.url)).deck.name).toBe("Recovered");
});
it("refuses a weak placeholder version and a claimed non-empty new resource", async () => {
  const { repo, storage } = setup();
  await repo.initialise();
  const original = storage.read.bind(storage);
  for (const etag of [null, 'W/"weak"']) {
    vi.spyOn(storage, "read").mockImplementationOnce(withEtag(original as never, etag));
    await expect(repo.create(newDeck())).rejects.toBeInstanceOf(DeckVersionError);
  }
  vi.spyOn(storage, "read").mockImplementationOnce(async (...args) => ({
    ...(await original(...args)),
    bytes: async () => new Uint8Array([1]),
  }));
  await expect(repo.create(newDeck())).rejects.toThrow("changed before");
});
it("re-reads after a write that returns no strong version of its own", async () => {
  const { repo, storage } = setup();
  await repo.initialise();
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => ({
    ...(await write(...args)),
    etag: 'W/"weak"',
  }));
  const item = await repo.create(newDeck("Created"));
  expect(isStrongEtag(item.etag)).toBe(true);
  vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => ({
    ...(await write(...args)),
    etag: null,
  }));
  expect((await repo.save(item, { ...item.deck, name: "Saved" })).deck.name).toBe("Saved");
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
  vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => {
    const saved = await write(...args);
    await write(saved.url, await serializeDeck(saved.url, { ...updated.deck, name: "remote" }), {
      contentType: "text/turtle",
      ifMatch: saved.etag as string,
    });
    return { ...saved, etagSource: "follow-up" };
  });
  await expect(repo.save(updated, { ...updated.deck, name: "mine" })).rejects.toBeInstanceOf(
    DeckConflictError,
  );
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
describe("listing never fails for one bad file", () => {
  it("reports unreadable, malformed and non-presentation files beside the good decks", async () => {
    const { repo, storage } = setup();
    await repo.initialise();
    await repo.create(newDeck("Good"), "good.ttl");
    const unrelated = await storage.create(
      repo.container,
      '<https://example.org/a> <https://example.org/b> "unrelated".',
      { name: "unrelated.ttl", contentType: "text/turtle" },
    );
    const malformed = await storage.create(repo.container, "<not turtle", {
      name: "malformed.ttl",
      contentType: "text/turtle",
    });
    const denied = await repo.create(newDeck("Denied"), "denied.ttl");
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementation(async (url, opts) => {
      if (url === denied.url) throw new StorageError("forbidden", { url, method: "GET" });
      return read(url, opts);
    });
    const listing = await repo.list();
    expect(listing.decks.map((entry) => entry.deck.name)).toEqual(["Good"]);
    expect(listing.broken).toEqual([
      { url: denied.url, reason: "unreadable" },
      { url: malformed.url, reason: "invalid" },
      { url: unrelated.url, reason: "invalid" },
    ]);
    await expect(repo.read(malformed.url)).rejects.toThrow("not a valid presentation");
  });
  it("treats a non-RDF representation and an oversized document as invalid", async () => {
    const { repo, storage } = setup();
    await repo.initialise();
    const html = await storage.create(repo.container, "<p>hi</p>", {
      name: "page.ttl",
      contentType: "text/turtle",
    });
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementationOnce(async (...args) => ({
      ...(await read(...args)),
      contentType: "text/html",
    }));
    await expect(repo.read(html.url)).rejects.toThrow("not a valid presentation");
    await storage.delete(html.url, { ifMatch: (await storage.head(html.url)).etag as string });
    const big = await storage.create(
      repo.container,
      `# ${"x".repeat(DECK_BYTE_LIMIT)}\n<https://example.org/a> <https://example.org/b> "c".`,
      { name: "big.ttl", contentType: "text/turtle" },
    );
    expect((await repo.list()).broken).toEqual([{ url: big.url, reason: "invalid" }]);
  });
  it("aborts a read when asked", async () => {
    const { repo } = setup();
    await repo.initialise();
    const item = await repo.create(newDeck());
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(repo.read(item.url, controller.signal)).rejects.toThrow();
  });
  it("reads at most four presentations at once", async () => {
    const { repo, storage } = setup();
    await repo.initialise();
    for (let index = 0; index < 9; index++) await repo.create(newDeck(`Deck ${index}`));
    let active = 0;
    let peak = 0;
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementation(async (...args) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        return await read(...args);
      } finally {
        active--;
      }
    });
    expect((await repo.list()).decks).toHaveLength(9);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
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
    expect((await repo.list()).decks.map((entry) => entry.url)).toEqual([deck.url]);
  });
});
describe("moved and copied presentations", () => {
  it("opens a deck copied to another URL and saves it under its new address", async () => {
    const { repo, storage } = setup();
    await repo.initialise();
    const original = await repo.create(newDeck("Travelling"), "original.ttl");
    const body = await (await storage.read(original.url)).text();
    const copy = await storage.create(repo.container, body, {
      name: "copy.ttl",
      contentType: "text/turtle",
    });
    const opened = await repo.read(copy.url);
    expect(opened.deck).toEqual(original.deck);
    const saved = await repo.save(opened, { ...opened.deck, name: "Copied" });
    expect((await storage.read(copy.url).then((result) => result.text())).includes(copy.url)).toBe(
      true,
    );
    expect((await repo.read(saved.url)).deck.name).toBe("Copied");
    expect((await repo.read(original.url)).deck.name).toBe("Travelling");
    expect(await names(repo)).toEqual(expect.arrayContaining(["Copied", "Travelling"]));
  });
  it("refuses an ambiguous document and a presentation outside the hash convention", async () => {
    const { repo, storage } = setup();
    await repo.initialise();
    const a = await serializeDeck(`${root}a.ttl`, newDeck("A"));
    const b = await serializeDeck(`${root}b.ttl`, newDeck("B"));
    const two = await storage.create(repo.container, `${a}\n${b}`, {
      name: "two.ttl",
      contentType: "text/turtle",
    });
    await expect(repo.read(two.url)).rejects.toThrow("not a valid presentation");
    const odd = await storage.create(
      repo.container,
      "<https://elsewhere.example/deck> a <http://schema.org/PresentationDigitalDocument> .",
      { name: "odd.ttl", contentType: "text/turtle" },
    );
    await expect(repo.read(odd.url)).rejects.toThrow("not a valid presentation");
    const blank = await storage.create(
      repo.container,
      "[] a <http://schema.org/PresentationDigitalDocument> .",
      { name: "blank.ttl", contentType: "text/turtle" },
    );
    await expect(repo.read(blank.url)).rejects.toThrow("not a valid presentation");
    const urn = await storage.create(
      repo.container,
      "<http://[bad> a <http://schema.org/PresentationDigitalDocument> .",
      { name: "unparsable-subject.ttl", contentType: "text/turtle" },
    );
    await expect(repo.read(urn.url)).rejects.toThrow("not a valid presentation");
    const scheme = await storage.create(
      repo.container,
      "<urn:uuid:1> a <http://schema.org/PresentationDigitalDocument> .",
      { name: "urn.ttl", contentType: "text/turtle" },
    );
    await expect(repo.read(scheme.url)).rejects.toThrow("not a valid presentation");
  });
});
describe("cleanup", () => {
  it("skips fresh empty placeholders and removes old ones", async () => {
    let time = Date.now();
    const { repo, storage } = setup("solid", () => time);
    await repo.initialise();
    const placeholder = await storage.create(repo.container, "", {
      name: "unfinished.ttl",
      contentType: "text/turtle",
    });
    expect(await repo.list()).toEqual({ decks: [], broken: [] });
    await expect(storage.head(placeholder.url)).resolves.toBeTruthy();
    time += DAY;
    vi.spyOn(storage, "delete").mockRejectedValueOnce(new Error("busy"));
    expect(await repo.list()).toEqual({ decks: [], broken: [] });
    await expect(storage.head(placeholder.url)).resolves.toBeTruthy();
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementationOnce(withEtag(read as never, 'W/"weak"'));
    expect(await repo.list()).toEqual({ decks: [], broken: [] });
    await expect(storage.head(placeholder.url)).resolves.toBeTruthy();
    vi.spyOn(storage, "read").mockImplementationOnce(async (...args) => ({
      ...(await read(...args)),
      body: null,
    }));
    await expect(repo.read(placeholder.url)).rejects.toThrow("not finished");
    expect(await repo.list()).toEqual({ decks: [], broken: [] });
    await expect(storage.head(placeholder.url)).rejects.toMatchObject({ code: "not-found" });
  });
  it("treats only a zero-byte body as a placeholder; other files without triples are invalid", async () => {
    const time = Date.now();
    const { repo, storage } = setup("solid", () => time + DAY);
    await repo.initialise();
    const comment = await storage.create(repo.container, "# just a comment\n", {
      name: "comment.ttl",
      contentType: "text/turtle",
    });
    const whitespace = await storage.create(repo.container, "\n", {
      name: "blank.ttl",
      contentType: "text/turtle",
    });
    const unmapped = await storage.create(repo.container, '{"name": "No context"}', {
      name: "unmapped.jsonld",
      contentType: "application/ld+json",
    });
    await expect(repo.read(comment.url)).rejects.toThrow("not a valid presentation");
    await expect(repo.read(unmapped.url)).rejects.toThrow("not a valid presentation");
    expect((await repo.list()).broken).toEqual(
      [comment.url, whitespace.url, unmapped.url].sort().map((url) => ({ url, reason: "invalid" })),
    );
    for (const url of [comment.url, whitespace.url, unmapped.url])
      await expect(storage.head(url)).resolves.toBeTruthy();
  });
  it("never deletes uploaded images, even ones no presentation uses", async () => {
    let time = Date.now();
    const { repo, storage } = setup("solid", () => time);
    await repo.initialise();
    const png = () => new Blob(["image"], { type: "image/png" });
    const used = await repo.uploadImage(png(), "used.png");
    const unused = await repo.uploadImage(png(), "unused.png");
    const deck = newDeck("Pictures");
    deck.slides = [{ ...(deck.slides[0] as (typeof deck.slides)[number]), image: used }];
    const stored = await repo.create(deck);
    const remove = vi.spyOn(storage, "delete");
    await repo.list();
    time += 30 * DAY;
    await repo.list();
    expect(remove).not.toHaveBeenCalled();
    await repo.remove(stored);
    await repo.list();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(stored.url, expect.anything());
    await expect(storage.head(used)).resolves.toBeTruthy();
    await expect(storage.head(unused)).resolves.toBeTruthy();
    expect("removeUploads" in repo).toBe(false);
  });
});
describe("app-owned sample files", () => {
  it("keeps a valid sample, creates a missing one and replaces an empty or invalid one", async () => {
    const { repo, storage } = setup();
    await repo.initialise();
    const created = await repo.ensure(newDeck("Sample"), "sample-a.ttl");
    expect(created.url).toBe(`${repo.container}sample-a.ttl`);
    const kept = await repo.ensure(newDeck("Other"), "sample-a.ttl");
    expect(kept.deck.name).toBe("Sample");
    await storage.create(repo.container, "", { name: "sample-b.ttl", contentType: "text/turtle" });
    expect((await repo.ensure(newDeck("Repaired"), "sample-b.ttl")).deck.name).toBe("Repaired");
    await storage.create(repo.container, "<broken", {
      name: "sample-c.ttl",
      contentType: "text/turtle",
    });
    const write = storage.write.bind(storage);
    vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => ({
      ...(await write(...args)),
      etagSource: "follow-up",
    }));
    expect((await repo.ensure(newDeck("Fixed"), "sample-c.ttl")).deck.name).toBe("Fixed");
    expect(await names(repo)).toEqual(expect.arrayContaining(["Sample", "Repaired", "Fixed"]));
  });
  it("refuses other names and propagates access errors", async () => {
    const { repo, storage } = setup();
    await repo.initialise();
    await expect(repo.ensure(newDeck(), "../escape.ttl")).rejects.toThrow(TypeError);
    vi.spyOn(storage, "read").mockRejectedValueOnce(
      new StorageError("forbidden", { url: root, method: "GET" }),
    );
    await expect(repo.ensure(newDeck(), "sample.ttl")).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
