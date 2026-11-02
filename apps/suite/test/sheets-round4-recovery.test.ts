// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { WorkbookConflictError, WorkbookPartialSaveError } from "../src/apps/sheets/lib/contract";
import { workbookLayout } from "../src/apps/sheets/lib/model";
import { harness, ROOT, snapshot } from "./sheets-workbook-helpers";

describe("Sheets round 4 recovery", () => {
  it("cannot adopt a newer index validator after checking ownership of an older snapshot", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Reconcile race", snapshot: snapshot() });
    const remote = snapshot("Newer\nrevision", true);
    let renamed = false;
    let raced = false;
    h.setHook(async (call) => {
      if (!renamed && call.method === "PUT" && call.url.endsWith("workbook.json")) {
        renamed = true;
        await h.service.rename(book.container, "Remote rename", book.version);
      }
      if (
        !raced &&
        call.method === "GET" &&
        call.url.endsWith("workbook.json") &&
        call.headers.get("accept") === "*/*"
      ) {
        raced = true;
        const response = await h.pod.fetch(call.url, call.init);
        const opened = await h.service.open(book.container);
        await h.service.save(book.container, remote, opened.version);
        return response;
      }
    });
    await expect(
      h.service.save(book.container, snapshot("Older\nrevision"), book.version),
    ).rejects.toBeInstanceOf(WorkbookConflictError);
    expect(raced).toBe(true);
    const opened = await h.service.open(book.container);
    expect(opened.snapshot).toEqual(remote);
    expect(opened.metadata.title).toBe("Remote rename");
    expect(opened.metadata.sheets).toHaveLength(2);
  });

  it("keeps the reservation and projections when rollback finds a newer snapshot before index publication", async () => {
    const h = await harness();
    const container = `${ROOT}rollback-race/`;
    const layout = workbookLayout(container);
    const remote = snapshot("Newer\nrevision", true);
    const publishing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let saving: ReturnType<typeof h.service.save> | undefined;
    let raced = false;
    h.setHook(async (call) => {
      if (!raced && call.method === "PUT" && call.url === layout.sheet(1).descriptor) {
        raced = true;
        const opened = await h.service.open(container);
        saving = h.service.save(container, remote, opened.version);
        await publishing.promise;
        return new Response(null, { status: 503 });
      }
      if (call.method === "PUT" && call.url === layout.index && call.headers.has("if-match")) {
        publishing.resolve();
        await release.promise;
      }
    });
    await expect(h.service.create({ title: "Rollback race" })).rejects.toThrow("1.jsonld");
    try {
      expect(h.calls.filter((call) => call.method === "DELETE").map((call) => call.url)).toEqual([
        layout.snapshot,
      ]);
      expect(h.pod.has(layout.index)).toBe(true);
      expect((await h.storage.loadSnapshot(container)).value).toEqual(remote);
      for (const number of [1, 2]) {
        expect(h.pod.has(layout.sheet(number).csv)).toBe(true);
        expect(h.pod.has(layout.sheet(number).descriptor)).toBe(true);
      }
    } finally {
      release.resolve();
      // Observe failure as well when running this regression against the old implementation.
      await saving?.catch(() => {});
    }
    await expect(saving).resolves.toBeDefined();
    expect((await h.service.open(container)).metadata.sheets).toHaveLength(2);
  });

  it.each([
    "workbook.json",
    "index.ttl",
  ])("can force an overwrite after pending %s verification reports a conflict", async (resource) => {
    const h = await harness();
    const book = await h.service.create({ title: "Force recovery", snapshot: snapshot() });
    const local = snapshot("Local\nedits");
    let written = false;
    h.setHook(async (call) => {
      if (!call.url.endsWith(resource)) return;
      if (call.method === "PUT") {
        const response = await h.pod.fetch(call.url, call.init);
        response.headers.delete("etag");
        written = true;
        return response;
      }
      if (written) return new Response(null, { status: 503 });
    });
    const partial = await h.service
      .save(book.container, local, book.version)
      .catch((e: unknown) => e);
    expect(partial).toBeInstanceOf(WorkbookPartialSaveError);
    if (!(partial instanceof WorkbookPartialSaveError)) throw partial;
    expect(partial.version.pendingVerification).toBeDefined();
    h.setHook(() => undefined);
    const opened = await h.service.open(book.container);
    const newer = await h.service.save(
      book.container,
      snapshot("Remote\nedits", true),
      opened.version,
    );
    await expect(h.service.save(book.container, local, partial.version)).rejects.toBeInstanceOf(
      WorkbookConflictError,
    );
    h.calls.length = 0;
    const saved = await h.service.save(book.container, local, partial.version, { force: true });
    expect(saved.version.pendingVerification).toBeUndefined();
    expect(
      h.calls
        .find((call) => call.method === "PUT" && call.url.endsWith("workbook.json"))
        ?.headers.get("if-match"),
    ).toBe(newer.version.snapshotEtag);
    const overwritten = await h.service.open(book.container);
    expect(overwritten.snapshot).toEqual(local);
    expect(overwritten.metadata.sheets).toHaveLength(1);
  });
});
