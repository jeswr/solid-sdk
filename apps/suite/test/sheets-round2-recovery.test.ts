// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { WorkbookPartialSaveError } from "../src/apps/sheets/lib/contract";
import { workbookLayout } from "../src/apps/sheets/lib/model";
import { CSV, harness, ROOT, snapshot } from "./sheets-workbook-helpers";

describe("Sheets revision ownership", () => {
  it.each([
    undefined,
    "Local rename",
  ])("reconciles an index rename after preflight with local title %s", async (title) => {
    const h = await harness();
    const book = await h.service.create({ title: "Original", snapshot: snapshot() });
    let renamed = false;
    h.setHook(async (call) => {
      if (!renamed && call.method === "PUT" && call.url.endsWith("workbook.json")) {
        renamed = true;
        await h.service.rename(book.container, "Remote rename", book.version);
      }
    });
    const local = snapshot("Local\nedit", true);
    const saved = await h.service.save(
      book.container,
      local,
      book.version,
      title === undefined ? {} : { title },
    );
    expect(saved.metadata.title).toBe(title ?? "Remote rename");
    const opened = await h.service.open(book.container);
    expect(opened.metadata).toEqual(saved.metadata);
    expect(opened.snapshot).toEqual(local);
    expect(opened.metadata.sheets).toHaveLength(2);
  });

  it("bounds index retries and reports partial progress rather than a snapshot conflict", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Contended", snapshot: snapshot() });
    h.calls.length = 0;
    h.setHook((call) =>
      call.method === "PUT" && call.url.endsWith("index.ttl")
        ? new Response(null, { status: 412 })
        : undefined,
    );
    const local = snapshot("Local\nedit");
    const error = await h.service.save(book.container, local, book.version).catch((e) => e);
    expect(error).toBeInstanceOf(WorkbookPartialSaveError);
    if (!(error instanceof WorkbookPartialSaveError)) throw error;
    expect(error.version.snapshotEtag).not.toBe(book.version.snapshotEtag);
    expect(h.calls.filter((c) => c.method === "PUT" && c.url.endsWith("index.ttl"))).toHaveLength(
      4,
    );
    h.setHook(() => undefined);
    await expect(h.service.save(book.container, local, error.version)).resolves.toBeDefined();
  });

  it("retains progress if rereading a racing index fails", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Retry read", snapshot: snapshot() });
    let rejected = false;
    h.setHook((call) => {
      if (!call.url.endsWith("index.ttl")) return;
      if (call.method === "PUT") {
        rejected = true;
        return new Response(null, { status: 412 });
      }
      if (rejected) return new Response(null, { status: 503 });
    });
    await expect(h.service.save(book.container, snapshot(), book.version)).rejects.toBeInstanceOf(
      WorkbookPartialSaveError,
    );
  });

  it("retries after a successful CSV PUT with no ETag and a failed validator GET", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Missing ETag", snapshot: snapshot() });
    const csv = workbookLayout(book.container).sheet(1).csv;
    h.setHook(async (call) => {
      if (call.url === csv) {
        if (call.method === "PUT") {
          const response = await h.pod.fetch(call.url, call.init);
          response.headers.delete("etag");
          return response;
        }
        return new Response(null, { status: 503 });
      }
      if (call.method === "PUT" && call.url.endsWith("1.jsonld"))
        return new Response(null, { status: 503 });
    });
    const local = snapshot("Local\nedit");
    const error = await h.service.save(book.container, local, book.version).catch((e) => e);
    expect(error).toBeInstanceOf(WorkbookPartialSaveError);
    if (!(error instanceof WorkbookPartialSaveError)) throw error;
    expect(error.version.derived[csv]).toBeUndefined();
    h.setHook(() => undefined);
    h.calls.length = 0;
    const saved = await h.service.save(book.container, local, error.version);
    expect(saved.version.derived[csv]).toBeDefined();
    expect(h.calls.find((c) => c.method === "PUT" && c.url === csv)?.headers.has("if-match")).toBe(
      false,
    );
    expect((await h.service.open(book.container)).snapshot).toEqual(local);
  });

  it("succeeds when derived validators cannot be discovered", async () => {
    const h = await harness();
    h.setHook(async (call) => {
      if (!/\.(csv|jsonld)$/.test(call.url)) return;
      if (call.method !== "PUT") return new Response(null, { status: 503 });
      const response = await h.pod.fetch(call.url, call.init);
      response.headers.delete("etag");
      return response;
    });
    const book = await h.service.create({ title: "Best effort", snapshot: snapshot() });
    expect(book.version.derived).toEqual({});
    const saved = await h.service.save(book.container, book.snapshot, book.version);
    expect(saved.version.derived).toEqual({});
  });

  it("protects projections rewritten after cleanup's HEAD using conditional DELETE", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Cleanup race", snapshot: snapshot(CSV, true) });
    const stale = workbookLayout(book.container).sheet(2);
    h.setHook(async (call) => {
      if (call.method === "DELETE" && call.url === stale.csv) {
        const before = (await h.pod.fetch(stale.csv, { method: "HEAD" })).headers.get("etag");
        expect(call.headers.get("if-match")).toBe(before);
        await h.pod.fetch(stale.csv, { method: "PUT", body: "Newer\nprojection" });
      }
    });
    await h.service.save(book.container, snapshot(), book.version);
    expect(h.pod.has(stale.csv)).toBe(true);
    expect(h.pod.has(stale.descriptor)).toBe(false);
  });

  it.each([404, 503, "missing ETag"])("ignores failed cleanup HEAD %s", async (failure) => {
    const h = await harness();
    const book = await h.service.create({ title: "HEAD failure", snapshot: snapshot(CSV, true) });
    h.setHook((call) => {
      if (call.method === "HEAD")
        return new Response(null, { status: typeof failure === "number" ? failure : 200 });
    });
    h.calls.length = 0;
    await h.service.save(book.container, snapshot(), book.version);
    expect(h.calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});

describe("Sheets create rollback ownership", () => {
  it("leaves an existing snapshot and unrelated files intact and tries the next slug", async () => {
    const h = await harness();
    const container = `${ROOT}budget/`;
    const layout = workbookLayout(container);
    const original = snapshot("Original\nvalues");
    const etag = await h.storage.saveSnapshot(container, original, { ifNoneMatch: "*" });
    await h.pod.fetch(`${container}unrelated.txt`, { method: "PUT", body: "Keep" });
    h.calls.length = 0;
    const book = await h.service.create({ title: "Budget", snapshot: snapshot() });
    expect(book.container).toBe(`${ROOT}budget-2/`);
    expect(await h.storage.loadSnapshot(container)).toEqual({ value: original, etag });
    expect(await (await h.pod.fetch(`${container}unrelated.txt`)).text()).toBe("Keep");
    expect(h.pod.has(layout.index)).toBe(false);
    expect(h.calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual([layout.index]);
  });

  it("rolls back only successful writes when a later derived PUT fails", async () => {
    const h = await harness();
    const container = `${ROOT}budget/`;
    const layout = workbookLayout(container);
    const unrelated = `${container}unrelated.txt`;
    await h.pod.fetch(unrelated, { method: "PUT", body: "Keep" });
    await h.pod.fetch(layout.sheet(1).descriptor, { method: "PUT", body: "Existing descriptor" });
    h.setHook((call) =>
      call.method === "PUT" && call.url === layout.sheet(1).descriptor
        ? new Response(null, { status: 503 })
        : undefined,
    );
    await expect(h.service.create({ title: "Budget" })).rejects.toThrow("1.jsonld");
    expect(h.pod.has(unrelated)).toBe(true);
    expect(h.pod.has(layout.sheet(1).descriptor)).toBe(true);
    expect(h.pod.has(layout.sheet(1).csv)).toBe(false);
    expect(h.pod.has(layout.snapshot)).toBe(false);
    expect(h.pod.has(layout.index)).toBe(false);
  });

  it("tries the next slug even if removing a collided snapshot's index reservation fails", async () => {
    const h = await harness();
    const container = `${ROOT}budget/`;
    await h.storage.saveSnapshot(container, snapshot(), { ifNoneMatch: "*" });
    h.setHook((call) =>
      call.method === "DELETE" && call.url === `${container}index.ttl`
        ? new Response(null, { status: 403 })
        : undefined,
    );
    const book = await h.service.create({ title: "Budget" });
    expect(book.container).toBe(`${ROOT}budget-2/`);
    expect(h.pod.has(`${container}workbook.json`)).toBe(true);
    expect((await h.service.list()).map((row) => row.container)).toEqual([book.container]);
  });

  it.each([
    "index.ttl",
    "workbook.json",
  ])("tracks a successful %s PUT before validator discovery fails", async (resource) => {
    const h = await harness();
    h.setHook(async (call) => {
      if (!call.url.endsWith(resource)) return;
      if (call.method === "GET") return new Response(null, { status: 503 });
      if (call.method === "PUT") {
        const response = await h.pod.fetch(call.url, call.init);
        response.headers.delete("etag");
        return response;
      }
    });
    await expect(h.service.create({ title: "Incomplete" })).rejects.toMatchObject({ status: 503 });
    expect(h.pod.has(`${ROOT}incomplete/index.ttl`)).toBe(false);
    expect(h.pod.has(`${ROOT}incomplete/workbook.json`)).toBe(false);
  });
});
