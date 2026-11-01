// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { WorkbookConflictError, WorkbookPartialSaveError } from "../src/apps/sheets/lib/contract";
import { workbookLayout } from "../src/apps/sheets/lib/model";
import { harness, ROOT, snapshot } from "./sheets-workbook-helpers";

describe("Sheets concurrent revision ownership", () => {
  it("does not reconcile an index 412 over a newer snapshot and sheet list", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Race", snapshot: snapshot() });
    const remote = snapshot("Newer\nrevision", true);
    let raced = false;
    h.calls.length = 0;
    h.setHook(async (call) => {
      if (raced || call.method !== "PUT" || !call.url.endsWith("workbook.json")) return;
      raced = true;
      const response = await h.pod.fetch(call.url, call.init);
      const opened = await h.service.open(book.container);
      await h.service.save(book.container, remote, opened.version);
      return response;
    });
    await expect(
      h.service.save(book.container, snapshot("Older\nrevision"), book.version),
    ).rejects.toBeInstanceOf(WorkbookConflictError);
    const opened = await h.service.open(book.container);
    expect(opened.snapshot).toEqual(remote);
    expect(opened.metadata.sheets).toHaveLength(2);
    expect(h.calls.filter((c) => c.method === "PUT" && c.url.endsWith("index.ttl"))).toHaveLength(
      2,
    );
  });

  it("checks snapshot ownership again after reconciling an index-only rename", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Repeated race", snapshot: snapshot() });
    const remote = snapshot("Newest\nrevision", true);
    let nested = false;
    let attempts = 0;
    h.setHook(async (call) => {
      if (nested || call.method !== "PUT" || !call.url.endsWith("index.ttl")) return;
      nested = true;
      if (attempts++ === 0) {
        await h.service.rename(book.container, "Remote rename", book.version);
      } else {
        const opened = await h.service.open(book.container);
        await h.service.save(book.container, remote, opened.version);
      }
      nested = false;
    });
    await expect(h.service.save(book.container, snapshot(), book.version)).rejects.toBeInstanceOf(
      WorkbookConflictError,
    );
    expect(attempts).toBe(2);
    expect((await h.service.open(book.container)).snapshot).toEqual(remote);
    expect((await h.storage.loadIndex(book.container)).value.sheets).toHaveLength(2);
  });

  it("stops create rollback at a resource whose conditional DELETE returns 412", async () => {
    const h = await harness();
    const container = `${ROOT}create-race/`;
    const remote = snapshot("B's\nrevision", true);
    let raced = false;
    h.setHook(async (call) => {
      if (
        raced ||
        call.method !== "PUT" ||
        !call.url.endsWith("index.ttl") ||
        !call.headers.has("if-match")
      )
        return;
      raced = true;
      const opened = await h.service.open(container);
      await h.service.save(container, remote, opened.version);
    });
    await expect(h.service.create({ title: "Create race" })).rejects.toBeInstanceOf(
      WorkbookConflictError,
    );
    const deletes = h.calls.filter((c) => c.method === "DELETE");
    expect(deletes.map((c) => c.url)).toEqual([workbookLayout(container).snapshot]);
    expect(deletes[0]?.headers.get("if-match")).toMatch(/^"demo-/);
    const opened = await h.service.open(container);
    expect(opened.snapshot).toEqual(remote);
    expect(opened.metadata.sheets).toHaveLength(2);
    for (const number of [1, 2]) {
      expect(h.pod.has(workbookLayout(container).sheet(number).csv)).toBe(true);
      expect(h.pod.has(workbookLayout(container).sheet(number).descriptor)).toBe(true);
    }
  });

  it("skips derived resources without known validators during rollback", async () => {
    const h = await harness();
    const layout = workbookLayout(`${ROOT}unknown-derived/`);
    h.setHook(async (call) => {
      if (call.url === layout.sheet(1).csv) {
        if (call.method !== "PUT") return new Response(null, { status: 503 });
        const response = await h.pod.fetch(call.url, call.init);
        response.headers.delete("etag");
        return response;
      }
      if (call.method === "PUT" && call.url === layout.sheet(1).descriptor)
        return new Response(null, { status: 503 });
    });
    await expect(h.service.create({ title: "Unknown derived" })).rejects.toThrow("1.jsonld");
    const deletes = h.calls.filter((c) => c.method === "DELETE");
    expect(deletes.map((c) => c.url)).toEqual([layout.snapshot, layout.index, layout.container]);
    expect(deletes.slice(0, 2).every((c) => c.headers.has("if-match"))).toBe(true);
    expect(deletes[2]?.headers.has("if-match")).toBe(false);
    expect(h.pod.has(layout.sheet(1).csv)).toBe(true);
  });

  it("keeps create resources when the final index PUT succeeds but cannot be verified", async () => {
    const h = await harness();
    const container = `${ROOT}unverified-create/`;
    let published = false;
    h.setHook(async (call) => {
      if (!call.url.endsWith("index.ttl")) return;
      if (call.method === "PUT" && call.headers.has("if-match")) {
        const response = await h.pod.fetch(call.url, call.init);
        response.headers.delete("etag");
        published = true;
        return response;
      }
      if (published && call.method === "GET") return new Response(null, { status: 503 });
    });
    await expect(h.service.create({ title: "Unverified create" })).rejects.toMatchObject({
      status: 503,
    });
    expect(h.calls.filter((c) => c.method === "DELETE")).toEqual([]);
    h.setHook(() => undefined);
    const opened = await h.service.open(container);
    expect(opened.metadata.sheets).toHaveLength(1);
    expect(opened.snapshot).toBeDefined();
    expect(h.pod.has(workbookLayout(container).sheet(1).csv)).toBe(true);
  });
});

describe.each(["workbook.json", "index.ttl"])("Sheets verified %s validators", (resource) => {
  it("rejects a fallback validator belonging to a concurrent writer", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "No validator", snapshot: snapshot() });
    const remote = snapshot("B's\nrevision", true);
    let raced = false;
    h.setHook(async (call) => {
      if (raced || call.method !== "PUT" || !call.url.endsWith(resource)) return;
      raced = true;
      const response = await h.pod.fetch(call.url, call.init);
      response.headers.delete("etag");
      const opened = await h.service.open(book.container);
      await h.service.save(book.container, remote, opened.version, { title: "B's title" });
      return response;
    });
    await expect(
      h.service.save(book.container, snapshot("A's\nrevision"), book.version),
    ).rejects.toBeInstanceOf(WorkbookConflictError);
    const opened = await h.service.open(book.container);
    expect(opened.snapshot).toEqual(remote);
    expect(opened.metadata.title).toBe("B's title");
    expect(opened.metadata.sheets).toHaveLength(2);
    await expect(
      h.service.save(book.container, snapshot("A's next\nrevision"), book.version),
    ).rejects.toBeInstanceOf(WorkbookConflictError);
    expect((await h.service.open(book.container)).snapshot).toEqual(remote);
  });

  it.each([
    "retry",
    "concurrent writer",
  ])("retains an unknown validator after GET 503: %s", async (next) => {
    const h = await harness();
    const book = await h.service.create({ title: "Recovery", snapshot: snapshot() });
    const local = snapshot("A's\nrevision");
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
    expect(partial.version.pendingVerification).toHaveProperty(
      resource === "workbook.json" ? "snapshot" : "index",
    );
    h.calls.length = 0;
    const repeated = await h.service
      .save(book.container, local, partial.version)
      .catch((e: unknown) => e);
    expect(repeated).toBeInstanceOf(WorkbookPartialSaveError);
    if (!(repeated instanceof WorkbookPartialSaveError)) throw repeated;
    expect(repeated.version).toEqual(partial.version);
    expect(h.calls.map((c) => c.method)).toEqual(["GET"]);
    h.setHook(() => undefined);
    if (next === "retry") {
      const editedAgain = snapshot("A's further\nrevision", true);
      const saved = await h.service.save(book.container, editedAgain, repeated.version);
      expect(saved.version.pendingVerification).toBeUndefined();
      const opened = await h.service.open(book.container);
      expect(opened.snapshot).toEqual(editedAgain);
      expect(opened.metadata.sheets).toHaveLength(2);
    } else {
      const opened = await h.service.open(book.container);
      const remote = snapshot("B's\nrevision", true);
      await h.service.save(book.container, remote, opened.version, { title: "B's title" });
      h.calls.length = 0;
      await expect(h.service.save(book.container, local, repeated.version)).rejects.toBeInstanceOf(
        WorkbookConflictError,
      );
      expect(h.calls.map((c) => c.method)).toEqual(["GET"]);
      expect((await h.service.open(book.container)).snapshot).toEqual(remote);
    }
  });
});

describe("Sheets content comparison and rename recovery", () => {
  it("compares snapshot objects without key ordering and preserves nested arrays, nulls and primitives", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "JSON", snapshot: snapshot() });
    const local = {
      ...book.snapshot,
      custom: { z: [null, true, 1, "s", { b: 2, a: 1 }], a: false },
    };
    h.setHook(async (call) => {
      if (!call.url.endsWith("workbook.json")) return;
      if (call.method === "PUT") {
        const response = await h.pod.fetch(call.url, call.init);
        response.headers.delete("etag");
        return response;
      }
      const response = await h.pod.fetch(call.url, call.init);
      const reordered = JSON.parse(await response.text());
      reordered.custom = { a: false, z: [null, true, 1, "s", { a: 1, b: 2 }] };
      return new Response(JSON.stringify(reordered), { headers: response.headers });
    });
    await expect(h.service.save(book.container, local, book.version)).resolves.toBeDefined();
  });

  it.each([
    "retry",
    "concurrent writer",
  ])("verifies a rename PUT without an ETag: %s", async (next) => {
    const h = await harness();
    const book = await h.service.create({ title: "Rename", snapshot: snapshot() });
    let written = false;
    h.setHook(async (call) => {
      if (!call.url.endsWith("index.ttl")) return;
      if (call.method === "PUT") {
        const response = await h.pod.fetch(call.url, call.init);
        response.headers.delete("etag");
        written = true;
        if (next === "concurrent writer") {
          h.setHook(() => undefined);
          const opened = await h.service.open(book.container);
          await h.service.rename(book.container, "Newer rename", opened.version);
        }
        return response;
      }
      if (written) return new Response(null, { status: 503 });
    });
    const failure = await h.service
      .rename(book.container, "Local rename", book.version)
      .catch((e: unknown) => e);
    if (next === "concurrent writer") {
      expect(failure).toBeInstanceOf(WorkbookConflictError);
    } else {
      expect(failure).toBeInstanceOf(WorkbookPartialSaveError);
      if (!(failure instanceof WorkbookPartialSaveError)) throw failure;
      h.setHook(() => undefined);
      const saved = await h.service.rename(book.container, "Local rename", failure.version);
      expect(saved.metadata.title).toBe("Local rename");
    }
  });
});
