// AUTHORED-BY Claude Opus 5.5
import { expect, it, vi } from "vitest";
import { createDraftStorage } from "../../src/apps/slides/state/draft-storage";

const key = "solid-slides:drafts:test";
const record = (name: string) =>
  JSON.stringify({ drafts: [{ url: `https://pod.example/slides/${name}.ttl` }] });
const empty = JSON.stringify({ drafts: [], conflicts: [], trash: [] });
function memory() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => void values.set(name, value),
    removeItem: (name: string) => void values.delete(name),
  } as unknown as Storage;
  return { values, storage: () => storage };
}
/** A Web Locks stand-in: a lock is held until its callback's promise settles. */
function lockManager() {
  const held = new Set<string>();
  return {
    held,
    request: vi.fn(async (name: string, callback: () => Promise<void>) => {
      held.add(name);
      try {
        await callback();
      } finally {
        held.delete(name);
      }
    }),
    query: vi.fn(async () => ({ held: [...held].map((name) => ({ name })) })),
  };
}

it("keeps each window's drafts when two tabs write the same key", async () => {
  const { values, storage } = memory();
  const a = createDraftStorage(key, { storage, locks: null, id: "a" });
  const b = createDraftStorage(key, { storage, locks: null, id: "b" });
  a.save(record("one"));
  b.save(record("two"));
  b.save(empty);
  const saved = JSON.parse(values.get(key) as string);
  expect(Object.keys(saved.windows)).toEqual(["a"]);
  expect(saved.windows.a.value).toBe(record("one"));
  a.save(empty);
  expect(values.has(key)).toBe(false);
});
it("adopts drafts from closed windows only, using Web Locks to tell which are open", async () => {
  const { storage } = memory();
  const locks = lockManager();
  const open = createDraftStorage(key, { storage, locks, id: "open" });
  const closed = createDraftStorage(key, { storage, locks, id: "closed" });
  open.save(record("open"));
  closed.save(record("closed"));
  await vi.waitFor(() => expect(locks.held.size).toBe(2));
  closed.dispose();
  await vi.waitFor(() => expect(locks.held.size).toBe(1));
  const next = createDraftStorage(key, { storage, locks, id: "next" });
  expect(await next.load()).toEqual([record("closed")]);
  next.save(record("closed"));
  const saved = JSON.parse(storage().getItem(key) as string);
  expect(Object.keys(saved.windows).sort()).toEqual(["next", "open"]);
  // A second new window finds nothing left to adopt from the closed one.
  const later = createDraftStorage(key, { storage, locks, id: "later" });
  expect(await later.load()).toEqual([]);
  open.dispose();
  next.dispose();
  later.dispose();
});
it("treats a lock query without a held list as no open windows", async () => {
  const { storage } = memory();
  createDraftStorage(key, { storage, locks: null, id: "gone", now: Date.now }).save(record("gone"));
  const locks = {
    request: vi.fn(async (_name: string, callback: () => Promise<void>) => {
      void callback();
    }),
    query: vi.fn(async () => ({})),
  };
  expect(await createDraftStorage(key, { storage, locks, id: "new" }).load()).toEqual([
    record("gone"),
  ]);
  locks.query.mockResolvedValueOnce({ held: [{}] } as never);
  expect(await createDraftStorage(key, { storage, locks, id: "unnamed" }).load()).toEqual([
    record("gone"),
  ]);
});
it("falls back to entry age without Web Locks, and when a lock query fails", async () => {
  const { storage } = memory();
  let time = 1_000_000;
  const now = () => time;
  createDraftStorage(key, { storage, locks: null, id: "old", now }).save(record("old"));
  const fresh = createDraftStorage(key, {
    storage,
    locks: null,
    id: "fresh",
    now,
    staleAfter: 100,
  });
  expect(await fresh.load()).toEqual([]);
  time += 101;
  expect(await fresh.load()).toEqual([record("old")]);
  const failing = {
    request: vi.fn(async () => {
      throw new Error("blocked");
    }),
    query: vi.fn(async () => {
      throw new Error("blocked");
    }),
  };
  const broken = createDraftStorage(key, { storage, locks: failing, id: "x", now, staleAfter: 1 });
  expect(await broken.load()).toEqual([record("old")]);
  broken.dispose();
});
it("offers a legacy or unreadable record once, then replaces it", async () => {
  const { values, storage } = memory();
  values.set(key, "corrupt");
  const window = createDraftStorage(key, { storage, locks: null, id: "w" });
  expect(await window.load()).toEqual(["corrupt"]);
  window.save(empty);
  expect(values.has(key)).toBe(false);
  values.set(
    key,
    JSON.stringify({
      version: 2,
      windows: { bad: { value: 1 }, ok: { at: 0, value: record("ok") }, w: { at: 0, value: "x" } },
    }),
  );
  expect(await window.load()).toEqual([record("ok")]);
  expect(await createDraftStorage(key, { storage, locks: null, id: "z" }).load()).toEqual([
    record("ok"),
    "x",
  ]);
});
it("treats records with any entry, legacy arrays and unparsable values as worth keeping", () => {
  const { values, storage } = memory();
  const window = createDraftStorage(key, { storage, locks: null, id: "w" });
  for (const value of [
    JSON.stringify([{}]),
    JSON.stringify({ trash: [{}] }),
    JSON.stringify({ conflict: {} }),
    "not json",
  ]) {
    window.save(value);
    expect(values.has(key)).toBe(true);
  }
  window.save(JSON.stringify([]));
  expect(values.has(key)).toBe(false);
});
it("uses browser storage and Web Locks by default", async () => {
  const { values, storage } = memory();
  vi.stubGlobal("localStorage", storage());
  try {
    const window = createDraftStorage(key);
    window.save(record("default"));
    expect(values.get(key)).toContain("default");
    // The shared lock stub has no query(), so liveness falls back to entry age.
    expect(await createDraftStorage(key, { staleAfter: 0 }).load()).toEqual([record("default")]);
    window.dispose();
    for (const navigator of [undefined, {}]) {
      vi.stubGlobal("navigator", navigator);
      const plain = createDraftStorage(key, { staleAfter: 0 });
      expect(await plain.load()).toEqual([record("default")]);
      plain.dispose();
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
