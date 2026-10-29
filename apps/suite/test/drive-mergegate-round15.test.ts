// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import { restoreItems, trashItems, uploadFile } from "../src/apps/drive/lib/operations/operations";
import { aclBody, DRIVE, OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };

afterEach(() => vi.unstubAllGlobals());

it("a file placeholder without its PUT validator retains empty recovery without adopting a later identity", async () => {
  const f = await wacPod();
  const to = `${PUBLIC}copy.txt`;
  f.after(async (url, method, response) => {
    if (url === to && method === "PUT") response.headers.delete("etag");
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(
    client.copy(`${PRIVATE}secret`, to, { kind: "preserve-source" }),
  ).rejects.toMatchObject({
    kind: "partial-failure",
    retainedDestinations: [to],
  });
  expect(await (await f.pod.fetch(to)).text()).toBe("");
  // No captured identity can authorize an ACL PUT on this endpoint. Its
  // durable requirement blocks payload writes; no confidential bytes were sent.
  expect(f.calls).not.toContainEqual({ url: `${to}.policy`, method: "PUT" });
  expect(await protectionLedger(f.fetch).get(to)).toBeDefined();
});

it.each([
  { fail: false, upload: false },
  { fail: true, upload: false },
  { fail: false, upload: true },
  { fail: true, upload: true },
])("copy refuses immediate Replace until file ACL verification finishes ($fail, upload: $upload)", async ({
  fail,
  upload,
}) => {
  const f = await wacPod();
  const from = `${PRIVATE}secret`;
  const to = `${PUBLIC}copy.txt`;
  f.policies.set(`${from}.policy`, await aclBody(from));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const beforePut: unknown[] = [];
  f.intercept(async (url, init) => {
    if (url === to && init?.method === "PUT")
      beforePut.push(await protectionLedger(f.fetch).get(to));
    if (url === `${to}.policy` && init?.method === "PUT") {
      reached.resolve();
      await release.promise;
      if (fail) return new Response(null, { status: 503 });
    }
    if (fail && url === to && init?.method === "DELETE") return new Response(null, { status: 503 });
    return undefined;
  });
  f.audit();
  expect((await f.anonymous(from)).status).toBe(403);
  const copying = client.copy(from, to, { kind: "preserve-source" });
  const copyResult = copying.catch((error: unknown) => error);
  await reached.promise;
  const fresh = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const approved = await fresh.stat(to);
  const replacing = upload
    ? uploadFile(fresh, PUBLIC, new Blob(["secret contents"]), "copy.txt", "replace", approved)
    : fresh.write(
        to,
        "secret contents",
        { contentType: "text/plain" },
        { kind: "protect-ancestors" },
      );
  const done = Promise.allSettled([copying, replacing]);
  try {
    await expect(replacing).rejects.toMatchObject({ kind: "operation-in-progress" });
    expect(beforePut).toHaveLength(1);
    expect(beforePut[0]).toBeDefined();
    expect(await (await f.anonymous(to)).text()).not.toBe("secret contents");
  } finally {
    release.resolve();
    await done;
    await copyResult;
  }
  if (!fail) {
    if (upload)
      await uploadFile(
        fresh,
        PUBLIC,
        new Blob(["secret contents"]),
        "copy.txt",
        "replace",
        await fresh.stat(to),
      );
    else
      await fresh.write(
        to,
        "secret contents",
        { contentType: "text/plain" },
        { kind: "protect-ancestors" },
      );
    expect((await f.anonymous(to)).status).toBe(403);
  }
  expect(f.exposures).toEqual([]);
});

it.each([
  "copy",
  "move",
  "restore",
  "keep-access move",
])("%s commits file protection before creation and retains it through verification", async (operation) => {
  const f = await wacPod();
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    webId: OWNER,
    confirmAccess: async () => "keep",
  });
  const from = `${PRIVATE}secret`;
  let to = `${PUBLIC}copy.txt`;
  const entry =
    operation === "restore"
      ? (await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER })).done[0]
      : undefined;
  if (operation === "restore") to = from;
  const ledger = protectionLedger(f.fetch);
  const beforePut = vi.fn();
  const beforeVerify = vi.fn();
  f.intercept(async (url, init) => {
    if (url === to && init?.method === "PUT" && init.body === "") {
      expect(await ledger.get(to)).toBeDefined();
      beforePut();
    }
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (url === `${to}.policy` && method === "GET" && response.ok) {
      if (!beforeVerify.mock.calls.length) expect(await ledger.get(to)).toBeDefined();
      beforeVerify();
    }
    return response;
  });
  f.audit();
  if (operation === "restore") {
    if (!entry) throw new Error("Missing trashed file");
    expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  } else if (operation === "copy") await client.copy(from, to, { kind: "preserve-source" });
  else
    await client.move(from, to, {
      kind: operation === "move" ? "preserve-source" : "confirm-move",
    });
  expect(beforePut).toHaveBeenCalledOnce();
  expect(beforeVerify).toHaveBeenCalled();
  expect(await ledger.get(to)).toBeUndefined();
  expect((await f.anonymous(to)).status).toBe(403);
  expect(f.exposures).toEqual([]);
});

it.each([
  "ACL 503",
  "hidden Link",
])("failed file protection survives reload and refuses reads and replacements: %s", async (mode) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await wacPod();
  const from = `${PRIVATE}secret`;
  const to = `${PUBLIC}copy.txt`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  f.intercept(async (url, init) =>
    (url === to && init?.method === "DELETE") ||
    (mode === "ACL 503" && url === `${to}.policy` && init?.method === "PUT")
      ? new Response(null, { status: 503 })
      : undefined,
  );
  f.after(async (url, _method, response) => {
    if (mode === "hidden Link" && url === to) response.headers.delete("link");
    return response;
  });
  await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(f.pod.has(to)).toBe(true);
  expect(await protectionLedger(f.fetch).get(to)).toBeDefined();
  vi.resetModules();
  const { createSolidDriveClient: create } = await import("../src/apps/drive/lib/client/client");
  const fresh = create({ storageUrl: ROOT, fetch: f.fetch });
  for (const read of [fresh.read, fresh.readVersion, fresh.readRdf])
    await expect(read(to)).rejects.toThrow(/sharing could not be secured/);
  await expect(
    fresh.write(
      to,
      "secret contents",
      { contentType: "text/plain" },
      { kind: "protect-ancestors" },
    ),
  ).rejects.toThrow();
  expect(await (await f.anonymous(to)).text()).toBe("");
  expect((await fresh.list(PUBLIC)).find((item) => item.url === to)).toMatchObject({
    protectionRequired: true,
  });
  expect(await fresh.stat(to)).toMatchObject({ protectionRequired: true });
  f.intercept(undefined);
  f.after(undefined);
  await fresh.read(to);
  expect(await protectionLedger(f.fetch).get(to)).toBeUndefined();
  expect((await f.anonymous(to)).status).toBe(403);
});
