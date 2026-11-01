// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import { newIntent } from "../src/apps/contacts/state/intents";
import { browserIntentStorage, IntentJournal } from "../src/apps/contacts/state/journal";
import { BOOK, MemoryIntentStorage, ROOT } from "./contacts-support";

afterEach(() => vi.unstubAllGlobals());
const WEBID = `${ROOT}profile/card#me`;
describe("Contacts durable journal storage", () => {
  it("stores each intent independently, reads sorted records and ignores unrelated and disappearing keys", () => {
    const storage = new MemoryIntentStorage();
    const journal = new IntentJournal(WEBID, BOOK, vi.fn(), () => storage);
    const first = newIntent("book", BOOK, BOOK);
    first.startedAt = "2026-01-01";
    const last = newIntent("book", BOOK, BOOK);
    last.startedAt = "2026-02-01";
    journal.put(last);
    journal.put(first);
    storage.setItem("other", "unrelated");
    expect(journal.list().map((item) => item.id)).toEqual([first.id, last.id]);
    journal.remove(first);
    expect(journal.list()).toEqual([last]);
    vi.spyOn(storage, "getItem").mockReturnValue(null);
    expect(journal.list()).toEqual([]);
    vi.spyOn(storage, "key").mockReturnValue(null);
    expect(journal.list()).toEqual([]);
  });
  it.each([
    "get",
    "set",
    "remove",
  ])("falls back to shared memory with one visible warning when storage %s throws", (failure) => {
    const webId = `https://${crypto.randomUUID()}.example/#me`;
    const storage = new MemoryIntentStorage();
    const warn = vi.fn();
    const journal = new IntentJournal(webId, BOOK, warn, () => storage);
    const intent = newIntent("book", BOOK, BOOK);
    journal.put(intent);
    if (failure === "get")
      vi.spyOn(storage, "getItem").mockImplementation(() => {
        throw new Error("disabled");
      });
    if (failure === "set")
      vi.spyOn(storage, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
    if (failure === "remove")
      vi.spyOn(storage, "removeItem").mockImplementation(() => {
        throw new Error("disabled");
      });
    if (failure === "remove") {
      journal.remove(intent);
      expect(journal.list()).toEqual([]);
    } else {
      journal.list();
      journal.put(intent);
      expect(journal.list()).toEqual([intent]);
      const remounted = new IntentJournal(webId, BOOK, vi.fn(), () => {
        throw new Error("disabled");
      });
      expect(remounted.list()).toEqual([intent]);
      remounted.remove(intent);
      expect(journal.list()).toEqual([]);
    }
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("lost on reload"));
  });
  it("handles a throwing localStorage getter and uses the browser's default storage when available", () => {
    const intent = newIntent("book", BOOK, BOOK);
    const storage = new MemoryIntentStorage();
    vi.stubGlobal("localStorage", storage);
    expect(browserIntentStorage()).toBe(storage);
    const journal = new IntentJournal(WEBID, BOOK, vi.fn());
    journal.put(intent);
    expect(journal.list()).toEqual([intent]);
    journal.remove(intent);
    const warn = vi.fn();
    const unavailable = new IntentJournal(`${WEBID}-unavailable`, BOOK, warn, () => {
      throw new Error("blocked getter");
    });
    unavailable.put(intent);
    expect(unavailable.list()).toEqual([intent]);
    unavailable.remove(intent);
    expect(warn).toHaveBeenCalledOnce();
  });
  it.each([
    "new",
    "checkpoint",
    "remove",
  ])("preserves %s fallback records across remounts when storage writes fail but reads succeed", (change) => {
    const webId = `https://${crypto.randomUUID()}.example/#me`;
    const storage = new MemoryIntentStorage();
    const warn = vi.fn();
    const journal = new IntentJournal(webId, BOOK, warn, () => storage);
    const existing = newIntent("book", BOOK, BOOK);
    journal.put(existing);
    expect(journal.list()).toEqual([existing]);
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(storage, "removeItem").mockImplementation(() => {
      throw new Error("read only");
    });
    const dirty = change === "new" ? newIntent("book", BOOK, BOOK) : existing;
    dirty.completed.push("book");
    if (change === "remove") journal.remove(dirty);
    else journal.put(dirty);
    const expected = change === "remove" ? [] : change === "new" ? [existing, dirty] : [dirty];
    const remountWarning = vi.fn();
    const remounted = new IntentJournal(webId, BOOK, remountWarning, () => storage);
    expect(remounted.list()).toEqual(expected);
    expect(journal.list()).toEqual(expected);
    // Persistent storage still holds its old checkpoint; it must not replace dirty memory.
    expect(JSON.parse(storage.getItem(journal.prefix + existing.id) as string).completed).toEqual(
      [],
    );
    for (const intent of expected) remounted.remove(intent);
    expect(new IntentJournal(webId, BOOK, vi.fn(), () => storage).list()).toEqual([]);
    expect(journal.list()).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(remountWarning).not.toHaveBeenCalled();
    expect(new IntentJournal(`${webId}-other`, BOOK, vi.fn(), () => storage).list()).toEqual([]);
  });
  it("refuses corrupted or mismatched recovery instead of abandoning it", () => {
    const storage = new MemoryIntentStorage();
    const journal = new IntentJournal(WEBID, BOOK, vi.fn(), () => storage);
    const intent = newIntent("book", BOOK, BOOK);
    storage.setItem(journal.prefix + intent.id, "{");
    expect(() => journal.list()).toThrow();
    storage.setItem(journal.prefix + intent.id, JSON.stringify({ ...intent, id: "other" }));
    expect(() => journal.list()).toThrow("invalid");
    storage.setItem(journal.prefix + intent.id, JSON.stringify({ ...intent, bookUrl: "other" }));
    expect(() => journal.list()).toThrow("invalid");
  });
  it("serializes controller lifetimes, continues after failure and coordinates through Web Locks", async () => {
    const journal = new IntentJournal(WEBID, BOOK, vi.fn(), () => new MemoryIntentStorage());
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => callback());
    vi.stubGlobal("navigator", { locks: { request } });
    const calls: number[] = [];
    const first = journal.lock(async () => {
      calls.push(1);
      throw new Error("first failed");
    });
    const second = journal.lock(async () => {
      calls.push(2);
      return "second";
    });
    await expect(first).rejects.toThrow("first failed");
    expect(await second).toBe("second");
    expect(calls).toEqual([1, 2]);
    expect(request).toHaveBeenCalledTimes(2);
    vi.stubGlobal("navigator", {});
    expect(await journal.lock(async () => "fallback")).toBe("fallback");
  });
});
