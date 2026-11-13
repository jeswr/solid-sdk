// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { Doc } from "yjs";
import {
  clearLocalMirrors,
  LocalMirrorError,
  prepareLocalMirror,
  waitForLocalMirror,
} from "./local.js";

const { IDBFactory, IDBKeyRange } = createRequire(
  new URL("../../solid-offline/package.json", import.meta.url),
)("fake-indexeddb");
vi.stubGlobal("indexedDB", new IDBFactory());
vi.stubGlobal("IDBKeyRange", IDBKeyRange);

const fault = vi.hoisted(() => ({
  stage: "open" as "open" | "hydrate" | "event" | "abort" | "error" | "construct",
  cause: new Error("Storage denied"),
  providers: [] as { destroy: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn>; doc: Doc }[],
}));

// These providers model the library's initialization failure signals; success,
// transactions and archival are exercised against real y-indexeddb in local.test.
vi.mock("y-indexeddb", async (original) => {
  const actual = await original<typeof import("y-indexeddb")>();
  return {
    ...actual,
    IndexeddbPersistence: class {
      constructor(
        readonly name: string,
        readonly doc: Doc,
      ) {
        if (fault.stage === "construct") throw fault.cause;
        fault.providers.push(this);
      }
      database = new EventTarget();
      listeners = new Map<string, (error: unknown) => void>();
      _db = fault.stage === "open" ? Promise.reject(fault.cause) : Promise.resolve(this.database);
      whenSynced = new Promise<never>((_resolve, reject) => {
        queueMicrotask(() => {
          if (fault.stage === "hydrate") reject(fault.cause);
          else if (fault.stage === "event") this.listeners.get("error")?.(fault.cause);
          else if (fault.stage === "abort" || fault.stage === "error")
            queueMicrotask(() => this.database.dispatchEvent(new Event(fault.stage)));
        });
      });
      on(event: string, listener: (error: unknown) => void) {
        this.listeners.set(event, listener);
      }
      off = vi.fn((event: string) => this.listeners.delete(event));
      destroy = vi.fn(async () => {
        if (fault.stage === "open") throw fault.cause;
      });
    },
  };
});

afterEach(() => {
  fault.providers.length = 0;
  vi.restoreAllMocks();
});

it.each([
  "open",
  "hydrate",
  "event",
  "abort",
  "error",
  "construct",
] as const)("settles prepare and clear with a typed error after failed %s initialization", async (stage) => {
  fault.stage = stage;
  const destroyed = vi.spyOn(Doc.prototype, "destroy");
  for (const action of [
    () => prepareLocalMirror("registry", "instance"),
    () => clearLocalMirrors("registry"),
  ]) {
    await expect(action()).rejects.toBeInstanceOf(LocalMirrorError);
    const provider = fault.providers.at(-1);
    if (stage !== "construct") {
      expect(provider?.destroy).toHaveBeenCalled();
      expect(provider?.off).toHaveBeenCalledWith("error", expect.any(Function));
      expect(provider?.doc.isDestroyed).toBe(true);
    }
  }
  expect(destroyed).toHaveBeenCalledTimes(4);
});

it("preserves the database-open cause even when provider destruction rejects", async () => {
  fault.stage = "open";
  await expect(prepareLocalMirror("registry", "instance")).rejects.toMatchObject({
    name: "LocalMirrorError",
    mirrorName: "registry",
    cause: fault.cause,
  });
});

it("waits for database opening even if an in-memory adapter has already synced", async () => {
  let opened!: (database: null) => void;
  const mirror = {
    name: "already synced",
    whenSynced: Promise.resolve(),
    // biome-ignore lint/style/useNamingConvention: y-indexeddb initialization contract.
    _db: new Promise<null>((resolve) => {
      opened = resolve;
    }),
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Parameters<typeof waitForLocalMirror>[0];
  const ready = waitForLocalMirror(mirror);
  await Promise.resolve();
  expect(mirror.off).not.toHaveBeenCalled();
  opened(null);
  await ready;
  expect(mirror.destroy).not.toHaveBeenCalled();
  expect(mirror.off).toHaveBeenCalledWith("error", expect.any(Function));
});

it.each([
  "event",
  "rejection",
])("rejects an early provider %s even while database opening and destruction remain pending", async (signal) => {
  const cause = new Error("Hydration stopped");
  let opened!: (database: EventTarget) => void;
  const mirror = {
    name: "opening",
    whenSynced: signal === "rejection" ? Promise.reject(cause) : new Promise<never>(() => {}),
    // biome-ignore lint/style/useNamingConvention: y-indexeddb initialization contract.
    _db: new Promise<EventTarget>((resolve) => {
      opened = resolve;
    }),
    on: vi.fn((_event, listener) => {
      if (signal === "event") queueMicrotask(() => listener(cause));
    }),
    off: vi.fn(),
    destroy: vi.fn(() => new Promise<void>(() => {})),
  } as unknown as Parameters<typeof waitForLocalMirror>[0];
  await expect(waitForLocalMirror(mirror)).rejects.toMatchObject({
    name: "LocalMirrorError",
    cause,
  });
  expect(mirror.destroy).toHaveBeenCalledOnce();
  expect(mirror.off).toHaveBeenCalledWith("error", expect.any(Function));
  const database = new EventTarget();
  const add = vi.spyOn(database, "addEventListener");
  opened(database);
  await Promise.resolve();
  expect(add).not.toHaveBeenCalled();
});
