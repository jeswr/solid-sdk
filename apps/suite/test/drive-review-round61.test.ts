// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { accessControl, bindAccess, privateAcl } from "../src/apps/drive/lib/client/access";
import { ancestorGuard } from "../src/apps/drive/lib/client/ancestors";
import {
  createSolidDriveClient,
  DrivePartialFailureError,
} from "../src/apps/drive/lib/client/client";
import { protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import {
  copyItem,
  createFolder,
  listTrash,
  moveItems,
  renameItem,
  restoreItems,
  trashItems,
  uploadFile,
} from "../src/apps/drive/lib/operations/operations";
import { trashEntries, trashIndexFrom } from "../src/apps/drive/lib/operations/trash-index";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, DRIVE, OWNER, PRIVATE, PUBLIC, ROOT, turtle } from "./drive-wac-pod";

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
  "New folder",
  "Upload",
  "Move",
  "Copy",
  "Rename",
  "Trash",
  "Restore",
  "folder Move",
  "container merge",
  "owner-only folder",
  "owner-only file",
])("round 61: %s establishes discovery from conditional creation when 404 has no Link", async (step) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const source =
    step === "folder Move" || step === "container merge" ? `${PRIVATE}tree/` : `${PRIVATE}secret`;
  if (source.endsWith("/")) {
    await f.pod.fetch(source, { method: "PUT", body: "" });
    if (step === "folder Move")
      await f.pod.fetch(`${source}child`, { method: "PUT", body: "secret contents" });
  }
  const selected = await client.stat(source);
  const archived =
    step === "Restore"
      ? (await trashItems(client, DRIVE, [selected], { webId: OWNER })).done[0]
      : undefined;
  f.after(async (_url, _method, response) => {
    if (response.status === 404) response.headers.delete("link");
    return response;
  });
  const destination = `${PRIVATE}new/`;
  let target = destination;
  if (step === "New folder") await createFolder(client, PRIVATE, "new");
  else if (step === "Upload") {
    await uploadFile(client, PRIVATE, new Blob(["original bytes"]), "new", "fail");
    target = `${PRIVATE}new`;
  } else if (step === "Move" || step === "folder Move") {
    expect((await moveItems(client, [selected], destination)).failed).toEqual([]);
    expect(f.pod.has(selected.url)).toBe(false);
    target = `${destination}${selected.name}${selected.kind === "folder" ? "/" : ""}`;
  } else if (step === "Copy") target = await copyItem(client, selected);
  else if (step === "Rename") target = await renameItem(client, selected, "renamed");
  else if (step === "Trash") {
    const result = await trashItems(client, DRIVE, [selected], { webId: OWNER });
    expect(result.failed).toEqual([]);
    target = result.done[0]?.url as string;
  } else if (step === "Restore") {
    if (!archived) throw new Error("Missing recovery");
    const result = await restoreItems(client, DRIVE, [archived]);
    expect(result.failed).toEqual([]);
    target = result.done[0]?.url as string;
  } else if (step === "container merge")
    await client.mergeContainer(source, destination, { kind: "preserve-source" });
  else if (step === "owner-only folder")
    await client.createFolder(destination, { kind: "owner-only", webId: OWNER });
  else {
    target = `${PRIVATE}new`;
    await client.write(
      target,
      "original bytes",
      { contentType: "text/plain", ifNoneMatch: "*" },
      { kind: "owner-only" },
    );
  }
  expect(f.pod.has(target)).toBe(true);
  expect((await f.anonymous(target)).status).toBe(403);
});

it("round 61: Replace evacuates both versions privately when 404 omits Link", async () => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const widened = await aclBody(url, true);
  let changed = false;
  f.after(async (target, method, response) => {
    if (response.status === 404) response.headers.delete("link");
    if (!changed && target === url && method === "PUT" && response.ok) {
      changed = true;
      f.policies.set(`${url}.policy`, widened);
    }
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const result = await uploadFile(
    client,
    PRIVATE,
    new Blob(["replacement"]),
    "secret",
    "replace",
    await client.stat(url),
  ).catch((cause: unknown) => cause);
  expect(changed).toBe(true);
  expect(result).toBeInstanceOf(DrivePartialFailureError);
  const bodies: string[] = [];
  for (const target of (result as DrivePartialFailureError).retainedDestinations) {
    bodies.push(await (await f.pod.fetch(target)).text());
    expect((await f.anonymous(target)).status).toBe(403);
  }
  expect(bodies).toEqual(expect.arrayContaining(["secret contents", "replacement"]));
  expect(await (await f.pod.fetch(url)).text()).toBe("");
  expect(f.policies.get(`${url}.policy`)).toBe(widened);
});

it("round 61: retained protection is rechecked after ledger retirement and widened bytes evacuate privately", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const to = `${PUBLIC}secret`;
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC));
  const widened = await aclBody(to, true);
  let refused = false,
    installed = false,
    changed = false;
  f.intercept(async (url, init) => {
    if (url === from && init?.method === "DELETE") {
      refused = true;
      return new Response(null, { status: 403 });
    }
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (refused && url === `${to}.policy` && method === "PUT" && response.ok) installed = true;
    return response;
  });
  const remove = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (installed && !changed && key === to) {
      changed = true;
      f.policies.set(`${to}.policy`, widened);
    }
    return remove.call(this, key);
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const result = await moveItems(client, [await client.stat(from)], PUBLIC);
  expect(changed).toBe(true);
  const error = result.failed[0]?.error;
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  expect(error).toMatchObject({ cause: { kind: "private-access-unavailable" } });
  const retained = (error as DrivePartialFailureError).retainedDestinations;
  expect(retained.length).toBeGreaterThan(0);
  for (const target of retained) {
    expect(await (await f.pod.fetch(target)).text()).toBe("secret contents");
    expect((await f.anonymous(target)).status).toBe(403);
  }
  expect(await (await f.pod.fetch(to)).text()).toBe("");
  expect(f.policies.get(`${to}.policy`)).toBe(widened);
  expect(await (await f.pod.fetch(from)).text()).toBe("secret contents");
});

it.each(
  ["Move", "Rename", "Restore"].flatMap((step) =>
    [false, true].map((ignoresHead) => ({ step, ignoresHead })),
  ),
)("round 61: $step preserves original bytes and reports destination replacement during source retirement (HEAD ignores If-Match: $ignoresHead)", async ({
  step,
  ignoresHead,
}) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  let from = `${PRIVATE}secret`;
  const to = step === "Rename" ? `${PRIVATE}renamed` : step === "Move" ? `${PUBLIC}secret` : from;
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC));
  const entry =
    step === "Restore"
      ? (await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER })).done[0]
      : undefined;
  if (step === "Restore") {
    if (!entry) throw new Error("Missing recovery");
    from = entry.url;
  }
  const selected = await client.stat(from);
  let deleted = false,
    changed = false;
  let replacement: Promise<unknown> = Promise.resolve();
  f.after(async (url, method, response) => {
    if (url === from && method === "DELETE" && response.ok) deleted = true;
    return response;
  });
  f.intercept(async (url, init) => {
    await replacement;
    if (ignoresHead && changed && url === to && init?.method === "HEAD") {
      const response = await f.pod.fetch(to, { method: "HEAD" });
      response.headers.delete("x-solid-demo-access-control");
      response.headers.set("link", `<${to}.policy>; rel="acl"`);
      return response;
    }
    return undefined;
  });
  const remove = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (deleted && !changed && key === from) {
      changed = true;
      replacement = f.pod.fetch(to, { method: "PUT", body: "foreign replacement" });
    }
    return remove.call(this, key);
  });
  const result = await (step === "Move"
    ? moveItems(client, [selected], PUBLIC)
    : step === "Rename"
      ? renameItem(client, selected, "renamed")
      : restoreItems(client, DRIVE, [entry as NonNullable<typeof entry>])
  ).catch((cause: unknown) => cause);
  const error =
    step === "Rename" ? result : (result as { failed: { error: unknown }[] }).failed[0]?.error;
  expect(changed).toBe(true);
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  expect(f.pod.has(from)).toBe(false);
  expect(await (await f.pod.fetch(to)).text()).toBe("foreign replacement");
  let recovered = false;
  for (const target of (error as DrivePartialFailureError).retainedDestinations) {
    if ((await (await f.pod.fetch(target)).text()) === "secret contents") {
      recovered = true;
      expect((await f.anonymous(target)).status).toBe(403);
    }
  }
  expect(recovered).toBe(true);
  if (entry) {
    const index = await client.readRdf(`${DRIVE}.trash/index.ttl`);
    expect(
      index && trashEntries(trashIndexFrom(index.dataset)).some((saved) => saved.url === entry.url),
    ).toBe(true);
  }
});

it("round 61: partial Restore keeps the archived shared audience after Trash DELETE refusal", async () => {
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
  expect((await f.anonymous(entry.url)).status).toBe(403);
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect((await f.anonymous(url)).status).toBe(200);
  expect(f.pod.has(entry.url)).toBe(false);
});

it.each([
  "file",
  "folder",
])("round 61: partial %s Restore detects survivor replacement during recovery retirement", async (kind) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const from = kind === "folder" ? `${PRIVATE}folder/` : `${PRIVATE}secret`;
  if (kind === "folder") await f.pod.fetch(from, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === from && init?.method === "DELETE" ? new Response(null, { status: 403 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  let deleted = false,
    changed = false;
  let replacement: Promise<unknown> = Promise.resolve();
  f.after(async (url, method, response) => {
    if (url === entry.url && method === "DELETE" && response.ok) deleted = true;
    return response;
  });
  f.intercept(async () => {
    await replacement;
    return undefined;
  });
  const remove = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (deleted && !changed && key === entry.url) {
      changed = true;
      replacement = f.pod.fetch(from, { method: "PUT", body: kind === "folder" ? "" : "foreign" });
    }
    return remove.call(this, key);
  });
  const result = await restoreItems(client, DRIVE, [entry]);
  expect(changed).toBe(true);
  expect(result.done).toEqual([]);
  expect(result.failed).toHaveLength(1);
  const error = result.failed[0]?.error as { remaining: { error: DrivePartialFailureError }[] };
  expect(error.remaining[0]?.error).toBeInstanceOf(DrivePartialFailureError);
  const retained = error.remaining[0]?.error.retainedDestinations as string[];
  expect(retained.length).toBeGreaterThan(0);
  for (const target of retained) expect((await f.anonymous(target)).status).toBe(403);
  if (kind === "file")
    expect(await (await f.pod.fetch(retained[0] as string)).text()).toBe("secret contents");
  const index = await client.readRdf(`${DRIVE}.trash/index.ttl`);
  expect(
    index && trashEntries(trashIndexFrom(index.dataset)).some((saved) => saved.url === entry.url),
  ).toBe(true);
});

it.each([
  "missing ETag",
  "weak ETag",
  "missing Link",
  "different Link",
  "concurrent ACL",
  "stale receipt",
  "captured endpoint",
])("round 61: first discovery refuses a %s creation receipt", async (failure) => {
  const f = await rdfPod();
  const url = `${PRIVATE}new`;
  f.after(async (_target, _method, response) => {
    if (response.status === 404 && failure !== "captured endpoint") response.headers.delete("link");
    return response;
  });
  const access = accessControl(f.fetch, ROOT);
  if (failure === "stale receipt")
    access.recordCreation(url, new Headers({ etag: '"old"', link: `<${url}.policy>; rel="acl"` }));
  const binding = await bindAccess(access, url, url);
  const response = await f.fetch(url, {
    method: "PUT",
    headers: { "if-none-match": "*" },
    body: "ours",
  });
  if (failure === "missing ETag") response.headers.delete("etag");
  if (failure === "weak ETag") response.headers.set("etag", 'W/"weak"');
  if (failure === "missing Link") response.headers.delete("link");
  if (failure === "different Link" || failure === "captured endpoint")
    response.headers.set("link", `<${url}other.policy>; rel="acl"`);
  if (failure === "concurrent ACL") f.policies.set(`${url}.policy`, await aclBody(url, true));
  if (failure !== "stale receipt") access.recordCreation(url, response.headers);
  if (failure === "captured endpoint")
    f.after(async (target, method, current) => {
      if (target === url && method === "HEAD")
        current.headers.set("link", `<${url}other.policy>; rel="acl"`);
      return current;
    });
  await expect(binding.recheck()).rejects.toThrow();
});

it.each([
  "widening",
  "endpoint",
  "missing validator",
])("round 61: protection verification keeps its durable requirement after retirement %s", async (failure) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const policy = await turtle(privateAcl(url, OWNER));
  f.policies.set(`${url}.policy`, policy);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  const ledger = protectionLedger(f.fetch);
  await ledger.set(url, {
    acl: `${url}.policy`,
    from: url,
    turtle: policy,
    ...(failure === "missing validator" ? {} : { etag: selected.etag as string }),
  });
  const widened = await aclBody(url, true);
  let changed = false;
  const remove = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (!changed && key === url) {
      changed = true;
      if (failure === "widening") f.policies.set(`${url}.policy`, widened);
    }
    return remove.call(this, key);
  });
  f.after(async (target, method, response) => {
    if (target === url && method === "HEAD") {
      if (failure === "missing validator") response.headers.delete("etag");
      if (failure === "endpoint" && changed)
        response.headers.set("link", `<${url}other.policy>; rel="acl"`);
    }
    return response;
  });
  await expect(client.read(url)).rejects.toThrow();
  expect(changed).toBe(true);
  expect(await ledger.get(url)).toBeDefined();
  f.calls.length = 0;
  await expect(client.read(url)).rejects.toThrow();
  expect(f.calls.filter(({ method }) => method === "PUT")).toEqual([]);
  expect(f.policies.get(`${url}.policy`)).toBe(failure === "widening" ? widened : policy);
});

it("round 61: Copy detects a replaced payload before reporting completion", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const to = `${PRIVATE}copy`;
  let changed = false;
  f.after(async (url, method, response) => {
    if (
      !changed &&
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()) === "secret contents"
    ) {
      changed = true;
      await f.pod.fetch(to, { method: "PUT", body: "foreign" });
    }
    return response;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toBeInstanceOf(
    DrivePartialFailureError,
  );
  expect(changed).toBe(true);
  expect(await (await f.pod.fetch(from)).text()).toBe("secret contents");
  expect(await (await f.pod.fetch(to)).text()).toBe("foreign");
});

it("round 61: a new source creation receipt establishes discovery independently of the destination", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}new`;
  f.after(async (_url, _method, response) => {
    if (response.status === 404) response.headers.delete("link");
    return response;
  });
  const access = accessControl(f.fetch, ROOT);
  const binding = await bindAccess(access, from, `${PRIVATE}secret`);
  const response = await f.fetch(from, {
    method: "PUT",
    headers: { "if-none-match": "*" },
    body: "new",
  });
  access.recordCreation(from, response.headers);
  await expect(binding.recheck()).resolves.toBeUndefined();
  expect(binding.identities).toContainEqual({ url: `${from}.policy`, etag: null });
});

it.each([
  "removed ACL",
  "unchanged ACL",
])("round 61: Retry retains its post-retirement ACL receipt with %s", async (change) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const policy = await turtle(privateAcl(url, OWNER));
  f.policies.set(`${url}.policy`, policy);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const ledger = protectionLedger(f.fetch);
  await ledger.set(url, {
    acl: `${url}.policy`,
    from: url,
    turtle: policy,
    etag: (await client.stat(url)).etag as string,
  });
  let retired = false,
    failed = false;
  const remove = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (key === url) retired = true;
    return remove.call(this, key);
  });
  f.intercept(async (target, init) => {
    if (retired && !failed && target === url && init?.method === "HEAD") {
      failed = true;
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  await expect(client.read(url)).rejects.toThrow();
  expect(failed).toBe(true);
  expect((await ledger.get(url))?.ownAcl).toEqual({
    url: `${url}.policy`,
    etag: JSON.stringify(policy),
  });
  if (change === "removed ACL") f.policies.delete(`${url}.policy`);
  f.calls.length = 0;
  if (change === "removed ACL") {
    await expect(client.read(url)).rejects.toThrow();
    expect(await ledger.get(url)).toBeDefined();
  } else {
    expect(await (await client.read(url)).text()).toBe("secret contents");
    expect(await ledger.get(url)).toBeUndefined();
  }
  expect(f.calls.filter(({ method }) => method === "PUT")).toEqual([]);
});

it.each([
  "before backup",
  "after backup",
  "allocation",
  "no owner",
])("round 61: committed recovery removal reports a preservation failure %s", async (failure) => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const to = `${PRIVATE}survivor`;
  await f.pod.fetch(to, { method: "PUT", body: "secret contents" });
  if (failure === "no owner") {
    const { AclResource } = await import("@solid/object");
    const { DataFactory } = await import("n3");
    const policy = privateAcl(from, OWNER);
    for (const rule of new AclResource(policy, DataFactory).authorizations)
      rule.mode.delete("http://www.w3.org/ns/auth/acl#Control");
    f.policies.set(`${from}.policy`, await turtle(policy));
  }
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    ...(failure === "no owner" ? {} : { webId: OWNER }),
  });
  const original = await client.stat(from);
  const survivor = await client.stat(to);
  let deleted = false;
  f.after(async (url, method, response) => {
    if (url === from && method === "DELETE" && response.ok) {
      deleted = true;
      await f.pod.fetch(to, { method: "PUT", body: "foreign" });
    }
    return response;
  });
  f.intercept(async (url, init) => {
    if (deleted && url.includes("/.drive-recovery-")) {
      if (failure === "before backup" && init?.method === "PUT" && url.endsWith("/"))
        return new Response(null, { status: 403 });
      if (
        failure === "after backup" &&
        init?.method === "HEAD" &&
        new Headers(init.headers).has("if-match") &&
        !url.endsWith("/") &&
        !url.endsWith(".policy")
      )
        return new Response(null, { status: 503 });
    }
    return undefined;
  });
  const allocate = crypto.randomUUID.bind(crypto);
  vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
    if (failure === "allocation" && deleted) throw new Error("Recovery allocation failed");
    return allocate();
  });
  const error = (await client
    .remove(from, {
      ifMatch: original.etag as string,
      commit: { survivors: [{ ...survivor, url: to, etag: survivor.etag as string }] },
    })
    .catch((cause: unknown) => cause)) as DrivePartialFailureError;
  if (failure === "no owner") {
    expect(deleted).toBe(false);
    expect(error).toMatchObject({
      kind: "private-access-unavailable",
      cause: "Recovery owner unavailable",
    });
    expect(await (await f.pod.fetch(from)).text()).toBe("secret contents");
    return;
  }
  expect(deleted).toBe(true);
  expect(error).toBeInstanceOf(DrivePartialFailureError);
  expect(error.deletedSources).toEqual([from]);
  if (failure === "allocation")
    expect(error.cause).toEqual(new Error("Recovery allocation failed"));
  else expect(error.cause).toMatchObject({ kind: "partial-failure" });
  expect(await (await f.pod.fetch(to)).text()).toBe("foreign");
  if (failure === "after backup") {
    expect(error.retainedDestinations.length).toBeGreaterThan(0);
    for (const url of error.retainedDestinations) {
      expect(await (await f.pod.fetch(url)).text()).toBe("secret contents");
      expect((await f.anonymous(url)).status).toBe(403);
    }
  }
});

it("round 61: backup retirement surfaces a concurrent policy change without reverting it", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const to = `${PUBLIC}secret`;
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC));
  const widened = await aclBody(to, true);
  let refused = false,
    cleared = false,
    changed = false;
  let folder: string | undefined;
  let widenedRecovery = "";
  f.intercept(async (url, init) => {
    if (url === from && init?.method === "DELETE") {
      refused = true;
      f.policies.set(`${to}.policy`, widened);
      return new Response(null, { status: 403 });
    }
    return undefined;
  });
  f.after(async (url, method, response) => {
    if (url === to && method === "PUT" && response.ok && refused) cleared = true;
    if (url.includes("/.drive-recovery-") && url.endsWith("/") && method === "PUT" && response.ok) {
      folder = url;
      widenedRecovery = await aclBody(url, true);
    }
    return response;
  });
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (cleared && !changed && key === to && folder) {
      changed = true;
      f.policies.set(`${folder}.policy`, widenedRecovery);
    }
    return put.call(this, value, key);
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const result = await moveItems(client, [await client.stat(from)], PUBLIC);
  expect(changed).toBe(true);
  expect(result.done).toEqual([]);
  let cause: unknown = result.failed[0]?.error;
  while (cause instanceof DrivePartialFailureError) cause = cause.cause;
  expect(cause).toMatchObject({
    kind: "private-access-unavailable",
    cause: "Bound access changed",
  });
  expect(f.policies.get(`${folder}.policy`)).toBe(widenedRecovery);
  expect(f.policies.get(`${to}.policy`)).toBe(widened);
  expect(await (await f.pod.fetch(from)).text()).toBe("secret contents");
});

it("round 61: Retry verifies the narrower policy actually installed before failed retirement", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const from = `${PUBLIC}placeholder`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const access = accessControl(f.fetch, ROOT);
  const shared = await access.effective(from);
  if (shared.status !== "known") throw new Error("Missing shared policy");
  const original = await client.stat(url);
  const guard = ancestorGuard({
    storageUrl: ROOT,
    http: f.fetch,
    access,
    readRdf: client.readRdf,
    putFolder: async () => {
      throw new Error("Unexpected PUT");
    },
    deleteVersion: async () => {
      throw new Error("Unexpected DELETE");
    },
    owner: () => OWNER,
    error: (status) => new Error(String(status)),
  });
  let retired = false,
    failed = false;
  const remove = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (key === url) retired = true;
    return remove.call(this, key);
  });
  f.intercept(async (target, init) => {
    if (retired && !failed && target === url && init?.method === "HEAD") {
      failed = true;
      return new Response(null, { status: 503 });
    }
    return undefined;
  });
  await expect(
    guard.protect(url, shared.policy, from, {
      identity: { url, etag: original.etag as string },
      knownAcl: `${url}.policy`,
      expectedAcl: null,
      restrict: true,
    }),
  ).rejects.toThrow("503");
  expect(failed).toBe(true);
  expect((await f.anonymous(url)).status).toBe(403);
  expect(await protectionLedger(f.fetch).get(url)).toBeDefined();
  expect(await (await client.read(url)).text()).toBe("secret contents");
  expect(await protectionLedger(f.fetch).get(url)).toBeUndefined();
});

it.each([
  "missing receipt",
  "revoked own ACL",
  "replaced own ACL",
])("round 61: pending protection refuses to adopt a %s on Retry", async (failure) => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const policy = await turtle(privateAcl(url, OWNER));
  f.policies.set(`${url}.policy`, policy);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  if (failure === "missing receipt") {
    f.policies.delete(`${url}.policy`);
    await protectionLedger(f.fetch).set(url, {
      acl: `${url}.policy`,
      from: url,
      turtle: policy,
      etag: selected.etag as string,
    });
  } else {
    let refused = false;
    f.intercept(async (target, init) => {
      if (!refused && target === `${url}.policy` && init?.method === "PUT") {
        refused = true;
        if (failure === "revoked own ACL") f.policies.delete(`${url}.policy`);
        else f.policies.set(`${url}.policy`, `${policy}\n# another writer\n`);
        return new Response(null, { status: 403 });
      }
      return undefined;
    });
    await expect(
      client.write(
        url,
        "replacement",
        { contentType: "text/plain", ifMatch: selected.etag as string },
        { kind: "owner-only" },
      ),
    ).rejects.toThrow();
    expect(refused).toBe(true);
    f.intercept(undefined);
  }
  f.calls.length = 0;
  await expect(client.read(url)).rejects.toThrow();
  expect(f.calls.filter(({ method }) => method === "PUT" || method === "DELETE")).toEqual([]);
  expect(await protectionLedger(f.fetch).get(url)).toBeDefined();
  expect(await (await f.pod.fetch(url)).text()).toBe("secret contents");
  expect(f.policies.get(`${url}.policy`)).toBe(
    failure === "replaced own ACL" ? `${policy}\n# another writer\n` : undefined,
  );
});

it("round 61: partial Restore refuses vanished recovery instead of accepting an unchecked survivor", async () => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
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
  const remove = client.remove;
  let changed = false;
  vi.spyOn(client, "remove").mockImplementation(async function (
    this: typeof client,
    target,
    options,
  ) {
    if (!changed && target === entry.url) {
      changed = true;
      await f.pod.fetch(entry.url, { method: "DELETE" });
      await f.pod.fetch(url, { method: "PUT", body: "foreign" });
    }
    return remove.call(this, target, options);
  });
  const result = await restoreItems(client, DRIVE, [entry]);
  expect(changed).toBe(true);
  expect(result.done).toEqual([]);
  expect(result.failed).toHaveLength(1);
  expect(await (await f.pod.fetch(url)).text()).toBe("foreign");
  const index = await client.readRdf(`${DRIVE}.trash/index.ttl`);
  expect(
    index && trashEntries(trashIndexFrom(index.dataset)).some((saved) => saved.url === entry.url),
  ).toBe(true);
});

it.each(
  ["Replace", "standalone overwrite", "owner-only overwrite"].flatMap((step) =>
    ["different ETag", "missing ETag"].map((proof) => ({ step, proof })),
  ),
)("round 61: $step refuses an unconfirmed backup GET with $proof", async ({ step, proof }) => {
  const f = await rdfPod();
  const url = `${PRIVATE}secret`;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const selected = await client.stat(url);
  let read = false;
  f.intercept(async (target, init) => {
    if (target === url && (init?.method ?? "GET") === "GET") {
      read = true;
      return new Response("unconfirmed snapshot", {
        headers: {
          "content-type": "text/plain",
          ...(proof === "different ETag" ? { etag: '"different"' } : {}),
        },
      });
    }
    return undefined;
  });
  const write =
    step === "Replace"
      ? uploadFile(client, PRIVATE, new Blob(["replacement"]), "secret", "replace", selected)
      : client.write(
          url,
          "replacement",
          { contentType: "text/plain", ifMatch: selected.etag as string },
          { kind: step === "owner-only overwrite" ? "owner-only" : "protect-ancestors" },
        );
  await expect(write).rejects.toMatchObject({ kind: "conflict", status: 412, url });
  expect(read).toBe(true);
  expect(f.calls).not.toContainEqual({ url, method: "PUT" });
  expect(await (await f.pod.fetch(url)).text()).toBe("secret contents");
});
