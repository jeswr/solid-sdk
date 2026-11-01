// AUTHORED-BY Codex
import { afterEach, expect, it, vi } from "vitest";
import { createSolidDriveClient, type DriveClient } from "../src/apps/drive/lib/client/client";
import { type UploadQueue, useUploadQueue } from "../src/apps/drive/state/uploads";
import { act, h, mount } from "./drive-ui-dom";
import { aclBody, DRIVE, OWNER, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

afterEach(() => vi.restoreAllMocks());

async function mountedQueue(client: DriveClient) {
  let queue!: UploadQueue;
  const invalidate = vi.fn();
  function Queue() {
    queue = useUploadQueue(client, invalidate);
    return null;
  }
  await mount(h(Queue));
  return {
    get current() {
      return queue;
    },
    settled: (status: string) =>
      vi.waitFor(async () => {
        await act(async () => {});
        expect(queue.tasks[0]?.status).toBe(status);
      }),
  };
}

it.each([
  false,
  true,
])("Retry discards replacement approval and prompts before overwriting a different public file (apply to all: %s)", async (applyToAll) => {
  const f = await wacPod();
  const url = `${PUBLIC}report.txt`;
  await f.fetch(url, { method: "PUT", body: "owner's original" });
  f.policies.set(`${url}.policy`, await aclBody(url));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const approved = (await client.stat(url)).etag;
  expect((await f.anonymous(url)).status).toBe(403);
  const queue = await mountedQueue(client);
  const { settled } = queue;
  await act(async () =>
    queue.current.enqueue(PUBLIC, [new File(["secret contents"], "report.txt")]),
  );
  await settled("conflict");
  const id = queue.current.tasks[0]?.id as string;
  const writes: (string | null)[] = [];
  f.intercept(async (target, init) => {
    if (target === url && init?.method === "PUT") {
      writes.push(new Headers(init.headers).get("if-match"));
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  await act(async () => queue.current.resolve(id, "replace", applyToAll));
  await settled("failed");
  f.intercept(undefined);
  await client.move(url, `${DRIVE}saved-report.txt`, { kind: "preserve-source" });
  await f.fetch(url, { method: "PUT", body: "public replacement" });
  f.policies.set(`${url}.policy`, await aclBody(url, true));
  f.intercept(async (target, init) => {
    if (target === url && init?.method === "PUT")
      writes.push(new Headers(init.headers).get("if-match"));
    return undefined;
  });
  f.audit();
  await act(async () => queue.current.retry(id));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(queue.current.tasks[0]?.status).not.toBe("uploading");
  });
  expect(await (await f.anonymous(url)).text()).toBe("public replacement");
  expect(queue.current.tasks[0]?.status).toBe("conflict");
  expect(writes).toEqual([approved]);
  expect(f.exposures).toEqual([]);
  await act(async () => queue.current.resolve(id, "skip"));
  await settled("skipped");
});

it.each([
  "changed",
  "missing",
])("a delayed Replace decision prompts again when its approved target is %s", async (change) => {
  const f = await wacPod();
  const url = `${PUBLIC}placeholder`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const queue = await mountedQueue(client);
  await act(async () => queue.current.enqueue(PUBLIC, [new File(["new contents"], "placeholder")]));
  await queue.settled("conflict");
  const id = queue.current.tasks[0]?.id as string;
  if (change === "changed") await f.fetch(url, { method: "PUT", body: "different file" });
  else await f.fetch(url, { method: "DELETE" });
  await act(async () => queue.current.resolve(id, "replace"));
  await queue.settled("conflict");
  if (change === "changed") {
    expect(await (await f.anonymous(url)).text()).toBe("different file");
    // The renewed prompt captures the new version and authorizes only it.
    await act(async () => queue.current.resolve(id, "replace"));
  } else {
    expect(f.pod.has(url)).toBe(false);
    await act(async () => queue.current.resolve(id, "upload"));
  }
  await queue.settled("done");
});

it.each([
  "unchanged",
  "missing",
  "404 response",
])("Retry rechecks the target when it is %s", async (change) => {
  const f = await wacPod();
  const url = `${PUBLIC}placeholder`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const approved = (await client.stat(url)).etag;
  const queue = await mountedQueue(client);
  await act(async () => queue.current.enqueue(PUBLIC, [new File(["new contents"], "placeholder")]));
  await queue.settled("conflict");
  const id = queue.current.tasks[0]?.id as string;
  f.intercept(async (target, init) =>
    target === url && init?.method === "PUT" ? new Response(null, { status: 503 }) : undefined,
  );
  await act(async () => queue.current.resolve(id, "replace"));
  await queue.settled("failed");
  f.intercept(undefined);
  if (change === "missing") await f.fetch(url, { method: "DELETE" });
  const writes: (string | null)[] = [];
  let placeholderReceipt: string | null | undefined;
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok && placeholderReceipt === undefined)
      placeholderReceipt = response.headers.get("etag");
    return response;
  });
  f.intercept(async (target, init) => {
    if (target === url && init?.method === "PUT") {
      writes.push(new Headers(init.headers).get("if-match"));
      if (change === "404 response" && new Headers(init.headers).has("if-match"))
        return new Response(null, { status: 404 });
    }
    return undefined;
  });
  await act(async () => queue.current.retry(id));
  await queue.settled("conflict");
  expect(writes).toEqual([]);
  if (change === "missing") {
    await act(async () => queue.current.resolve(id, "upload"));
    await queue.settled("done");
    expect(placeholderReceipt).toBeTruthy();
    expect(writes).toEqual([null, placeholderReceipt]);
  } else {
    await act(async () => queue.current.resolve(id, "replace"));
    await queue.settled(change === "unchanged" ? "done" : "conflict");
    expect(writes).toEqual([approved]);
  }
  if (change !== "404 response") expect(await (await client.read(url)).text()).toBe("new contents");
});
