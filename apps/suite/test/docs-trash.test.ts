// AUTHORED-BY Codex
// AUTHORED-BY Codex GPT-6

import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { deleteDocument, deleteForever, restoreDocument } from "../src/apps/docs/editor/operations";
import {
  buildDocument,
  DocumentDoc,
  parseDocument,
  serializeTurtle,
} from "../src/apps/docs/lib/model";
import { createSolidDriveClient, DriveError } from "../src/apps/drive/lib/client/client";
import { listTrash, restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";

const ROOT = "https://docs-trash.test/alice/";
const DRIVE = `${ROOT}drive/`;
const DOC = `${ROOT}docs/plan.ttl`;
const TREE = `${ROOT}docs/plan/`;
async function fixture(companion = true) {
  const snapshot = await serializeTurtle(
    buildDocument(DOC, { title: "Plan", updateLog: `${TREE}updates/` }),
  );
  const pod = createDemoPod({
    root: ROOT,
    seed: [
      { path: "docs/plan.ttl", body: snapshot, contentType: "text/turtle" },
      ...(companion
        ? [
            { path: "docs/plan/assets/chart.png", body: "image", contentType: "image/png" },
            {
              path: "docs/plan/updates/001798000000000-00000000-0000-4000-8000-000000000001",
              body: "update",
              contentType: "application/octet-stream",
            },
          ]
        : []),
    ],
  });
  const session = { storageUrl: ROOT, webId: `${ROOT}profile#me`, fetch: pod.fetch } as PodSession;
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: pod.fetch });
  return { pod, session, client };
}

describe("Docs uses Drive trash records", () => {
  it("relocates revision links and preserves an undated snapshot's complete body", async () => {
    const { pod, session, client } = await fixture(false);
    const dataset = buildDocument(DOC, {
      title: "Plan",
      body: "<p>Full body</p>",
      revisionLabel: "Named draft",
    });
    new DocumentDoc(`${DOC}#it`, dataset, DataFactory).modified = undefined;
    await pod.fetch(DOC, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: await serializeTurtle(dataset),
    });
    const trashed = await deleteDocument(DOC, session);
    await pod.fetch(DOC, { method: "PUT", body: "occupant" });
    const restored = await restoreDocument(trashed.done, session);
    expect(restored.failed).toEqual([]);
    const url = restored.done[0]?.url as string;
    const snapshot = await client.readRdf(url);
    const data = snapshot && parseDocument(url, snapshot.dataset);
    expect(data?.body).toBe("<p>Full body</p>");
    expect(data?.revisions[0]?.id).toBe(`${url}#rev-0`);
    expect(data?.revisions[0]?.label).toBe("Named draft");
  });
  it.each([
    "source-read",
    "source-validator",
    "weak-source",
    "write-validator",
    "weak-write",
    "changed-target",
    "companion",
  ])("retains the trash snapshot when a renamed pair cannot be safely restored (%s)", async (failure) => {
    const { pod, session, client } = await fixture();
    const trashed = await deleteDocument(DOC, session);
    await pod.fetch(DOC, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: await serializeTurtle(
        buildDocument(DOC, { title: "Replacement", updateLog: `${TREE}updates/` }),
      ),
    });
    await client.createFolder(`${TREE}updates/`, { kind: "inherit-verified" });
    const target = `${ROOT}docs/plan%20(restored).ttl`;
    const interrupted = {
      ...client,
      readVersion: async (url: string) => {
        if (url === trashed.done[0]?.url && failure === "source-read")
          throw new DriveError("not-found", 404, url);
        const version = await client.readVersion(url);
        if (url === trashed.done[0]?.url && failure === "source-validator")
          return { body: version.body };
        if (url === trashed.done[0]?.url && failure === "weak-source")
          return { ...version, etag: 'W/"source"' };
        return version;
      },
      write: async (...args: Parameters<typeof client.write>) => {
        const written = await client.write(...args);
        if (args[0] === target && failure === "write-validator") return {};
        if (args[0] === target && failure === "weak-write") return { etag: 'W/"written"' };
        return written;
      },
      stat: async (...args: Parameters<typeof client.stat>) => {
        const item = await client.stat(...args);
        return args[0] === target && failure === "changed-target"
          ? { ...item, etag: '"changed"' }
          : item;
      },
      move: async (...args: Parameters<typeof client.move>) => {
        if (args[0] === trashed.done[1]?.url && failure === "companion")
          throw new Error("companion unavailable");
        return client.move(...args);
      },
    };
    const restored = await restoreItems(interrupted, DRIVE, trashed.done);
    expect(restored.failed.some(({ url }) => url === trashed.done[0]?.url)).toBe(true);
    expect((await pod.fetch(trashed.done[0]?.url as string)).ok).toBe(true);
    expect(await (await pod.fetch(DOC)).text()).toContain("Replacement");
    if (failure === "source-read") expect(restored.done).toEqual([]);
  });
  it("rewrites a renamed snapshot even when restoring just that record", async () => {
    const { pod, session, client } = await fixture();
    const trashed = await deleteDocument(DOC, session);
    await pod.fetch(DOC, { method: "PUT", body: "occupant" });
    const restored = await restoreDocument(trashed.done.slice(0, 1), session);
    expect(restored.failed).toEqual([]);
    const result = await client.readRdf(restored.done[0]?.url as string);
    expect(result && parseDocument(restored.done[0]?.url as string, result.dataset)?.title).toBe(
      "Plan",
    );
  });
  it("keeps ordinary colliding resources in docs restorable without interpreting invalid RDF", async () => {
    const { pod, session, client } = await fixture(false);
    await pod.fetch(DOC, { method: "PUT", body: "ordinary file" });
    const trashed = await deleteDocument(DOC, session);
    await pod.fetch(DOC, { method: "PUT", body: "occupant" });
    const restored = await restoreItems(client, DRIVE, trashed.done);
    expect(restored.failed).toEqual([]);
    expect(await (await pod.fetch(restored.done[0]?.url as string)).text()).toBe("ordinary file");
  });
  it("classifies companions before a parallel snapshot restore can delete its trash source", async () => {
    const { pod, session, client } = await fixture();
    const trashed = await deleteDocument(DOC, session);
    await client.createFolder(`${TREE}updates/`, { kind: "inherit-verified" });
    let moving = false;
    let release = () => {};
    const moved = new Promise<void>((resolve) => {
      release = resolve;
    });
    const racing = {
      ...client,
      move: async (...args: Parameters<typeof client.move>) => {
        if (args[0] !== trashed.done[0]?.url) return client.move(...args);
        moving = true;
        try {
          return await client.move(...args);
        } finally {
          release();
        }
      },
      read: async (source: string) => {
        if (source === trashed.done[0]?.url && moving) await moved;
        return client.read(source);
      },
    };
    const restored = await restoreItems(racing, DRIVE, trashed.done);
    expect(restored.failed).toEqual([]);
    expect(restored.done[1]).toMatchObject({ url: TREE, renamed: false });
    expect(
      await (
        await pod.fetch(`${TREE}updates/001798000000000-00000000-0000-4000-8000-000000000001`)
      ).text(),
    ).toBe("update");
  });
  it("renames an ordinary docs archive collision instead of partially merging binary files", async () => {
    const { pod, client, session } = await fixture();
    const archive = `${ROOT}docs/archive/`;
    await pod.fetch(`${archive}updates/notes.bin`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: "original",
    });
    const trashed = await trashItems(client, DRIVE, [await client.stat(archive)], {
      webId: session.webId,
      now: new Date(),
    });
    await pod.fetch(`${archive}updates/notes.bin`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: "replacement",
    });
    const restored = await restoreItems(client, DRIVE, trashed.done);
    expect(restored.failed).toEqual([]);
    expect(restored.done[0]).toMatchObject({
      renamed: true,
      url: `${ROOT}docs/archive%20(restored)/`,
    });
    expect(await (await pod.fetch(`${archive}updates/notes.bin`)).text()).toBe("replacement");
    expect(
      await (await pod.fetch(`${ROOT}docs/archive%20(restored)/updates/notes.bin`)).text(),
    ).toBe("original");
    expect(await listTrash(client, DRIVE)).toEqual([]);
  });
  it("merges a recreated update-only companion tree on Undo without changing asset URLs", async () => {
    const { pod, session, client } = await fixture();
    const trashed = await deleteDocument(DOC, session);
    await pod.fetch(`${TREE}updates/001798000000001-00000000-0000-4000-8000-000000000002`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: "late immutable update",
    });
    const restored = await restoreItems(client, DRIVE, trashed.done);
    expect(restored.failed).toEqual([]);
    expect(restored.done.map(({ url, renamed }) => ({ url, renamed }))).toEqual([
      { url: DOC, renamed: false },
      { url: TREE, renamed: false },
    ]);
    expect(
      await (
        await pod.fetch(`${TREE}updates/001798000000000-00000000-0000-4000-8000-000000000001`)
      ).text(),
    ).toBe("update");
    expect(
      await (
        await pod.fetch(`${TREE}updates/001798000000001-00000000-0000-4000-8000-000000000002`)
      ).text(),
    ).toBe("late immutable update");
    expect(await (await pod.fetch(`${TREE}assets/chart.png`)).text()).toBe("image");
    expect(await listTrash(client, DRIVE)).toEqual([]);
  });
  it.each([
    ["assets/new.png", "image/png"],
    ["updates/not-an-update.txt", "text/plain"],
    ["updates/notes.bin", "application/octet-stream"],
    ["updates/nested/update.bin", "application/octet-stream"],
    ["other/update.bin", "application/octet-stream"],
    ["unexpected.bin", "application/octet-stream"],
  ])("preserves the normal restore collision policy for a companion containing %s", async (path, type) => {
    const { pod, session, client } = await fixture();
    const trashed = await deleteDocument(DOC, session);
    await pod.fetch(`${TREE}${path}`, {
      method: "PUT",
      headers: { "content-type": type },
      body: "unrelated occupant",
    });
    const restored = await restoreItems(client, DRIVE, trashed.done);
    expect(restored.failed).toEqual([]);
    expect(restored.done[1]).toMatchObject({
      url: `${ROOT}docs/plan%20(restored)/`,
      renamed: true,
    });
    expect(await (await pod.fetch(`${TREE}${path}`)).text()).toBe("unrelated occupant");
  });
  it.each([
    undefined,
    `${ROOT}docs/other/updates/`,
    `${TREE}not-updates/`,
  ])("requires sibling Docs metadata naming its own log before merging (%s)", async (updateLog) => {
    const { pod, client, session } = await fixture();
    const trashed = await deleteDocument(DOC, session);
    await pod.fetch(DOC, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: await serializeTurtle(buildDocument(DOC, { title: "Occupant", updateLog })),
    });
    await client.createFolder(`${TREE}updates/`, { kind: "inherit-verified" });
    const restored = await restoreItems(client, DRIVE, trashed.done.slice(1));
    expect(restored.failed).toEqual([]);
    expect(restored.done[0]?.renamed).toBe(true);
  });
  it.each([
    "invalid turtle",
    "",
  ])("falls back to rename when the sibling cannot verify a Docs companion (%s)", async (body) => {
    const { pod, client, session } = await fixture();
    const trashed = await deleteDocument(DOC, session);
    await pod.fetch(DOC, { method: "PUT", headers: { "content-type": "text/turtle" }, body });
    await client.createFolder(`${TREE}updates/`, { kind: "inherit-verified" });
    const restored = await restoreItems(client, DRIVE, trashed.done.slice(1));
    expect(restored.failed).toEqual([]);
    expect(restored.done[0]?.renamed).toBe(true);
  });
  it("merges empty update folders and timestamped recovery logs without renaming", async () => {
    const { pod, session, client } = await fixture();
    const trashed = await deleteDocument(DOC, session);
    await client.createFolder(`${TREE}updates/`, { kind: "inherit-verified" });
    await pod.fetch(`${TREE}updates-123/001798000000002-00000000-0000-4000-8000-000000000003`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: "late",
    });
    expect((await restoreDocument(trashed.done, session)).failed).toEqual([]);
    expect(
      await (
        await pod.fetch(`${TREE}updates/001798000000000-00000000-0000-4000-8000-000000000001`)
      ).text(),
    ).toBe("update");
    expect(
      await (
        await pod.fetch(`${TREE}updates-123/001798000000002-00000000-0000-4000-8000-000000000003`)
      ).text(),
    ).toBe("late");
  });
  it("retains recovery copies when an update URL is occupied by different bytes", async () => {
    const { pod, session, client } = await fixture();
    const trashed = await deleteDocument(DOC, session);
    await pod.fetch(`${TREE}updates/001798000000000-00000000-0000-4000-8000-000000000001`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: "different",
    });
    const restored = await restoreDocument(trashed.done, session);
    expect(restored.done).toHaveLength(1);
    expect(restored.failed).toHaveLength(1);
    expect(
      await (
        await pod.fetch(`${TREE}updates/001798000000000-00000000-0000-4000-8000-000000000001`)
      ).text(),
    ).toBe("different");
    const recovery = (await listTrash(client, DRIVE))[0];
    expect(recovery?.status).toBe("partial");
    expect(
      await (
        await pod.fetch(
          `${recovery?.url}updates/001798000000000-00000000-0000-4000-8000-000000000001`,
        )
      ).text(),
    ).toBe("update");
    await pod.fetch(`${TREE}updates/001798000000000-00000000-0000-4000-8000-000000000001`, {
      method: "DELETE",
    });
    // Retry the caller's original record after resolving the conflicting resource.
    expect((await restoreDocument(trashed.done.slice(1), session)).failed).toEqual([]);
    expect(
      await (
        await pod.fetch(`${TREE}updates/001798000000000-00000000-0000-4000-8000-000000000001`)
      ).text(),
    ).toBe("update");
    expect(await (await pod.fetch(`${TREE}assets/chart.png`)).text()).toBe("image");
    expect(await listTrash(client, DRIVE)).toEqual([]);
  });
  it("lists a Docs delete in Drive and restores both the snapshot and companion tree with restoreItems", async () => {
    const { pod, session, client } = await fixture();
    const result = await deleteDocument(DOC, session);
    expect(result).toMatchObject({ done: [{ original: DOC }, { original: TREE }], failed: [] });
    const entries = await listTrash(client, DRIVE);
    expect(entries).toEqual(result.done);
    expect(entries).toHaveLength(2);
    expect((await pod.fetch(DOC)).status).toBe(404);
    expect((await pod.fetch(`${TREE}assets/chart.png`)).status).toBe(404);
    const restored = await restoreItems(client, DRIVE, entries);
    expect(restored.failed).toEqual([]);
    expect(restored.done.map(({ url }) => url)).toEqual([DOC, TREE]);
    expect(await (await pod.fetch(DOC)).text()).toContain("Plan");
    expect(await (await pod.fetch(`${TREE}assets/chart.png`)).text()).toBe("image");
    expect(
      await (
        await pod.fetch(`${TREE}updates/001798000000000-00000000-0000-4000-8000-000000000001`)
      ).text(),
    ).toBe("update");
    expect(await listTrash(client, DRIVE)).toEqual([]);
  });
  it("uses the same records for Docs restore and confirmed permanent deletion", async () => {
    const { session, client, pod } = await fixture();
    const first = await deleteDocument(DOC, session);
    expect((await restoreDocument(first.done, session)).failed).toEqual([]);
    const second = await deleteDocument(DOC, session);
    await expect(deleteForever(second.done, session, false)).rejects.toThrow("Confirm");
    expect(await listTrash(client, DRIVE)).toHaveLength(2);
    expect((await deleteForever(second.done, session, true)).failed).toEqual([]);
    expect(await listTrash(client, DRIVE)).toEqual([]);
    for (const entry of second.done) expect((await pod.fetch(entry.url)).status).toBe(404);
  });
  it("trashes a document without a companion container", async () => {
    const { session, client } = await fixture(false);
    const result = await deleteDocument(DOC, session);
    expect(result.done).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(await listTrash(client, DRIVE)).toEqual(result.done);
  });
  it.each([
    "docs/sub/plan.ttl",
    "drive/plan.ttl",
    "docs/plan.ttl?x=1",
    "docs/plan.txt",
  ])("refuses non-document location %s before deleting anything", async (path) => {
    const { session, pod } = await fixture();
    await expect(deleteDocument(`${ROOT}${path}`, session)).rejects.toThrow();
    expect((await pod.fetch(DOC)).ok).toBe(true);
  });
  it("preserves Drive partial records when the companion tree cannot finish moving", async () => {
    const { session, client, pod } = await fixture();
    const interrupted = {
      ...session,
      fetch: (async (input, init) =>
        String(input) === `${TREE}updates/001798000000000-00000000-0000-4000-8000-000000000001` &&
        init?.method === "DELETE"
          ? new Response(null, { status: 403 })
          : pod.fetch(input, init)) as typeof fetch,
    };
    const result = await deleteDocument(DOC, interrupted);
    expect(result.done.map((entry) => entry.original)).toEqual([DOC]);
    expect(result.failed).toMatchObject([{ url: TREE }]);
    const visible = await listTrash(client, DRIVE);
    expect(visible).toHaveLength(2);
    const tree = visible.find((entry) => entry.original === TREE);
    expect(tree).toMatchObject({ status: "partial" });
    expect(tree?.remaining).toEqual([
      `${tree?.url}assets/chart.png`,
      `${tree?.url}updates/001798000000000-00000000-0000-4000-8000-000000000001`,
    ]);
    const restored = await restoreItems(client, DRIVE, visible);
    expect(restored.failed).toEqual([]);
    expect(restored.done.map(({ url, renamed }) => ({ url, renamed }))).toEqual([
      { url: DOC, renamed: false },
      { url: TREE, renamed: false },
    ]);
    expect(await (await pod.fetch(`${TREE}assets/chart.png`)).text()).toBe("image");
    expect(
      await (
        await pod.fetch(`${TREE}updates/001798000000000-00000000-0000-4000-8000-000000000001`)
      ).text(),
    ).toBe("update");
    expect((await pod.fetch(DOC)).ok).toBe(true);
    expect((await pod.fetch(`${ROOT}docs/plan%20(restored)/`)).status).toBe(404);
    expect(await listTrash(client, DRIVE)).toEqual([]);
  });
  it("does not remove either source when Drive cannot persist the batch intents", async () => {
    const { session, pod } = await fixture();
    const unavailable = {
      ...session,
      fetch: (async (input, init) =>
        String(input) === `${DRIVE}.trash/index.ttl` && init?.method === "PUT"
          ? new Response(null, { status: 503 })
          : pod.fetch(input, init)) as typeof fetch,
    };
    const result = await deleteDocument(DOC, unavailable);
    expect(result.done).toEqual([]);
    expect(result.failed.map(({ url }) => url)).toEqual([DOC, TREE]);
    expect(result.warnings).toMatchObject([{ kind: "trash-index-persistence" }]);
    expect((await pod.fetch(DOC)).ok).toBe(true);
    expect((await pod.fetch(`${TREE}assets/chart.png`)).ok).toBe(true);
  });
  it("surfaces completion warnings and leaves records that Drive can reconcile", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { session, pod, client } = await fixture();
    let writes = 0;
    const unavailable = {
      ...session,
      fetch: (async (input, init) => {
        if (String(input) === `${DRIVE}.trash/index.ttl` && init?.method === "PUT" && ++writes > 1)
          return new Response(null, { status: 503 });
        // Also lose the slot-local completion receipts: only the pending
        // intents survive, so Drive must conservatively reconcile as partial.
        if (String(input).endsWith("/partial.ttl") && init?.method === "PUT")
          return new Response(null, { status: 503 });
        return pod.fetch(input, init);
      }) as typeof fetch,
    };
    const result = await deleteDocument(DOC, unavailable);
    expect(result.done).toHaveLength(2);
    expect(result.failed).toEqual([]);
    expect(result.warnings).toMatchObject([{ kind: "trash-index-persistence" }]);
    const reconciled = await listTrash(client, DRIVE);
    expect(reconciled).toEqual(
      result.done.map((entry) => ({
        ...entry,
        status: "partial",
        remaining:
          entry.original === DOC
            ? [entry.url]
            : [
                `${entry.url}assets/chart.png`,
                `${entry.url}updates/001798000000000-00000000-0000-4000-8000-000000000001`,
              ],
      })),
    );
    expect((await restoreDocument(reconciled, session)).failed).toEqual([]);
    expect(await listTrash(client, DRIVE)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
  it("refuses to start a delete when the companion existence check is forbidden", async () => {
    const { session, pod } = await fixture();
    const forbidden = {
      ...session,
      fetch: (async (input, init) =>
        String(input) === TREE && init?.method === "HEAD"
          ? new Response(null, { status: 403 })
          : pod.fetch(input, init)) as typeof fetch,
    };
    await expect(deleteDocument(DOC, forbidden)).rejects.toMatchObject({ kind: "forbidden" });
    expect((await pod.fetch(DOC)).ok).toBe(true);
  });
  it("refuses Docs restore or purge of records for other apps", async () => {
    const { session } = await fixture();
    const entry = {
      url: `${DRIVE}.trash/slot/file`,
      original: `${ROOT}mail/file.ttl`,
      name: "file",
      trashedAt: new Date(),
    };
    await expect(restoreDocument([entry], session)).rejects.toThrow("Expected a document in Docs");
    await expect(deleteForever([entry], session, true)).rejects.toThrow(
      "Expected a document in Docs",
    );
  });
});

it("bounds Docs trash and Undo requests by compacting the typed Yjs log without changing CRDT state", async () => {
  const doc = new Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array) => updates.push(update));
  for (const letter of "A clear plan for the launch. Keep every word in your own pod.")
    doc.getText("body").insert(doc.getText("body").length, letter);
  doc.getText("body").delete(0, 2);
  const seed = updates.map((body, index) => ({
    path: `docs/plan/updates/${index}`,
    body,
    contentType: "application/octet-stream",
  }));
  const results = [];
  for (const compact of [false, true]) {
    const pod = createDemoPod({
      root: ROOT,
      seed: [{ path: "docs/plan.ttl", body: "snapshot", contentType: "text/turtle" }, ...seed],
    });
    let requests = 0;
    let mutations = 0;
    const http: typeof fetch = (input, init) => {
      requests++;
      if (["PUT", "DELETE"].includes(init?.method ?? "GET")) mutations++;
      return pod.fetch(input, init);
    };
    const client = createSolidDriveClient({ storageUrl: ROOT, fetch: http });
    const session = { storageUrl: ROOT, webId: `${ROOT}profile#me`, fetch: http } as PodSession;
    const trashed = compact
      ? await deleteDocument(DOC, session)
      : await trashItems(client, DRIVE, await Promise.all([client.stat(DOC), client.stat(TREE)]));
    expect(trashed.failed).toEqual([]);
    const trash = { requests, mutations };
    requests = mutations = 0;
    expect((await restoreDocument(trashed.done, session)).failed).toEqual([]);
    const undo = { requests, mutations };
    const replay = new Doc();
    const log = await client.list(`${TREE}updates/`);
    for (const { url } of log)
      applyUpdate(replay, new Uint8Array(await (await client.read(url)).arrayBuffer()));
    expect(encodeStateAsUpdate(replay)).toEqual(encodeStateAsUpdate(doc));
    if (compact) expect(log).toHaveLength(1);
    results.push({ trash, undo });
    replay.destroy();
  }
  doc.destroy();
  expect(updates).toHaveLength(62);
  // Lease checks and resource protection still apply on the demo pod; its
  // explicit capability lets us omit redundant ancestor HEADs and ACL history.
  // Definitive 205 DELETE responses retire their intents without confirmation HEADs.
  expect(results).toEqual([
    { trash: { requests: 612, mutations: 132 }, undo: { requests: 416, mutations: 133 } },
    { trash: { requests: 253, mutations: 73 }, undo: { requests: 50, mutations: 11 } },
  ]);
});
