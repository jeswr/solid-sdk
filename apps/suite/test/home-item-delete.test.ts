// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Store } from "n3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readItem } from "../src/apps/home/components/item/data";
import {
  CLAIM_POLL_MS,
  CLAIM_STALE_MS,
  createDeleteController,
  HOLD_GRACE_MS,
  UNDO_MS,
} from "../src/apps/home/components/item/delete-controller";
import { classificationForType } from "../src/apps/home/lib/model/classify";
import { itemActions } from "../src/apps/home/state/presentation";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const root = "https://pod.example/alice/";
const url = `${root}bookmarks/item.ttl`;
const body =
  '<#it> a <http://www.w3.org/2002/01/bookmark#Bookmark>; <http://purl.org/dc/terms/title> "My bookmark".';
async function setup() {
  const pod = createDemoPod({
    root,
    seed: [{ path: "bookmarks/item.ttl", body, contentType: "text/turtle" }],
  });
  const fetch = vi.fn(pod.fetch);
  const session = {
    mode: "demo",
    storageUrl: root,
    webId: `${root}profile/card#me`,
    displayName: "Alice",
    fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  } as const;
  const refresh = vi.fn(async () => {});
  const controller = createDeleteController(session, refresh);
  const item = (await readItem(session, url)).item;
  return { pod, session, fetch, controller, item, refresh };
}
let saved: Map<string, string>;
beforeEach(() => {
  saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("refuses individual deletion in a shared history, including stale cards, and preserves siblings", async () => {
  const { session, controller, pod, fetch } = await setup();
  const target = `${root}integrations/netflix/media/viewing-history.ttl`;
  const history = `@prefix s: <https://schema.org/>.
    <#garden> a s:WatchAction; s:name "The Garden".
    <#weekend> a s:WatchAction; s:name "A Quiet Weekend".`;
  await pod.fetch(target, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: history,
  });
  try {
    for (const subject of ["garden", "weekend"]) {
      const { item } = await readItem(session, target, `${target}#${subject}`);
      expect(await controller.remove(item, vi.fn())).toBe(false);
      // A stale card must also be refused after the controller reads the current document.
      expect(await controller.remove({ ...item, dataset: new Store() }, vi.fn())).toBe(false);
      expect(itemActions(item, root).map((action) => action.id)).not.toContain("delete");
    }
    expect(controller.getSnapshot().size).toBe(0);
    expect(controller.pendingDeletes()).toEqual([]);
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(await (await pod.fetch(target)).text()).toBe(history);
  } finally {
    controller.dispose();
  }
});

it("refuses an old queued document deletion when a shared history is resumed", async () => {
  const { session, controller, pod, fetch, refresh } = await setup();
  controller.dispose();
  const target = `${root}integrations/netflix/media/viewing-history.ttl`;
  const history = `@prefix s: <https://schema.org/>.
    <#garden> a s:WatchAction; s:name "The Garden".
    <#weekend> a s:WatchAction; s:name "A Quiet Weekend".`;
  await pod.fetch(target, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: history,
  });
  const { item } = await readItem(session, target);
  saved.set(
    `suite.home.pending-deletes:${session.webId}\u0000${root}`,
    JSON.stringify([{ url: target, etag: item.etag, deleteAt: Date.now() + UNDO_MS }]),
  );
  const failed = vi.fn();
  const resumed = createDeleteController({ ...session }, refresh, failed);
  try {
    expect(resumed.getSnapshot().has(target)).toBe(true);
    resumed.release(target);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
    expect(resumed.pendingDeletes()).toEqual([]);
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(await (await pod.fetch(target)).text()).toBe(history);
  } finally {
    resumed.dispose();
  }
});

const profileBody =
  '<#me> a <http://xmlns.com/foaf/0.1/Person>; <http://xmlns.com/foaf/0.1/name> "Alice"; <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://issuer.example/>; <http://www.w3.org/ns/pim/space#storage> <../>.';
it.each([
  "identity",
  "contact-details",
])("protects the %s card's whole WebID document while allowing field editing", async (type) => {
  const { session, controller, pod, fetch } = await setup();
  const profile = session.webId.split("#")[0] as string;
  await pod.fetch(profile, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: profileBody,
  });
  const read = await readItem(session, profile, session.webId);
  const item = { ...read.item, ...classificationForType(type) };
  const actions = itemActions(item, root, true, session.webId).map((action) => action.id);
  expect(actions).toContain("edit");
  expect(actions).not.toContain("delete");
  // Even a caller that never learns the WebID cannot offer Delete for the profile.
  expect(itemActions(item, root, true).map((action) => action.id)).not.toContain("delete");
  expect(await controller.remove(item, vi.fn())).toBe(false);
  // A card that lost its profile statements is still refused by URL.
  expect(await controller.remove({ ...item, dataset: new Store() }, vi.fn())).toBe(false);
  expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  expect(await (await pod.fetch(profile)).text()).toBe(profileBody);
});
it("still deletes identity documents that are not the WebID profile", async () => {
  vi.useFakeTimers();
  const { session, pod, controller } = await setup();
  const permit = `${root}personal/passport.ttl`;
  await pod.fetch(permit, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: '<#it> a <https://schema.org/GovernmentPermit>; <https://schema.org/name> "Passport".',
  });
  const item = (await readItem(session, permit)).item;
  expect(item.dataType?.id).toBe("identity");
  expect(itemActions(item, root, true, session.webId).map((action) => action.id)).toContain(
    "delete",
  );
  expect(await controller.remove(item, vi.fn())).toBe(true);
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(pod.has(permit)).toBe(false);
});
it.each([
  ["settings/prefs.ttl", '<#x> <https://schema.org/name> "Plain settings".'],
  ["settings/privateTypeIndex.ttl", '<#x> <https://schema.org/name> "Plain index".'],
  ["settings/publicTypeIndex.ttl", '<#x> <https://schema.org/name> "Plain index".'],
  ["meta/description", "<> a <http://www.w3.org/ns/solid/terms#StorageDescription>."],
  ["meta/index", "<> a <http://www.w3.org/ns/solid/terms#TypeIndex>."],
  ["meta/prefs", "<#me> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <index>."],
])("refuses whole-resource deletion of infrastructure: %s", async (path, content) => {
  const { session, pod, controller } = await setup();
  const target = new URL(path, root).href;
  await pod.fetch(target, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: content,
  });
  expect(await controller.remove((await readItem(session, target)).item, vi.fn())).toBe(false);
  expect(pod.has(target)).toBe(true);
});
it("refuses untyped settings linked from the profile or the storage root", async () => {
  const { session, pod, controller, fetch } = await setup();
  const prefs = `${root}config/mine.ttl`;
  const description = `${root}config/about`;
  await pod.fetch(session.webId.split("#")[0] as string, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `<#me> <http://www.w3.org/ns/pim/space#preferencesFile> <${prefs}>.`,
  });
  for (const target of [prefs, description])
    await pod.fetch(target, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: '<#x> <https://schema.org/name> "Looks ordinary".',
    });
  fetch.mockImplementation(async (input, init) => {
    const response = await pod.fetch(input, init);
    if (String(input) !== root || init?.method !== "HEAD") return response;
    const headers = new Headers(response.headers);
    headers.append(
      "link",
      '<config/about>; rel="http://www.w3.org/ns/solid/terms#storageDescription"',
    );
    return new Response(null, { status: response.status, headers });
  });
  for (const target of [prefs, description])
    expect(await controller.remove((await readItem(session, target)).item, vi.fn())).toBe(false);
  // An unreadable profile fails closed rather than allowing deletion.
  fetch.mockImplementation(async (input, init) =>
    String(input).endsWith("profile/card")
      ? new Response(null, { status: 500 })
      : pod.fetch(input, init),
  );
  await expect(controller.remove((await readItem(session, url)).item, vi.fn())).rejects.toThrow();
  expect(controller.getSnapshot().size).toBe(0);
});
it("reads an external WebID profile without credentials when checking linked settings", async () => {
  const { session, pod } = await setup();
  const external = { ...session, webId: "https://id.example/card#me" };
  const publicFetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(`<#me> <http://www.w3.org/ns/pim/space#preferencesFile> <${url}>.`, {
        headers: { "content-type": "text/turtle" },
      }),
  );
  vi.stubGlobal("fetch", publicFetch);
  const controller = createDeleteController(external, async () => {});
  expect(await controller.remove((await readItem(external, url)).item, vi.fn())).toBe(false);
  expect(publicFetch).toHaveBeenCalledWith(
    "https://id.example/card",
    expect.objectContaining({ credentials: "omit", redirect: "error" }),
  );
  publicFetch.mockResolvedValue(new Response(null, { status: 404 }));
  expect(await controller.remove((await readItem(external, url)).item, vi.fn())).toBe(true);
  expect(pod.has(url)).toBe(true);
  controller.dispose();
});
it.each([
  4_000, 9_000,
])("finishes a durable pending delete after a reload at %i ms", async (elapsed) => {
  vi.useFakeTimers();
  const { session, pod, controller, item, refresh } = await setup();
  await controller.remove(item, vi.fn());
  // Only the target and its validator are stored; never the item's content.
  expect([...saved.values()].join()).not.toContain("My bookmark");
  controller.dispose();
  await vi.advanceTimersByTimeAsync(elapsed);
  const other = createDeleteController(
    { ...session, webId: "https://other.example/card#me" },
    refresh,
  );
  expect(other.getSnapshot().size).toBe(0);
  const reloaded = createDeleteController({ ...session }, refresh);
  expect(reloaded.getSnapshot().has(url)).toBe(true);
  await vi.advanceTimersByTimeAsync(Math.max(1, UNDO_MS - elapsed));
  expect(pod.has(url)).toBe(false);
  expect(reloaded.getSnapshot().has(url)).toBe(false);
  expect(saved.size).toBe(0);
  expect(createDeleteController({ ...session }, refresh).getSnapshot().size).toBe(0);
});
it("cancels a resumed delete with Undo after a reload during the undo window", async () => {
  vi.useFakeTimers();
  const { session, pod, controller, item, refresh, fetch } = await setup();
  await controller.remove(item, vi.fn());
  controller.dispose();
  await vi.advanceTimersByTimeAsync(1_000);
  const reloaded = createDeleteController({ ...session }, refresh);
  expect(await reloaded.undo(url)).toBe(true);
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(pod.has(url)).toBe(true);
  expect(
    fetch.mock.calls.some(([, init]) => init?.method === "DELETE" || init?.method === "PUT"),
  ).toBe(false);
  expect(saved.size).toBe(0);
});
it("lets Undo in one tab cancel the same deletion resumed in another", async () => {
  vi.useFakeTimers();
  const { session, pod, controller, item, refresh, fetch } = await setup();
  await controller.remove(item, vi.fn());
  const otherTab = createDeleteController({ ...session }, refresh);
  expect(otherTab.getSnapshot().has(url)).toBe(true);
  expect(await controller.undo(url)).toBe(true);
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(pod.has(url)).toBe(true);
  expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  expect(otherTab.getSnapshot().size).toBe(0);
});
it("re-checks a resumed target and ignores malformed or out-of-storage tombstones", async () => {
  vi.useFakeTimers();
  const { session, pod, refresh } = await setup();
  const key = `suite.home.pending-deletes:${session.webId}\u0000${root}`;
  const prefs = `${root}settings/prefs.ttl`;
  await pod.fetch(prefs, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: '<#x> <https://schema.org/name> "Settings".',
  });
  saved.set(
    key,
    JSON.stringify([
      { url: prefs, etag: "x", deleteAt: 0 },
      { url: "https://evil.example/x", etag: "x", deleteAt: 0 },
      { url: session.webId.split("#")[0], etag: "x", deleteAt: 0 },
      { url: 7 },
      null,
    ]),
  );
  const failed = vi.fn();
  const resumed = createDeleteController({ ...session }, refresh, failed);
  expect([...resumed.getSnapshot()]).toEqual([prefs]);
  await vi.advanceTimersByTimeAsync(1);
  expect(failed).toHaveBeenCalledOnce();
  expect(pod.has(prefs)).toBe(true);
  saved.set(key, "{not json");
  expect(createDeleteController({ ...session }, refresh).getSnapshot().size).toBe(0);
  saved.set(key, JSON.stringify({ entries: [] }));
  expect(createDeleteController({ ...session }, refresh).getSnapshot().size).toBe(0);
});
it("still deletes from this page when browser storage is unavailable", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  });
  const { controller, item, pod } = await setup();
  expect(await controller.remove(item, vi.fn())).toBe(true);
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(pod.has(url)).toBe(false);
});
it("removes optimistically, waits eight seconds, and conditionally commits once across route changes", async () => {
  vi.useFakeTimers();
  const { controller, item, fetch, pod, refresh } = await setup();
  const changed = vi.fn();
  const unsubscribe = controller.subscribe(changed);
  expect(await controller.remove(item, vi.fn())).toBe(true);
  expect(controller.getSnapshot().has(url)).toBe(true);
  expect(pod.has(url)).toBe(true);
  expect(await controller.remove(item, vi.fn())).toBe(false);
  await vi.advanceTimersByTimeAsync(UNDO_MS - 1);
  expect(pod.has(url)).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(pod.has(url)).toBe(false);
  expect(fetch).toHaveBeenCalledWith(
    url,
    expect.objectContaining({ method: "DELETE", headers: { "if-match": item.etag } }),
  );
  expect(refresh).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledTimes(2);
  unsubscribe();
  expect(await controller.undo(url)).toBe(false);
});
it("Undo cancels the delayed delete and uses create-only restoration with identical body/type", async () => {
  vi.useFakeTimers();
  const { controller, item, fetch, pod } = await setup();
  await controller.remove(item, vi.fn());
  expect(await controller.undo(url)).toBe(true);
  await vi.advanceTimersByTimeAsync(9_000);
  expect(pod.has(url)).toBe(true);
  expect(fetch).toHaveBeenCalledWith(
    url,
    expect.objectContaining({
      method: "PUT",
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      body,
    }),
  );
  const restored = await pod.fetch(url);
  expect(restored.status).toBe(200);
  expect(restored.headers.get("etag")).not.toBe(item.etag);
  expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
});
it("Undo restores an item removed elsewhere and never overwrites a newer item", async () => {
  vi.useFakeTimers();
  const { controller, item, pod } = await setup();
  await controller.remove(item, vi.fn());
  await pod.fetch(url, { method: "DELETE" });
  expect(await controller.undo(url)).toBe(true);
  expect(await (await pod.fetch(url)).text()).toBe(body);
  await controller.remove(
    (await readItem({ fetch: pod.fetch, storageUrl: root } as never, url)).item,
    vi.fn(),
  );
  await pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: body.replace("My bookmark", "Newer bookmark"),
  });
  await controller.undo(url);
  expect(await (await pod.fetch(url)).text()).toContain("Newer bookmark");
});
it("rolls back failed deletes and protects concurrent edits with If-Match", async () => {
  vi.useFakeTimers();
  const { controller, item, pod } = await setup();
  const failed = vi.fn();
  await controller.remove(item, failed);
  await pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: body.replace("My bookmark", "Concurrent change"),
  });
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(failed).toHaveBeenCalledOnce();
  expect(controller.getSnapshot().has(url)).toBe(false);
  expect(await (await pod.fetch(url)).text()).toContain("Concurrent change");
  expect(await controller.remove({ ...item, url: `${root}bookmarks/` }, failed)).toBe(false);
});

it("can delete a file and Undo preserves its exact bytes and content type", async () => {
  vi.useFakeTimers();
  const data = new Uint8Array([0, 255, 128, 42]);
  const file = `${root}drive/photo.bin`;
  const pod = createDemoPod({
    root,
    seed: [{ path: "drive/photo.bin", body: data, contentType: "application/octet-stream" }],
  });
  const session = {
    mode: "demo",
    storageUrl: root,
    webId: `${root}profile/card#me`,
    displayName: "Alice",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  } as const;
  const read = await readItem(session, file);
  expect(read.binary).toBe(true);
  expect(read.item.dataType?.id).toBe("files");
  expect(read.body).toEqual(data);
  const controller = createDeleteController(session, async () => {});
  expect(await controller.remove(read.item, vi.fn())).toBe(true);
  await pod.fetch(file, { method: "DELETE" });
  expect(await controller.undo(file)).toBe(true);
  expect(new Uint8Array(await (await pod.fetch(file)).arrayBuffer())).toEqual(data);
});

// AUTHORED-BY Claude Opus 5.5 — fix round 2 (findings 3, 4, 5)
it("a held deletion waits for its Undo toast however long Sonner pauses, then runs on release", async () => {
  vi.useFakeTimers();
  const { controller, item, pod, refresh } = await setup();
  await controller.remove(item, vi.fn());
  const started = vi.fn();
  expect(controller.hold(url, started)).toBe(true);
  // The toast is hovered past the undo window: nothing is deleted and Undo still works.
  await vi.advanceTimersByTimeAsync(UNDO_MS + 10_000);
  expect(pod.has(url)).toBe(true);
  expect(started).not.toHaveBeenCalled();
  expect(await controller.undo(url)).toBe(true);
  expect(pod.has(url)).toBe(true);
  // A late close of the same toast can't commit a deletion that was undone.
  controller.release(url);
  await vi.advanceTimersByTimeAsync(UNDO_MS + HOLD_GRACE_MS);
  expect(pod.has(url)).toBe(true);
  // Next time the toast closes without Undo: the deletion starts at once, exactly once.
  await controller.remove(
    (await readItem({ fetch: pod.fetch, storageUrl: root } as never, url)).item,
    vi.fn(),
  );
  expect(controller.hold(url, started)).toBe(true);
  controller.release(url);
  controller.release(url);
  expect(started).toHaveBeenCalledOnce();
  expect(controller.hold(url)).toBe(false);
  expect(await controller.undo(url)).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(pod.has(url)).toBe(false);
  expect(refresh).toHaveBeenCalled();
});
it("commits a held deletion after the grace period and tells the holder it started", async () => {
  vi.useFakeTimers();
  const { controller, item, pod } = await setup();
  await controller.remove(item, vi.fn());
  const started = vi.fn();
  controller.hold(url, started);
  await vi.advanceTimersByTimeAsync(UNDO_MS + HOLD_GRACE_MS - 1);
  expect(pod.has(url)).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(started).toHaveBeenCalledOnce();
  expect(pod.has(url)).toBe(false);
});
it("treats a resumed deletion another tab already finished as done, then refreshes", async () => {
  vi.useFakeTimers();
  const { session, pod, controller, item, refresh } = await setup();
  await controller.remove(item, vi.fn());
  controller.dispose();
  const failed = vi.fn();
  const reloaded = createDeleteController({ ...session }, refresh, failed);
  expect(reloaded.pendingDeletes()).toEqual([{ url, deleteAt: expect.any(Number), resumed: true }]);
  await pod.fetch(url, { method: "DELETE" });
  refresh.mockClear();
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(failed).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledOnce();
  expect(reloaded.getSnapshot().size).toBe(0);
});
it("treats a 412 for an item that is now missing as done (a changed item still fails, above)", async () => {
  vi.useFakeTimers();
  const { pod, controller, item, fetch, refresh } = await setup();
  fetch.mockImplementation(async (input, init) => {
    if (init?.method !== "DELETE") return pod.fetch(input, init);
    // Another tab removed it between our read and our conditional DELETE.
    await pod.fetch(input, { method: "DELETE" });
    return new Response(null, { status: 412 });
  });
  const failed = vi.fn();
  await controller.remove(item, failed);
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(failed).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledOnce();
  expect(pod.has(url)).toBe(false);
});

// AUTHORED-BY Claude Opus 5.5 — fix round 3 (findings 1, 2)
it("says it is too late to undo a resumed deletion another tab already finished", async () => {
  vi.useFakeTimers();
  const { session, pod, controller, item, fetch } = await setup();
  await controller.remove(item, vi.fn());
  const otherRefresh = vi.fn(async () => {});
  const otherTab = createDeleteController({ ...session }, otherRefresh);
  expect(otherTab.pendingDeletes()).toEqual([{ url, deleteAt: expect.any(Number), resumed: true }]);
  // Tab A's toast closes: its DELETE runs and removes the shared tombstone.
  controller.hold(url);
  controller.release(url);
  await vi.advanceTimersByTimeAsync(0);
  expect(pod.has(url)).toBe(false);
  expect(saved.size).toBe(0);
  fetch.mockClear();
  // Undo in tab B can't bring it back, so it must not claim it did.
  expect(await otherTab.undo(url)).toBe(false);
  expect(otherRefresh).toHaveBeenCalledOnce();
  expect(otherTab.getSnapshot().size).toBe(0);
  expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});
it("says it is too late to undo a resumed deletion whose DELETE finished before a reload", async () => {
  vi.useFakeTimers();
  const { session, pod, controller, item, fetch } = await setup();
  await controller.remove(item, vi.fn());
  // The DELETE completed, but the page unloaded before it could clear its tombstone.
  await pod.fetch(url, { method: "DELETE" });
  controller.dispose();
  expect(saved.size).toBe(1);
  const refresh = vi.fn(async () => {});
  const reloaded = createDeleteController({ ...session }, refresh);
  expect(reloaded.getSnapshot().has(url)).toBe(true);
  fetch.mockClear();
  expect(await reloaded.undo(url)).toBe(false);
  expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: "HEAD" }));
  expect(refresh).toHaveBeenCalledOnce();
  expect(reloaded.getSnapshot().size).toBe(0);
  expect(saved.size).toBe(0);
  expect(pod.has(url)).toBe(false);
});
it("still undoes a resumed deletion when the server can't be asked whether it is gone", async () => {
  vi.useFakeTimers();
  const { session, pod, controller, item, fetch } = await setup();
  await controller.remove(item, vi.fn());
  controller.dispose();
  const reloaded = createDeleteController(
    { ...session },
    vi.fn(async () => {}),
  );
  fetch.mockImplementation(async (input, init) => {
    if (init?.method === "HEAD") throw new TypeError("offline");
    return pod.fetch(input, init);
  });
  expect(await reloaded.undo(url)).toBe(true);
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(pod.has(url)).toBe(true);
  expect(saved.size).toBe(0);
});
it("refreshes when a resumed commit finds another tab already removed its tombstone", async () => {
  vi.useFakeTimers();
  const { session, pod, controller, item, fetch } = await setup();
  await controller.remove(item, vi.fn());
  const otherRefresh = vi.fn(async () => {});
  const otherTab = createDeleteController({ ...session }, otherRefresh);
  controller.hold(url);
  controller.release(url);
  await vi.advanceTimersByTimeAsync(0);
  expect(pod.has(url)).toBe(false);
  fetch.mockClear();
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  // Tab B never sends its own DELETE, and refreshes so the card doesn't reappear.
  expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  expect(otherRefresh).toHaveBeenCalledOnce();
  expect(otherTab.getSnapshot().size).toBe(0);
});

// AUTHORED-BY Claude Opus 5.5 — fix round 4 (findings 1, 3, 4)
/** A promise this test settles by hand, to hold one request open. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}
const sends = (fetch: ReturnType<typeof vi.fn>, method: string) =>
  fetch.mock.calls.filter(([, init]) => init?.method === method).length;
/** Two tabs that both resumed the same tombstone after a reload. */
async function twoResumedTabs() {
  const setupResult = await setup();
  const { session, controller, item } = setupResult;
  await controller.remove(item, vi.fn());
  controller.dispose();
  const tabA = createDeleteController(
    { ...session },
    vi.fn(async () => {}),
  );
  const failedB = vi.fn();
  const tabB = createDeleteController(
    { ...session },
    vi.fn(async () => {}),
    failedB,
  );
  expect(tabA.getSnapshot().has(url)).toBe(true);
  expect(tabB.getSnapshot().has(url)).toBe(true);
  // Tab A's Undo toast holds its own timer, as the page does.
  expect(tabA.hold(url)).toBe(true);
  return { ...setupResult, tabA, tabB, failedB };
}
it("says too late when Undo races another tab's commit that is still re-checking the item", async () => {
  vi.useFakeTimers();
  const { pod, fetch, tabA, failedB } = await twoResumedTabs();
  const read = gate();
  let reading = false;
  fetch.mockImplementation(async (input, init) => {
    if (String(input) === url && (init?.method ?? "GET") === "GET") {
      reading = true;
      await read.opened;
    }
    return pod.fetch(input, init);
  });
  // Tab B's timer fires: it claims the tombstone, then its readItem is held open.
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(reading).toBe(true);
  expect(JSON.stringify([...saved.values()])).toContain("claim");
  // Tab A's Undo now can't stop that DELETE, so it must not say it undid it.
  const heads = sends(fetch, "HEAD");
  expect(await tabA.undo(url)).toBe(false);
  expect(sends(fetch, "HEAD")).toBe(heads);
  read.open();
  await vi.advanceTimersByTimeAsync(0);
  expect(failedB).not.toHaveBeenCalled();
  expect(sends(fetch, "DELETE")).toBe(1);
  expect(pod.has(url)).toBe(false);
  expect(saved.size).toBe(0);
});
it("never deletes after Undo in another tab withdrew the tombstone, even mid-check", async () => {
  vi.useFakeTimers();
  const { pod, fetch, tabA, tabB } = await twoResumedTabs();
  const head = gate();
  fetch.mockImplementation(async (input, init) => {
    if (init?.method === "HEAD") await head.opened;
    return pod.fetch(input, init);
  });
  // Tab A's Undo withdraws the shared tombstone first; its HEAD is then held open.
  const undone = tabA.undo(url);
  await vi.advanceTimersByTimeAsync(0);
  expect(saved.size).toBe(0);
  // Tab B's timer fires meanwhile: it finds nothing to claim and sends no DELETE.
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(tabB.getSnapshot().size).toBe(0);
  head.open();
  expect(await undone).toBe(true);
  expect(sends(fetch, "DELETE")).toBe(0);
  expect(pod.has(url)).toBe(true);
});
it("leaves another tab's live claim in place and takes over a stale one", async () => {
  vi.useFakeTimers();
  const { session, pod, fetch, item, refresh } = await setup();
  const key = `suite.home.pending-deletes:${session.webId}\u0000${root}`;
  const claimed = (at: number) => [
    { url, etag: item.etag, deleteAt: Date.now(), claim: { by: "other-tab", at } },
  ];
  const stored = JSON.stringify(claimed(Date.now()));
  saved.set(key, stored);
  const live = createDeleteController({ ...session }, refresh);
  expect(await live.undo(url)).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(sends(fetch, "DELETE")).toBe(0);
  // The committing tab's tombstone is kept, so its own Undo answers stay right.
  expect(JSON.parse(saved.get(key) as string)).toEqual(JSON.parse(stored));
  // A claim left by a tab that closed mid-commit is finished by the next load.
  saved.set(key, JSON.stringify(claimed(Date.now() - CLAIM_STALE_MS)));
  createDeleteController({ ...session }, refresh);
  await vi.advanceTimersByTimeAsync(1);
  expect(sends(fetch, "DELETE")).toBe(1);
  expect(pod.has(url)).toBe(false);
  expect(saved.size).toBe(0);
});
it("says a resumed deletion another tab undid is undone, and only a 404 is too late", async () => {
  vi.useFakeTimers();
  const { session, pod, controller, item, fetch } = await setup();
  await controller.remove(item, vi.fn());
  const otherTab = createDeleteController(
    { ...session },
    vi.fn(async () => {}),
  );
  // Tab A undoes (removing the shared tombstone); tab B's own Undo then sees the item there.
  expect(await controller.undo(url)).toBe(true);
  fetch.mockClear();
  expect(await otherTab.undo(url)).toBe(true);
  expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: "HEAD" }));
  expect(sends(fetch, "PUT") + sends(fetch, "DELETE")).toBe(0);
  expect(pod.has(url)).toBe(true);
  // With the tombstone gone and the server unreachable, it can't claim success.
  await controller.remove((await readItem(session, url)).item, vi.fn());
  const third = createDeleteController(
    { ...session },
    vi.fn(async () => {}),
  );
  expect(await controller.undo(url)).toBe(true);
  fetch.mockImplementation(async (input, init) => {
    if (init?.method === "HEAD") throw new TypeError("offline");
    return pod.fetch(input, init);
  });
  expect(await third.undo(url)).toBe(false);
});
it("re-creates a saved copy when another tab's DELETE lands between the two PUTs", async () => {
  vi.useFakeTimers();
  const { controller, item, fetch, pod } = await setup();
  await controller.remove(item, vi.fn());
  fetch.mockImplementation(async (input, init) => {
    if (init?.method === "PUT" && new Headers(init.headers).has("if-match")) {
      await pod.fetch(input, { method: "DELETE" });
      return new Response(null, { status: 412 });
    }
    return pod.fetch(input, init);
  });
  expect(await controller.undo(url)).toBe(true);
  expect(sends(fetch, "PUT")).toBe(3);
  expect(await (await pod.fetch(url)).text()).toBe(body);
});
it("reports a failed restore when every PUT is refused and the item isn't there", async () => {
  vi.useFakeTimers();
  const { controller, item, fetch, pod } = await setup();
  await controller.remove(item, vi.fn());
  fetch.mockImplementation(async (input, init) => {
    if (init?.method === "PUT") return new Response(null, { status: 412 });
    if (init?.method === "HEAD") return new Response(null, { status: 404 });
    return pod.fetch(input, init);
  });
  await expect(controller.undo(url)).rejects.toThrow("Restore failed");
  // A newer item in place (HEAD 200) is left as it is, and Undo succeeds.
  await controller.remove(
    (await readItem({ ...pod, storageUrl: root } as never, url)).item,
    vi.fn(),
  );
  fetch.mockImplementation(async (input, init) =>
    init?.method === "PUT" ? new Response(null, { status: 412 }) : pod.fetch(input, init),
  );
  expect(await controller.undo(url)).toBe(true);
});

// AUTHORED-BY Claude Opus 5.5 — fix round 5 (findings 1, 2, 3)
const queueKey = `suite.home.pending-deletes:${root}profile/card#me\u0000${root}`;
/**
 * The demo pod, but with ETags derived from content only, as some servers do: an identical
 * re-write keeps the ETag, so an If-Match rewrite can't fence off an earlier DELETE.
 */
function contentEtags(pod: Awaited<ReturnType<typeof setup>>["pod"]) {
  const tag = async (input: RequestInfo | URL) => {
    const current = await pod.fetch(input);
    return current.ok ? `"c-${encodeURIComponent(await current.text()).length}"` : undefined;
  };
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const match = headers.get("if-match");
    if (match) {
      if ((await tag(input)) !== match) return new Response(null, { status: 412 });
      headers.delete("if-match");
    }
    const response = await pod.fetch(input, { ...init, headers });
    const etag = response.headers.has("etag") ? await tag(input) : undefined;
    if (!etag) return response;
    const out = new Headers(response.headers);
    out.set("etag", etag);
    const empty = init?.method === "HEAD" || [204, 304].includes(response.status);
    return new Response(empty ? null : await response.arrayBuffer(), {
      status: response.status,
      headers: out,
    });
  };
}
/** Tab A deleted the item and holds its saved copy; tab B resumed the same tombstone. */
async function copyHolderAndCommitter() {
  const setupResult = await setup();
  const { session, pod, fetch } = setupResult;
  const etagged = contentEtags(pod);
  fetch.mockImplementation(etagged);
  const item = (await readItem(session, url)).item;
  expect(item.etag).toMatch(/^"c-/);
  const tabA = setupResult.controller;
  expect(await tabA.remove(item, vi.fn())).toBe(true);
  expect(tabA.hold(url)).toBe(true);
  const refreshB = vi.fn(async () => {});
  const failedB = vi.fn();
  const tabB = createDeleteController({ ...session }, refreshB, failedB);
  return { ...setupResult, etagged, item, tabA, tabB, refreshB, failedB };
}
it("Undo holding the copy waits out another tab's DELETE already sent, then re-creates the item", async () => {
  vi.useFakeTimers();
  const { pod, fetch, etagged, tabA, failedB } = await copyHolderAndCommitter();
  const deleting = gate();
  let sent = false;
  fetch.mockImplementation(async (input, init) => {
    if (init?.method === "DELETE") {
      sent = true;
      await deleting.opened;
    }
    return etagged(input, init);
  });
  // Tab B's timer: it claims, re-checks the item and sends its DELETE, still in flight.
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(sent).toBe(true);
  const undone = tabA.undo(url);
  await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS * 3);
  // Undo waits for that DELETE instead of trusting an If-Match rewrite.
  expect(sends(fetch, "PUT")).toBe(0);
  expect(JSON.parse(saved.get(queueKey) as string)[0]).toMatchObject({ undone: true });
  deleting.open();
  await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS);
  expect(await undone).toBe(true);
  expect(failedB).not.toHaveBeenCalled();
  // The DELETE landed before Undo answered; nothing deletes the restored copy afterwards.
  const deletes = sends(fetch, "DELETE");
  await vi.advanceTimersByTimeAsync(CLAIM_STALE_MS + HOLD_GRACE_MS);
  expect(sends(fetch, "DELETE")).toBe(deletes);
  expect(await (await pod.fetch(url)).text()).toBe(body);
  expect(fetch.mock.calls.at(-1)?.[1]?.method).not.toBe("DELETE");
  expect(saved.size).toBe(0);
  expect(tabA.getSnapshot().size).toBe(0);
});
it("Undo holding the copy stops a committer that has not sent its DELETE yet", async () => {
  vi.useFakeTimers();
  const { session, pod, fetch, etagged, tabA, failedB, refreshB } = await copyHolderAndCommitter();
  const read = gate();
  let reading = false;
  fetch.mockImplementation(async (input, init) => {
    if (String(input) === url && (init?.method ?? "GET") === "GET") {
      reading = true;
      await read.opened;
    }
    return etagged(input, init);
  });
  // Tab B claimed and is re-checking the item (its GET is held open).
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(reading).toBe(true);
  const undone = tabA.undo(url);
  await vi.advanceTimersByTimeAsync(0);
  read.open();
  await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS);
  expect(await undone).toBe(true);
  // Tab B re-checked its claim, found it undone, and sent no DELETE.
  expect(sends(fetch, "DELETE")).toBe(0);
  expect(refreshB).toHaveBeenCalled();
  expect(failedB).not.toHaveBeenCalled();
  expect(await (await pod.fetch(url)).text()).toBe(body);
  expect(saved.size).toBe(0);
  // A reload while the Undo tab restores doesn't resume an undone tombstone.
  saved.set(queueKey, JSON.stringify([{ url, etag: "x", deleteAt: 0, undone: true }]));
  expect(createDeleteController({ ...session }, vi.fn()).getSnapshot().size).toBe(0);
});
it("reports a failed restore when the item still isn't there after the committer is done", async () => {
  vi.useFakeTimers();
  const { fetch, etagged, tabA } = await copyHolderAndCommitter();
  await vi.advanceTimersByTimeAsync(UNDO_MS - 1);
  // Tab B claims (no network yet: the GET is held), then tab A's Undo meets that claim.
  const read = gate();
  fetch.mockImplementation(async (input, init) => {
    if (init?.method === "GET" || init?.method === undefined) await read.opened;
    if (init?.method === "PUT") return new Response(null, { status: 412 });
    if (init?.method === "HEAD") return new Response(null, { status: 404 });
    return etagged(input, init);
  });
  await vi.advanceTimersByTimeAsync(1);
  const undone = tabA.undo(url);
  const outcome = expect(undone).rejects.toThrow("Restore failed");
  read.open();
  await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS);
  await outcome;
});
it("runs claims, withdrawals and the claim re-check before DELETE under the queue's Web Lock", async () => {
  vi.useFakeTimers();
  const { session, controller, item, fetch, pod } = await setup();
  const locks = navigator.locks as unknown as {
    request: (name: string, options: unknown, work: () => unknown) => Promise<unknown>;
  };
  const request = vi.spyOn(locks, "request");
  await controller.remove(item, vi.fn());
  expect(request).toHaveBeenCalledWith(queueKey, { mode: "exclusive" }, expect.any(Function));
  const tabB = createDeleteController(
    { ...session },
    vi.fn(async () => {}),
  );
  controller.hold(url);
  // Another holder keeps the lock: tab B's claim waits for it.
  const held = gate();
  void locks.request(queueKey, { mode: "exclusive" }, () => held.opened);
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(JSON.stringify([...saved.values()])).not.toContain("claim");
  // Tab A's Undo (withdraw) queues behind tab B's claim.
  const undone = controller.undo(url);
  await vi.advanceTimersByTimeAsync(0);
  expect(saved.size).toBe(1);
  held.open();
  // Tab B claimed first, so the Undo met its claim, marked it undone, and B sent no DELETE.
  await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS);
  expect(await undone).toBe(true);
  expect(sends(fetch, "DELETE")).toBe(0);
  expect(pod.has(url)).toBe(true);
  expect(tabB.getSnapshot().size).toBe(0);
  const work = request.mock.calls.length;
  expect(work).toBeGreaterThanOrEqual(5);
});
it("falls back to plain read-modify-writes when Web Locks are unavailable", async () => {
  vi.useFakeTimers();
  Object.defineProperty(globalThis.navigator, "locks", { configurable: true, value: undefined });
  const { session, controller, item, fetch, pod } = await setup();
  await controller.remove(item, vi.fn());
  expect(saved.size).toBe(1);
  const tabB = createDeleteController(
    { ...session },
    vi.fn(async () => {}),
  );
  expect(await controller.undo(url)).toBe(true);
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(sends(fetch, "DELETE")).toBe(0);
  expect(tabB.getSnapshot().size).toBe(0);
  await controller.remove((await readItem(session, url)).item, vi.fn());
  const tabC = createDeleteController(
    { ...session },
    vi.fn(async () => {}),
  );
  controller.hold(url);
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(sends(fetch, "DELETE")).toBe(1);
  expect(pod.has(url)).toBe(false);
  expect(saved.size).toBe(0);
  expect(tabC.getSnapshot().size).toBe(0);
});
it("keeps the card hidden while another tab's claim is live, and re-checks on storage events", async () => {
  vi.useFakeTimers();
  const events = new EventTarget();
  vi.stubGlobal("addEventListener", events.addEventListener.bind(events));
  vi.stubGlobal("removeEventListener", events.removeEventListener.bind(events));
  const storageEvent = () =>
    events.dispatchEvent(Object.assign(new Event("storage"), { key: queueKey }));
  const { session, controller, item, fetch, pod } = await setup();
  await controller.remove(item, vi.fn());
  const refreshB = vi.fn(async () => {});
  const tabB = createDeleteController({ ...session }, refreshB);
  const deleting = gate();
  fetch.mockImplementation(async (input, init) => {
    if (init?.method === "DELETE") await deleting.opened;
    return pod.fetch(input, init);
  });
  controller.hold(url);
  // Tab B claims at the deadline; tab A's toast then closes and A's commit meets that claim.
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  controller.release(url);
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.getSnapshot().has(url)).toBe(true);
  expect(controller.pendingDeletes()).toEqual([]);
  expect(controller.hold(url)).toBe(false);
  storageEvent();
  await vi.advanceTimersByTimeAsync(CLAIM_STALE_MS / 2);
  expect(controller.getSnapshot().has(url)).toBe(true);
  // A resumed tab's late Undo is too late, and its card stays hidden too.
  const tabC = createDeleteController(
    { ...session },
    vi.fn(async () => {}),
  );
  expect(await tabC.undo(url)).toBe(false);
  expect(tabC.getSnapshot().has(url)).toBe(true);
  deleting.open();
  await vi.advanceTimersByTimeAsync(0);
  expect(pod.has(url)).toBe(false);
  expect(tabB.getSnapshot().size).toBe(0);
  // Tab B's queue write reaches tab A as a storage event: the card follows the pod now.
  const refreshes = refreshB.mock.calls.length;
  storageEvent();
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.getSnapshot().size).toBe(0);
  expect(tabC.getSnapshot().size).toBe(0);
  expect(refreshB.mock.calls.length).toBe(refreshes);
  expect(sends(fetch, "DELETE")).toBe(1);
  controller.dispose();
});
it("takes over a claim that went stale as its own pending deletion, so Undo works", async () => {
  vi.useFakeTimers();
  const { session, item, fetch, pod } = await setup();
  const offered = vi.fn();
  const tabA = createDeleteController(
    session,
    vi.fn(async () => {}),
    vi.fn(),
    offered,
  );
  await tabA.remove(item, vi.fn());
  // Another tab claimed it and closed mid-commit.
  const [tombstone] = JSON.parse(saved.get(queueKey) as string);
  saved.set(
    queueKey,
    JSON.stringify([{ ...tombstone, claim: { by: "crashed-tab", at: Date.now() } }]),
  );
  const started = vi.fn();
  tabA.hold(url, started);
  tabA.release(url);
  await vi.advanceTimersByTimeAsync(0);
  expect(started).toHaveBeenCalledOnce();
  expect(tabA.getSnapshot().has(url)).toBe(true);
  expect(offered).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(CLAIM_STALE_MS);
  expect(offered).toHaveBeenCalledWith(url, Date.now() + UNDO_MS);
  expect(tabA.pendingDeletes()).toEqual([{ url, deleteAt: Date.now() + UNDO_MS, resumed: false }]);
  const [fresh] = JSON.parse(saved.get(queueKey) as string);
  expect(fresh).toEqual({ url, etag: item.etag, deleteAt: Date.now() + UNDO_MS });
  expect(tabA.hold(url)).toBe(true);
  expect(await tabA.undo(url)).toBe(true);
  expect(sends(fetch, "DELETE")).toBe(0);
  expect(pod.has(url)).toBe(true);
  expect(saved.size).toBe(0);
  expect(tabA.getSnapshot().size).toBe(0);
  // Without Undo the taken-over deletion runs after its fresh window.
  await tabA.remove((await readItem(session, url)).item, vi.fn());
  const [again] = JSON.parse(saved.get(queueKey) as string);
  saved.set(queueKey, JSON.stringify([{ ...again, claim: { by: "crashed-tab", at: Date.now() } }]));
  tabA.release(url);
  await vi.advanceTimersByTimeAsync(CLAIM_STALE_MS);
  expect(pod.has(url)).toBe(true);
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(sends(fetch, "DELETE")).toBe(1);
  expect(pod.has(url)).toBe(false);
  expect(saved.size).toBe(0);
});

// AUTHORED-BY Claude Opus 5.5 — fix round 6 (findings 1, 2, 3)
/** Storage events reach every controller in this test, as they would reach other tabs. */
function storageEvents() {
  const events = new EventTarget();
  vi.stubGlobal("addEventListener", events.addEventListener.bind(events));
  vi.stubGlobal("removeEventListener", events.removeEventListener.bind(events));
  return () => events.dispatchEvent(Object.assign(new Event("storage"), { key: queueKey }));
}
it("adopting another tab's newer tombstone drops the older saved copy, so Undo keeps the new version", async () => {
  vi.useFakeTimers();
  const storageEvent = storageEvents();
  const { session, item, fetch, pod } = await setup();
  const offered = vi.fn();
  const tabA = createDeleteController(
    session,
    vi.fn(async () => {}),
    vi.fn(),
    offered,
  );
  await tabA.remove(item, vi.fn());
  // Another live tab claims the deletion; tab A's commit meets that claim and watches it.
  const [tombstone] = JSON.parse(saved.get(queueKey) as string);
  saved.set(queueKey, JSON.stringify([{ ...tombstone, claim: { by: "tab-b", at: Date.now() } }]));
  tabA.release(url);
  await vi.advanceTimersByTimeAsync(0);
  expect(tabA.getSnapshot().has(url)).toBe(true);
  // Tab B finished; a newer version was written and tab C deleted that one.
  await pod.fetch(url, { method: "DELETE" });
  const newer = '<#it> <http://purl.org/dc/terms/title> "Version two".';
  await pod.fetch(url, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: newer,
  });
  const etag = (await readItem(session, url)).item.etag;
  expect(etag).not.toBe(item.etag);
  const deleteAt = Date.now() + UNDO_MS;
  saved.set(queueKey, JSON.stringify([{ url, etag, deleteAt }]));
  storageEvent();
  await vi.advanceTimersByTimeAsync(0);
  expect(offered).toHaveBeenCalledWith(url, deleteAt);
  expect(tabA.pendingDeletes()).toEqual([{ url, deleteAt, resumed: true }]);
  fetch.mockClear();
  // Undo withdraws tab C's tombstone and writes nothing: version one never replaces two.
  expect(await tabA.undo(url)).toBe(true);
  expect(sends(fetch, "PUT")).toBe(0);
  expect(await (await pod.fetch(url)).text()).toBe(newer);
  expect(saved.size).toBe(0);
  await vi.advanceTimersByTimeAsync(UNDO_MS + HOLD_GRACE_MS);
  expect(sends(fetch, "DELETE")).toBe(0);
  tabA.dispose();
});
it("renews a committer's claim while a slow DELETE is outstanding, so Undo waits it out", async () => {
  vi.useFakeTimers();
  const { pod, fetch, etagged, tabA, failedB } = await copyHolderAndCommitter();
  const deleting = gate();
  let sent = false;
  fetch.mockImplementation(async (input, init) => {
    if (init?.method === "DELETE") {
      sent = true;
      await deleting.opened;
    }
    return etagged(input, init);
  });
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(sent).toBe(true);
  const undone = tabA.undo(url);
  let settled = false;
  void undone.then(() => {
    settled = true;
  });
  // The DELETE is held well past the stale age: tab B keeps its claim live meanwhile.
  await vi.advanceTimersByTimeAsync(CLAIM_STALE_MS * 2);
  const [claimed] = JSON.parse(saved.get(queueKey) as string);
  expect(claimed).toMatchObject({ undone: true });
  expect(Date.now() - claimed.claim.at).toBeLessThan(CLAIM_STALE_MS);
  expect(settled).toBe(false);
  expect(sends(fetch, "PUT")).toBe(0);
  deleting.open();
  await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS);
  expect(await undone).toBe(true);
  expect(failedB).not.toHaveBeenCalled();
  expect(await (await pod.fetch(url)).text()).toBe(body);
  expect(saved.size).toBe(0);
  // Renewal stopped when the DELETE settled: nothing writes the queue afterwards.
  const writes = vi.spyOn(localStorage, "setItem");
  await vi.advanceTimersByTimeAsync(CLAIM_STALE_MS * 2);
  expect(writes).not.toHaveBeenCalled();
  expect(saved.size).toBe(0);
  expect(sends(fetch, "DELETE")).toBe(1);
});
it("a watching tab keeps the card hidden after Undo marks the tombstone undone, until the claim clears", async () => {
  vi.useFakeTimers();
  const storageEvent = storageEvents();
  const { session, pod, fetch, etagged, tabA, tabB } = await copyHolderAndCommitter();
  const refreshC = vi.fn(async () => {});
  const tabC = createDeleteController({ ...session }, refreshC);
  const deleting = gate();
  fetch.mockImplementation(async (input, init) => {
    if (init?.method === "DELETE") await deleting.opened;
    return etagged(input, init);
  });
  // Tab B claims and sends its DELETE; tab C's commit meets that claim and watches it.
  await vi.advanceTimersByTimeAsync(UNDO_MS);
  expect(sends(fetch, "DELETE")).toBe(1);
  expect(tabC.getSnapshot().has(url)).toBe(true);
  expect(tabC.pendingDeletes()).toEqual([]);
  // Tab A's Undo marks the tombstone undone while B's DELETE is still in flight.
  const undone = tabA.undo(url);
  await vi.advanceTimersByTimeAsync(0);
  expect(JSON.parse(saved.get(queueKey) as string)[0]).toMatchObject({ undone: true });
  storageEvent();
  await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS);
  expect(tabC.getSnapshot().has(url)).toBe(true);
  expect(refreshC).not.toHaveBeenCalled();
  // B's DELETE settles and its claim clears: C now follows the pod.
  deleting.open();
  await vi.advanceTimersByTimeAsync(0);
  expect(saved.size).toBe(0);
  storageEvent();
  await vi.advanceTimersByTimeAsync(CLAIM_POLL_MS);
  expect(tabC.getSnapshot().size).toBe(0);
  expect(refreshC).toHaveBeenCalled();
  expect(await undone).toBe(true);
  expect(await (await pod.fetch(url)).text()).toBe(body);
  expect(tabB.getSnapshot().size).toBe(0);
  expect(sends(fetch, "DELETE")).toBe(1);
  tabC.dispose();
});
