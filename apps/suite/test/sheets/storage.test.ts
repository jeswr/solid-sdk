// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import {
  createSheetStorage,
  inferDescriptor,
  type Precondition,
  SheetResource,
  SheetStorageError,
  SOLID,
  SPREADSHEET_CLASS,
  workbookLayout,
} from "../../src/apps/sheets/lib/model";
import { BOOK, GRID, META, POD } from "./fixtures";

/** Byte storage with mandatory ETag enforcement; RDF/conversion code runs unchanged. */
function memoryPod() {
  const resources = new Map<string, { body: string; contentType: string; etag: string }>();
  let version = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input),
      resource = resources.get(url),
      headers = new Headers(init?.headers);
    if (init?.method === "PUT") {
      if (!headers.has("if-match") && !headers.has("if-none-match"))
        throw new TypeError("Unconditional write");
      if (
        (headers.get("if-none-match") === "*" && resource) ||
        (headers.has("if-match") && headers.get("if-match") !== resource?.etag)
      ) {
        return new Response(null, { status: 412, headers: { etag: resource?.etag ?? '"absent"' } });
      }
      const etag = `"${++version}"`;
      resources.set(url, {
        body: String(init?.body),
        contentType: headers.get("content-type") ?? "",
        etag,
      });
      return new Response(null, { status: 201, headers: { etag } });
    }
    return resource
      ? new Response(resource.body, {
          headers: { "content-type": resource.contentType, etag: resource.etag },
        })
      : new Response(null, { status: 404 });
  });
  return { fetch, resources, storage: createSheetStorage(fetch, POD) };
}

describe("injected spreadsheet storage", () => {
  it("saves and reloads each resource with explicit media types and ETags", async () => {
    const { storage, resources, fetch } = memoryPod();
    const create = { ifNoneMatch: "*" } as const;
    const descriptor = inferDescriptor("Income", GRID);
    const snapshot = { sheets: { s1: { formula: "=SUM(A1:A3)", format: { bold: true } } } };
    const indexTag = await storage.saveIndex(BOOK, META, create);
    const csvTag = await storage.saveCsv(BOOK, 1, GRID, create);
    const descriptorTag = await storage.saveDescriptor(BOOK, 1, descriptor, create);
    const snapshotTag = await storage.saveSnapshot(BOOK, snapshot, create);
    expect(await storage.loadIndex(BOOK)).toEqual({ value: META, etag: indexTag });
    expect(await storage.loadCsv(BOOK, 1, descriptor.columns)).toEqual({
      value: GRID,
      etag: csvTag,
    });
    expect(await storage.loadCsv(BOOK, 1)).toEqual({ value: GRID, etag: csvTag });
    expect(await storage.loadDescriptor(BOOK, 1)).toEqual({
      value: descriptor,
      etag: descriptorTag,
    });
    expect(await storage.loadSnapshot(BOOK)).toEqual({ value: snapshot, etag: snapshotTag });
    expect([...resources.values()].map((r) => r.contentType)).toEqual([
      "text/turtle",
      "text/csv",
      "application/ld+json",
      "application/json",
    ]);
    const updated = await storage.saveSnapshot(BOOK, { v: 2 }, { ifMatch: snapshotTag as string });
    expect(updated).not.toBe(snapshotTag);
    expect((await storage.loadSnapshot(BOOK)).value).toEqual({ v: 2 });
    for (const [, init] of fetch.mock.calls) {
      expect(init?.redirect).toBe("manual");
      if (init?.method !== "PUT") expect(init?.cache).toBe("no-store");
    }
  });
  it("propagates create collisions, stale ETags and missing resources without retrying", async () => {
    const { storage, fetch } = memoryPod();
    const etag = await storage.saveSnapshot(BOOK, { v: 1 }, { ifNoneMatch: "*" });
    for (const condition of [{ ifNoneMatch: "*" }, { ifMatch: '"stale"' }] as Precondition[]) {
      await expect(storage.saveSnapshot(BOOK, { v: 2 }, condition)).rejects.toMatchObject({
        status: 412,
        etag,
        name: "SheetStorageError",
      });
    }
    expect(fetch).toHaveBeenCalledTimes(3);
    expect((await storage.loadSnapshot(BOOK)).value).toEqual({ v: 1 });
    await expect(storage.loadIndex(BOOK)).rejects.toBeInstanceOf(SheetStorageError);
  });
  it("rejects missing, weak, wildcard and conflicting preconditions before fetching", async () => {
    const { storage, fetch } = memoryPod();
    for (const condition of [
      {},
      { ifMatch: "" },
      { ifMatch: "*" },
      { ifMatch: 'W/"v1"' },
      { ifMatch: '"bad\r\n"' },
      { ifMatch: '"v1"', ifNoneMatch: "*" },
      { ifNoneMatch: "x" },
    ]) {
      await expect(storage.saveSnapshot(BOOK, {}, condition as Precondition)).rejects.toThrow(
        TypeError,
      );
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains missing ETags and HTTP/network errors", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("{}"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockRejectedValueOnce(new Error("offline"));
    const storage = createSheetStorage(fetch, POD);
    expect(await storage.loadSnapshot(BOOK)).toEqual({ value: {}, etag: null });
    expect(await storage.saveSnapshot(BOOK, {}, { ifNoneMatch: "*" })).toBeNull();
    await expect(storage.saveSnapshot(BOOK, {}, { ifMatch: '"a"' })).rejects.toMatchObject({
      status: 403,
      etag: null,
    });
    await expect(storage.loadSnapshot(BOOK)).rejects.toThrow("offline");
  });
  it("refuses foreign origins, sibling paths, encoded traversal and redirects", async () => {
    const { storage, fetch } = memoryPod();
    for (const book of [
      "https://evil.example/sheets/",
      "https://pod.example/alice-other/sheets/",
      `${POD}x/..%2f..%2fsheets/`,
    ]) {
      await expect(storage.saveSnapshot(book, {}, { ifNoneMatch: "*" })).rejects.toThrow();
      await expect(storage.registerSpreadsheet(`${POD}index.ttl`, book)).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    await expect(storage.loadSnapshot(BOOK)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Type Index registration", () => {
  const indexUrl = `${POD}settings/privateTypeIndex.ttl`;
  const existing = `@prefix solid: <${SOLID}>. <${indexUrl}> a solid:TypeIndex, solid:UnlistedDocument. <#other> a solid:TypeRegistration; solid:forClass <https://schema.org/Other>; solid:instance <${POD}other.ttl>.`;
  it("preserves foreign registrations, adds one instance and becomes idempotent", async () => {
    const { storage, fetch, resources } = memoryPod();
    resources.set(indexUrl, { body: existing, contentType: "text/turtle", etag: '"seed"' });
    expect(await storage.registerSpreadsheet(indexUrl, BOOK)).toEqual({ added: true, etag: '"1"' });
    const dataset = await parseRdf(resources.get(indexUrl)?.body ?? "", "text/turtle", {
      baseIRI: indexUrl,
    });
    expect(
      new SheetResource(`${indexUrl}#other`, dataset, DataFactory).iri(`${SOLID}instance`),
    ).toBe(`${POD}other.ttl`);
    const registration = new SheetResource(
      `${indexUrl}#sheets-${encodeURIComponent(workbookLayout(BOOK).subject)}`,
      dataset,
      DataFactory,
    );
    expect(registration.iri(`${SOLID}forClass`)).toBe(SPREADSHEET_CLASS);
    expect(registration.iri(`${SOLID}instance`)).toBe(workbookLayout(BOOK).subject);
    expect(registration.iri(`${SOLID}instanceContainer`)).toBeUndefined();
    expect(await storage.registerSpreadsheet(indexUrl, BOOK)).toEqual({
      added: false,
      etag: '"1"',
    });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  });
  it("distinguishes instance registrations from collections and other instances", async () => {
    const { storage, resources } = memoryPod();
    resources.set(indexUrl, {
      body: `${existing} <#collection> a <${SOLID}TypeRegistration>; <${SOLID}forClass> <${SPREADSHEET_CLASS}>; <${SOLID}instance> <${BOOK}index.ttl#it>; <${SOLID}instanceContainer> <${BOOK}>. <#different> a <${SOLID}TypeRegistration>; <${SOLID}forClass> <${SPREADSHEET_CLASS}>; <${SOLID}instance> <${POD}other.ttl>.`,
      contentType: "text/turtle",
      etag: '"seed"',
    });
    expect((await storage.registerSpreadsheet(indexUrl, BOOK)).added).toBe(true);
  });
  it.each([
    "collection",
    "instance",
    "untyped",
  ])("preserves an occupied %s subject and mints a separate idempotent registration", async (kind) => {
    const { storage, fetch, resources } = memoryPod();
    const base = `${indexUrl}#sheets-${encodeURIComponent(workbookLayout(BOOK).subject)}`;
    const target = kind === "collection" ? "instanceContainer" : "instance";
    const occupied =
      kind === "untyped"
        ? `<${base}> <https://schema.org/name> "Occupied".`
        : `<${base}> a <${SOLID}TypeRegistration>; <${SOLID}forClass> <${SPREADSHEET_CLASS}>; <${SOLID}${target}> <${POD}other/>.`;
    const body = `${existing} ${occupied} <${base}-1> <https://schema.org/name> "Also occupied".`;
    const original = await parseRdf(body, "text/turtle", { baseIRI: indexUrl });
    resources.set(indexUrl, { body, contentType: "text/turtle", etag: '"seed"' });
    expect(await storage.registerSpreadsheet(indexUrl, BOOK)).toEqual({ added: true, etag: '"1"' });
    const dataset = await parseRdf(resources.get(indexUrl)?.body ?? "", "text/turtle", {
      baseIRI: indexUrl,
    });
    for (const quad of original) expect(dataset.has(quad)).toBe(true);
    const registration = new SheetResource(`${base}-2`, dataset, DataFactory);
    expect(registration.types).toContain(`${SOLID}TypeRegistration`);
    expect(registration.iri(`${SOLID}forClass`)).toBe(SPREADSHEET_CLASS);
    expect(registration.iri(`${SOLID}instance`)).toBe(workbookLayout(BOOK).subject);
    expect(registration.iri(`${SOLID}instanceContainer`)).toBeUndefined();
    expect(await storage.registerSpreadsheet(indexUrl, BOOK)).toEqual({
      added: false,
      etag: '"1"',
    });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  });
  it("requires document URLs and readable indexes with strong ETags; never bootstraps", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(existing))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const storage = createSheetStorage(fetch, POD);
    await expect(storage.registerSpreadsheet(`${indexUrl}#it`, BOOK)).rejects.toThrow("document");
    expect(fetch).not.toHaveBeenCalled();
    await expect(storage.registerSpreadsheet(indexUrl, BOOK)).rejects.toThrow("ETag");
    await expect(storage.registerSpreadsheet(indexUrl, BOOK)).rejects.toMatchObject({
      status: 403,
    });
    await expect(storage.registerSpreadsheet(indexUrl, BOOK)).rejects.toMatchObject({
      status: 404,
    });
    expect(fetch.mock.calls.every(([, init]) => init?.method !== "PUT")).toBe(true);
  });
  it("surfaces registration conflicts and their remote ETag without retrying", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(existing, { headers: { etag: '"seed"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 412, headers: { etag: '"newer"' } }));
    await expect(
      createSheetStorage(fetch, POD).registerSpreadsheet(indexUrl, BOOK),
    ).rejects.toMatchObject({ status: 412, etag: '"newer"' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
