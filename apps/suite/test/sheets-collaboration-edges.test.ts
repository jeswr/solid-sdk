// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 5.5
import { createRequire } from "node:module";
import { SolidUpdateStore } from "@jeswr/y-solid";
import { LocalMirrorError } from "@jeswr/y-solid/local";
import type { IWorkbookData } from "@univerjs/core";
import { afterEach, expect, it, vi } from "vitest";
import { decodeCell } from "../src/apps/sheets/lib/collaboration/formulas";
import type { Axes } from "../src/apps/sheets/lib/collaboration/model";
import {
  clearWorkbookMirrors,
  WorkbookCollaboration,
} from "../src/apps/sheets/lib/collaboration/persistence";
import type { Snapshot } from "../src/apps/sheets/lib/contract";
import { SheetReferenceError } from "../src/apps/sheets/lib/refs/model";
import { formatA1 } from "../src/apps/sheets/lib/refs/notation";
import { harness, POD, WEBID } from "./sheets-workbook-helpers";

const control = vi.hoisted(() => ({
  clear: undefined as Error | undefined,
  prepare: undefined as Error | undefined,
}));
vi.mock("@jeswr/y-solid/local", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jeswr/y-solid/local")>();
  return {
    ...actual,
    clearLocalMirrors: async (...args: Parameters<typeof actual.clearLocalMirrors>) => {
      if (control.clear) throw control.clear;
      return actual.clearLocalMirrors(...args);
    },
    prepareLocalMirror: async (...args: Parameters<typeof actual.prepareLocalMirror>) => {
      if (control.prepare) throw control.prepare;
      return actual.prepareLocalMirror(...args);
    },
  };
});

const container = `${POD}sheets/edges/collab/`;
const snapshot: Snapshot = {
  id: "book",
  sheetOrder: ["data"],
  styles: {},
  sheets: {
    data: { id: "data", name: "Data", rowCount: 2, columnCount: 2, cellData: {} },
  },
};

function fakeIndexedDb() {
  const { IDBFactory, IDBKeyRange } = createRequire(
    `${process.cwd()}/../../packages/solid-offline/package.json`,
  )("fake-indexeddb") as {
    IDBFactory: new () => IDBFactory;
    IDBKeyRange: typeof globalThis.IDBKeyRange;
  };
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
}

/** An in-memory update log with the y-solid store's interface. */
function memoryStore() {
  const updates = new Map<string, Uint8Array>();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "PUT") {
      if (updates.has(url)) return new Response(null, { status: 412 });
      updates.set(url, new Uint8Array(init.body as ArrayBuffer));
      return new Response(null, { status: 201 });
    }
    const value = updates.get(url);
    return new Response(value as BodyInit | undefined, { status: value ? 200 : 404 });
  };
  class Store extends SolidUpdateStore {
    constructor() {
      super({ container, fetch });
    }
    override async appendUpdate(update: Uint8Array) {
      const url = `${container}${crypto.randomUUID()}`;
      updates.set(url, update.slice());
      return { url };
    }
    override async listUpdateUrls() {
      return [...updates.keys()];
    }
    override async readUpdate(url: string) {
      return updates.get(url) ?? null;
    }
    override async loadUpdates() {
      return [...updates].map(([url, update]) => ({ url, update }));
    }
  }
  return { fetch, store: () => new Store() };
}

afterEach(() => {
  control.clear = undefined;
  control.prepare = undefined;
  vi.unstubAllGlobals();
});

it("clearing mirrors tolerates storage denial but surfaces other failures", async () => {
  fakeIndexedDb();
  control.clear = new LocalMirrorError("mirror", new Error("denied"));
  await expect(clearWorkbookMirrors(WEBID, `${POD}sheets/edges/`)).resolves.toBeUndefined();
  control.clear = new Error("unexpected");
  await expect(clearWorkbookMirrors(WEBID, `${POD}sheets/edges/`)).rejects.toThrow("unexpected");
});

it("an owner's mirror falls back to the log's workbook and needs an instance identity", async () => {
  fakeIndexedDb();
  const memory = memoryStore();
  const runtime = new WorkbookCollaboration(container, memory.fetch, false, memory.store(), WEBID);
  await runtime.open(snapshot);
  expect(runtime.localMirrorUnavailable).toBe(false);
  await runtime.destroy();
  const unnamed = new WorkbookCollaboration(container, memory.fetch, false, memory.store(), WEBID);
  await expect(unnamed.open({ ...snapshot, id: "" })).rejects.toThrow(
    "Missing workbook instance identity",
  );
});

it("only a local-mirror failure degrades to no mirror; other failures reject the open", async () => {
  fakeIndexedDb();
  const memory = memoryStore();
  control.prepare = new LocalMirrorError("mirror", new Error("quota"));
  const degraded = new WorkbookCollaboration(container, memory.fetch, false, memory.store(), WEBID);
  await degraded.open(snapshot);
  expect(degraded.localMirrorUnavailable).toBe(true);
  await degraded.destroy();
  control.prepare = new Error("broken mirror code");
  const failing = new WorkbookCollaboration(container, memory.fetch, false, memory.store(), WEBID);
  await expect(failing.open(snapshot)).rejects.toThrow("broken mirror code");
});

it("a retired runtime refuses appends, flushes and further currency checks", async () => {
  const memory = memoryStore();
  let current = true;
  const runtime = new WorkbookCollaboration(
    container,
    memory.fetch,
    false,
    memory.store(),
    undefined,
    {
      workbook: `${POD}sheets/edges/`,
      isCurrent: async () => current,
    },
  );
  await runtime.open(snapshot);
  current = false;
  const internals = runtime as unknown as { assertCurrent(): Promise<void> };
  const retired = await internals.assertCurrent().catch((error: unknown) => error);
  expect(retired).toBeInstanceOf(Error);
  expect((retired as Error).message).toContain("deleted or replaced");
  await expect(internals.assertCurrent()).rejects.toBe(retired);
  await expect(runtime.flush()).rejects.toBe(retired);
  await expect(runtime.provider.store.appendUpdate(new Uint8Array([0, 0]))).rejects.toBe(retired);
});

it("a stable reference to a deleted row decodes to #REF!", () => {
  const workbook = { sheets: { data: { name: "Data" } } } as unknown as IWorkbookData;
  const positions = new Map<string, Axes>([["data", { rowIds: ["r1"], colIds: ["c1"] }]]);
  const reference = {
    rows: { start: { index: 1, absolute: false }, end: { index: 1, absolute: false } },
    columns: { start: { index: 1, absolute: false }, end: { index: 1, absolute: false } },
  };
  expect(
    decodeCell(
      {
        f: "=A1",
        stableFormula: [
          "=",
          { text: "A1", sheetId: "data", reference, rows: [null, null], columns: ["c1", "c1"] },
        ],
      } as unknown as Parameters<typeof decodeCell>[0],
      workbook,
      positions,
    ),
  ).toEqual({ f: "=#REF!" });
});

it("reversed ranges are refused when formatting", () => {
  expect(() =>
    formatA1({
      rows: { start: { index: 3, absolute: false }, end: { index: 1, absolute: false } },
      columns: null,
    }),
  ).toThrow(SheetReferenceError);
});

it("a legacy ID migration surfaces non-conflict failures", async () => {
  const h = await harness();
  const book = await h.service.create({ title: "Legacy failure", snapshot });
  const legacy = { ...book.snapshot };
  delete legacy.id;
  await h.storage.saveSnapshot(book.container, legacy, { ifMatch: book.version.snapshotEtag });
  h.setHook((call) =>
    call.method === "PUT" && call.url.endsWith("workbook.json")
      ? new Response(null, { status: 500 })
      : undefined,
  );
  await expect(h.service.open(book.container)).rejects.toBeDefined();
});

it("collaborating on a legacy snapshot assigns an instance, and view-only legacy logs stay unscoped", async () => {
  const h = await harness();
  const book = await h.service.create({ title: "Legacy collab", snapshot });
  const legacy = { ...book.snapshot };
  delete legacy.id;
  await h.storage.saveSnapshot(book.container, legacy, { ifMatch: book.version.snapshotEtag });
  const owner = (await h.service.collaborate?.(
    book.container,
    legacy,
    false,
  )) as WorkbookCollaboration;
  expect(owner.container).toMatch(/collab\/[0-9a-f-]{36}\/$/);
  await owner.destroy();
  const viewer = (await h.service.collaborate?.(
    book.container,
    { ...legacy },
    true,
  )) as WorkbookCollaboration;
  expect(viewer.container).toBe(`${book.container}collab/`);
  await viewer.destroy();
});

it.each([
  [410, "deleted or replaced"],
  [500, ""],
])("a currency check answering %i retires or fails the repair", async (status, message) => {
  const h = await harness();
  const book = await h.service.create({ title: `Currency ${status}`, snapshot });
  const runtime = (await h.service.collaborate?.(
    book.container,
    book.snapshot,
    false,
  )) as WorkbookCollaboration;
  try {
    h.setHook((call) =>
      call.method === "PUT" && call.url.includes("/collab/")
        ? new Response(null, { status: 503 })
        : undefined,
    );
    runtime.doc.transact(() => runtime.doc.getMap("probe").set("edit", 1));
    await runtime.provider.flush();
    h.setHook((call) =>
      call.method === "GET" && call.url.endsWith("workbook.json")
        ? new Response(null, { status })
        : undefined,
    );
    const error = await runtime.flush().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    if (message) expect((error as Error).message).toContain(message);
    else expect((error as Error).message).not.toContain("deleted or replaced");
  } finally {
    h.setHook(() => undefined);
    await runtime.destroy().catch(() => {});
  }
});
