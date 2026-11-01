// AUTHORED-BY Codex
import { expect, it } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { listTrash, restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { DRIVE, OWNER, PRIVATE, ROOT, wacPod } from "./drive-wac-pod";

it.each([404, 410])("missing RDF %s is absent metadata", async (status) => {
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: async () => new Response(null, { status }),
  });
  expect(await client.readRdf(`${DRIVE}missing.ttl`)).toBeUndefined();
});

it("Restore retains recovery while a child DELETE is still accepted on the server", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const source = `${PRIVATE}secret`;
  let deferred: RequestInit | undefined;
  f.intercept(async (url, init) => {
    if (url === source && init?.method === "DELETE") {
      deferred = init;
      return new Response(null, { status: 202 });
    }
    return undefined;
  });
  const trashed = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  expect(trashed.done).toEqual([]);
  expect(trashed.failed).toHaveLength(1);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry) throw new Error("Missing recovery");
  const fresh = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const restored = await restoreItems(fresh, DRIVE, [entry]);
  expect(restored.done).toEqual([]);
  expect(restored.failed).toHaveLength(1);
  expect(f.pod.has(`${entry.url}secret`)).toBe(true);
  if (!deferred) throw new Error("DELETE was not deferred");
  f.intercept(undefined);
  expect((await f.fetch(source, deferred)).ok).toBe(true);
  expect(f.pod.has(`${entry.url}secret`)).toBe(true);
  expect((await restoreItems(fresh, DRIVE, [entry])).failed).toEqual([]);
  expect(await (await fresh.read(source)).text()).toBe("secret contents");
});

it.each([200, 204, 404, 410])("DELETE %s is terminal without polling", async (status) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const url = `${PRIVATE}secret`;
  const target = await client.stat(url);
  f.after(async (read, method, response) =>
    read === url && method === "DELETE" ? new Response(null, { status }) : response,
  );
  const before = f.calls.length;
  await client.remove(url, { ifMatch: target.etag as string });
  const removed = f.calls.findIndex((call, index) => index >= before && call.method === "DELETE");
  expect(f.calls.slice(removed + 1).filter(({ method }) => method === "HEAD")).toEqual([]);
});

it.each(["immediate", "later", "410"])("202 confirms deletion through HEAD: %s", async (mode) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const url = `${PRIVATE}secret`;
  let deleting = false;
  let reads = 0;
  f.after(async (read, method, response) => {
    if (read !== url) return response;
    if (method === "DELETE") {
      deleting = true;
      return new Response(null, { status: 202 });
    }
    if (deleting && method === "HEAD") {
      reads++;
      if (mode === "later" && reads < 3) return new Response(null, { status: 200 });
      if (mode === "410") return new Response(null, { status: 410 });
    }
    return response;
  });
  if (mode === "later") {
    await expect(client.remove(url)).rejects.toMatchObject({ kind: "delete-pending" });
    await expect(client.remove(url)).rejects.toMatchObject({ kind: "delete-pending" });
  }
  await client.remove(url);
  expect(reads).toBe(mode === "later" ? 4 : 1);
  expect(f.pod.has(url)).toBe(false);
});

it.each([
  "exists",
  "offline",
  "503",
])("unconfirmed DELETE retains the moved duplicate: %s", async (mode) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const source = `${PRIVATE}secret`;
  const to = `${DRIVE}public/recovery`;
  let deleting = false;
  let reads = 0;
  f.intercept(async (url, init) => {
    if (url !== source) return undefined;
    if (init?.method === "DELETE") {
      deleting = true;
      return new Response(null, { status: 202 });
    }
    if (deleting && init?.method === "HEAD") {
      reads++;
      if (mode === "offline") throw new TypeError("Offline");
      if (mode === "503") return new Response(null, { status: 503 });
    }
    return undefined;
  });
  await expect(client.move(source, to, { kind: "preserve-source" })).rejects.toMatchObject({
    deletedSources: [],
    unverifiedSources: [source],
    retainedDestinations: [to],
    cause: { kind: "delete-pending", message: "Still deleting on the server" },
  });
  expect(reads).toBe(1);
  expect(f.pod.has(source)).toBe(true);
  expect(f.pod.has(to)).toBe(true);
  const fresh = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  await expect(fresh.remove(to)).rejects.toMatchObject({ kind: "delete-pending" });
  await expect(
    fresh.write(to, "replacement", { contentType: "text/plain" }, { kind: "protect-ancestors" }),
  ).rejects.toMatchObject({ kind: "delete-pending" });
  expect(await (await fresh.read(to)).text()).toBe("secret contents");
});

it.each([
  "file",
  "folder",
])("permanent deletion retains its Trash record for an accepted %s DELETE", async (kind) => {
  const { deleteForever } = await import("../src/apps/drive/lib/operations/operations");
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const original = kind === "folder" ? PRIVATE : `${PRIVATE}secret`;
  const trashed = await trashItems(client, DRIVE, [await client.stat(original)], { webId: OWNER });
  expect(trashed.failed).toEqual([]);
  const entry = trashed.done[0];
  if (!entry) throw new Error("Missing trash entry");
  const target = kind === "folder" ? `${entry.url}secret` : entry.url;
  let deferred: RequestInit | undefined;
  f.intercept(async (url, init) => {
    if (url === target && init?.method === "DELETE") {
      deferred = init;
      return new Response(null, { status: 202 });
    }
    return undefined;
  });
  const result = await deleteForever(client, DRIVE, [entry]);
  expect(result.done).toEqual([]);
  expect(result.failed).toHaveLength(1);
  expect(await listTrash(client, DRIVE)).toHaveLength(1);
  if (!deferred) throw new Error("No deferred deletion");
  f.intercept(undefined);
  await f.fetch(target, deferred);
  expect((await deleteForever(client, DRIVE, await listTrash(client, DRIVE))).failed).toEqual([]);
  expect(await listTrash(client, DRIVE)).toEqual([]);
});

it.each(["Recent", "Search"])("%s ignores missing descendants and missing roots", async (view) => {
  const { recentFiles, searchByName } = await import("../src/apps/drive/lib/operations/operations");
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const query = () =>
    view === "Recent" ? recentFiles(client, [DRIVE]) : searchByName(client, DRIVE, "p");
  for (const status of [404, 410]) {
    f.intercept(async (url, init) =>
      url === PRIVATE && (init?.method ?? "GET") === "GET"
        ? new Response(null, { status })
        : undefined,
    );
    const items = await query();
    expect(items.some(({ url }) => url === `${DRIVE}public/placeholder`)).toBe(true);
    expect(items.some(({ url }) => url === PRIVATE)).toBe(false);
    f.intercept(async (url, init) =>
      url === DRIVE && (init?.method ?? "GET") === "GET"
        ? new Response(null, { status })
        : undefined,
    );
    expect(await query()).toEqual([]);
  }
});

it.each([
  "restore",
  "upload cleanup",
])("accepted %s DELETE keeps bytes and protection until confirmation", async (operation) => {
  const { deletionLedger, protectionLedger } = await import(
    "../src/apps/drive/lib/client/protection-ledger"
  );
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const original = `${PRIVATE}secret`;
  if (operation === "restore") {
    const { done } = await trashItems(client, DRIVE, [await client.stat(original)], {
      webId: OWNER,
    });
    const entry = done[0];
    if (!entry) throw new Error("No trash entry");
    f.intercept(async (url, init) =>
      url === entry.url && init?.method === "DELETE"
        ? new Response(null, { status: 202 })
        : undefined,
    );
    const result = await restoreItems(client, DRIVE, [entry]);
    expect(result.done).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(f.pod.has(entry.url)).toBe(true);
    expect(f.pod.has(original)).toBe(true);
    expect(await deletionLedger(f.fetch).get(entry.url)).toBeDefined();
    await expect(client.remove(original)).rejects.toMatchObject({ kind: "delete-pending" });
  } else {
    const to = `${DRIVE}public/new/child`;
    const folder = `${DRIVE}public/new/`;
    await protectionLedger(f.fetch).set(folder, {
      acl: `${PRIVATE}.policy`,
      from: PRIVATE,
      turtle: f.policies.get(`${PRIVATE}.policy`) as string,
    });
    f.intercept(async (url, init) => {
      if (url === `${folder}.policy` && init?.method === "PUT")
        return new Response(null, { status: 503 });
      if (url === folder && init?.method === "DELETE") return new Response(null, { status: 202 });
      return undefined;
    });
    await expect(
      client.write(to, "bytes", { contentType: "text/plain" }, { kind: "protect-ancestors" }),
    ).rejects.toMatchObject({ kind: "delete-pending" });
    expect(await deletionLedger(f.fetch).get(folder)).toBeDefined();
    expect(await protectionLedger(f.fetch).get(folder)).toBeDefined();
    const fresh = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
    await expect(
      fresh.write(to, "replacement", { contentType: "text/plain" }, { kind: "protect-ancestors" }),
    ).rejects.toMatchObject({ kind: "delete-pending" });
    expect(f.pod.has(to)).toBe(false);
  }
});

it.each([404, 410, 503])("Trash classifies a %s recovery subtree independently", async (status) => {
  const { serializeTrashIndex, trashIndexFrom } = await import(
    "../src/apps/drive/lib/operations/trash-index"
  );
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  await client.write(
    `${PRIVATE}nested/file`,
    "nested",
    { contentType: "text/plain" },
    { kind: "protect-ancestors" },
  );
  const {
    done: [entry],
  } = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  if (!entry) throw new Error("Missing entry");
  const indexUrl = `${DRIVE}.trash/index.ttl`;
  const current = await client.readRdf(indexUrl);
  if (!current?.etag) throw new Error("No index");
  const index = trashIndexFrom(current.dataset);
  index.record(entry.url).status = "partial";
  await client.write(
    indexUrl,
    await serializeTrashIndex(index),
    { contentType: "text/turtle", ifMatch: current.etag },
    { kind: "protect-ancestors" },
  );
  f.intercept(async (url, init) =>
    url === `${entry.url}nested/` && (init?.method ?? "GET") === "GET"
      ? new Response(null, { status })
      : undefined,
  );
  if (status === 503) await expect(listTrash(client, DRIVE)).rejects.toMatchObject({ status });
  else {
    const entries = await listTrash(client, DRIVE);
    expect(entries[0]?.remaining).toEqual([`${entry.url}secret`]);
    // A missing top-level recovery is also dropped, without blocking the view.
    f.intercept(async (url, init) =>
      url === entry.url && (init?.method ?? "GET") === "GET"
        ? new Response(null, { status })
        : undefined,
    );
    expect(await listTrash(client, DRIVE)).toEqual([]);
  }
});

it("copy rollback reports a pending cleanup DELETE and retains the duplicate", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const to = `${DRIVE}public/copy`;
  f.intercept(async (url, init) => {
    if (url === to && init?.method === "PUT" && init.body instanceof Blob)
      return new Response(null, { status: 503 });
    if (url === to && init?.method === "DELETE") return new Response(null, { status: 202 });
    return undefined;
  });
  await expect(
    client.copy(`${PRIVATE}secret`, to, { kind: "preserve-source" }),
  ).rejects.toMatchObject({
    retainedDestinations: [to],
    cause: { kind: "delete-pending" },
  });
  expect(f.pod.has(to)).toBe(true);
  expect(f.pod.has(`${PRIVATE}secret`)).toBe(true);
});

it.each([
  "restore",
  "partial restore",
  "delete",
])("%s reports an accepted slot cleanup DELETE instead of success", async (operation) => {
  const { deleteForever } = await import("../src/apps/drive/lib/operations/operations");
  const { serializeTrashIndex, trashIndexFrom } = await import(
    "../src/apps/drive/lib/operations/trash-index"
  );
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const {
    done: [entry],
  } = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  if (!entry) throw new Error("No entry");
  if (operation === "partial restore") {
    const url = `${DRIVE}.trash/index.ttl`;
    const current = await client.readRdf(url);
    if (!current?.etag) throw new Error("Missing index");
    const index = trashIndexFrom(current.dataset);
    index.record(entry.url).status = "partial";
    await client.write(
      url,
      await serializeTrashIndex(index),
      { contentType: "text/turtle", ifMatch: current.etag },
      { kind: "protect-ancestors" },
    );
  }
  const slot = new URL("..", entry.url).href;
  f.intercept(async (url, init) =>
    url === slot && init?.method === "DELETE" ? new Response(null, { status: 202 }) : undefined,
  );
  const result =
    operation === "delete"
      ? await deleteForever(client, DRIVE, [entry])
      : await restoreItems(client, DRIVE, [entry]);
  expect(result.done).toEqual([]);
  expect(result.failed).toMatchObject([{ error: { kind: "delete-pending" } }]);
  expect(f.pod.has(slot)).toBe(true);
});

it("container merge exposes a pending rollback DELETE without discarding its source data", async () => {
  const { DataFactory } = await import("n3");
  const { parseRdf } = await import("@jeswr/fetch-rdf");
  const { WacFields, turtle } = await import("./drive-wac-pod");
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  // The in-memory pod generates listings, so attach application data at its read seam.
  f.after(async (url, method, response) => {
    if (url !== PRIVATE || method !== "GET" || !response.ok) return response;
    const data = await parseRdf(await response.text(), "text/turtle");
    new WacFields(PRIVATE, data, DataFactory)
      .iris("http://purl.org/dc/terms/relation")
      .add(`${ROOT}related`);
    return new Response(await turtle(data), { status: response.status, headers: response.headers });
  });
  const to = `${DRIVE}public/merged/`;
  let puts = 0;
  f.intercept(async (url, init) => {
    if (url !== to) return undefined;
    if (init?.method === "PUT" && ++puts > 1) return new Response(null, { status: 503 });
    if (init?.method === "DELETE") return new Response(null, { status: 202 });
    return undefined;
  });
  await expect(
    client.mergeContainer(PRIVATE, to, { kind: "preserve-source" }),
  ).rejects.toMatchObject({ kind: "delete-pending" });
  expect(f.pod.has(PRIVATE)).toBe(true);
  expect(f.pod.has(to)).toBe(true);
});

it("permanent deletion reconciles a recovery container removed after its last child", async () => {
  const { deleteForever } = await import("../src/apps/drive/lib/operations/operations");
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const {
    done: [entry],
  } = await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER });
  if (!entry) throw new Error("Missing entry");
  f.after(async (url, method, response) => {
    if (url === `${entry.url}secret` && method === "DELETE" && response.ok)
      await f.pod.fetch(entry.url, { method: "DELETE" });
    return response;
  });
  expect(await deleteForever(client, DRIVE, [entry])).toEqual({ done: [entry], failed: [] });
  expect(await listTrash(client, DRIVE)).toEqual([]);
});
