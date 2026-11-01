// AUTHORED-BY Codex

import { createRequire } from "node:module";
import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { createSolidDriveClient, parentOf } from "../src/apps/drive/lib/client/client";
import { listTrash, restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { nonWacPod } from "./drive-non-wac-pod";
import { expectPrivateRecovery } from "./drive-private-recovery";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, DRIVE, OWNER, PRIVATE, ROOT, turtle, WacFields } from "./drive-wac-pod";

const NOTE = "https://example.test/recovered";
const { IDBFactory, IDBObjectStore } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as {
  IDBFactory: new () => IDBFactory;
  IDBObjectStore: { prototype: IDBObjectStore };
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function recoveryData(url: string) {
  const data = new Store();
  new WacFields(url, data, DataFactory).iris(NOTE).add(`${ROOT}statement`);
  return turtle(data);
}

it.each([
  "before commit",
  "after commit",
  "during deletion bookkeeping",
  "during cleanup",
  "during index persistence",
])("Restore keeps recovered RDF with an access failure %s", async (phase) => {
  if (phase === "during deletion bookkeeping") vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === PRIVATE && init?.method === "DELETE" ? new Response(null, { status: 412 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  const [selected] = await listTrash(client, DRIVE);
  if (!selected) throw new Error("Missing partial recovery");
  f.intercept(undefined);
  await f.pod.fetch(selected.url, { method: "PUT", body: await recoveryData(selected.url) });
  // Present the arranged recovery graph before confirming Restore.
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing arranged recovery");
  let committed = false;
  let widened = false;
  if (phase === "during deletion bookkeeping") {
    const remove = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
      this: IDBObjectStore,
      key,
    ) {
      if (committed && key === entry.url) throw new Error("Deletion bookkeeping failed");
      return remove.call(this, key);
    });
  }
  f.after(async (url, method, response) => {
    if (url === entry.url && method === "DELETE" && response.ok) committed = true;
    if (
      !widened &&
      ((phase === "before commit" && url === PRIVATE && method === "PUT" && response.ok) ||
        (committed &&
          (phase === "after commit" ||
            phase === "during deletion bookkeeping" ||
            (phase === "during cleanup" &&
              url === `${parentOf(entry.url)}partial.ttl` &&
              method === "GET") ||
            (phase === "during index persistence" &&
              url === `${DRIVE}.trash/index.ttl` &&
              method === "GET"))))
    ) {
      widened = true;
      f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
    }
    return response;
  });
  await restoreItems(client, DRIVE, [entry]);
  expect(committed).toBe(phase !== "before commit");
  expect(widened).toBe(true);
  expect(f.pod.has(entry.url)).toBe(phase === "before commit");
  const survivor = await client.readRdf(PRIVATE);
  expect(survivor && new WacFields(PRIVATE, survivor.dataset, DataFactory).iris(NOTE).size).toBe(
    phase === "before commit" ? 0 : 1,
  );
  if (phase === "before commit") {
    const recovery = await client.readRdf(entry.url);
    expect(
      recovery && new WacFields(entry.url, recovery.dataset, DataFactory).iris(NOTE).size,
    ).toBe(1);
  }
});

it("move retains its source when the inherited destination disappears during final access rechecks", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const source = `${PRIVATE}secret`;
  const to = `${PRIVATE}moved`;
  let beforeDeletes = 0;
  let raced = false;
  f.after(async (url, method, response) => {
    if (!raced && beforeDeletes === 3 && url === `${PRIVATE}.policy` && method === "GET") {
      raced = true;
      await f.pod.fetch(to, { method: "DELETE" });
    }
    return response;
  });
  await expect(
    client.move(
      source,
      to,
      { kind: "confirm-move" },
      {
        beforeDelete: async () => {
          beforeDeletes += 1;
        },
      },
    ),
  ).rejects.toThrow();
  expect(raced).toBe(true);
  expect(f.pod.has(source)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: source, method: "DELETE" });
});

it.each([
  "ACP",
  "unreadable ACL",
] as const)("Delete forever fallback conditionally deletes on %s storage after real Trash access failure", async (model) => {
  const source = `${PRIVATE}secret`;
  const pod = nonWacPod(model, ROOT, source);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: pod.fetch, webId: OWNER });
  const selected = await client.stat(source);
  if (!selected.etag) throw new Error("Missing selected validator");
  expect((await trashItems(client, DRIVE, [selected], { webId: OWNER })).failed).toHaveLength(1);
  expect(pod.calls.filter(({ method }) => method === "DELETE")).toEqual([]);
  await client.remove(source, { recursive: true, ifMatch: selected.etag });
  expect(
    pod.calls
      .filter(({ method }) => method === "DELETE")
      .map(({ headers }) => headers.get("if-match")),
  ).toEqual(['"original"']);
  expect(pod.has(source)).toBe(false);
});

it.each([
  "ACP",
  "unreadable ACL",
] as const)("recursive Delete forever uses conditional deletes without reading policies on %s storage", async (model) => {
  const pod = nonWacPod(model, ROOT, `${PRIVATE}secret`);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: pod.fetch });
  await client.remove(PRIVATE, { recursive: true });
  expect(pod.has(PRIVATE)).toBe(false);
  expect(pod.has(`${PRIVATE}secret`)).toBe(false);
  expect(
    pod.calls
      .filter(({ method }) => method === "DELETE")
      .map(({ headers }) => headers.get("if-match")),
  ).toEqual(['"original"', '"revision-1"']);
  expect(pod.calls.some(({ url }) => /\.(acl|acr)$/.test(url))).toBe(false);
});

it.each([
  "file",
  "folder",
])("partial Restore retains the recovery %s if its survivor disappears during deletion access rechecks", async (kind) => {
  const f = await rdfPod();
  const original = kind === "file" ? `${PRIVATE}secret` : PRIVATE;
  if (kind === "folder") await f.pod.fetch(`${PRIVATE}secret`, { method: "DELETE" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === original && init?.method === "DELETE" ? new Response(null, { status: 412 }) : undefined,
  );
  await trashItems(client, DRIVE, [await client.stat(original)], { webId: OWNER });
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing partial recovery");
  f.intercept(undefined);
  const remove = client.remove;
  let committing = false;
  vi.spyOn(client, "remove").mockImplementation(function (this: typeof client, url, options) {
    if (url === entry.url) committing = true;
    return remove.call(this, url, options);
  });
  let raced = false;
  f.after(async (url, method, response) => {
    if (committing && !raced && method === "GET" && url.endsWith(".policy")) {
      raced = true;
      await f.pod.fetch(original, { method: "DELETE" });
    }
    return response;
  });
  expect((await restoreItems(client, DRIVE, [entry])).failed).toHaveLength(1);
  expect(raced).toBe(true);
  expect(f.pod.has(original)).toBe(false);
  expect(f.pod.has(entry.url)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: entry.url, method: "DELETE" });
});

it.each([
  "missing validator",
  "weak validator",
  "ignored precondition",
])("partial Restore retains merged recovery when its final survivor check has %s", async (mode) => {
  const f = await rdfPod();
  await f.pod.fetch(`${PRIVATE}secret`, { method: "DELETE" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === PRIVATE && init?.method === "DELETE" ? new Response(null, { status: 412 }) : undefined,
  );
  await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing partial recovery");
  f.intercept(undefined);
  f.intercept(async (url, init) =>
    mode === "ignored precondition" &&
    url === PRIVATE &&
    init?.method === "HEAD" &&
    new Headers(init.headers).has("if-match")
      ? new Response(null, { headers: { etag: '"foreign"' } })
      : undefined,
  );
  const readRdf = client.readRdf;
  vi.spyOn(client, "readRdf").mockImplementation(async (url) => {
    const result = await readRdf(url);
    if (result && url === PRIVATE && mode !== "ignored precondition")
      return {
        dataset: result.dataset,
        ...(mode === "weak validator" ? { etag: 'W/"weak"' } : {}),
      };
    return result;
  });
  expect((await restoreItems(client, DRIVE, [entry])).failed).toHaveLength(1);
  expect(f.pod.has(entry.url)).toBe(true);
});

it.each([
  404, 410,
])("a merge undo preserves the only RDF copy after a lost DELETE response confirmed by %s", async (status) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const to = `${DRIVE}public/survivor/`;
  await f.pod.fetch(`${PRIVATE}secret`, { method: "DELETE" });
  await f.pod.fetch(PRIVATE, { method: "PUT", body: await recoveryData(PRIVATE) });
  await f.pod.fetch(to, { method: "PUT", body: "" });
  f.policies.set(`${to}.policy`, await aclBody(to));
  const merged = await client.mergeContainer(PRIVATE, to, { kind: "preserve-source" });
  const etag = (await client.stat(PRIVATE)).etag;
  if (!etag) throw new Error("Missing recovery validator");
  let deleted = false;
  f.intercept(async (url, init) => {
    if (url === PRIVATE && init?.method === "DELETE") {
      await f.pod.fetch(PRIVATE, init);
      deleted = true;
      throw new TypeError("Lost DELETE response");
    }
    if (deleted && url === PRIVATE && init?.method === "HEAD")
      return new Response(null, { status });
    return undefined;
  });
  await expect(client.remove(PRIVATE, { ifMatch: etag })).rejects.toMatchObject({
    kind: "delete-pending",
  });
  f.policies.set(`${to}.policy`, await aclBody(to, true));
  await expect(merged.recheck()).rejects.toThrow();
  const survivor = await client.readRdf(to);
  expect(survivor && new WacFields(to, survivor.dataset, DataFactory).iris(NOTE).size).toBe(1);
});

it("merge compensation is disarmed by recovery deletion without a shared client scope", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const to = `${DRIVE}public/survivor/`;
  await f.pod.fetch(`${PRIVATE}secret`, { method: "DELETE" });
  await f.pod.fetch(PRIVATE, { method: "PUT", body: await recoveryData(PRIVATE) });
  await f.pod.fetch(to, { method: "PUT", body: "" });
  f.policies.set(`${to}.policy`, await aclBody(to));
  const merged = await client.mergeContainer(PRIVATE, to, { kind: "preserve-source" });
  const etag = (await client.stat(PRIVATE)).etag;
  if (!etag) throw new Error("Missing recovery validator");
  const compensation = merged.disarm[0];
  if (!compensation) throw new Error("Missing compensation");
  const disarm = vi.spyOn(compensation, "disarm");
  await client.remove(PRIVATE, {
    ifMatch: etag,
    commit: { disarm: merged.disarm, rechecks: [merged.recheck] },
  });
  expect(disarm).toHaveBeenCalledOnce();
  f.policies.set(`${to}.policy`, await aclBody(to, true));
  await expect(merged.recheck()).rejects.toThrow();
  const survivor = await client.readRdf(to);
  expect(survivor && new WacFields(to, survivor.dataset, DataFactory).iris(NOTE).size).toBe(1);
});

it("copy rollback retains its payload if the source disappears during access rechecks", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const source = `${PRIVATE}secret`;
  const to = `${PRIVATE}copy`;
  let writes = 0;
  f.after(async (url, method, response) => {
    if (url === to && method === "PUT" && response.ok && ++writes === 2) {
      await f.pod.fetch(source, { method: "DELETE" });
      f.policies.set(`${to}.policy`, await aclBody(to, true));
    }
    return response;
  });
  await expect(client.copy(source, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(f.pod.has(source)).toBe(false);
  expect(await (await f.pod.fetch(to)).text()).toBe("");
  await expectPrivateRecovery(f, "secret contents");
});

it("merge rollback checks recovery identity after access rechecks before overwriting recovered RDF", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const to = `${DRIVE}public/survivor/`;
  await f.pod.fetch(`${PRIVATE}secret`, { method: "DELETE" });
  await f.pod.fetch(PRIVATE, { method: "PUT", body: await recoveryData(PRIVATE) });
  await f.pod.fetch(to, { method: "PUT", body: "" });
  f.policies.set(`${to}.policy`, await aclBody(to));
  const merged = await client.mergeContainer(PRIVATE, to, { kind: "preserve-source" });
  const compensation = merged.disarm[0];
  if (!compensation) throw new Error("Missing compensation");
  let undoing = false;
  const rollback = compensation.rollback.bind(compensation);
  vi.spyOn(compensation, "rollback").mockImplementation(async () => {
    undoing = true;
    await rollback();
  });
  let checked = false;
  let raced = false;
  f.after(async (url, method, response) => {
    if (undoing && url === PRIVATE && method === "HEAD") checked = true;
    if (checked && !raced && url.endsWith(".policy") && method === "GET") {
      raced = true;
      await f.pod.fetch(PRIVATE, { method: "DELETE" });
    }
    return response;
  });
  f.policies.set(`${to}.policy`, await aclBody(to, true));
  await expect(merged.recheck()).rejects.toThrow();
  expect(raced).toBe(true);
  expect(f.pod.has(PRIVATE)).toBe(false);
  const survivor = await client.readRdf(to);
  expect(survivor && new WacFields(to, survivor.dataset, DataFactory).iris(NOTE).size).toBe(1);
});
