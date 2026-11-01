// AUTHORED-BY Codex GPT-6
import { Store } from "n3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readItem } from "../src/apps/home/components/item/data";
import {
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
