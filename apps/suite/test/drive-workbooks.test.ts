// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { createSolidDriveClient, type DriveItem } from "../src/apps/drive/lib/client/client";
import { withWorkbook } from "../src/apps/drive/lib/client/workbook";
import { hrefFor } from "../src/apps/drive/lib/files/urls";
import {
  deleteForever,
  listTrash,
  recentFiles,
  restoreItems,
  searchByName,
  trashItems,
} from "../src/apps/drive/lib/operations/operations";
import { friendlyType, toListEntry, viewItems } from "../src/apps/drive/lib/view/view";
import { encodeRef } from "../src/lib/refs";
import { harness, POD, ROOT } from "./sheets-workbook-helpers";

describe("Sheets containers in Drive", () => {
  it("presents a workbook as one item with its metadata title and editor link", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Quarterly Budget" });
    const client = createSolidDriveClient({ storageUrl: POD, fetch: h.fetch });
    const items = await client.list(ROOT);
    expect(items).toHaveLength(1);
    const item = items[0] as DriveItem;
    expect(item).toMatchObject({
      url: book.container,
      name: "Quarterly Budget",
      kind: "folder",
      workbook: true,
      modified: book.metadata.modified,
    });
    expect(await client.stat(book.container)).toMatchObject({
      name: "Quarterly Budget",
      workbook: true,
    });
    expect(hrefFor(item)).toBe(`/sheets/s/${encodeRef(book.container)}`);
    expect(friendlyType(item)).toBe("Spreadsheet");
    expect(toListEntry(item)).toMatchObject({ kind: "resource", contentType: "text/csv" });
    expect(viewItems(items, { types: ["data"] })).toEqual(items);
    expect(viewItems(items, { types: ["folders"] })).toEqual([]);
  });

  it("keeps a plain workbook-looking folder without workbook.json as a folder", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Budget / 2026" });
    await h.pod.fetch(`${book.container}workbook.json`, { method: "DELETE" });
    await h.pod.fetch(`${ROOT}quarterly-budget/`, { method: "PUT" });
    const client = createSolidDriveClient({ storageUrl: POD, fetch: h.fetch });
    const items = await client.list(ROOT);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.workbook).toBeUndefined();
      expect(item.kind).toBe("folder");
      expect(friendlyType(item)).toBe("Folder");
      expect(hrefFor(item)).toMatch(/^\/drive\/f\//);
    }
  });

  it("treats workbooks as one item in Recent and Search without walking their contents", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Budget" });
    const client = createSolidDriveClient({ storageUrl: POD, fetch: h.fetch });
    h.calls.length = 0;
    const recent = await recentFiles(client, [ROOT]);
    expect(recent.map((item) => item.url)).toEqual([book.container]);
    expect((await searchByName(client, ROOT, "budget")).map((item) => item.url)).toEqual([
      book.container,
    ]);
    expect(await searchByName(client, ROOT, "workbook.json")).toEqual([]);
    expect(h.calls.filter((call) => call.url === book.container && call.method === "GET")).toEqual(
      [],
    );
  });

  it("trashes and deletes the complete workbook through Drive's container operations", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Budget" });
    const client = createSolidDriveClient({ storageUrl: POD, fetch: h.fetch });
    const item = await client.stat(book.container);
    const result = await trashItems(client, `${POD}drive/`, [item]);
    expect(result.failed).toEqual([]);
    expect(result.done).toHaveLength(1);
    expect(h.pod.has(book.container)).toBe(false);
    const entry = result.done[0];
    expect(entry).toBeDefined();
    if (!entry) throw new Error("Expected a trashed workbook");
    expect(h.pod.has(`${entry.url}workbook.json`)).toBe(true);
    expect(h.pod.has(`${entry.url}index.ttl`)).toBe(true);
    expect(h.pod.has(`${entry.url}sheets/1.csv`)).toBe(true);
    expect((await deleteForever(client, `${POD}drive/`, [entry])).failed).toEqual([]);
    expect(h.pod.has(`${entry.url}workbook.json`)).toBe(false);
    expect(h.pod.has(entry.url)).toBe(false);
  });

  it("restores the whole workbook and retains it in trash when its original slug is occupied", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Plan / 2026" });
    const client = createSolidDriveClient({ storageUrl: POD, fetch: h.fetch });
    const trash = await trashItems(client, `${POD}drive/`, [await client.stat(book.container)]);
    expect(trash.failed).toEqual([]);
    const restored = await restoreItems(client, `${POD}drive/`, trash.done);
    expect(restored.failed).toEqual([]);
    expect((await h.service.open(book.container)).metadata.title).toBe("Plan / 2026");
    const second = await trashItems(client, `${POD}drive/`, [await client.stat(book.container)]);
    await h.service.create({ title: "Plan / 2026" });
    const collision = await restoreItems(client, `${POD}drive/`, second.done);
    expect(collision.done).toEqual([]);
    expect(collision.failed).toMatchObject([{ error: { kind: "conflict", status: 409 } }]);
    expect(h.pod.has(`${second.done[0]?.url}workbook.json`)).toBe(true);
    expect((await h.service.open(book.container)).metadata.title).toBe("Plan / 2026");
  });

  it("resumes a workbook restore after its trash container DELETE is refused once", async () => {
    const h = await harness();
    const book = await h.service.createFromCsv({ title: "Budget", csv: "Amount\n42" });
    const client = createSolidDriveClient({ storageUrl: POD, fetch: h.fetch });
    const driveRoot = `${POD}drive/`;
    const trashed = await trashItems(client, driveRoot, [await client.stat(book.container)]);
    expect(trashed.failed).toEqual([]);
    const entry = trashed.done[0];
    if (!entry) throw new Error("Expected a trashed workbook");
    let refused = false;
    h.setHook((call) => {
      if (call.url === entry.url && call.method === "DELETE" && !refused) {
        refused = true;
        return new Response(null, { status: 403 });
      }
      return undefined;
    });
    const first = await restoreItems(client, driveRoot, [entry]);
    expect(refused).toBe(true);
    expect(first.failed).toHaveLength(1);
    expect(h.pod.has(book.container)).toBe(true);
    expect(h.pod.has(entry.url)).toBe(true);
    const restoredBook = await h.service.open(book.container);
    const remaining = await listTrash(client, driveRoot);
    expect(remaining).toHaveLength(1);
    expect(await restoreItems(client, driveRoot, remaining)).toEqual({
      done: [{ entry: remaining[0], url: book.container, renamed: false }],
      failed: [],
    });
    expect(await h.service.open(book.container)).toEqual(restoredBook);
    expect(h.pod.has(entry.url)).toBe(false);
    expect(await listTrash(client, driveRoot)).toEqual([]);
  });

  it("uses Sheets metadata admission, isolates unreadable folders, and never probes outside Sheets", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Incomplete" });
    const index = await h.storage.loadIndex(book.container);
    await h.storage.saveIndex(
      book.container,
      { ...index.value, sheets: [] },
      { ifMatch: index.etag as string },
    );
    const folder: DriveItem = { url: book.container, name: "incomplete", kind: "folder" };
    expect(await withWorkbook(folder, POD, h.fetch)).toBe(folder);
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const item of [
      { ...folder, kind: "file" as const },
      { ...folder, url: `${POD}drive/budget/` },
      { ...folder, url: `${ROOT}nested/budget/` },
      { ...folder, url: "https://other.test/sheets/budget/" },
    ]) {
      expect(await withWorkbook(item, POD, fetch)).toBe(item);
    }
    expect(fetch).not.toHaveBeenCalled();
    for (const status of [403, 404, 500])
      expect(await withWorkbook(folder, POD, async () => new Response(null, { status }))).toBe(
        folder,
      );
    expect(
      await withWorkbook(
        folder,
        POD,
        async () => new Response("malformed RDF", { headers: { "content-type": "text/turtle" } }),
      ),
    ).toBe(folder);
  });

  it("rejects trash records for Sheets internals, nested containers, and other pods", async () => {
    const h = await harness();
    const client = createSolidDriveClient({ storageUrl: POD, fetch: h.fetch });
    for (const url of [
      ROOT,
      `${ROOT}nested/book/`,
      `${ROOT}book/workbook.json`,
      "https://other.test/alice/sheets/book/",
    ]) {
      await expect(
        trashItems(client, `${POD}drive/`, [
          { url, name: "book", kind: url.endsWith("/") ? "folder" : "file" },
        ]),
      ).rejects.toMatchObject({ kind: "invalid-trash-record" });
    }
    expect(h.calls).toEqual([]);
  });

  it("keeps independently trashed Docs resources separate when their paths look like a pair", async () => {
    const h = await harness();
    const client = createSolidDriveClient({ storageUrl: POD, fetch: h.fetch });
    const snapshot = `${POD}docs/plan.ttl`;
    const companion = `${POD}docs/plan/`;
    await h.pod.fetch(snapshot, {
      method: "PUT",
      body: "snapshot",
      headers: { "content-type": "text/plain" },
    });
    await h.pod.fetch(companion, { method: "PUT" });
    const first = await trashItems(client, `${POD}drive/`, [await client.stat(snapshot)]);
    const second = await trashItems(client, `${POD}drive/`, [await client.stat(companion)]);
    expect(first.failed).toEqual([]);
    expect(second.failed).toEqual([]);
    for (const selected of [first.done, [...first.done, ...second.done]]) {
      const restored = await restoreItems(client, `${POD}drive/`, selected);
      expect(restored.done).toEqual([]);
      expect(restored.failed).toHaveLength(selected.length);
      for (const failure of restored.failed)
        expect(failure.error).toMatchObject({ kind: "invalid-trash-record" });
    }
    for (const entry of [...first.done, ...second.done]) expect(h.pod.has(entry.url)).toBe(true);
    expect(h.pod.has(snapshot)).toBe(false);
    expect(h.pod.has(companion)).toBe(false);
  });
});
