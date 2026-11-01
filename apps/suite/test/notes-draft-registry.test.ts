// AUTHORED-BY Codex GPT-6
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StoredNote } from "../src/apps/notes/lib/model/store";
import { deferred } from "./drive-ui-dom";

const webId = "https://pod.example/profile/card#me";
const key = `suite.notes.pending-drafts.${webId}`;
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
  const stored = JSON.parse(localStorage.getItem(key) as string);
  expect(stored).toEqual({ version: 1, webId, drafts: [{ note, draft, status: "saving" }] });
  vi.resetModules();
  const reloaded = await registry();
  expect(reloaded.get(note.url)).toEqual(stored.drafts[0]);
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
  expect(JSON.parse(localStorage.getItem(key) as string).drafts).toEqual([]);
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
  localStorage.setItem(`suite.notes.pending-drafts.${other}`, localStorage.getItem(key) as string);
  expect(module.getPendingDrafts(other).all()).toEqual([]);
  expect(module.getPendingDrafts(webId).get(note.url)?.draft).toEqual(draft);
});
