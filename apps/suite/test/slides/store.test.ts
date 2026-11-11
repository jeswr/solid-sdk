// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import {
  type Deck,
  DeckConflictError,
  type DeckRepository,
  DeckVersionError,
  newDeck,
  type StoredDeck,
} from "@jeswr/solid-slides";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlidesStore } from "../../src/apps/slides/state/slides-store";

const container = "https://pod.example/slides/";
const item = (name = "Original"): StoredDeck => ({
  url: `${container}one.ttl`,
  etag: '"1"',
  deck: newDeck(name, new Date(0)),
});
function setup(decks = [item()]) {
  const repo = {
    container,
    create: vi.fn(async (deck: Deck) => ({ url: `${container}created.ttl`, etag: '"2"', deck })),
    save: vi.fn(async (current: StoredDeck, deck: Deck) => ({ ...current, etag: '"2"', deck })),
    remove: vi.fn(async () => {}),
    removeUploads: vi.fn(async () => {}),
  } as unknown as DeckRepository;
  const report = vi.fn();
  const persist = vi.fn();
  const store = new SlidesStore(repo, decks, report, persist);
  return { store, repo, report, persist };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("serial optimistic deck saves", () => {
  it("publishes immediately, debounces, uses latest content and persists pending drafts", async () => {
    const { store, repo, persist } = setup();
    const changed = vi.fn();
    const off = store.subscribe(changed);
    store.edit(item().url, newDeck("First"));
    store.edit(item().url, newDeck("Latest"));
    expect(store.getSnapshot().decks[0]?.deck.name).toBe("Latest");
    expect(repo.save).not.toHaveBeenCalled();
    expect(JSON.parse(persist.mock.calls.at(-1)?.[0] as string).drafts[0].deck.name).toBe("Latest");
    await vi.advanceTimersByTimeAsync(650);
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().pending).toBe(0);
    expect(changed).toHaveBeenCalled();
    off();
    store.dispose();
  });
  it("maps temporary identifiers to actual returned URLs, preserving edits made during creation", async () => {
    const { store, repo } = setup([]);
    let finish!: (value: StoredDeck) => void;
    vi.mocked(repo.create).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const url = store.add(newDeck("Before"));
    const save = store.flush();
    expect(store.flush()).toBe(save);
    store.edit(url, newDeck("During"));
    finish({ url: `${container}actual.ttl`, etag: '"2"', deck: newDeck("Before") });
    await save;
    expect(store.resolveUrl(url)).toBe(`${container}actual.ttl`);
    expect(store.getSnapshot().decks[0]?.deck.name).toBe("During");
    await store.flush();
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${container}actual.ttl`, etag: '"2"' }),
      expect.objectContaining({ name: "During" }),
      false,
    );
    store.edit(url, newDeck("After"));
    await store.flush(true);
    expect(store.getSnapshot().pending).toBe(0);
    store.dispose();
  });
  it("retains failed edits for retry and keeps newer edits after an earlier save finishes", async () => {
    const { store, repo, report } = setup();
    vi.mocked(repo.save).mockRejectedValueOnce(new Error("offline"));
    store.edit(item().url, newDeck("Unsaved"));
    await store.flush();
    expect(store.getSnapshot()).toMatchObject({ pending: 1, error: true });
    expect(report).toHaveBeenCalled();
    await store.flush();
    expect(store.getSnapshot()).toMatchObject({ pending: 0, error: false });
    let finish!: (value: StoredDeck) => void;
    vi.mocked(repo.save).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    store.edit(item().url, newDeck("A"));
    const saving = store.flush();
    store.edit(item().url, newDeck("B"));
    finish({ ...item("A"), etag: '"3"' });
    await saving;
    expect(store.getSnapshot().decks[0]?.deck.name).toBe("B");
    expect(store.getSnapshot().pending).toBe(1);
    await store.flush();
    store.dispose();
  });
  it("keeps both sides of a conflict, durably, and can save a copy or use the pod version", async () => {
    const { store, repo, persist } = setup();
    store.edit(item().url, newDeck("Mine"));
    vi.mocked(repo.save).mockRejectedValueOnce(
      new DeckConflictError(newDeck("Mine"), item("Remote")),
    );
    await store.flush();
    expect(store.getSnapshot().decks[0]?.deck.name).toBe("Remote");
    expect(store.getSnapshot().conflict?.local.name).toBe("Mine");
    const copy = setup([item("Remote")]);
    copy.store.restore(persist.mock.calls.at(-1)?.[0] as string);
    expect(copy.store.getSnapshot().conflict?.local.name).toBe("Mine");
    const url = store.resolveConflict(true);
    expect(url).toBeTruthy();
    expect(store.getSnapshot().decks[0]?.deck.name).toBe("Mine (your copy)");
    await store.flush();
    copy.store.resolveConflict(false);
    expect(copy.store.getSnapshot().conflict).toBeNull();
    expect(copy.store.resolveConflict(true)).toBeUndefined();
    store.dispose();
    copy.store.dispose();
  });
  it("restores only valid scoped drafts, reports corruption and survives unavailable device storage", async () => {
    const { store, report } = setup();
    store.restore("invalid");
    expect(report).toHaveBeenCalled();
    store.restore(
      JSON.stringify([
        item("Recovered"),
        { ...item(), url: "https://elsewhere.example/a" },
        { ...item(), etag: null },
      ]),
    );
    expect(store.getSnapshot().decks[0]?.deck.name).toBe("Recovered");
    await store.flush();
    const blocked = new SlidesStore(setup().repo, [item()], report, () => {
      throw Error("quota");
    });
    blocked.edit(item().url, newDeck("Still usable"));
    expect(report).toHaveBeenCalledWith(expect.stringContaining("storage is full"));
    await blocked.flush();
    store.dispose();
    blocked.dispose();
  });
});
describe("delete with undo", () => {
  it("updates the library at once and can undo before the delayed delete", async () => {
    const { store, repo } = setup();
    store.remove(item().url);
    expect(store.getSnapshot().decks).toEqual([]);
    store.undo(item().url);
    expect(store.getSnapshot().decks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(repo.remove).not.toHaveBeenCalled();
    store.remove("unknown");
    store.undo("unknown");
    store.dispose();
  });
  it("deletes after the undo window and restores on failure", async () => {
    const { store, repo, report } = setup();
    vi.mocked(repo.remove).mockRejectedValueOnce(new Error("denied"));
    store.remove(item().url);
    await vi.advanceTimersByTimeAsync(6000);
    expect(store.getSnapshot().decks).toHaveLength(1);
    expect(report).toHaveBeenCalledWith(expect.stringContaining("restored"));
    store.remove(item().url);
    await vi.advanceTimersByTimeAsync(6000);
    expect(store.getSnapshot().decks).toHaveLength(0);
    store.dispose();
  });
  it("handles drafts deleted before saving, pending edits undone, and creations deleted in flight", async () => {
    const { store, repo } = setup([]);
    const url = store.add(newDeck());
    store.remove(url);
    await vi.advanceTimersByTimeAsync(6000);
    expect(repo.remove).not.toHaveBeenCalled();
    expect(store.getSnapshot().pending).toBe(0);
    const draft = store.add(newDeck("Undo me"));
    store.remove(draft);
    store.undo(draft);
    await store.flush();
    let finish!: (value: StoredDeck) => void;
    vi.mocked(repo.create).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const last = store.add(newDeck("Last"));
    const save = store.flush();
    store.remove(last);
    finish({ ...item("Last"), url: `${container}new.ttl` });
    await save;
    await vi.advanceTimersByTimeAsync(6000);
    expect(repo.remove).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${container}new.ttl` }),
    );
    store.dispose();
  });
  it("restores deletion intents across navigation", async () => {
    const { store, persist } = setup();
    store.remove(item().url);
    const saved = persist.mock.calls.at(-1)?.[0] as string;
    store.dispose();
    const next = setup();
    next.store.restore(saved);
    expect(next.store.getSnapshot().decks).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(6000);
    expect(next.repo.remove).toHaveBeenCalled();
    next.store.dispose();
  });
});
it("sends a separate keepalive flight during a normal save and coalesces teardown duplicates", async () => {
  const { store, repo } = setup();
  let ordinary!: (value: StoredDeck) => void;
  let emergency!: (value: StoredDeck) => void;
  vi.mocked(repo.save)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          ordinary = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          emergency = resolve;
        }),
    );
  const draft = newDeck("Latest");
  store.edit(item().url, draft);
  const first = store.flush();
  const exit = store.flush(true);
  expect(exit).not.toBe(first);
  expect(store.flush(true)).toBe(exit);
  emergency({ ...item(), deck: draft, etag: '"2"' });
  await exit;
  ordinary({ ...item(), deck: draft, etag: '"2"' });
  await first;
  expect(store.getSnapshot().pending).toBe(0);
  store.dispose();
});
it("keeps an unsaved creation durable when an unload cannot complete its two-step create", async () => {
  const { store, repo } = setup([]);
  let finish!: (value: StoredDeck) => void;
  vi.mocked(repo.create).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  store.add(newDeck());
  const first = store.flush();
  await store.flush(true);
  expect(repo.create).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().pending).toBe(1);
  finish(item());
  await first;
  store.dispose();
});
it("reconciles a duplicate-save conflict when the pod already holds the latest local draft", async () => {
  const { store, repo } = setup();
  const draft = newDeck("Already saved");
  store.edit(item().url, draft);
  const actual = store.getSnapshot().decks[0] as StoredDeck;
  vi.mocked(repo.save).mockRejectedValueOnce(
    new DeckConflictError(draft, { ...actual, etag: '"2"' }),
  );
  await store.flush();
  expect(store.getSnapshot().conflict).toBeNull();
  expect(store.getSnapshot().pending).toBe(0);
  store.dispose();
});
it("ignores corrupt deletion intents and preserves other records while restoring or editing", async () => {
  const second = { ...item("Other"), url: `${container}two.ttl` };
  const { store } = setup([item(), second]);
  store.restore(
    JSON.stringify({
      drafts: [],
      trash: [
        { url: "https://elsewhere.example/", deadline: 100 },
        { url: item().url, deadline: "bad" },
      ],
    }),
  );
  store.edit(item().url, newDeck("One"));
  expect(store.getSnapshot().decks[1]?.deck.name).toBe("Other");
  store.remove(item().url);
  store.undo(item().url);
  await store.flush();
  store.dispose();
  const plain = new SlidesStore(setup().repo, [], vi.fn());
  plain.add(newDeck());
  await plain.flush();
  plain.dispose();
});
it("waits for a creation before a delayed deletion and can remove orphan dirty keys", async () => {
  const { store, repo } = setup([]);
  let finish!: (value: StoredDeck) => void;
  vi.mocked(repo.create).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const url = store.add(newDeck());
  const pending = store.flush();
  store.remove(url);
  await vi.advanceTimersByTimeAsync(6000);
  finish(item());
  await pending;
  await Promise.resolve();
  expect(repo.remove).toHaveBeenCalled();
  store.edit("unknown", newDeck());
  await store.flush();
  expect(store.getSnapshot().pending).toBe(0);
  store.dispose();
});
it("keeps a deleted deck's conflicting draft safe without changing other presentations", async () => {
  const { store, repo } = setup([item(), { ...item("Other"), url: `${container}other.ttl` }]);
  let fail!: (error: Error) => void;
  vi.mocked(repo.save).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  store.edit(item().url, newDeck("Unsaved"));
  const saving = store.flush();
  store.remove(item().url);
  fail(new DeckConflictError(newDeck("Unsaved"), item("Remote")));
  await saving;
  expect(store.getSnapshot().conflict?.local.name).toBe("Unsaved");
  expect(store.getSnapshot().decks[0]?.deck.name).toBe("Other");
  store.undo(item().url);
  store.dispose();
});
it("honours undo while an expired deletion waits for its in-flight save", async () => {
  const { store, repo } = setup();
  let finish!: (value: StoredDeck) => void;
  vi.mocked(repo.save).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  store.edit(item().url, newDeck("Pending"));
  const saving = store.flush();
  store.remove(item().url);
  await vi.advanceTimersByTimeAsync(6000);
  store.undo(item().url);
  finish({ ...item("Pending"), etag: '"2"' });
  await saving;
  await Promise.resolve();
  expect(repo.remove).not.toHaveBeenCalled();
  expect(store.getSnapshot().decks).toHaveLength(1);
  store.dispose();
});

const other = (name = "Other"): StoredDeck => ({ ...item(name), url: `${container}two.ttl` });
const withImage = (deck: Deck, image: string): Deck => ({
  ...deck,
  slides: deck.slides.map((slide) => ({ ...slide, image, layout: "image" as const })),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("overlapping saves", () => {
  it("queues a hidden-tab keepalive save behind the save in flight instead of racing it", async () => {
    const { store, repo } = setup();
    const first = deferred<StoredDeck>();
    vi.mocked(repo.save).mockImplementationOnce(() => first.promise);
    store.edit(item().url, newDeck("A"));
    const saving = store.flush();
    store.edit(item().url, newDeck("B"));
    const hidden = store.flush(true, false);
    expect(store.flush(true, false)).toBe(hidden);
    expect(repo.save).toHaveBeenCalledTimes(1);
    first.resolve({ ...item("A"), etag: '"2"' });
    await saving;
    await hidden;
    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(repo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ etag: '"2"' }),
      expect.objectContaining({ name: "B" }),
      true,
    );
    expect(store.getSnapshot()).toMatchObject({ pending: 0, conflict: null });
    // Nothing left to save: the queued flush finishes without another request.
    const idle = deferred<StoredDeck>();
    vi.mocked(repo.save).mockImplementationOnce(() => idle.promise);
    store.edit(item().url, newDeck("C"));
    const last = store.flush();
    const queued = store.flush(true, false);
    idle.resolve({ ...item("C"), etag: '"3"' });
    await last;
    await queued;
    expect(repo.save).toHaveBeenCalledTimes(3);
    store.dispose();
  });
  it("continues from its own earlier snapshot after a 412 instead of reporting a false conflict", async () => {
    const { store, repo, report } = setup();
    const first = deferred<StoredDeck>();
    const a = newDeck("A");
    vi.mocked(repo.save)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async (_current, deck) => {
        // The page-teardown flight lost the race to the ordinary save of A.
        throw new DeckConflictError(deck, { ...item("A"), deck: a, etag: '"2"' });
      });
    store.edit(item().url, a);
    const saving = store.flush();
    store.edit(item().url, newDeck("B"));
    const exit = store.flush(true);
    await exit;
    expect(repo.save).toHaveBeenCalledTimes(3);
    expect(repo.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ etag: '"2"' }),
      expect.objectContaining({ name: "B" }),
      true,
    );
    first.resolve({ ...item("A"), deck: a, etag: '"2"' });
    await saving;
    expect(store.getSnapshot().conflict).toBeNull();
    expect(report).not.toHaveBeenCalled();
    store.dispose();
  });
  it("still reports a conflict when the pod holds someone else's version", async () => {
    const { store, repo } = setup();
    vi.mocked(repo.save).mockImplementation(async (_current, deck) => {
      throw new DeckConflictError(deck, { ...item("Theirs"), etag: '"9"' });
    });
    store.edit(item().url, newDeck("Mine"));
    await store.flush();
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().conflict?.local.name).toBe("Mine");
    store.dispose();
  });
  it("stops retrying its own versions after a bounded number of attempts", async () => {
    const { store, repo } = setup();
    let firstSent: Deck | undefined;
    let edits = 0;
    vi.mocked(repo.save).mockImplementation(async (current, deck) => {
      firstSent ??= deck;
      // Keep editing while the pod keeps answering with the first snapshot this store sent.
      store.edit(item().url, newDeck(`Mine-${++edits + 1}`));
      throw new DeckConflictError(deck, { ...current, deck: firstSent, etag: '"5"' });
    });
    store.edit(item().url, newDeck("Mine-1"));
    await store.flush();
    expect(repo.save).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().conflict?.local.name).toBe("Mine-4");
    store.dispose();
  });
  it("explains when the pod gives no strong version to save with", async () => {
    const { store, repo, report } = setup();
    vi.mocked(repo.save).mockRejectedValueOnce(new DeckVersionError());
    store.edit(item().url, newDeck("Weak"));
    await store.flush();
    expect(store.getSnapshot()).toMatchObject({ error: true, pending: 1 });
    expect(report).toHaveBeenCalledWith(expect.stringContaining("can't save over it safely"));
    store.dispose();
  });
});
describe("several conflicts", () => {
  it("keeps one conflict per presentation and resolves them one at a time, durably", async () => {
    const { store, repo, persist } = setup([item(), other()]);
    vi.mocked(repo.save).mockImplementation(async (current, deck) => {
      throw new DeckConflictError(deck, {
        ...current,
        deck: newDeck(`${current.url.endsWith("one.ttl") ? "One" : "Two"} remote`),
        etag: '"9"',
      });
    });
    store.edit(item().url, newDeck("One mine"));
    store.edit(other().url, newDeck("Two mine"));
    await store.flush();
    await store.flush();
    expect(store.getSnapshot().conflicts.map((entry) => entry.local.name)).toEqual([
      "One mine",
      "Two mine",
    ]);
    expect(store.getSnapshot().conflict?.local.name).toBe("One mine");
    const saved = persist.mock.calls.at(-1)?.[0] as string;
    const copy = setup([item(), other()]);
    copy.store.restore(saved);
    expect(copy.store.getSnapshot().conflicts).toHaveLength(2);
    expect(store.resolveConflict(true)).toBeTruthy();
    expect(store.getSnapshot().conflict?.local.name).toBe("Two mine");
    expect(store.resolveConflict(false)).toBeUndefined();
    expect(store.getSnapshot().conflicts).toEqual([]);
    expect(store.getSnapshot().decks.map((entry) => entry.deck.name)).toContain(
      "One mine (your copy)",
    );
    store.dispose();
    copy.store.dispose();
  });
  it("keeps the first local copy when the same presentation conflicts again", async () => {
    const { store, persist } = setup();
    const first = {
      url: item().url,
      local: newDeck("First edits"),
      remote: { ...item("Remote 1"), etag: '"5"' },
    };
    const second = {
      ...first,
      local: newDeck("Later"),
      remote: { ...item("Remote 2"), etag: '"6"' },
    };
    const elsewhere = {
      url: other().url,
      local: newDeck("Elsewhere"),
      remote: { ...other("Remote 3"), etag: '"7"' },
    };
    store.restore(JSON.stringify({ conflicts: [elsewhere, first], conflict: second }));
    expect(store.getSnapshot().conflicts).toHaveLength(2);
    expect(store.resolveConflict(false)).toBeUndefined();
    expect(store.getSnapshot().conflict?.local.name).toBe("First edits");
    expect(store.getSnapshot().conflict?.remote.deck.name).toBe("Remote 2");
    expect(JSON.parse(persist.mock.calls.at(-1)?.[0] as string).conflicts).toHaveLength(1);
    store.dispose();
  });
});
describe("draft recovery", () => {
  it("restores every valid entry even when one is undecodable", async () => {
    const { store, report } = setup([item(), other()]);
    store.restore(
      JSON.stringify({
        drafts: [
          { ...item(), deck: { name: "broken" } },
          { ...other(), deck: newDeck("Recovered") },
          "not an entry",
        ],
        conflicts: [{ url: item().url, local: {}, remote: item() }],
        trash: [{ url: item().url, deadline: Date.now() + 6000, item: { url: item().url } }],
      }),
    );
    expect(store.getSnapshot().decks.find((entry) => entry.url === other().url)?.deck.name).toBe(
      "Recovered",
    );
    expect(store.getSnapshot().pending).toBe(1);
    expect(store.getSnapshot().conflicts).toEqual([]);
    expect(store.getSnapshot().decks).toHaveLength(2);
    expect(report).toHaveBeenCalledWith(expect.stringContaining("saved draft"));
    report.mockClear();
    store.restore(JSON.stringify(null));
    expect(report).toHaveBeenCalledTimes(1);
    store.dispose();
  });
  it("exposes presentations the listing could not open", () => {
    const repo = setup().repo;
    const broken = [{ url: `${container}bad.ttl`, reason: "invalid" as const }];
    const store = new SlidesStore(repo, [], vi.fn(), vi.fn(), broken);
    expect(store.getSnapshot().broken).toEqual(broken);
    expect(setup().store.getSnapshot().broken).toEqual([]);
  });
});
describe("cleanup", () => {
  it("carries out a confirmed deletion on dispose instead of dropping it", async () => {
    const { store, repo } = setup();
    store.remove(item().url);
    store.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(repo.remove).toHaveBeenCalledWith(expect.objectContaining({ url: item().url }));
    await vi.advanceTimersByTimeAsync(6000);
    expect(repo.remove).toHaveBeenCalledTimes(1);
  });
  it("removes a deleted deck's uploads that no other presentation shows", async () => {
    const shared = `${container}shared.png`;
    const own = `${container}own.png`;
    const first = { ...item(), deck: withImage(newDeck("A"), own) };
    first.deck.slides.push({ ...first.deck.slides[0], id: "second", image: shared } as never);
    const second = { ...other(), deck: withImage(newDeck("B"), shared) };
    const { store, repo } = setup([first, second]);
    store.remove(first.url);
    await vi.advanceTimersByTimeAsync(6000);
    expect(repo.removeUploads).toHaveBeenCalledWith([own]);
    vi.mocked(repo.removeUploads).mockRejectedValueOnce(new Error("offline"));
    store.remove(second.url);
    await vi.advanceTimersByTimeAsync(6000);
    expect(repo.removeUploads).toHaveBeenLastCalledWith([shared]);
    expect(store.getSnapshot().decks).toEqual([]);
    store.dispose();
  });
  it("keeps uploads a deck in the undo window or a conflict still uses", async () => {
    const image = `${container}kept.png`;
    const first = { ...item(), deck: withImage(newDeck("A"), image) };
    const second = { ...other(), deck: withImage(newDeck("B"), image) };
    const { store, repo } = setup([first, second]);
    store.restore(
      JSON.stringify({
        conflicts: [{ url: item().url, local: withImage(newDeck("L"), image), remote: item() }],
      }),
    );
    store.remove(first.url);
    await vi.advanceTimersByTimeAsync(3000);
    store.remove(second.url);
    await vi.advanceTimersByTimeAsync(3000);
    expect(repo.removeUploads).toHaveBeenLastCalledWith([]);
    store.dispose();
  });
});
