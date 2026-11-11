// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { createNotesStore } from "../src/apps/notes/lib/model/store";
import { createMemoryFiredStore } from "../src/apps/notes/lib/reminders/fired-store";
import { createReminderScheduler } from "../src/apps/notes/lib/reminders/scheduler";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { deferred } from "./drive-ui-dom";

const webId = "https://pod.example/profile/card#me";
const key = `suite.notes.pending-drafts.${webId}`;
const noteKey = `${key}:https://pod.example/notes/reload.ttl:tab-a`;
const note: StoredNote = {
  url: "https://pod.example/notes/reload.ttl",
  title: "Pod copy",
  body: "Old body",
  labels: [],
  etag: '"v1"',
  location: "active",
  format: "text/html",
  revisions: [],
};
const draft = { title: "Latest keystroke", body: "Latest body", labels: ["A"] };
const events = new Map<string, EventListener>();
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(
    "tab-a" as `${string}-${string}-${string}-${string}-${string}`,
  );
  vi.useFakeTimers();
  events.clear();
  vi.spyOn(window, "addEventListener").mockImplementation((name, listener) => {
    events.set(name, listener as EventListener);
  });
  vi.spyOn(document, "addEventListener").mockImplementation((name, listener) => {
    events.set(name, listener as EventListener);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function registry() {
  const module = await import("../src/apps/notes/state/draft-registry");
  return module.getPendingDrafts(webId);
}

it("durably records before the debounce; reload recovers the latest draft and its original ETag", async () => {
  const pending = await registry();
  expect(await registry()).toBe(pending);
  pending.change(note, draft, vi.fn());
  const stored = JSON.parse(localStorage.getItem(noteKey) as string);
  expect(stored).toEqual({
    version: 3,
    webId,
    tabId: "tab-a",
    updatedAt: expect.any(Number),
    revision: expect.any(String),
    snapshot: { note, draft, status: "saving" },
    claims: [],
  });
  expect(localStorage.getItem(key)).toBeNull();
  // The old page's pagehide released its heartbeat, so the reload keeps its tab id.
  localStorage.removeItem("suite.notes.heartbeat:tab-a");
  vi.resetModules();
  const reloaded = await registry();
  expect(reloaded.get(note.url)).toEqual(stored.snapshot);
  const saved = { ...note, ...draft, etag: '"v2"' };
  const saving = deferred<StoredNote>();
  const save = vi.fn().mockReturnValue(saving.promise);
  reloaded.bind(note, save);
  events.get("online")?.(new Event("online"));
  events.get("pagehide")?.(new Event("pagehide"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  events.get("visibilitychange")?.(new Event("visibilitychange"));
  expect(save).toHaveBeenCalledExactlyOnceWith(note, draft, '"v1"');
  const unload = new Event("beforeunload", { cancelable: true });
  events.get("beforeunload")?.(unload);
  expect(unload.defaultPrevented).toBe(true);
  saving.resolve(saved);
  await reloaded.retry();
  expect(localStorage.getItem(noteKey)).toBeNull();
  const cleanUnload = new Event("beforeunload", { cancelable: true });
  events.get("beforeunload")?.(cleanUnload);
  expect(cleanUnload.defaultPrevented).toBe(false);
});

it("restores conflict state after reload without attempting to overwrite the remote note", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({ version: 1, webId, drafts: [{ note, draft, status: "conflict" }] }),
  );
  const pending = await registry();
  const save = vi.fn();
  pending.bind(note, save);
  await pending.retry();
  expect(save).not.toHaveBeenCalled();
  expect(pending.get(note.url)).toMatchObject({ draft, status: "conflict" });
  expect(localStorage.getItem(key)).toBeNull();
  expect(JSON.parse(localStorage.getItem(noteKey) as string).snapshot.status).toBe("conflict");
});

it.each(["{", '[{"bad":"shape"}]'])("ignores damaged storage (%s)", async (text) => {
  localStorage.setItem(key, text);
  expect((await registry()).all()).toEqual([]);
});

it("retains the in-memory draft and unload warning when storage is unavailable", async () => {
  vi.spyOn(window.Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Unavailable");
  });
  vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Full");
  });
  const pending = await registry();
  const save = vi.fn().mockRejectedValue(new Error("Offline"));
  pending.change(note, draft, save);
  expect(pending.get(note.url)?.draft).toEqual(draft);
  const unload = new Event("beforeunload", { cancelable: true });
  events.get("beforeunload")?.(unload);
  expect(unload.defaultPrevented).toBe(true);
  await pending.retry();
  expect(pending.get(note.url)?.draft).toEqual(draft);
});

it("never hydrates another identity's draft from memory or a copied durable envelope", async () => {
  const pending = await registry();
  pending.change(note, draft, vi.fn());
  const module = await import("../src/apps/notes/state/draft-registry");
  const other = "https://pod.example/profile/card#other";
  localStorage.setItem(
    `suite.notes.pending-drafts.${other}:${note.url}`,
    localStorage.getItem(noteKey) as string,
  );
  expect(module.getPendingDrafts(other).all()).toEqual([]);
  expect(module.getPendingDrafts(webId).get(note.url)?.draft).toEqual(draft);
});

async function independent(tabId: string, now = () => 1_000) {
  const { createDraftRegistry } = await import("../src/apps/notes/state/draft-registry");
  return createDraftRegistry(webId, {
    storage: localStorage,
    tabId,
    now,
  });
}

it("keeps tab A's unsuccessful X draft when an already-open tab B saves Y", async () => {
  const a = await independent("tab-a");
  const b = await independent("tab-b");
  const offline = vi.fn().mockRejectedValue(new Error("Offline"));
  a.change(note, draft, offline);
  await a.retry();
  const x = localStorage.getItem(noteKey);
  const y = { ...note, url: "https://pod.example/notes/y.ttl" };
  const saveY = vi.fn(async () => ({ ...y, ...draft, etag: '"v2"' }));
  b.change(y, draft, saveY);
  await b.flush(y, saveY);
  expect(localStorage.getItem(noteKey)).toBe(x);
  expect(localStorage.getItem(`${key}:${y.url}:tab-b`)).toBeNull();
  expect((await independent("tab-a")).get(note.url)).toMatchObject({ draft, status: "failed" });
});

it("retains both failing drafts for the same note and reloads each tab's own text", async () => {
  const a = await independent("tab-a");
  const b = await independent("tab-b");
  const offline = vi.fn().mockRejectedValue(new Error("Offline"));
  const other = { ...draft, body: "B's unique text" };
  a.change(note, draft, offline);
  await a.retry();
  const aText = localStorage.getItem(noteKey);
  b.change(note, other, offline);
  await b.retry();
  expect(localStorage.getItem(noteKey)).toBe(aText);
  const reloadedA = await independent("tab-a");
  const reloadedB = await independent("tab-b");
  expect(reloadedA.get(note.url)?.draft).toEqual(draft);
  expect(reloadedB.get(note.url)?.draft).toEqual(other);
  const create = vi.fn();
  await reloadedA.recover(note, create);
  await reloadedB.recover(note, create);
  expect(create).not.toHaveBeenCalled();
  expect(reloadedA.get(note.url)?.draft).toEqual(draft);
  expect(reloadedB.get(note.url)?.draft).toEqual(other);
});

it("does not remove another tab's same-note draft when an older save completes", async () => {
  const a = await independent("tab-a");
  const b = await independent("tab-b");
  const writing = deferred<StoredNote>();
  const save = vi.fn().mockReturnValue(writing.promise);
  a.change(note, draft, save);
  const flushing = a.flush(note, save);
  const newer = { ...draft, body: "Tab B's newer body" };
  b.change(note, newer, vi.fn());
  const bKey = `${key}:${note.url}:tab-b`;
  const recovery = localStorage.getItem(bKey);
  writing.resolve({ ...note, ...draft, etag: '"v2"' });
  await flushing;
  expect(localStorage.getItem(noteKey)).toBeNull();
  expect(localStorage.getItem(bKey)).toBe(recovery);
  expect((await independent("tab-b")).get(note.url)?.draft).toEqual(newer);
});

it("does not rewrite an unchanged draft when persisting changes to another note", async () => {
  const a = await independent("tab-a");
  const b = await independent("tab-b");
  a.change(note, draft, vi.fn());
  b.change(note, { ...draft, body: "Newer from B" }, vi.fn());
  const older = localStorage.getItem(noteKey);
  const newer = localStorage.getItem(`${key}:${note.url}:tab-b`);
  a.change({ ...note, url: "https://pod.example/notes/y.ttl" }, draft, vi.fn());
  expect(localStorage.getItem(noteKey)).toBe(older);
  expect(localStorage.getItem(`${key}:${note.url}:tab-b`)).toBe(newer);
});

it("loads the newest orphan into the editor and saves every other orphan separately before clearing keys", async () => {
  let clock = 1_000;
  const now = () => clock;
  const a = await independent("tab-a", now);
  const b = await independent("tab-b", now);
  const live = await independent("live", now);
  const offline = vi.fn().mockRejectedValue(new Error("Offline"));
  a.change(note, draft, offline);
  await a.retry();
  clock = 2_000;
  const newest = { ...draft, title: "Newest", body: "B's orphan" };
  b.change(note, newest, offline);
  await b.retry();
  live.change(note, { ...draft, body: "Still editing" }, offline);
  const unrelated = { ...note, url: "https://pod.example/notes/other.ttl" };
  a.change(unrelated, draft, offline);
  clock = 32_000;
  live.heartbeat();
  const receiver = await independent("receiver", now);
  const creating = deferred<StoredNote>();
  const create = vi.fn().mockReturnValue(creating.promise);
  const recovery = receiver.recover(note, create);
  expect(receiver.recover(note, create)).toBe(recovery);
  expect(receiver.get(note.url)?.draft).toEqual(newest);
  expect(create).toHaveBeenCalledExactlyOnceWith({ ...draft, title: `${draft.title} (recovered)` });
  expect(localStorage.getItem(noteKey)).not.toBeNull();
  expect(localStorage.getItem(`${key}:${note.url}:tab-b`)).not.toBeNull();
  const liveText = localStorage.getItem(`${key}:${note.url}:live`);
  creating.resolve({ ...note, url: "https://pod.example/notes/recovered.ttl" });
  await recovery;
  expect(localStorage.getItem(noteKey)).toBeNull();
  expect(localStorage.getItem(`${key}:${unrelated.url}:tab-a`)).not.toBeNull();
  expect(localStorage.getItem(`${key}:${note.url}:live`)).toBe(liveText);
  await expect(receiver.flush(note, offline)).rejects.toThrow("Offline");
  expect(localStorage.getItem(`${key}:${note.url}:tab-b`)).not.toBeNull();
  const saved = { ...note, ...newest, etag: '"v2"' };
  await receiver.flush(
    note,
    vi.fn(async () => saved),
  );
  expect(localStorage.getItem(`${key}:${note.url}:tab-b`)).toBeNull();
  expect(localStorage.getItem(`${key}:${note.url}:receiver`)).toBeNull();
});

it("retains failed extra orphan recoveries for the next open and leaves 30-second-old heartbeats live", async () => {
  let clock = 1_000;
  const now = () => clock;
  const a = await independent("tab-a", now);
  const b = await independent("tab-b", now);
  a.change(note, draft, vi.fn());
  b.change(note, { ...draft, body: "Other" }, vi.fn());
  clock = 31_000;
  const receiver = await independent("receiver", now);
  const create = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(note);
  await receiver.recover(note, create);
  expect(receiver.get(note.url)).toBeUndefined();
  expect(create).not.toHaveBeenCalled();
  clock++;
  await receiver.recover(note, create);
  expect(create).toHaveBeenCalledOnce();
  expect(localStorage.getItem(`${key}:${note.url}:tab-b`)).not.toBeNull();
  await receiver.recover(note, create);
  expect(create).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem(`${key}:${note.url}:tab-b`)).toBeNull();
});

it("writes a heartbeat every 10 seconds while the browser registry is open", async () => {
  await registry();
  const before = Number(localStorage.getItem("suite.notes.heartbeat:tab-a"));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(Number(localStorage.getItem("suite.notes.heartbeat:tab-a"))).toBe(before + 10_000);
});

it("prefers per-note recovery to a legacy envelope and ignores damaged or miskeyed records", async () => {
  const a = await registry();
  a.change(note, draft, vi.fn());
  const latest = localStorage.getItem(noteKey) as string;
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      webId,
      drafts: [{ note, draft: { ...draft, body: "Older envelope" }, status: "saving" }],
    }),
  );
  localStorage.setItem(`${key}:bad`, "{");
  localStorage.setItem(`${key}:wrong-url`, latest);
  // The old page's pagehide released its heartbeat, so the reload keeps its tab id.
  localStorage.removeItem("suite.notes.heartbeat:tab-a");
  vi.resetModules();
  expect((await registry()).all()).toEqual([{ note, draft, status: "saving" }]);
  expect(localStorage.getItem(noteKey)).toBe(latest);
  expect(localStorage.getItem(key)).toBeNull();
});

it("migrates valid legacy recovery over a damaged per-note key", async () => {
  localStorage.setItem(
    key,
    JSON.stringify({ version: 1, webId, drafts: [{ note, draft, status: "failed" }] }),
  );
  localStorage.setItem(noteKey, "{");
  expect((await registry()).get(note.url)).toMatchObject({ draft, status: "failed" });
  expect(localStorage.getItem(key)).toBeNull();
  // The old page's pagehide released its heartbeat, so the reload keeps its tab id.
  localStorage.removeItem("suite.notes.heartbeat:tab-a");
  vi.resetModules();
  expect((await registry()).get(note.url)).toMatchObject({ draft, status: "failed" });
});

it("retains legacy recovery in memory and storage when migration cannot write", async () => {
  const legacy = JSON.stringify({ version: 1, webId, drafts: [{ note, draft, status: "failed" }] });
  localStorage.setItem(key, legacy);
  vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Full");
  });
  expect((await registry()).get(note.url)).toMatchObject({ draft, status: "failed" });
  expect(localStorage.getItem(key)).toBe(legacy);
});

it("migrates round-2 per-note drafts into this tab's key", async () => {
  const oldKey = `${key}:${note.url}`;
  localStorage.setItem(
    oldKey,
    JSON.stringify({
      version: 2,
      webId,
      revision: "old",
      snapshot: { note, draft, status: "failed" },
    }),
  );
  expect((await registry()).get(note.url)).toMatchObject({ draft, status: "failed" });
  expect(localStorage.getItem(oldKey)).toBeNull();
  expect(JSON.parse(localStorage.getItem(noteKey) as string).version).toBe(3);
});

it("keeps an orphan claim across reload and removes its source only after the note saves", async () => {
  let clock = 1_000;
  const now = () => clock;
  const a = await independent("tab-a", now);
  a.change(note, draft, vi.fn());
  clock = 31_001;
  const receiver = await independent("receiver", now);
  const create = vi.fn();
  await receiver.recover(note, create);
  const reloaded = await independent("receiver", now);
  await reloaded.recover(note, create);
  expect(create).not.toHaveBeenCalled();
  expect(localStorage.getItem(noteKey)).not.toBeNull();
  await reloaded.flush(
    note,
    vi.fn(async () => ({ ...note, ...draft, etag: '"v2"' })),
  );
  expect(localStorage.getItem(noteKey)).toBeNull();
  expect(localStorage.getItem(`${key}:${note.url}:receiver`)).toBeNull();
});

it("gives a duplicated tab a fresh ID, keeps a reloaded tab's ID, and never overwrites the other tab's draft", async () => {
  sessionStorage.setItem("suite.notes.tab-id", "copied-tab-id");
  const a = await registry();
  // No live heartbeat owns the stored id (a reload), so it is kept.
  expect(a.tabId).toBe("copied-tab-id");
  const unloadA = events.get("beforeunload");
  const save = vi.fn(async () => ({ ...note, ...draft, etag: '"v2"' }));
  a.change(note, draft, save);
  await a.flush(note, save);
  vi.resetModules();
  // The duplicate copies sessionStorage while A's heartbeat is live.
  const b = await registry();
  expect(b.tabId).not.toBe(a.tabId);
  expect(sessionStorage.getItem("suite.notes.tab-id")).toBe(b.tabId);
  const releaseB = events.get("pagehide");
  const bDraft = { ...draft, body: "B's unique unresolved conflict" };
  const { NoteConflictError } = await import("../src/apps/notes/lib/model/errors");
  const conflict = vi.fn().mockRejectedValue(new NoteConflictError(note.url));
  b.change(note, bDraft, conflict);
  await b.retry();
  const offline = vi.fn().mockRejectedValue(new Error("Offline"));
  a.change(note, { ...draft, body: "A's later failing edit" }, offline);
  await a.retry();
  unloadA?.(new Event("beforeunload", { cancelable: true }));
  await a.retry();
  events.get("beforeunload")?.(new Event("beforeunload", { cancelable: true }));
  await b.retry();
  const bKey = `${key}:${note.url}:${b.tabId}`;
  expect(JSON.parse(localStorage.getItem(bKey) as string).snapshot.draft).toEqual(bDraft);
  // Entering the back/forward cache keeps the page alive, so its heartbeat stays.
  releaseB?.(Object.assign(new Event("pagehide"), { persisted: true }));
  expect(localStorage.getItem(`suite.notes.heartbeat:${b.tabId}`)).not.toBeNull();
  // B reloads: its pagehide releases the heartbeat, so the reload keeps B's id and its conflict.
  releaseB?.(Object.assign(new Event("pagehide"), { persisted: false }));
  await b.retry();
  expect(localStorage.getItem(`suite.notes.heartbeat:${b.tabId}`)).toBeNull();
  vi.resetModules();
  const reloaded = await registry();
  expect(reloaded.tabId).toBe(b.tabId);
  expect(reloaded.get(note.url)).toMatchObject({ draft: bDraft, status: "conflict" });
  expect(
    JSON.parse(localStorage.getItem(`${key}:${note.url}:copied-tab-id`) as string).snapshot.draft
      .body,
  ).toBe("A's later failing edit");
  // Restored from the back/forward cache: the page is live again.
  events.get("pageshow")?.(Object.assign(new Event("pageshow"), { persisted: true }));
  expect(localStorage.getItem(`suite.notes.heartbeat:${b.tabId}`)).not.toBeNull();
  localStorage.removeItem(`suite.notes.heartbeat:${b.tabId}`);
  events.get("pageshow")?.(Object.assign(new Event("pageshow"), { persisted: false }));
  expect(localStorage.getItem(`suite.notes.heartbeat:${b.tabId}`)).toBeNull();
});

it("preserves an orphan's claims when its recovering page reloads with a new ID", async () => {
  let clock = 1_000;
  const now = () => clock;
  const a = await independent("tab-a", now);
  a.change(note, draft, vi.fn());
  clock = 31_001;
  const receiver = await independent("receiver", now);
  const create = vi.fn();
  await receiver.recover(note, create);
  clock = 61_002;
  const reloaded = await independent("new-page", now);
  await reloaded.recover(note, create);
  expect(reloaded.get(note.url)?.draft).toEqual(draft);
  expect(create).not.toHaveBeenCalled();
  await reloaded.flush(
    note,
    vi.fn(async () => ({ ...note, ...draft, etag: '"v2"' })),
  );
  expect(localStorage.getItem(noteKey)).toBeNull();
  expect(localStorage.getItem(`${key}:${note.url}:receiver`)).toBeNull();
});

it.each([
  false,
  true,
])("does not recover a live page's claimed orphan and clears it after extra recovery (damaged source=%s)", async (damaged) => {
  let clock = 1_000;
  const now = () => clock;
  const a = await independent("tab-a", now);
  a.change(note, draft, vi.fn());
  clock = 31_001;
  const receiver = await independent("receiver", now);
  const create = vi.fn().mockResolvedValue(note);
  await receiver.recover(note, create);
  const other = await independent("other", now);
  await other.recover(note, create);
  expect(other.get(note.url)).toBeUndefined();
  expect(create).not.toHaveBeenCalled();
  clock++;
  other.change(note, { ...draft, body: "Newest unique draft" }, vi.fn());
  if (damaged) localStorage.setItem(noteKey, "{");
  clock = 61_003;
  const reopened = await independent("new-page", now);
  await reopened.recover(note, create);
  expect(reopened.get(note.url)?.draft.body).toBe("Newest unique draft");
  expect(create).toHaveBeenCalledExactlyOnceWith({ ...draft, title: `${draft.title} (recovered)` });
  expect(localStorage.getItem(noteKey)).toBe(damaged ? "{" : null);
  expect(localStorage.getItem(`${key}:${note.url}:receiver`)).toBeNull();
});

it("recovers valid round-2 storage even if the aggregate envelope is damaged", async () => {
  localStorage.setItem(key, "{");
  localStorage.setItem(
    `${key}:${note.url}`,
    JSON.stringify({
      version: 2,
      webId,
      revision: "old",
      snapshot: { note, draft, status: "failed" },
    }),
  );
  expect((await registry()).get(note.url)?.draft).toEqual(draft);
});

it("preserves reminder identity and delivery count through a persisted text draft and reload", async () => {
  vi.mocked(crypto.randomUUID).mockRestore();
  const { createDraftRegistry } = await import("../src/apps/notes/state/draft-registry");
  const store = createNotesStore({
    fetch: createDemoPod({ root: "https://pod.example/" }).fetch,
    podRoot: "https://pod.example/",
    webId,
  });
  const saved = await store.create({ title: "Identified", reminder: new Date().toISOString() });
  const fired = createMemoryFiredStore();
  const notify = vi.fn();
  const scheduler = createReminderScheduler({ fired, notify });
  await scheduler.tick([saved], Date.now());
  const seams = { storage: localStorage, tabId: "draft-reload", now: Date.now };
  const first = createDraftRegistry(webId, seams);
  first.change(saved, draft, (...args) => store.save(...args));
  first.release();
  const reloaded = createDraftRegistry(webId, seams);
  const recovered = reloaded.get(saved.url);
  expect(recovered?.note.reminderId).toBe(saved.reminderId);
  expect(recovered?.draft).toEqual(draft);
  reloaded.bind(saved, (...args) => store.save(...args));
  await reloaded.retry();
  const persisted = await store.read(saved.url);
  expect(persisted).toMatchObject({ ...draft, reminderId: saved.reminderId });
  await createReminderScheduler({ fired, notify }).tick([persisted as StoredNote], Date.now());
  expect(notify).toHaveBeenCalledTimes(1);
});
