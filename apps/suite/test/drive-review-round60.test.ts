// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import {
  accessControl,
  bindAccess,
  DriveAccessChangedError,
} from "../src/apps/drive/lib/client/access";
import { ancestorGuard, policyArchiveOf } from "../src/apps/drive/lib/client/ancestors";
import {
  createSolidDriveClient,
  DrivePartialFailureError,
} from "../src/apps/drive/lib/client/client";
import { protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import {
  deleteForever,
  listTrash,
  moveItems,
  renameItem,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, DRIVE, OWNER, PRIVATE, PUBLIC, ROOT, turtle, WacFields } from "./drive-wac-pod";

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

it.each([
  "endpoint",
  "policy",
])("round 60: protection requires a pre-hydrated ACL %s before any I/O", async (missing) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const access = accessControl(f.fetch, ROOT);
  const state = await access.effective(PRIVATE);
  if (state.status !== "known") throw new Error("Missing policy");
  const etag = (await client.stat(PRIVATE)).etag as string;
  const provision = ancestorGuard({
    storageUrl: ROOT,
    http: f.fetch,
    access,
    readRdf: client.readRdf,
    putFolder: async () => {
      throw new Error("Unexpected PUT");
    },
    error: () => new Error("HTTP failure"),
    owner: () => OWNER,
    deleteVersion: async () => {
      throw new Error("Unexpected DELETE");
    },
  });
  f.calls.length = 0;
  if (missing === "endpoint")
    await expect(
      provision.protect(PRIVATE, state.policy, PRIVATE, {
        identity: { url: PRIVATE, etag },
        expectedAcl: null,
      }),
    ).rejects.toMatchObject({ cause: "ACL endpoint unavailable" });
  else {
    const guard = { identity: { url: PRIVATE, etag }, knownAcl: state.policy.url };
    // @ts-expect-error Even a known endpoint needs its captured own policy or absence.
    await expect(provision.protect(PRIVATE, state.policy, PRIVATE, guard)).rejects.toMatchObject({
      cause: "Own ACL receipt unavailable",
    });
  }
  expect(f.calls).toEqual([]);
});

it("round 60: metadata undo refuses foreign RDF even when a server reuses its ETag", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}recovery/`;
  const to = `${PRIVATE}existing/`;
  const data = new Store();
  new WacFields(from, data, DataFactory).iris("https://example.test/note").add("urn:original");
  await f.pod.fetch(from, { method: "PUT", body: await turtle(data) });
  await f.pod.fetch(to, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const merged = await client.mergeContainer(from, to, { kind: "preserve-source" });
  let failed = false;
  let changed = false;
  f.intercept(async (url, init) => {
    if (!failed && url === `${to}.policy` && !init?.method) {
      failed = true;
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (url === to && method === "GET") {
      changed = true;
      const foreign = new Store();
      new WacFields(to, foreign, DataFactory).iris("https://example.test/note").add("urn:foreign");
      return new Response(await turtle(foreign), { headers: response.headers });
    }
    return response;
  });
  f.calls.length = 0;
  await expect(merged.recheck()).rejects.toMatchObject({ kind: "conflict", status: 409 });
  expect(changed).toBe(true);
  expect(f.calls.filter(({ method }) => method === "PUT" || method === "DELETE")).toEqual([]);
  expect(f.pod.has(from)).toBe(true);
});

it("round 60: explicit demo access can replay a failed overwrite without fabricating an ACL validator", async () => {
  const pod = createDemoPod({
    root: ROOT,
    seed: [{ path: "original", body: "original", contentType: "text/plain" }],
  });
  const url = `${ROOT}original`;
  let written = false;
  let failed = false;
  const http: typeof fetch = async (input, init) => {
    if (written && !failed && String(input) === url && init?.method === "HEAD") {
      failed = true;
      return new Response(null, { status: 503 });
    }
    const response = await pod.fetch(input, init);
    if (String(input) === url && init?.method === "PUT" && response.ok) written = true;
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  await expect(
    uploadFile(
      client,
      ROOT,
      new Blob(["replacement"]),
      "original",
      "replace",
      await client.stat(url),
    ),
  ).rejects.toThrow();
  expect(failed).toBe(true);
  expect(await (await pod.fetch(url)).text()).toBe("original");
});

it.each([
  "Restore",
  "Delete forever",
])("round 60: %s preserves a replaced policy archive after refused conditional cleanup", async (step) => {
  const f = await rdfPod();
  const source = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const [entry] = (await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER }))
    .done;
  if (!entry) throw new Error("Missing recovery");
  const archive = policyArchiveOf(entry.url) as string;
  const foreign = `${await (await f.pod.fetch(archive)).text()}\n`;
  let replaced = false;
  const remove = client.remove;
  vi.spyOn(client, "remove").mockImplementation(async function (this: typeof client, url, options) {
    if (url === archive && !replaced) {
      replaced = true;
      await f.pod.fetch(archive, { method: "PUT", body: foreign });
    }
    return remove.call(this, url, options);
  });
  const reads = vi.spyOn(client, "readVersion");
  const result = await (step === "Restore"
    ? restoreItems(client, DRIVE, [entry])
    : deleteForever(client, DRIVE, [entry]));
  expect(replaced).toBe(true);
  expect(result.failed).toHaveLength(1);
  expect(reads.mock.calls.filter(([url]) => url === archive).length).toBeGreaterThanOrEqual(2);
  expect(await (await f.pod.fetch(archive)).text()).toBe(foreign);
  expect(f.calls).not.toContainEqual({ url: archive, method: "DELETE" });
});

it.each([
  "Replace",
  "standalone overwrite",
])("round 60: failed %s preserves captured own ACL absence and future inheritance", async (step) => {
  const f = await rdfPod();
  const url = `${PUBLIC}shared`;
  await f.pod.fetch(url, { method: "PUT", body: "original" });
  await f.pod.fetch(`${PUBLIC}sibling`, { method: "PUT", body: "sibling" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let written = false;
  let failed = false;
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) written = true;
    return response;
  });
  f.intercept(async (target, init) => {
    if (written && !failed && target === `${url}.policy` && !init?.method) {
      failed = true;
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  const run =
    step === "Replace"
      ? uploadFile(client, PUBLIC, new Blob(["replacement"]), "shared", "replace", selected)
      : client.write(
          url,
          "replacement",
          { contentType: "text/plain", ifMatch: selected.etag as string },
          { kind: "protect-ancestors" },
        );
  await expect(run).rejects.toThrow();
  expect(failed).toBe(true);
  expect(await (await f.pod.fetch(url)).text()).toBe("original");
  expect(f.policies.has(`${url}.policy`)).toBe(false);
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC));
  expect((await f.anonymous(url)).status).toBe(403);
  expect((await f.anonymous(`${PUBLIC}sibling`)).status).toBe(403);
});

it.each([
  "folder overwrite",
  "metadata undo",
])("round 60: failed %s preserves inherited sharing for nonempty folder metadata", async (step) => {
  const f = await rdfPod();
  const url = `${PUBLIC}existing/`;
  const from = `${PUBLIC}recovery/`;
  const data = new Store();
  new WacFields(url, data, DataFactory).iris("https://example.test/note").add("urn:original");
  await f.pod.fetch(url, { method: "PUT", body: await turtle(data) });
  const incoming = new Store();
  new WacFields(from, incoming, DataFactory).iris("https://example.test/note").add("urn:incoming");
  await f.pod.fetch(from, { method: "PUT", body: await turtle(incoming) });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let written = false;
  let failed = false;
  f.after(async (target, method, response) => {
    if (target === url && method === "PUT" && response.ok) written = true;
    return response;
  });
  f.intercept(async (target, init) => {
    if (written && !failed && target === `${url}.policy` && !init?.method) {
      failed = true;
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  const run =
    step === "metadata undo"
      ? client.mergeContainer(from, url, { kind: "preserve-source" })
      : client.write(
          url,
          "",
          { contentType: "text/turtle", ifMatch: selected.etag as string },
          { kind: "protect-ancestors" },
        );
  await expect(run).rejects.toThrow();
  expect(failed).toBe(true);
  const current = await client.readRdf(url);
  expect([
    ...new WacFields(url, current?.dataset as Store, DataFactory).iris("https://example.test/note"),
  ]).toEqual(["urn:original"]);
  expect(f.policies.has(`${url}.policy`)).toBe(false);
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC));
  expect((await f.anonymous(url)).status).toBe(403);
});

it.each([
  "Move",
  "Rename",
  "preserve-source",
])("round 60: %s rechecks surviving access after committed source DELETE retirement", async (step) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const destination = step === "Rename" ? PRIVATE : PUBLIC;
  const to = `${destination}${step === "Move" ? "secret" : "moved"}`;
  f.policies.set(`${destination}.policy`, await aclBody(destination));
  const widened = await aclBody(destination, true);
  const widenedOwn = await aclBody(to, true);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(from);
  let deleted = false;
  let changed = false;
  f.after(async (url, method, response) => {
    if (url === from && method === "DELETE" && response.ok) deleted = true;
    return response;
  });
  const remove = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (deleted && !changed) {
      changed = true;
      if (step === "preserve-source") f.policies.set(`${to}.policy`, widenedOwn);
      else f.policies.set(`${destination}.policy`, widened);
    }
    return remove.call(this, key);
  });
  // Move and Rename share confirm-move's transfer path; preserve-source is used
  // by Trash/Restore/Undo and installs a separate policy at the destination.
  const result = await (step === "Move"
    ? moveItems(client, [selected], destination)
    : step === "Rename"
      ? renameItem(client, selected, "moved")
      : client.move(from, to, { kind: "preserve-source" }, { ifMatch: selected.etag as string })
  ).catch((cause: unknown) => cause);
  const error =
    step === "Move" ? (result as Awaited<ReturnType<typeof moveItems>>).failed[0]?.error : result;
  expect(changed).toBe(true);
  expect(f.pod.has(from)).toBe(false);
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  const retained = (error as DrivePartialFailureError).retainedDestinations;
  expect(retained.length).toBeGreaterThan(0);
  expect(retained.some((url) => f.pod.has(url))).toBe(true);
  for (const url of retained) expect((await f.anonymous(url)).status).toBe(403);
  expect(f.policies.get(`${destination}.policy`)).toBe(
    step === "preserve-source" ? await aclBody(destination) : widened,
  );
  if (step === "preserve-source") expect(f.policies.get(`${to}.policy`)).toBe(widenedOwn);
});

it.each([
  "source",
  "destination",
])("round 60: binding pins absent %s ACL endpoints even when both policies have no validator", async (side) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const to = `${PRIVATE}copy`;
  const binding = await bindAccess(accessControl(f.fetch, ROOT), from, to);
  const target = side === "source" ? from : to;
  f.after(async (url, method, response) => {
    if (url === target && method === "HEAD")
      response.headers.set("link", `<${PRIVATE}other.policy>; rel="acl"`);
    return response;
  });
  await expect(binding.recheck()).rejects.toBeInstanceOf(DriveAccessChangedError);
});

it.each([
  "protection repair",
  "container provisioning",
  "owner-only overwrite",
  "Trash protection",
])("round 60: %s refuses replacement of a captured absent ACL endpoint", async (step) => {
  const f = await rdfPod();
  const url =
    step === "container provisioning" || step === "Trash protection"
      ? `${PRIVATE}folder/`
      : `${PRIVATE}secret`;
  if (step === "Trash protection") await f.pod.fetch(url, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = step === "container provisioning" ? undefined : await client.stat(url);
  if (step === "protection repair")
    await protectionLedger(f.fetch).set(url, {
      acl: `${PRIVATE}.policy`,
      from: PRIVATE,
      turtle: f.policies.get(`${PRIVATE}.policy`) as string,
      etag: selected?.etag as string,
      ownAcl: { url: `${url}.policy`, etag: null },
    });
  let observed = false;
  let replaced = false;
  let discoveryReads = 0;
  f.after(async (target, method, response) => {
    if (target === `${url}.policy` && method === "GET") observed = true;
    if (observed && target === url && method === "HEAD") {
      replaced = true;
      response.headers.set("link", `<${url}other.policy>; rel="acl"`);
    }
    if (
      (step === "owner-only overwrite" || step === "Trash protection") &&
      target === url &&
      method === "HEAD" &&
      ++discoveryReads > 1
    )
      observed = true;
    return response;
  });
  const run =
    step === "protection repair"
      ? client.read(url)
      : step === "container provisioning"
        ? client.createFolder(url, { kind: "owner-only", webId: OWNER })
        : step === "Trash protection"
          ? client.prepareTrash(url, { kind: "owner-only", webId: OWNER })
          : client.write(
              url,
              "replacement",
              { contentType: "text/plain", ifMatch: selected?.etag as string },
              { kind: "owner-only" },
            );
  await expect(run).rejects.toThrow(/access|policy|protection/i);
  expect(replaced).toBe(true);
  expect(
    f.calls.filter(({ method, url: target }) => method === "PUT" && target.endsWith(".policy")),
  ).toEqual([]);
});

it("round 60: partial Restore compares a shared original against the archived policy after Trash DELETE 403", async () => {
  const f = await rdfPod();
  const url = `${PUBLIC}shared`;
  await f.pod.fetch(url, { method: "PUT", body: "shared original" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (target, init) =>
    target === url && init?.method === "DELETE" ? new Response(null, { status: 403 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(url)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  expect((await f.anonymous(url)).status).toBe(200);
  expect((await f.anonymous(entry.url)).status).toBe(403);
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect(f.pod.has(entry.url)).toBe(false);
  expect((await f.anonymous(url)).status).toBe(200);
});

it.each([
  "install",
  "private folder",
  "protection repair",
  "provisioning",
])("round 60: %s pins the ACL endpoint through its final resource identity HEAD", async (step) => {
  const f = await rdfPod();
  const url = step === "provisioning" ? `${PRIVATE}folder/` : PRIVATE;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const access = accessControl(f.fetch, ROOT);
  const policy = await access.effective(PRIVATE);
  if (policy.status !== "known") throw new Error("Missing policy");
  if (step === "protection repair") {
    f.policies.delete(`${PRIVATE}.policy`);
    const selected = await client.stat(PRIVATE);
    await protectionLedger(f.fetch).set(PRIVATE, {
      acl: policy.policy.url,
      from: PRIVATE,
      turtle: await aclBody(PRIVATE),
      etag: selected.etag as string,
      ownAcl: { url: `${PRIVATE}.policy`, etag: null },
    });
  }
  let replaced = false;
  f.intercept(async (target, init) => {
    if (target === url && init?.method === "HEAD" && new Headers(init.headers).has("if-match")) {
      replaced = true;
      const response = await f.pod.fetch(target, init);
      response.headers.delete("x-solid-demo-access-control");
      response.headers.set("link", `<${url}other.policy>; rel="acl"`);
      return response;
    }
    return undefined;
  });
  const run =
    step === "install"
      ? access.install(policy.policy, PRIVATE, url)
      : step === "private folder"
        ? access.privateFolder(url, OWNER)
        : step === "protection repair"
          ? client.list(PRIVATE)
          : client.createFolder(url, { kind: "owner-only", webId: OWNER });
  await expect(run).rejects.toThrow();
  expect(replaced).toBe(true);
  expect(
    f.calls.filter(({ method, url: target }) => method === "PUT" && target.endsWith(".policy")),
  ).toEqual([]);
});
