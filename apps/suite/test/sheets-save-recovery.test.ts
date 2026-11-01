// AUTHORED-BY Codex GPT-6
import { assert, describe, expect, it } from "vitest";
import { WorkbookConflictError, WorkbookPartialSaveError } from "../src/apps/sheets/lib/contract";
import { workbookLayout } from "../src/apps/sheets/lib/model";
import { CSV, harness, listing, ROOT, snapshot } from "./sheets-workbook-helpers";

describe("Sheets publication and recovery", () => {
  it("rejects a remotely renamed index before touching the snapshot or any projection", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Original", snapshot: snapshot() });
    await h.service.rename(book.container, "Remote rename", book.version);
    h.calls.length = 0;
    await expect(
      h.service.save(book.container, snapshot("Local\nedit"), book.version),
    ).rejects.toBeInstanceOf(WorkbookConflictError);
    expect(h.calls.map((call) => call.method)).toEqual(["GET"]);
    expect((await h.service.open(book.container)).snapshot).toEqual(book.snapshot);
  });

  it("still detects a stale snapshot when the index has not changed", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Snapshot conflict", snapshot: snapshot() });
    await h.storage.saveSnapshot(book.container, snapshot("Remote\nedit"), {
      ifMatch: book.version.snapshotEtag,
    });
    await expect(
      h.service.save(book.container, book.snapshot, book.version),
    ).rejects.toBeInstanceOf(WorkbookConflictError);
  });

  it("skips all stale cleanup once a newer save publishes after our publication", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Race", snapshot: snapshot(CSV, true) });
    let competing = false;
    h.setHook(async (call) => {
      if (!competing && call.method === "HEAD" && call.url.endsWith("2.csv")) {
        competing = true;
        expect(h.calls.some((c) => c.method === "DELETE")).toBe(false);
        const remote = await h.service.open(book.container);
        await h.service.save(book.container, snapshot("Remote\nvalues", true), remote.version);
      }
    });
    await expect(h.service.save(book.container, snapshot(), book.version)).resolves.toBeDefined();
    expect((await h.service.open(book.container)).metadata.sheets).toHaveLength(2);
    const second = workbookLayout(book.container).sheet(2);
    expect(h.pod.has(second.csv)).toBe(true);
    expect(h.pod.has(second.descriptor)).toBe(true);
    expect(h.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it.each([
    "sheets/1.csv",
    "sheets/1.jsonld",
    "index.ttl",
  ])("retries a partial %s failure using all learned ETags", async (resource) => {
    const h = await harness();
    const book = await h.service.create({ title: "Partial", snapshot: snapshot() });
    const changed = snapshot("New\nvalues");
    h.setHook((call) =>
      call.method === "PUT" && call.url === `${book.container}${resource}`
        ? new Response(null, { status: 503 })
        : undefined,
    );
    const error = await h.service
      .save(book.container, changed, book.version)
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(WorkbookPartialSaveError);
    if (!(error instanceof WorkbookPartialSaveError)) throw error;
    expect(error.version.snapshotEtag).not.toBe(book.version.snapshotEtag);
    expect(error.version.indexEtag).toBe(book.version.indexEtag);
    if (resource !== "sheets/1.csv") {
      const csv = workbookLayout(book.container).sheet(1).csv;
      expect(error.version.derived[csv]).not.toBe(book.version.derived[csv]);
    }
    expect(error.cause).toBeInstanceOf(Error);
    h.setHook(() => undefined);
    const saved = await h.service.save(book.container, changed, error.version);
    expect((await h.service.open(book.container)).version.snapshotEtag).toBe(
      saved.version.snapshotEtag,
    );
    expect((await h.service.open(book.container)).snapshot).toEqual(changed);
  });

  it.each([
    "workbook.json",
    "sheets/1.jsonld",
    "index.ttl",
  ])("removes only its written resources after failed creation at %s and reuses the slug", async (resource) => {
    const h = await harness();
    h.setHook((call) =>
      call.method === "PUT" &&
      call.url === `${ROOT}ghost/${resource}` &&
      (resource !== "index.ttl" || call.headers.has("if-match"))
        ? new Response(null, { status: 503 })
        : undefined,
    );
    await expect(h.service.create({ title: "Ghost", snapshot: snapshot() })).rejects.toThrow();
    expect(await h.service.list()).toEqual([]);
    expect(h.pod.has(`${ROOT}ghost/index.ttl`)).toBe(false);
    expect(h.pod.has(`${ROOT}ghost/workbook.json`)).toBe(false);
    expect(
      h.calls.filter((c) => c.method === "DELETE").every((c) => !c.url.endsWith("/sheets/")),
    ).toBe(true);
    h.setHook(() => undefined);
    expect((await h.service.create({ title: "Ghost" })).container).toBe(`${ROOT}ghost/`);
  });

  it("retries a partial force-save with the currently published index version", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Force retry", snapshot: snapshot() });
    const remote = await h.service.rename(book.container, "Remote title", book.version);
    h.setHook((call) =>
      call.method === "PUT" && call.url.endsWith("1.jsonld")
        ? new Response(null, { status: 503 })
        : undefined,
    );
    const partial = await h.service
      .save(book.container, book.snapshot, book.version, { force: true })
      .catch((error: unknown) => error);
    expect(partial).toBeInstanceOf(WorkbookPartialSaveError);
    if (!(partial instanceof WorkbookPartialSaveError)) throw partial;
    expect(partial.version.indexEtag).toBe(remote.version.indexEtag);
    h.setHook(() => undefined);
    await expect(
      h.service.save(book.container, book.snapshot, partial.version),
    ).resolves.toBeDefined();
  });

  it("hides an interrupted zero-sheet reservation even if cleanup also fails", async () => {
    const h = await harness();
    h.setHook((call) =>
      call.method === "DELETE" || call.url.endsWith("workbook.json")
        ? new Response(null, { status: 503 })
        : undefined,
    );
    await expect(h.service.create({ title: "Ghost" })).rejects.toMatchObject({ status: 503 });
    expect(h.pod.has(`${ROOT}ghost/index.ttl`)).toBe(true);
    expect(await h.service.list()).toEqual([]);
  });

  it("retries stale cleanup from a listing after publishing, and ignores unrelated containment", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Cleanup", snapshot: snapshot(CSV, true) });
    const stale = workbookLayout(book.container).sheet(2);
    h.setHook((call) =>
      call.method === "DELETE" ? new Response(null, { status: 503 }) : undefined,
    );
    const saved = await h.service.save(book.container, snapshot(), book.version);
    expect(h.pod.has(stale.csv)).toBe(true);
    expect(saved.metadata.sheets).toHaveLength(1);
    const deletes = h.calls.filter((c) => c.method === "DELETE");
    const finalIndex = h.calls.findLastIndex(
      (c) => c.method === "PUT" && c.url.endsWith("index.ttl"),
    );
    assert(deletes[0]);
    expect(h.calls.indexOf(deletes[0])).toBeGreaterThan(finalIndex);
    const sheetRoot = `${book.container}sheets/`;
    h.setHook((call) =>
      call.method === "GET" && call.url === sheetRoot
        ? listing(sheetRoot, [
            { url: stale.csv, container: false },
            { url: stale.descriptor, container: false },
            { url: `${sheetRoot}notes.txt`, container: false },
            { url: `${sheetRoot}1.csv`, container: false },
            { url: `${sheetRoot}3.csv/`, container: true },
            { url: `${sheetRoot}nested/3.csv`, container: false },
          ])
        : undefined,
    );
    await h.service.save(book.container, snapshot(), saved.version);
    expect(h.pod.has(stale.csv)).toBe(false);
    expect(h.pod.has(stale.descriptor)).toBe(false);
    const current = await h.service.open(book.container);
    h.setHook((call) => (call.url === sheetRoot ? new Response(null, { status: 503 }) : undefined));
    await expect(
      h.service.save(book.container, snapshot(), current.version),
    ).resolves.toBeDefined();
  });
});
