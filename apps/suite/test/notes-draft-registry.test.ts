// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { deferred } from "./drive-ui-dom";

const webId = "https://pod.example/profile/card#me";
const key = `suite.notes.pending-drafts.${webId}`;
const noteKey = `${key}:https://pod.example/notes/reload.ttl`;
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
  events.clear();
  vi.spyOn(window, "addEventListener").mockImplementation((name, listener) => {
    events.set(name, listener as EventListener);
  });
  vi.spyOn(document, "addEventListener").mockImplementation((name, listener) => {
    events.set(name, listener as EventListener);
  });
});
afterEach(() => vi.restoreAllMocks());
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
    version: 2,
    webId,
    revision: expect.any(String),
    snapshot: { note, draft, status: "saving" },
  });
  expect(localStorage.getItem(key)).toBeNull();
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

it("keeps tab A's unsuccessful X draft when an already-open tab B saves Y", async () => {
  const a = await registry();
  vi.resetModules();
  const b = await registry();
  const offline = vi.fn().mockRejectedValue(new Error("Offline"));
  a.change(note, draft, offline);
  await a.retry();
  const x = localStorage.getItem(noteKey);
  const y = { ...note, url: "https://pod.example/notes/y.ttl" };
  const saveY = vi.fn(async () => ({ ...y, ...draft, etag: '"v2"' }));
  b.change(y, draft, saveY);
  await b.flush(y, saveY);
  expect(localStorage.getItem(noteKey)).toBe(x);
  expect(localStorage.getItem(`${key}:${y.url}`)).toBeNull();
  vi.resetModules();
  expect((await registry()).get(note.url)).toMatchObject({ draft, status: "failed" });
});

it("does not remove another tab's newer revision when an older save completes", async () => {
  const a = await registry();
  vi.resetModules();
  const b = await registry();
  const writing = deferred<StoredNote>();
  const save = vi.fn().mockReturnValue(writing.promise);
  a.change(note, draft, save);
  const flushing = a.flush(note, save);
  const newer = { ...draft, body: "Tab B's newer body" };
  b.change(note, newer, vi.fn());
  const recovery = localStorage.getItem(noteKey);
  writing.resolve({ ...note, ...draft, etag: '"v2"' });
  await flushing;
  expect(localStorage.getItem(noteKey)).toBe(recovery);
  vi.resetModules();
  expect((await registry()).get(note.url)?.draft).toEqual(newer);
});

it("does not rewrite an unchanged draft when persisting changes to another note", async () => {
  const a = await registry();
  const save = vi.fn();
  a.change(note, draft, save);
  vi.resetModules();
  const b = await registry();
  b.change(note, { ...draft, body: "Newer from B" }, save);
  const newer = localStorage.getItem(noteKey);
  const y = { ...note, url: "https://pod.example/notes/y.ttl" };
  a.change(y, draft, save);
  expect(localStorage.getItem(noteKey)).toBe(newer);
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
