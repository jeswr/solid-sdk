// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  type Deck,
  DeckConflictError,
  type DeckRepository,
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
