// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import { uploadFile } from "../src/apps/drive/lib/operations/operations";
import { aclBody, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };

afterEach(() => vi.unstubAllGlobals());

it.each([
  204, 404,
])("confirmed placeholder DELETE (%s) clears its durable requirement and permits upload after reload", async (status) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await wacPod();
  const to = `${PUBLIC}copy.txt`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const deletes: (string | null)[] = [];
  f.intercept(async (url, init) => {
    if (url === `${to}.policy` && init?.method === "PUT")
      return new Response(null, { status: 503 });
    if (url === to && init?.method === "DELETE")
      deletes.push(new Headers(init.headers).get("if-match"));
    return undefined;
  });
  f.after(async (url, method, response) =>
    url === to && method === "DELETE" && response.ok ? new Response(null, { status }) : response,
  );
  await expect(client.copy(`${PRIVATE}secret`, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(deletes[0]).toBeTruthy();
  expect(f.pod.has(to)).toBe(false);
  vi.resetModules();
  const { protectionLedger: freshLedger } = await import(
    "../src/apps/drive/lib/client/protection-ledger"
  );
  expect(await freshLedger(f.fetch).get(to)).toBeUndefined();
  const { createSolidDriveClient: create } = await import("../src/apps/drive/lib/client/client");
  const fresh = create({ storageUrl: ROOT, fetch: f.fetch });
  await uploadFile(fresh, PUBLIC, new Blob(["new public file"]), "copy.txt");
  expect(await (await f.anonymous(to)).text()).toBe("new public file");
});

it("a conditional upload to a vacant URL clears a stale durable requirement from an older flight", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await wacPod();
  const to = `${PUBLIC}copy.txt`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  f.intercept(async (url, init) =>
    (url === `${to}.policy` && init?.method === "PUT") || (url === to && init?.method === "DELETE")
      ? new Response(null, { status: 503 })
      : undefined,
  );
  await expect(client.copy(`${PRIVATE}secret`, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(await protectionLedger(f.fetch).get(to)).toBeDefined();
  f.intercept(undefined);
  await f.fetch(to, { method: "DELETE" });
  vi.resetModules();
  const { createSolidDriveClient: create } = await import("../src/apps/drive/lib/client/client");
  const fresh = create({ storageUrl: ROOT, fetch: f.fetch });
  await uploadFile(fresh, PUBLIC, new Blob(["new public file"]), "copy.txt");
  expect(await protectionLedger(f.fetch).get(to)).toBeUndefined();
  expect(await (await f.anonymous(to)).text()).toBe("new public file");
});

it.each([
  "deleted",
  "already gone",
  "failed",
  "offline",
  "changed",
  "pending",
])("a later conditional Delete clears protection only after confirmed absence: %s", async (mode) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await wacPod();
  const to = `${PUBLIC}copy.txt`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  f.intercept(async (url, init) =>
    (url === `${to}.policy` && init?.method === "PUT") || (url === to && init?.method === "DELETE")
      ? new Response(null, { status: 503 })
      : undefined,
  );
  await expect(client.copy(`${PRIVATE}secret`, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(await protectionLedger(f.fetch).get(to)).toBeDefined();
  const target = await client.stat(to);
  f.intercept(undefined);
  if (mode === "already gone") await f.fetch(to, { method: "DELETE" });
  if (mode === "changed") await f.fetch(to, { method: "PUT", body: "a different resource" });
  f.intercept(async (url, init) => {
    if (url === to && init?.method === "DELETE") {
      if (mode === "already gone") return new Response(null, { status: 404 });
      if (mode === "failed") return new Response(null, { status: 503 });
      if (mode === "offline") throw new TypeError("Offline");
      if (mode === "pending") return new Response(null, { status: 202 });
    }
    return undefined;
  });
  const deleting = client.remove(to, { ifMatch: target.etag as string });
  if (mode === "deleted") {
    // Private retention superseded the unresolved cleanup's old validator;
    // that old conditional DELETE can no longer remove this representation.
    await deleting;
    f.intercept(undefined);
    await f.fetch(to, { method: "DELETE" });
    await client.remove(to);
  } else if (mode === "already gone") await deleting;
  else await expect(deleting).rejects.toThrow();
  const retained = ["failed", "offline", "changed", "pending"].includes(mode);
  expect(f.pod.has(to)).toBe(retained);
  expect(Boolean(await protectionLedger(f.fetch).get(to))).toBe(retained);
});

it("a cleanup DELETE accepted for later processing retains protection until absence is confirmed", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await wacPod();
  const to = `${PUBLIC}copy.txt`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  f.intercept(async (url, init) => {
    if (url === `${to}.policy` && init?.method === "PUT")
      return new Response(null, { status: 503 });
    if (url === to && init?.method === "DELETE") return new Response(null, { status: 202 });
    return undefined;
  });
  await expect(client.copy(`${PRIVATE}secret`, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(f.pod.has(to)).toBe(true);
  expect(await protectionLedger(f.fetch).get(to)).toBeDefined();
  expect(await (await f.pod.fetch(to)).text()).toBe("");
});

it("a missing ancestor with retained protection is safely reprovisioned after a lost cleanup response", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await wacPod();
  const to = `${PUBLIC}recovered/`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  f.intercept(async (url, init) => {
    if (url === `${to}.policy` && init?.method === "PUT")
      return new Response(null, { status: 503 });
    if (url === to && init?.method === "DELETE") {
      await f.pod.fetch(url, init);
      throw new TypeError("Lost cleanup response after DELETE committed");
    }
    return undefined;
  });
  await expect(client.copy(PRIVATE, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(f.pod.has(to)).toBe(false);
  expect(await protectionLedger(f.fetch).get(to)).toBeDefined();
  f.intercept(undefined);
  f.audit([to]);
  const fresh = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await fresh.write(
    `${to}upload.txt`,
    "secret contents",
    { contentType: "text/plain", ifNoneMatch: "*" },
    { kind: "protect-ancestors" },
  );
  expect(await protectionLedger(f.fetch).get(to)).toBeUndefined();
  expect((await f.anonymous(to)).status).toBe(403);
  expect((await f.anonymous(`${to}upload.txt`)).status).toBe(403);
  expect(f.exposures).toEqual([]);
});

it.each([
  "copy",
  "new folder",
])("%s starts a fresh provisioning flight at a vacant URL with stale protection", async (operation) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await wacPod();
  const folder = operation === "new folder";
  const to = `${PUBLIC}fresh${folder ? "/" : ".txt"}`;
  const ledger = protectionLedger(f.fetch);
  // An old, incompatible requirement must not control the new resource.
  await ledger.set(to, { acl: `${PRIVATE}.policy`, from: PRIVATE, turtle: await aclBody(PRIVATE) });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  if (folder) await client.createFolder(to, { kind: "inherit-verified" });
  else await client.copy(`${PUBLIC}placeholder`, to, { kind: "preserve-source" });
  expect(await ledger.get(to)).toBeUndefined();
  expect((await f.anonymous(to)).ok).toBe(true);
});

it.each([
  "no target",
  "wrong URL",
  "missing ETag",
  "weak ETag",
  "wildcard ETag",
  "malformed ETag",
])("Replace refuses %s without looking up a new validator", async (mode) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const url = `${PUBLIC}placeholder`;
  const target =
    mode === "no target"
      ? undefined
      : {
          url: mode === "wrong URL" ? `${PUBLIC}other` : url,
          ...(mode === "missing ETag"
            ? {}
            : {
                etag:
                  mode === "weak ETag"
                    ? 'W/"old"'
                    : mode === "wildcard ETag"
                      ? "*"
                      : mode === "malformed ETag"
                        ? "old"
                        : '"old"',
              }),
        };
  const before = f.calls.length;
  await expect(
    uploadFile(client, PUBLIC, new Blob(["contents"]), "placeholder", "replace", target),
  ).rejects.toMatchObject({ kind: "conflict" });
  expect(f.calls).toHaveLength(before);
});
