// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { createSolidDriveClient, DriveError } from "../src/apps/drive/lib/client/client";
import { deletionLedger, protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import {
  deleteForever,
  listTrash,
  restoreItems,
  trashItems,
} from "../src/apps/drive/lib/operations/operations";
import {
  deleteOutcomes,
  refusedDelete,
  terminalDelete,
  unknownDelete,
} from "./drive-delete-outcomes";
import { DRIVE, OWNER, PRIVATE, ROOT, turtle, WacFields, wacPod } from "./drive-wac-pod";

it("Restore retains both guards and recovery after a 504 until the deferred child DELETE finishes", async () => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const source = `${PRIVATE}secret`;
  let deferred: RequestInit | undefined;
  f.intercept(async (url, init) => {
    if (url === source && init?.method === "DELETE") {
      deferred = init;
      return new Response(null, { status: 504 });
    }
    return undefined;
  });
  expect(
    (await trashItems(client, DRIVE, [await client.stat(PRIVATE)], { webId: OWNER })).done,
  ).toEqual([]);
  const [entry] = await listTrash(client, DRIVE);
  if (!entry || !deferred) throw new Error("Missing deferred deletion or recovery");
  const recovery = `${entry.url}secret`;
  expect(await deletionLedger(f.fetch).get(source)).toEqual({
    sources: [source],
    recovery,
    etag: expect.any(String),
  });
  expect(await deletionLedger(f.fetch).get(recovery)).toEqual({ sources: [source] });
  const fresh = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  expect((await restoreItems(fresh, DRIVE, [entry])).done).toEqual([]);
  expect(f.pod.has(recovery)).toBe(true);
  f.intercept(undefined);
  expect((await f.fetch(source, deferred)).ok).toBe(true);
  expect(f.pod.has(recovery)).toBe(true);
  expect((await restoreItems(fresh, DRIVE, [entry])).failed).toEqual([]);
  expect(await (await fresh.read(source)).text()).toBe("secret contents");
  expect(await deletionLedger(f.fetch).get(source)).toBeUndefined();
  expect(await deletionLedger(f.fetch).get(recovery)).toBeUndefined();
});

it.each([
  404, 503,
])("move retains recovery when final source verification reports %s before DELETE", async (status) => {
  const f = await wacPod();
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch });
  const source = `${PRIVATE}secret`;
  const recovery = `${DRIVE}public/recovery`;
  let checks = 0;
  await expect(
    client.move(
      source,
      recovery,
      { kind: "preserve-source" },
      {
        beforeDelete: async () => {
          if (++checks === 2) {
            if (status === 404) await f.pod.fetch(source, { method: "DELETE" });
            throw new DriveError(status === 404 ? "not-found" : "failed", status, source);
          }
        },
      },
    ),
  ).rejects.toMatchObject({
    kind: "partial-failure",
    retainedDestinations: [recovery],
    cause: { status },
  });
  expect(checks).toBe(2);
  expect(f.calls.filter(({ url, method }) => url === source && method === "DELETE")).toEqual([]);
  expect(await (await client.read(recovery)).text()).toBe("secret contents");
  expect(f.pod.has(source)).toBe(status !== 404);
});

describe.each([
  "trash",
  "move",
  "remove",
  "recursive remove",
  "copy rollback",
  "container merge",
  "slot cleanup",
  "permanent delete",
  "restore",
  "upload cleanup",
] as const)("%s DELETE outcomes", (operation) => {
  it.each(
    deleteOutcomes,
  )("classifies DELETE %s and retains only unresolved guards", async (outcome) => {
    const f = await wacPod();
    const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
    const original = `${PRIVATE}secret`;
    let target = original;
    let recovery: string | undefined;
    let entries: Awaited<ReturnType<typeof listTrash>> = [];
    if (
      operation === "permanent delete" ||
      operation === "restore" ||
      operation === "slot cleanup"
    ) {
      const trashed = await trashItems(client, DRIVE, [await client.stat(original)], {
        webId: OWNER,
      });
      expect(trashed.failed).toEqual([]);
      entries = trashed.done;
      target = entries[0]?.url as string;
      if (!target) throw new Error("Missing entry");
      if (operation === "restore") recovery = original;
      if (operation === "slot cleanup") target = new URL(".", target).href;
    } else if (operation === "move") recovery = `${DRIVE}public/moved`;
    else if (operation === "upload cleanup") {
      target = `${DRIVE}public/new/`;
      await protectionLedger(f.fetch).set(target, {
        acl: `${PRIVATE}.policy`,
        from: PRIVATE,
        turtle: f.policies.get(`${PRIVATE}.policy`) as string,
      });
    }
    if (operation === "recursive remove") target = PRIVATE;
    if (operation === "copy rollback") target = `${DRIVE}public/copy`;
    if (operation === "container merge") target = `${DRIVE}public/merged/`;
    let puts = 0;
    let requests = 0;
    f.intercept(async (url, init) => {
      if (operation === "upload cleanup" && url === `${target}.policy` && init?.method === "PUT")
        return new Response(null, { status: 503 });
      if (url === target && init?.method === "PUT") {
        if (operation === "copy rollback" && init.body instanceof Blob)
          return new Response(null, { status: 503 });
        if (operation === "container merge" && ++puts > 1)
          return new Response(null, { status: 503 });
      }
      if (url === target && init?.method === "DELETE") {
        requests++;
        if (!terminalDelete(outcome)) return unknownDelete(outcome);
      }
      return undefined;
    });
    f.after(async (url, method, response) => {
      if (operation === "container merge" && url === PRIVATE && method === "GET" && response.ok) {
        const data = await parseRdf(await response.text(), "text/turtle");
        new WacFields(PRIVATE, data, DataFactory)
          .iris("http://purl.org/dc/terms/relation")
          .add(`${ROOT}related`);
        return new Response(await turtle(data), {
          status: response.status,
          headers: response.headers,
        });
      }
      return terminalDelete(outcome) && url === target && method === "DELETE"
        ? new Response(null, { status: outcome as number })
        : response;
    });
    let failure: unknown;
    if (["remove", "recursive remove", "copy rollback", "container merge"].includes(operation)) {
      try {
        if (operation === "copy rollback")
          await client.copy(original, target, { kind: "preserve-source" });
        else if (operation === "container merge")
          await client.mergeContainer(PRIVATE, target, { kind: "preserve-source" });
        else await client.remove(target, { recursive: operation === "recursive remove" });
      } catch (error) {
        failure = error;
      }
    } else if (operation === "move") {
      try {
        await client.move(original, recovery as string, { kind: "preserve-source" });
      } catch (error) {
        failure = error;
      }
    } else if (operation === "upload cleanup") {
      try {
        await client.write(
          `${target}child`,
          "bytes",
          { contentType: "text/plain" },
          { kind: "protect-ancestors" },
        );
      } catch (error) {
        failure = error;
      }
    } else {
      const result =
        operation === "trash"
          ? await trashItems(client, DRIVE, [await client.stat(original)], { webId: OWNER })
          : operation === "restore"
            ? await restoreItems(client, DRIVE, entries)
            : await deleteForever(client, DRIVE, entries);
      failure = result.failed[0]?.error;
      expect(result.done).toHaveLength(terminalDelete(outcome) ? 1 : 0);
      if (operation === "trash") recovery = (await listTrash(client, DRIVE))[0]?.url;
    }
    // A definitive 412 never authorizes adopting a newer identity, even for cleanup.
    const expectedRequests = 1;
    expect(requests).toBe(expectedRequests);
    if (terminalDelete(outcome)) {
      if (!["upload cleanup", "copy rollback", "container merge"].includes(operation))
        expect(failure).toBeUndefined();
      expect(f.pod.has(target)).toBe(false);
      expect(await deletionLedger(f.fetch).get(target)).toBeUndefined();
      if (recovery) expect(await deletionLedger(f.fetch).get(recovery)).toBeUndefined();
      return;
    }
    expect(failure).toBeDefined();
    expect(f.pod.has(target)).toBe(true);
    if (refusedDelete(outcome)) {
      expect(await deletionLedger(f.fetch).get(target)).toBeUndefined();
      if (recovery) {
        expect(f.pod.has(recovery)).toBe(true);
        expect(await deletionLedger(f.fetch).get(recovery)).toBeUndefined();
      }
      f.intercept(undefined);
      await freshClientRemoval();
      return;
    }
    async function freshClientRemoval() {
      const fresh = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
      await fresh.remove(target);
      expect(f.pod.has(target)).toBe(false);
    }
    expect(await deletionLedger(f.fetch).get(target)).toEqual({
      sources: [target],
      etag: expect.any(String),
      ...(recovery ? { recovery } : {}),
    });
    if (recovery) {
      expect(f.pod.has(recovery)).toBe(true);
      expect(await deletionLedger(f.fetch).get(recovery)).toEqual({ sources: [target] });
    }
    const fresh = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
    await expect(fresh.remove(target)).rejects.toMatchObject({ kind: "delete-pending" });
    if (recovery)
      await expect(fresh.remove(recovery)).rejects.toMatchObject({ kind: "delete-pending" });
    if (operation === "upload cleanup") {
      expect(await protectionLedger(f.fetch).get(target)).toBeDefined();
      await expect(
        fresh.write(
          `${target}child`,
          "new",
          { contentType: "text/plain" },
          { kind: "protect-ancestors" },
        ),
      ).rejects.toMatchObject({ kind: "delete-pending" });
    }
    expect(requests).toBe(expectedRequests);
    // Complete the old request, then a fresh client must confirm absence before reuse.
    f.intercept(undefined);
    f.after(undefined);
    expect((await f.fetch(target, { method: "DELETE" })).ok).toBe(true);
    await fresh.remove(target);
    expect(await deletionLedger(f.fetch).get(target)).toBeUndefined();
    if (recovery) {
      expect(await deletionLedger(f.fetch).get(recovery)).toBeUndefined();
      expect(f.pod.has(recovery)).toBe(true);
    }
  });
});
