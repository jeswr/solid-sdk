// AUTHORED-BY Codex GPT-6.1-Sol
import type { IWorkbookData } from "@univerjs/core";
import { describe, expect, it } from "vitest";
import { WorkbookConflictError, WorkbookNotFoundError } from "../src/apps/sheets/lib/contract";
import { SheetStorageError, workbookLayout } from "../src/apps/sheets/lib/model";
import { createWorkbookService } from "../src/apps/sheets/lib/workbook";
import { harness, listing, POD, ROOT, snapshot, WEBID } from "./sheets-workbook-helpers";

describe("Sheets failure and scope handling", () => {
  it.each([
    "index.ttl",
    "workbook.json",
  ])("maps missing/forbidden %s to not-found", async (resource) => {
    const h = await harness();
    const book = await h.service.create({ title: "Open", snapshot: snapshot() });
    for (const status of [404, 403]) {
      h.setHook((c) =>
        c.url === `${book.container}${resource}` ? new Response(null, { status }) : undefined,
      );
      await expect(h.service.open(book.container)).rejects.toMatchObject({
        name: "WorkbookNotFoundError",
        container: book.container,
      });
    }
    expect(new WorkbookNotFoundError(book.container)).toBeInstanceOf(Error);
  });

  it("preserves unexpected read failures and malformed snapshots", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Open", snapshot: snapshot() });
    h.setHook((c) =>
      c.url.endsWith("workbook.json") ? new Response(null, { status: 500 }) : undefined,
    );
    await expect(h.service.open(book.container)).rejects.toBeInstanceOf(SheetStorageError);
    h.setHook((c) => (c.url.endsWith("workbook.json") ? new Response("invalid json") : undefined));
    await expect(h.service.open(book.container)).rejects.toBeInstanceOf(SyntaxError);
  });

  it("fails allocation after 50 create-only collisions and propagates other reservation errors", async () => {
    const h = await harness();
    h.setHook((c) => (c.method === "PUT" ? new Response(null, { status: 412 }) : undefined));
    await expect(h.service.create({ title: "Taken", snapshot: snapshot() })).rejects.toThrow(
      "50 attempts",
    );
    expect(h.calls).toHaveLength(50);
    expect(h.calls[49]?.url).toBe(`${ROOT}taken-50/index.ttl`);
    h.setHook(() => new Response(null, { status: 503 }));
    await expect(h.service.create({ title: "Broken", snapshot: snapshot() })).rejects.toMatchObject(
      { status: 503 },
    );
  });

  it("reports a conflict on the final create index update and never overwrites existing derived files on create", async () => {
    const h = await harness();
    h.setHook((c) =>
      c.method === "PUT" && c.url.endsWith("index.ttl") && c.headers.has("if-match")
        ? new Response(null, { status: 412 })
        : undefined,
    );
    await expect(
      h.service.create({ title: "Conflict", snapshot: snapshot() }),
    ).rejects.toBeInstanceOf(WorkbookConflictError);
    h.calls.length = 0;
    h.setHook((c) =>
      c.method === "PUT" && c.url.endsWith(".csv")
        ? new Response(null, { status: 412 })
        : undefined,
    );
    await expect(
      h.service.create({ title: "Existing derived", snapshot: snapshot() }),
    ).rejects.toMatchObject({ status: 412 });
    expect(h.calls.filter((c) => c.url.endsWith(".csv"))).toHaveLength(1);
  });

  it("propagates authoritative non-conflict failures", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Save", snapshot: snapshot() });
    h.setHook((c) =>
      c.method === "PUT" && c.url.endsWith("workbook.json")
        ? new Response(null, { status: 503 })
        : undefined,
    );
    await expect(h.service.save(book.container, book.snapshot, book.version)).rejects.toMatchObject(
      { status: 503 },
    );
  });

  it.each([
    "csv",
    "jsonld",
  ])("names failed derived %s writes after saving the authoritative snapshot", async (extension) => {
    const h = await harness();
    const book = await h.service.create({ title: "Partial", snapshot: snapshot() });
    const changed = { ...book.snapshot, name: "Saved snapshot" };
    const url = `${book.container}sheets/1.${extension}`;
    h.setHook((c) =>
      c.method === "PUT" && c.url === url ? new Response(null, { status: 503 }) : undefined,
    );
    await expect(h.service.save(book.container, changed, book.version)).rejects.toThrow(url);
    expect((await h.service.open(book.container)).snapshot).toEqual(changed);
    expect((await h.storage.loadIndex(book.container)).value.title).toBe("Partial");
  });

  it("does not overwrite a known stale derived ETag or retry a second lazy conflict", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Derived conflict", snapshot: snapshot() });
    const url = workbookLayout(book.container).sheet(1).csv;
    h.setHook((c) =>
      c.method === "PUT" && c.url === url ? new Response(null, { status: 412 }) : undefined,
    );
    await expect(h.service.save(book.container, book.snapshot, book.version)).rejects.toThrow(url);
    let opened = await h.service.open(book.container);
    h.calls.length = 0;
    await expect(h.service.save(book.container, book.snapshot, opened.version)).rejects.toThrow(
      url,
    );
    expect(h.calls.filter((c) => c.url === url && c.method === "PUT")).toHaveLength(2);
    opened = await h.service.open(book.container);
    h.setHook((c) =>
      c.url === url ? new Response(null, { status: c.method === "PUT" ? 412 : 404 }) : undefined,
    );
    await expect(h.service.save(book.container, book.snapshot, opened.version)).rejects.toThrow(
      url,
    );
  });

  it("learns validators via GET when successful PUT responses omit them", async () => {
    const h = await harness();
    h.setHook(async (c) => {
      if (c.method !== "PUT") return;
      const response = await h.pod.fetch(c.url, c.init);
      response.headers.delete("etag");
      return response;
    });
    const book = await h.service.create({ title: "ETags", snapshot: snapshot() });
    expect(book.version.snapshotEtag).toMatch(/^"demo-/);
    const result = await h.service.save(book.container, book.snapshot, book.version);
    expect(result.version.indexEtag).toBe(
      (await h.pod.fetch(workbookLayout(book.container).index)).headers.get("etag"),
    );
  });

  it.each([null, 'W/"weak"'])("rejects an unreadable strong validator %s", async (etag) => {
    const h = await harness();
    const book = await h.service.create({ title: "ETags", snapshot: snapshot() });
    h.setHook(async (c) => {
      if (c.method !== "GET" || !c.url.endsWith("workbook.json")) return;
      const response = await h.pod.fetch(c.url, c.init);
      if (etag === null) response.headers.delete("etag");
      else response.headers.set("etag", etag);
      return response;
    });
    await expect(h.service.open(book.container)).rejects.toThrow("strong ETag");
    await expect(
      h.service.save(book.container, book.snapshot, book.version, { force: true }),
    ).rejects.toThrow("strong ETag");
  });

  it("rejects invalid snapshots before writes and falls back to the sheet ID for an unnamed sheet", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Valid", snapshot: snapshot() });
    const invalid = { value: Number.NaN };
    h.calls.length = 0;
    await expect(h.service.save(book.container, invalid, book.version)).rejects.toThrow("JSON");
    expect(h.calls).toHaveLength(0);
    const unnamed = snapshot();
    const engine = unnamed as unknown as IWorkbookData;
    Reflect.deleteProperty(engine.sheets.data as object, "name");
    const copy = await h.service.create({ title: "Unnamed", snapshot: unnamed });
    expect(copy.metadata.sheets).toEqual([{ number: 1, name: "data" }]);
  });

  it("uses a real clock by default", async () => {
    const h = await harness();
    const service = createWorkbookService({ podRoot: POD, webId: WEBID, fetch: h.fetch });
    const before = Date.now();
    const book = await service.create({ title: "Clock", snapshot: snapshot() });
    expect(book.metadata.created.getTime()).toBeGreaterThanOrEqual(before);
    expect(book.metadata.created.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("rejects every workbook operation outside the direct Sheets children before I/O", async () => {
    const h = await harness();
    const book = await h.service.create({ title: "Scope", snapshot: snapshot() });
    h.calls.length = 0;
    for (const url of [
      "https://other.example/sheets/book/",
      `${POD}docs/book/`,
      ROOT,
      `${ROOT}book/nested/`,
      `${ROOT}book/?query=1`,
      `${ROOT}book/#fragment`,
      `${ROOT}book`,
      `${ROOT}%2foutside/`,
    ]) {
      await expect(h.service.open(url)).rejects.toThrow();
      await expect(h.service.save(url, book.snapshot, book.version)).rejects.toThrow();
      await expect(h.service.rename(url, "Title", book.version)).rejects.toThrow();
      await expect(h.service.copy(url, "Copy")).rejects.toThrow();
      await expect(h.service.remove(url)).rejects.toThrow();
    }
    expect(h.calls).toHaveLength(0);
  });

  it("propagates root listing and recursive listing failures", async () => {
    const h = await harness();
    h.setHook(() => new Response(null, { status: 503 }));
    await expect(h.service.list()).rejects.toMatchObject({ status: 503 });
    await expect(h.service.remove(`${ROOT}failed/`)).rejects.toMatchObject({ status: 503 });
  });

  it("names delete failures, including stale derived files", async () => {
    const h = await harness();
    const book = await h.service.create({
      title: "Delete errors",
      snapshot: snapshot(undefined, true),
    });
    const url = workbookLayout(book.container).sheet(2).csv;
    h.setHook((c) => (c.method === "DELETE" ? new Response(null, { status: 403 }) : undefined));
    await expect(h.service.save(book.container, snapshot(), book.version)).rejects.toThrow(url);
    await expect(h.service.remove(book.container)).rejects.toThrow(
      "Could not delete spreadsheet resource:",
    );
  });

  it("ignores hostile containment entries during listing and removal", async () => {
    const h = await harness();
    const container = `${ROOT}hostile/`;
    h.setHook((c) => {
      if (c.url === ROOT)
        return listing(ROOT, [
          { url: "https://foreign.example/book/", container: true },
          { url: `${ROOT}deep/book/`, container: true },
        ]);
      if (c.url === container && c.method === "GET")
        return listing(container, [{ url: `${POD}keep.txt`, container: false }]);
    });
    expect(await h.service.list()).toEqual([]);
    await h.service.remove(container);
    expect(h.calls.every((c) => c.url.startsWith(ROOT))).toBe(true);
    expect(h.calls.some((c) => c.url === `${POD}keep.txt`)).toBe(false);
  });

  it("limits parallel child reads to four", async () => {
    const h = await harness();
    for (let i = 0; i < 9; i++)
      await h.service.create({ title: `Book ${i}`, snapshot: snapshot() });
    let active = 0;
    let peak = 0;
    h.setHook(async (c) => {
      if (c.method !== "GET" || !c.url.endsWith("index.ttl")) return;
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      const response = await h.pod.fetch(c.url, c.init);
      active--;
      return response;
    });
    expect(await h.service.list()).toHaveLength(9);
    expect(peak).toBe(4);
  });

  it("accepts an empty RDF container listing", async () => {
    const h = await harness();
    h.setHook(() => new Response("", { headers: { "content-type": "text/turtle" } }));
    expect(await h.service.list()).toEqual([]);
  });
});
