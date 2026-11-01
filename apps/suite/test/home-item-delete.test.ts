// AUTHORED-BY Codex GPT-6
import { afterEach, expect, it, vi } from "vitest";
import { readItem } from "../src/apps/home/components/item/data";
import {
  createDeleteController,
  UNDO_MS,
} from "../src/apps/home/components/item/delete-controller";
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
afterEach(() => vi.useRealTimers());
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
