// AUTHORED-BY Codex
import { createRequire } from "node:module";
import { DataFactory, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { accessControl, privateAcl } from "../src/apps/drive/lib/client/access";
import { discardVersion } from "../src/apps/drive/lib/client/cleanup";
import { createSolidDriveClient, DriveError } from "../src/apps/drive/lib/client/client";
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
import {
  addTrashRecord,
  emptyTrashIndex,
  serializeTrashIndex,
} from "../src/apps/drive/lib/operations/trash-index";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, DRIVE, OWNER, PRIVATE, ROOT, turtle, WacFields } from "./drive-wac-pod";

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
  "file",
  "folder",
])("round 53: partial %s Restore has no protection read after the final survivor HEAD", async (kind) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const original = kind === "file" ? `${PRIVATE}secret` : `${PRIVATE}tree/`;
  if (kind === "folder") await f.pod.fetch(original, { method: "PUT", body: "" });
  f.intercept(async (url, init) =>
    url === original && init?.method === "DELETE" ? new Response(null, { status: 412 }) : undefined,
  );
  await trashItems(client, DRIVE, [await client.stat(original)], { webId: OWNER });
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing partial recovery");
  let checked = false;
  let intervened = false;
  f.intercept(async (url, init) => {
    checked =
      url === original && init?.method === "HEAD" && new Headers(init.headers).has("if-match");
    return undefined;
  });
  const get = IDBObjectStore.prototype.get;
  vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (key === original && checked) {
      intervened = true;
      void f.pod.fetch(original, { method: "DELETE" });
    }
    checked = false;
    return get.call(this, key);
  });
  const result = await restoreItems(client, DRIVE, [entry]);
  expect(intervened).toBe(false);
  expect(result.failed).toEqual([]);
  expect(f.pod.has(original)).toBe(true);
  expect(f.pod.has(entry.url)).toBe(false);
});
it.each(
  ["own", "inherited"].flatMap((sharing) => ["file", "folder"].map((kind) => ({ sharing, kind }))),
)("round 53: partial Restore accepts an unchanged shared $kind original with $sharing archived access after Trash DELETE is refused", async ({
  sharing,
  kind,
}) => {
  const f = await rdfPod();
  const from = kind === "file" ? `${PRIVATE}secret` : `${PRIVATE}tree/`;
  if (kind === "folder")
    await f.pod.fetch(`${from}child`, { method: "PUT", body: "secret contents" });
  const shared = sharing === "own" ? from : PRIVATE;
  f.policies.set(`${shared}.policy`, await aclBody(shared, true));
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === from && init?.method === "DELETE" ? new Response(null, { status: 412 }) : undefined,
  );
  expect(
    (await trashItems(client, DRIVE, [await client.stat(from)], { webId: OWNER })).failed,
  ).toHaveLength(1);
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing partial recovery");
  expect(entry.status).toBe("partial");
  expect((await f.anonymous(entry.url)).status).toBe(403);
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect(await (await f.anonymous(kind === "file" ? from : `${from}child`)).text()).toBe(
    "secret contents",
  );
  expect(f.pod.has(entry.url)).toBe(false);
});
const steps = [
  "move",
  "rename",
  "Trash",
  "remove",
  "recursive remove",
  "Delete forever",
  "Empty Trash",
  "overwrite",
  "folder metadata",
  "Restore",
  "partial file Restore",
  "partial folder Restore",
] as const;
it.each(
  steps,
)("round 53: %s keeps the confirmed validator when the URL is replaced before preflight", async (step) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const folder =
    step === "recursive remove" || step === "partial folder Restore" || step === "folder metadata";
  let url = folder ? `${PRIVATE}tree/` : `${PRIVATE}secret`;
  if (folder) await f.pod.fetch(url, { method: "PUT", body: "" });
  let entry: Awaited<ReturnType<typeof listTrash>>[number] | undefined;
  if (
    [
      "Delete forever",
      "Empty Trash",
      "Restore",
      "partial file Restore",
      "partial folder Restore",
    ].includes(step)
  ) {
    if (step.startsWith("partial"))
      f.intercept(async (target, init) =>
        target === url && init?.method === "DELETE"
          ? new Response(null, { status: 412 })
          : undefined,
      );
    await trashItems(client, DRIVE, [await client.stat(url)], { webId: OWNER });
    f.intercept(undefined);
    [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing recovery");
    url = entry.url;
  }
  const selected = await client.stat(url);
  if (!selected.etag) throw new Error("Missing selected validator");
  await f.pod.fetch(url, {
    method: "PUT",
    body: folder ? "" : step.startsWith("partial") ? "secret contents" : "replacement",
  });
  f.calls.length = 0;
  const run = async () => {
    if (step === "move") return moveItems(client, [selected], `${PRIVATE}target/`);
    if (step === "rename") return renameItem(client, selected, "renamed");
    if (step === "Trash") return trashItems(client, DRIVE, [selected], { webId: OWNER });
    if (step === "Delete forever" || step === "Empty Trash") {
      if (!entry) throw new Error("Missing recovery");
      return deleteForever(client, DRIVE, [{ ...entry, etag: selected.etag as string }]);
    }
    if (step === "Restore" || step.startsWith("partial")) {
      if (!entry) throw new Error("Missing recovery");
      return restoreItems(client, DRIVE, [{ ...entry, etag: selected.etag as string }]);
    }
    if (step === "overwrite")
      return uploadFile(client, PRIVATE, new Blob(["upload"]), "secret", "replace", selected);
    if (step === "folder metadata")
      return client.write(
        url,
        "",
        { contentType: "text/turtle", ifMatch: selected.etag as string },
        { kind: "protect-ancestors" },
      );
    return client.remove(url, {
      recursive: step === "recursive remove",
      ifMatch: selected.etag as string,
    });
  };
  const outcome = await run().catch((error: unknown) => error);
  if (outcome && typeof outcome === "object" && "failed" in outcome)
    expect(outcome.failed).toHaveLength(1);
  else expect(outcome).toBeInstanceOf(Error);
  expect(f.pod.has(url)).toBe(true);
  expect(f.calls).not.toContainEqual({ url, method: "DELETE" });
  if (selected.kind === "file")
    expect(await (await f.pod.fetch(url)).text()).toBe(
      step.startsWith("partial") ? "secret contents" : "replacement",
    );
});
it.each([
  ...steps,
  "copy",
  "ACL overwrite",
  "overwrite rollback",
] as const)("round 53: %s has no IndexedDB or Web Lock I/O between its last identity HEAD and irreversible request", async (step) => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const events: string[] = [];
  for (const method of ["get", "getAllKeys", "put", "delete"] as const) {
    const original = IDBObjectStore.prototype[method];
    vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (
      this: IDBObjectStore,
      ...args: unknown[]
    ) {
      events.push("IndexedDB");
      return Reflect.apply(original, this, args);
    });
  }
  const locks = navigator.locks;
  const request = locks.request.bind(locks);
  vi.spyOn(locks, "request").mockImplementation((...args: Parameters<typeof locks.request>) => {
    events.push("Web Lock");
    return Reflect.apply(request, locks, args);
  });
  const f = await rdfPod();
  const mutations: string[][] = [];
  const http: typeof fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    if (method === "DELETE" || (method === "PUT" && headers.has("if-match")))
      mutations.push(events.slice(-1));
    const response = await f.fetch(input, init);
    events.push(method === "HEAD" && headers.has("if-match") ? "identity HEAD" : method);
    return response;
  };
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http, webId: OWNER });
  const folder =
    step === "recursive remove" || step === "partial folder Restore" || step === "folder metadata";
  const url = folder ? `${PRIVATE}tree/` : `${PRIVATE}secret`;
  if (folder) await f.pod.fetch(url, { method: "PUT", body: "" });
  const selected = await client.stat(url);
  if (!selected.etag) throw new Error("Missing selected validator");
  if (
    [
      "Delete forever",
      "Empty Trash",
      "Restore",
      "partial file Restore",
      "partial folder Restore",
    ].includes(step)
  ) {
    if (step.startsWith("partial"))
      f.intercept(async (target, init) =>
        target === url && init?.method === "DELETE"
          ? new Response(null, { status: 412 })
          : undefined,
      );
    await trashItems(client, DRIVE, [selected], { webId: OWNER });
    f.intercept(undefined);
    const entries = await listTrash(client, DRIVE);
    mutations.length = 0;
    const result =
      step.startsWith("partial") || step === "Restore"
        ? await restoreItems(client, DRIVE, entries)
        : await deleteForever(client, DRIVE, entries);
    expect(result.failed).toEqual([]);
  } else if (step === "copy") await client.copy(url, `${PRIVATE}copy`, { kind: "preserve-source" });
  else if (step === "ACL overwrite")
    await accessControl(http, ROOT).store(`${PRIVATE}.policy`, privateAcl(PRIVATE, OWNER));
  else if (step === "overwrite rollback") {
    let changed = false;
    f.after(async (target, method, response) => {
      if (!changed && target === url && method === "PUT" && response.ok) {
        changed = true;
        f.policies.set(`${url}.policy`, await aclBody(url, true));
      }
      return response;
    });
    await expect(
      uploadFile(client, PRIVATE, new Blob(["upload"]), "secret", "replace", selected),
    ).rejects.toThrow();
    expect(changed).toBe(true);
  } else if (step === "folder metadata")
    await client.write(
      url,
      "",
      { contentType: "text/turtle", ifMatch: selected.etag },
      { kind: "protect-ancestors" },
    );
  else if (step === "move") await moveItems(client, [selected], `${PRIVATE}target/`);
  else if (step === "rename") await renameItem(client, selected, "renamed");
  else if (step === "Trash")
    expect((await trashItems(client, DRIVE, [selected], { webId: OWNER })).failed).toEqual([]);
  else if (step === "overwrite")
    await uploadFile(client, PRIVATE, new Blob(["upload"]), "secret", "replace", selected);
  else await client.remove(url, { recursive: folder, ifMatch: selected.etag as string });
  expect(mutations.length).toBeGreaterThan(0);
  for (const prior of mutations) expect(prior).toEqual(["identity HEAD"]);
});

it("round 53: cleanup refuses a newer identity even when its content is identical", async () => {
  const url = `${PRIVATE}owned`;
  const remove = vi
    .fn()
    .mockRejectedValueOnce(new DriveError("conflict", 412, url))
    .mockResolvedValue(undefined);
  await expect(
    discardVersion({
      url,
      captured: { content: "ours", etag: '"selected"' },
      read: async () => ({ content: "ours", etag: '"replacement"' }),
      owns: (content) => content === "ours",
      remove,
    }),
  ).rejects.toMatchObject({ status: 412 });
  expect(remove.mock.calls).toEqual([['"selected"']]);
});

it("round 53: a late Move access confirmation cannot refresh the captured source validator", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}secret`;
  const to = `${DRIVE}public/secret`;
  f.policies.set(`${DRIVE}public/.policy`, await aclBody(`${DRIVE}public/`));
  const confirmAccess = vi.fn(async () => {
    await f.pod.fetch(from, { method: "PUT", body: "replacement" });
    return "move" as const;
  });
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    webId: OWNER,
    confirmAccess,
  });
  let widened = false;
  f.after(async (url, method, response) => {
    if (
      !widened &&
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()) === "secret contents"
    ) {
      widened = true;
      f.policies.set(`${DRIVE}public/.policy`, await aclBody(`${DRIVE}public/`, true));
    }
    return response;
  });
  await expect(client.move(from, to, { kind: "confirm-move" })).rejects.toMatchObject({
    status: 412,
  });
  expect(confirmAccess).toHaveBeenCalledOnce();
  expect(await (await f.pod.fetch(from)).text()).toBe("replacement");
  expect(f.calls).not.toContainEqual({ url: from, method: "DELETE" });
  expect(f.pod.has(to)).toBe(false);
});

it.each([
  "recovery container",
  "policy archive",
  "receipt",
  "slot",
  "ancestor",
  "rollback container",
])("round 53: %s cleanup preserves a byte-identical replacement after a refused identity check", async (path) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const folder = path === "recovery container" || path === "rollback container";
  const source = folder ? `${PRIVATE}tree/` : `${PRIVATE}secret`;
  if (folder) await f.pod.fetch(source, { method: "PUT", body: "" });
  let target: string;
  let entry: Awaited<ReturnType<typeof listTrash>>[number] | undefined;
  if (path === "ancestor" || path === "rollback container") target = `${PRIVATE}new/`;
  else {
    if (path === "recovery container")
      f.intercept(async (url, init) =>
        url === source && init?.method === "DELETE"
          ? new Response(null, { status: 412 })
          : undefined,
      );
    await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER });
    f.intercept(undefined);
    [entry] = await listTrash(client, DRIVE);
    if (!entry) throw new Error("Missing recovery");
    const slot = new URL(".", entry.url).href;
    target =
      path === "recovery container"
        ? entry.url
        : path === "slot"
          ? slot
          : path === "policy archive"
            ? `${slot}.access.json`
            : `${slot}partial.ttl`;
    if (path === "receipt") {
      const index = emptyTrashIndex();
      addTrashRecord(index, entry);
      index.record(entry.url).status = "complete";
      await f.pod.fetch(target, {
        method: "PUT",
        body: await serializeTrashIndex(index),
        headers: { "content-type": "text/turtle" },
      });
    }
  }
  if (path === "ancestor")
    await protectionLedger(f.fetch).set(target, {
      acl: `${PRIVATE}.policy`,
      from: PRIVATE,
      turtle: f.policies.get(`${PRIVATE}.policy`) as string,
    });
  let raced = false;
  let rollback = false;
  if (path === "rollback container") {
    await f.pod.fetch(`${source}child`, { method: "PUT", body: "secret contents" });
    f.after(async (url, method, response) => {
      if (
        !rollback &&
        url === `${target}child` &&
        method === "PUT" &&
        response.ok &&
        (await (await f.pod.fetch(url)).text()) === "secret contents"
      ) {
        rollback = true;
        f.policies.set(`${target}.policy`, await aclBody(target, true));
      }
      return response;
    });
  }
  f.intercept(async (url, init) => {
    if (path === "ancestor" && url === `${target}.policy` && init?.method === "PUT")
      return new Response(null, { status: 403 });
    if (
      !raced &&
      url === target &&
      init?.method === "HEAD" &&
      new Headers(init.headers).has("if-match") &&
      (path !== "rollback container" || rollback)
    ) {
      raced = true;
      const current = await f.pod.fetch(target);
      await f.pod.fetch(target, {
        method: "PUT",
        body: await current.text(),
        headers: { "content-type": current.headers.get("content-type") as string },
      });
    }
    return undefined;
  });
  if (path === "ancestor")
    await client
      .write(
        `${target}upload`,
        "secret",
        { contentType: "text/plain", ifNoneMatch: "*" },
        { kind: "protect-ancestors" },
      )
      .catch(() => undefined);
  else if (path === "rollback container")
    await client.copy(source, target, { kind: "preserve-source" }).catch(() => undefined);
  else {
    if (!entry) throw new Error("Missing entry");
    if (path === "recovery container") await restoreItems(client, DRIVE, [entry]);
    else await deleteForever(client, DRIVE, [entry]);
  }
  expect(raced).toBe(true);
  expect(f.pod.has(target)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: target, method: "DELETE" });
});

async function partialRecovery(kind: "file" | "folder") {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const original = kind === "file" ? `${PRIVATE}secret` : `${PRIVATE}tree/`;
  if (kind === "folder") await f.pod.fetch(original, { method: "PUT", body: "" });
  f.intercept(async (url, init) =>
    url === original && init?.method === "DELETE" ? new Response(null, { status: 412 }) : undefined,
  );
  await trashItems(client, DRIVE, [await client.stat(original)], { webId: OWNER });
  f.intercept(undefined);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing partial recovery");
  return { f, client, entry, original };
}

it.each([
  "changed after preflight",
  "missing validator",
  "weak validator",
  "missing final read",
])("round 53: partial folder Restore refuses a recovery with %s", async (mode) => {
  const { f, client, entry } = await partialRecovery("folder");
  const read = client.readRdf;
  let reads = 0;
  vi.spyOn(client, "readRdf").mockImplementation(async (url) => {
    if (url === entry.url) {
      reads++;
      if (mode === "changed after preflight" && reads === 1)
        await f.pod.fetch(url, { method: "PUT", body: "" });
      if (mode === "missing final read" && reads === 2) {
        await f.pod.fetch(url, { method: "DELETE" });
        return undefined;
      }
    }
    const current = await read(url);
    if (current && url === entry.url && reads === 1 && mode.includes("validator"))
      return {
        dataset: current.dataset,
        ...(mode === "weak validator" ? { etag: 'W/"weak"' } : {}),
      };
    return current;
  });
  const { etag: _etag, ...legacy } = entry;
  const result = await restoreItems(client, DRIVE, [mode.includes("validator") ? legacy : entry]);
  expect(result.failed).toHaveLength(1);
  expect(f.calls).not.toContainEqual({ url: entry.url, method: "DELETE" });
  expect(f.pod.has(entry.url)).toBe(mode !== "missing final read");
});

it("round 53: partial file Restore never adopts an identical recovery replaced during comparison", async () => {
  const { f, client, entry } = await partialRecovery("file");
  const read = client.readVersion;
  vi.spyOn(client, "readVersion").mockImplementation(async (url) => {
    if (url === entry.url) await f.pod.fetch(url, { method: "PUT", body: "secret contents" });
    return read(url);
  });
  expect((await restoreItems(client, DRIVE, [entry])).failed).toHaveLength(1);
  expect(f.calls).not.toContainEqual({ url: entry.url, method: "DELETE" });
  expect(f.pod.has(entry.url)).toBe(true);
});

it("round 53: Restore refuses a changed identity even when the initial HEAD ignores If-Match", async () => {
  const { f, client, entry } = await partialRecovery("file");
  f.intercept(async (url, init) =>
    url === entry.url && init?.method === "HEAD" && new Headers(init.headers).has("if-match")
      ? new Response(null, { headers: { etag: '"foreign"' } })
      : undefined,
  );
  expect((await restoreItems(client, DRIVE, [entry])).failed).toHaveLength(1);
  expect(f.calls).not.toContainEqual({ url: entry.url, method: "DELETE" });
});

it("round 53: container recovery cleanup accepts confirmed absence after a refused identity check", async () => {
  const { f, client, entry, original } = await partialRecovery("folder");
  let committing = false;
  const remove = client.remove;
  vi.spyOn(client, "remove").mockImplementation(function (this: typeof client, url, options) {
    if (url === entry.url) committing = true;
    return remove.call(this, url, options);
  });
  f.intercept(async (url, init) => {
    if (
      committing &&
      url === entry.url &&
      init?.method === "HEAD" &&
      new Headers(init.headers).has("if-match")
    ) {
      await f.pod.fetch(url, { method: "DELETE" });
      return new Response(null, { status: 412 });
    }
    return undefined;
  });
  await restoreItems(client, DRIVE, [entry]);
  expect(committing).toBe(true);
  expect(f.pod.has(entry.url)).toBe(false);
  expect(f.pod.has(original)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: entry.url, method: "DELETE" });
});

it("round 53: metadata undo retains its captured identity after a refused overwrite", async () => {
  const f = await rdfPod();
  const from = `${PRIVATE}recovery/`;
  const to = `${PRIVATE}survivor/`;
  const data = new Store();
  new WacFields(from, data, DataFactory).iris("https://example.test/note").add(`${ROOT}statement`);
  await f.pod.fetch(from, { method: "PUT", body: await turtle(data) });
  await f.pod.fetch(to, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const merged = await client.mergeContainer(from, to, { kind: "preserve-source" });
  f.policies.set(`${to}.policy`, await aclBody(to, true));
  f.intercept(async (url, init) =>
    url === to && init?.method === "HEAD" && new Headers(init.headers).has("if-match")
      ? new Response(null, { status: 412 })
      : undefined,
  );
  await expect(merged.recheck()).rejects.toMatchObject({ status: 412 });
  expect(await (await f.pod.fetch(to)).text()).toContain("statement");
  expect(f.pod.has(from)).toBe(true);
});

it.each([
  "unreadable",
  "missing validator",
  "legacy confirmed absence",
])("round 53: permanent deletion refuses unavailable identity inputs: %s", async (mode) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const [entry] = (
    await trashItems(client, DRIVE, [await client.stat(`${PRIVATE}secret`)], { webId: OWNER })
  ).done;
  if (!entry) throw new Error("Missing recovery");
  if (mode === "legacy confirmed absence") {
    await f.pod.fetch(entry.url, { method: "DELETE" });
    delete client.recheckDeletions;
  } else if (mode === "missing validator")
    f.after(async (url, method, response) => {
      if (url === entry.url && method === "HEAD") response.headers.delete("etag");
      return response;
    });
  else
    f.intercept(async (url, init) =>
      url === entry.url && init?.method === "HEAD"
        ? new Response(null, { status: 403 })
        : undefined,
    );
  const { etag: _etag, ...legacy } = entry;
  const result = await deleteForever(client, DRIVE, [legacy]);
  expect(result.failed).toHaveLength(mode === "legacy confirmed absence" ? 0 : 1);
  expect(f.calls).not.toContainEqual({ url: entry.url, method: "DELETE" });
});

it("round 53: an empty recovery never adopts a newer identity without our own child deletion", async () => {
  const { f, client, entry } = await partialRecovery("folder");
  const read = client.readRdf;
  let reads = 0;
  vi.spyOn(client, "readRdf").mockImplementation(async (url) => {
    if (url === entry.url && ++reads === 2) await f.pod.fetch(url, { method: "PUT", body: "" });
    return read(url);
  });
  expect((await restoreItems(client, DRIVE, [entry])).failed).toHaveLength(1);
  expect(f.pod.has(entry.url)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: entry.url, method: "DELETE" });
});

it.each([
  "created container",
  "metadata undo",
])("round 53: %s never refreshes its captured identity without our own child mutation", async (kind) => {
  const f = await rdfPod();
  const from = `${PRIVATE}empty-source/`;
  const to = `${PRIVATE}empty-target/`;
  const data = new Store();
  new WacFields(from, data, DataFactory).iris("https://example.test/note").add(`${ROOT}statement`);
  await f.pod.fetch(from, { method: "PUT", body: await turtle(data) });
  if (kind === "metadata undo") await f.pod.fetch(to, { method: "PUT", body: "" });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const merged =
    kind === "metadata undo"
      ? await client.mergeContainer(from, to, { kind: "preserve-source" })
      : undefined;
  let rollingBack = !!merged;
  let raced = false;
  let puts = 0;
  f.intercept(async (url, init) => {
    if (!merged && url === to && init?.method === "PUT" && ++puts === 2) {
      rollingBack = true;
      return new Response(null, { status: 503 });
    }
    if (rollingBack && !raced && url === to && (init?.method ?? "GET") === "GET") {
      raced = true;
      const current = await f.pod.fetch(url);
      await f.pod.fetch(url, { method: "PUT", body: await current.text() });
    }
    return undefined;
  });
  f.calls.length = 0;
  if (merged) {
    f.policies.set(`${to}.policy`, await aclBody(to, true));
    await expect(merged.recheck()).rejects.toThrow();
  } else await expect(client.copy(from, to, { kind: "preserve-source" })).rejects.toThrow();
  expect(raced).toBe(true);
  expect(f.pod.has(to)).toBe(true);
  expect(f.calls).not.toContainEqual({ url: to, method: "DELETE" });
  if (merged) expect(await (await f.pod.fetch(to)).text()).toContain("statement");
});

it.each([
  "file",
  "folder",
])("round 53: %s deletion hydrates a caller's content proof before its raw final identity check", async (kind) => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const url = kind === "file" ? `${PRIVATE}secret` : `${PRIVATE}empty/`;
  if (kind === "folder") await f.pod.fetch(url, { method: "PUT", body: "" });
  const selected = await client.stat(url);
  if (!selected.etag) throw new Error("Missing selected validator");
  const proof = vi.fn(async () => {
    await protectionLedger(f.fetch).get(url);
  });
  await client.remove(url, {
    ifMatch: selected.etag,
    recursive: kind === "folder",
    commit: { identityChecks: [proof] },
  });
  expect(proof).toHaveBeenCalledOnce();
  expect(f.pod.has(url)).toBe(false);
});

it("round 53: legacy move results remain compatible while Trash listings hydrate the confirmed identity", async () => {
  const f = await rdfPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const move = client.move;
  vi.spyOn(client, "move").mockImplementation(async function (this: typeof client, ...args) {
    const result = await move.call(this, ...args);
    return { url: result.url };
  });
  const trashed = await trashItems(client, DRIVE, [await client.stat(`${PRIVATE}secret`)], {
    webId: OWNER,
  });
  const [entry] = trashed.done;
  if (!entry) throw new Error("Missing recovery");
  expect(entry.etag).toBeUndefined();
  expect((await listTrash(client, DRIVE))[0]?.etag).toBeDefined();
  expect((await restoreItems(client, DRIVE, [entry])).failed).toEqual([]);
  expect(await (await f.pod.fetch(entry.original)).text()).toBe("secret contents");
});
