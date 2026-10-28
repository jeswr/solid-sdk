// AUTHORED-BY Codex
import { afterEach, expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { moveWithValidator } from "../src/apps/drive/state/undo";
import { aclBody, DRIVE, OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

afterEach(() => vi.unstubAllGlobals());

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const upload = (client: ReturnType<typeof createSolidDriveClient>, name: string) =>
  client.write(`${PRIVATE}${name}`, "secret contents", { contentType: "text/plain" });

async function recreatedFolder(trashFile = false) {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const file = trashFile
    ? (await trashItems(client, DRIVE, [await client.stat(`${PRIVATE}secret`)], { webId: OWNER }))
        .done[0]
    : undefined;
  const trashed = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  expect(trashed.failed).toEqual([]);
  expect(f.pod.has(PRIVATE)).toBe(false);
  f.audit([PRIVATE]);
  f.calls.length = 0;
  return { f, client, file };
}

it.each([
  false,
  true,
])("concurrent uploads await the recreated ancestor ACL PUT (503: %s)", async (fail) => {
  vi.stubGlobal("navigator", fail ? undefined : {});
  const { f, client } = await recreatedFolder();
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.intercept(async (url, init) => {
    if (url === `${PRIVATE}.policy` && init?.method === "PUT") {
      reached.resolve();
      await release.promise;
      if (fail) return new Response(null, { status: 503 });
    }
    return undefined;
  });
  const first = upload(client, "first");
  await reached.promise;
  const second = upload(client, "second");
  const done = Promise.allSettled([first, second]);
  try {
    await turn();
    expect(f.pod.has(`${PRIVATE}first`)).toBe(false);
    expect(f.pod.has(`${PRIVATE}second`)).toBe(false);
    await client.write(`${PUBLIC}unrelated`, "unrelated", { contentType: "text/plain" });
    expect(f.pod.has(`${PUBLIC}unrelated`)).toBe(true);
    expect(f.exposures).toEqual([]);
  } finally {
    release.resolve();
    await done;
  }
  expect((await done).map((result) => result.status)).toEqual(
    fail ? ["rejected", "rejected"] : ["fulfilled", "fulfilled"],
  );
  expect(f.pod.has(PRIVATE)).toBe(!fail);
  expect(f.pod.has(`${PRIVATE}first`)).toBe(!fail);
  expect(f.pod.has(`${PRIVATE}second`)).toBe(!fail);
  expect(f.exposures).toEqual([]);
  expect(
    f.calls.filter(({ url, method }) => url === `${PRIVATE}.policy` && method === "PUT"),
  ).toHaveLength(1);
  if (fail)
    expect(
      f.calls.filter(({ url, method }) => method === "PUT" && /\/(first|second)$/.test(url)),
    ).toEqual([]);
  else {
    expect((await f.anonymous(`${PRIVATE}first`)).status).toBe(403);
    expect((await f.anonymous(`${PRIVATE}second`)).status).toBe(403);
  }
});

it("a second client waits until the recreated ancestor ACL has been verified", async () => {
  vi.stubGlobal("navigator", {});
  const { f, client } = await recreatedFolder();
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.after(async (url, method, response) => {
    if (url === `${PRIVATE}.policy` && method === "GET" && response.ok) {
      reached.resolve();
      await release.promise;
    }
    return response;
  });
  const first = upload(client, "first");
  await reached.promise;
  const other = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const second = upload(other, "second");
  const done = Promise.all([first, second]);
  try {
    await turn();
    expect(f.pod.has(`${PRIVATE}second`)).toBe(false);
  } finally {
    release.resolve();
    await done;
  }
  expect(f.pod.has(`${PRIVATE}first`)).toBe(true);
  expect(f.pod.has(`${PRIVATE}second`)).toBe(true);
  expect(f.exposures).toEqual([]);
});

// A separate module registry models a tab; only the pod and Web Locks are shared.
async function otherTab(f: Awaited<ReturnType<typeof wacPod>>) {
  vi.resetModules();
  const { createSolidDriveClient: create } = await import("../src/apps/drive/lib/client/client");
  return create({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
}

function webLocks(enter: (name: string, index: number) => Promise<void> = async () => {}) {
  const queues = new Map<string, Promise<void>>();
  const counts = new Map<string, number>();
  const request = vi.fn((name: string, work: () => Promise<void>) => {
    const index = (counts.get(name) ?? 0) + 1;
    counts.set(name, index);
    const previous = queues.get(name) ?? Promise.resolve();
    const pending = previous
      .catch(() => undefined)
      .then(async () => {
        await enter(name, index);
        await work();
      });
    queues.set(name, pending);
    return pending;
  });
  vi.stubGlobal("navigator", { locks: { request } });
  return request;
}

it.each([
  "ACL PUT",
  "verification",
  "503",
])("Web Locks hold a second tab before payload writes during %s", async (phase) => {
  const { f, client } = await recreatedFolder();
  const request = webLocks();
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.intercept(async (url, init) => {
    if (url === `${PRIVATE}.policy` && init?.method === "PUT" && phase !== "verification") {
      reached.resolve();
      await release.promise;
      if (phase === "503") return new Response(null, { status: 503 });
    }
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (
      url === `${PRIVATE}.policy` &&
      method === "GET" &&
      response.ok &&
      phase === "verification"
    ) {
      reached.resolve();
      await release.promise;
    }
    return response;
  });
  const first = upload(client, "first");
  await reached.promise;
  const second = upload(await otherTab(f), "second");
  const settled = vi.fn();
  void second.then(settled, settled);
  const done = Promise.allSettled([first, second]);
  try {
    await turn();
    expect(settled).not.toHaveBeenCalled();
    expect(
      request.mock.calls.filter(([name]) => name === `solid-drive:ancestor:${PRIVATE}`),
    ).toHaveLength(2);
    expect(f.pod.has(`${PRIVATE}first`)).toBe(false);
    expect(f.pod.has(`${PRIVATE}second`)).toBe(false);
  } finally {
    release.resolve();
    await done;
  }
  expect((await done).map((result) => result.status)).toEqual(
    phase === "503" ? ["rejected", "rejected"] : ["fulfilled", "fulfilled"],
  );
  expect(f.pod.has(PRIVATE)).toBe(phase !== "503");
  expect(f.exposures).toEqual([]);
});

it.each([
  "matching",
  "public",
  "missing",
  "unreadable",
  "HEAD denied",
])("a tab expecting to provision re-reads a concurrently created ancestor ACL (%s)", async (policy) => {
  const { f, client } = await recreatedFolder();
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const request = webLocks(async (name, index) => {
    if (name !== `solid-drive:ancestor:${PRIVATE}`) return;
    if (index === 1) {
      reached.resolve();
      await release.promise;
    } else {
      if (policy === "public") f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
      if (policy === "missing") f.policies.delete(`${PRIVATE}.policy`);
      if (policy === "unreadable" || policy === "HEAD denied")
        f.intercept(async (url) =>
          url === (policy === "unreadable" ? `${PRIVATE}.policy` : PRIVATE)
            ? new Response(null, { status: 503 })
            : undefined,
        );
    }
  });
  const first = upload(client, "first");
  await reached.promise;
  const second = upload(await otherTab(f), "second");
  const done = Promise.allSettled([first, second]);
  // Both tabs must have observed 404 and queued their provisioning before creation.
  await turn();
  try {
    expect(
      request.mock.calls.filter(([name]) => name === `solid-drive:ancestor:${PRIVATE}`),
    ).toHaveLength(2);
  } finally {
    release.resolve();
    await done;
  }
  const results = await done;
  expect(results[1]?.status).toBe(policy === "matching" ? "fulfilled" : "rejected");
  expect(f.pod.has(`${PRIVATE}second`)).toBe(policy === "matching");
  expect(
    f.calls.filter(({ url, method }) => url === `${PRIVATE}.policy` && method === "PUT"),
  ).toHaveLength(1);
  // Mutating the verified policy above is an external edit, after the first upload's guard.
  if (policy === "matching") expect(f.exposures).toEqual([]);
});

it("simultaneous provisioning shares one create and ACL installation without Web Locks", async () => {
  vi.stubGlobal("navigator", {});
  const { f, client } = await recreatedFolder();
  await Promise.all([upload(client, "first"), upload(client, "second")]);
  expect(f.calls.filter(({ url, method }) => url === PRIVATE && method === "PUT")).toHaveLength(1);
  expect(
    f.calls.filter(({ url, method }) => url === `${PRIVATE}.policy` && method === "PUT"),
  ).toHaveLength(1);
  expect(f.exposures).toEqual([]);
});

it.each([
  "nested upload",
  "restore",
  "move",
  "copy",
  "undo",
  "new folder",
])("%s waits for the same pending ancestor ACL and fails without writes on 503", async (operation) => {
  const { f, client, file } = await recreatedFolder(operation === "restore");
  await client.write(`${PUBLIC}source`, "secret contents", { contentType: "text/plain" });
  const source = `${PUBLIC}source`;
  const sourceItem = await client.stat(source);
  const trashed = await trashItems(client, DRIVE, [sourceItem], { webId: OWNER });
  const entry = trashed.done[0];
  if (!entry) throw new Error("Missing source");
  if (operation === "restore") expect(file).toBeDefined();
  const restoring = file ?? entry;
  f.exposures.length = 0;
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  f.intercept(async (url, init) => {
    if (url === `${PRIVATE}.policy` && init?.method === "PUT") {
      reached.resolve();
      await release.promise;
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  const first = upload(client, "first");
  await reached.promise;
  const second =
    operation === "nested upload"
      ? client.write(`${PRIVATE}nested/second`, "secret contents", { contentType: "text/plain" })
      : operation === "restore"
        ? restoreItems(client, DRIVE, [restoring])
        : operation === "new folder"
          ? client.createFolder(`${PRIVATE}nested/`)
          : operation === "copy"
            ? client.copy(entry.url, `${PRIVATE}second`)
            : operation === "move"
              ? client.move(entry.url, `${PRIVATE}second`)
              : moveWithValidator(
                  { storageUrl: ROOT, fetch: f.fetch, webId: OWNER },
                  entry.url,
                  `${PRIVATE}second`,
                  (await client.stat(entry.url)).etag as string,
                );
  const settled = vi.fn();
  void second.then(settled, settled);
  const done = Promise.allSettled([first, second]);
  try {
    await turn();
    expect(settled).not.toHaveBeenCalled();
    expect(f.pod.has(`${PRIVATE}second`)).toBe(false);
    expect(f.pod.has(`${PRIVATE}nested/`)).toBe(false);
  } finally {
    release.resolve();
    await done;
  }
  const results = await done;
  expect(results[0]?.status).toBe("rejected");
  if (operation === "restore")
    expect(await second).toEqual(expect.objectContaining({ failed: [expect.anything()] }));
  else expect(results[1]?.status).toBe("rejected");
  expect(f.pod.has(PRIVATE)).toBe(false);
  expect(f.exposures).toEqual([]);
});

it("a delayed HEAD 200 cannot outlive a failed ancestor flight and permit a public write", async () => {
  vi.stubGlobal("navigator", {});
  const { f, client } = await recreatedFolder();
  const aclPut = Promise.withResolvers<void>();
  const releaseAcl = Promise.withResolvers<void>();
  const head = Promise.withResolvers<void>();
  const releaseHead = Promise.withResolvers<void>();
  f.intercept(async (url, init) => {
    if (url === `${PRIVATE}.policy` && init?.method === "PUT") {
      aclPut.resolve();
      await releaseAcl.promise;
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  const first = upload(client, "first");
  await aclPut.promise;
  let delay = true;
  f.after(async (url, method, response) => {
    if (url === PRIVATE && method === "HEAD" && delay) {
      delay = false;
      expect(response.status).toBe(200);
      head.resolve();
      await releaseHead.promise;
    }
    return response;
  });
  const second = upload(client, "second");
  const done = Promise.allSettled([first, second]);
  try {
    await head.promise;
    releaseAcl.resolve();
    await expect(first).rejects.toThrow();
    expect(f.pod.has(PRIVATE)).toBe(false);
  } finally {
    releaseAcl.resolve();
    releaseHead.resolve();
    await done;
  }
  expect((await done).map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(f.pod.has(PRIVATE)).toBe(false);
  expect(f.exposures).toEqual([]);
  f.intercept(undefined);
  await upload(client, "retry");
  expect((await f.anonymous(`${PRIVATE}retry`)).status).toBe(403);
  expect(f.exposures).toEqual([]);
});
