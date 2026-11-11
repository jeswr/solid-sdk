// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  addElement,
  DEFAULT_STYLE,
  emptyScene,
  rectangle,
  serializeScene,
  text,
} from "@jeswr/excalidraw-scene";
import type { TypeIndex } from "@jeswr/pod-type-index";
import { DRAW_SCENE_IRI, serializeScene as descriptor } from "@jeswr/solid-drawing";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleScenes, seedSamples } from "../src/apps/whiteboard/demo/sample";
import { readDrafts, writeDrafts } from "../src/apps/whiteboard/lib/drafts";
import { downloadBoard, pngSize, scenePng } from "../src/apps/whiteboard/lib/export";
import {
  type Board,
  isConflict,
  openWhiteboards,
  prepareWhiteboards,
  WhiteboardRepository,
} from "../src/apps/whiteboard/lib/repository";
import { canvasPoint, dragBox, INITIAL_VIEW, zoomAt } from "../src/apps/whiteboard/lib/viewport";
import { BoardAutosave } from "../src/apps/whiteboard/state/autosave";
import { applyStyle, commit, history, redo, undo } from "../src/apps/whiteboard/state/history";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

const root = "https://fictional.example/pod/";
const scene = () => addElement(emptyScene(), rectangle(10, 20, 100, 80, { id: "one" }));
const index = () =>
  ({ find: vi.fn(async () => []), register: vi.fn(async () => undefined) }) as unknown as TypeIndex;
async function fixture(protocol: "solid" | "lws" = "solid") {
  const storage = createMemoryStorage({ protocol, root });
  const repository = await prepareWhiteboards(storage, index());
  return { storage, repository };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("whiteboard pod orchestration", () => {
  it.each([
    "solid",
    "lws",
  ] as const)("creates, lists, updates, renames, copies and deletes on %s", async (protocol) => {
    const { repository, storage } = await fixture(protocol);
    expect(await repository.list()).toEqual([]);
    const board = await repository.create("  Workshop  ", scene());
    expect(board.title).toBe("Workshop");
    expect((await repository.read(board.descriptor)).scene).toEqual(board.scene);
    expect((await repository.list()).map((b) => b.title)).toEqual(["Workshop"]);
    const renamed = await repository.rename(board, " New name ");
    expect(renamed.title).toBe("New name");
    expect(renamed.metadata.created).toBe(board.metadata.created);
    const saved = await repository.save(
      renamed,
      addElement(scene(), text(100, 100, "Hello")),
      true,
    );
    expect((await repository.read(saved.descriptor)).scene.elements).toHaveLength(2);
    expect(await (await storage.read(saved.blob)).text()).toBe(serializeScene(saved.scene));
    const copied = await repository.create("Copy", saved.scene);
    expect(copied.blob).not.toBe(saved.blob);
    expect((await repository.list()).map((b) => b.title)).toEqual(["Copy", "New name"]);
    await repository.remove(copied);
    await repository.remove(saved);
    expect(await repository.list()).toEqual([]);
  });
  it("registers draw:Scene and reuses its container", async () => {
    const { storage } = await fixture();
    const types = index();
    const repo = await prepareWhiteboards(storage, types);
    expect(types.register).toHaveBeenCalledWith(
      DRAW_SCENE_IRI,
      { container: root + "whiteboards/" },
      { index: "private" },
    );
    expect(repo.container).toBe(root + "whiteboards/");
  });
  it("requires ETags and rejects overwrites on 412", async () => {
    const { repository } = await fixture();
    const board = await repository.create("A", scene());
    const next = await repository.save(board, emptyScene());
    await expect(repository.save(board, scene())).rejects.toMatchObject({
      code: "precondition-failed",
    });
    expect(isConflict(await repository.save(board, scene()).catch((e) => e))).toBe(true);
    expect(isConflict(new Error())).toBe(false);
    await expect(repository.save({ ...next, etag: null }, scene())).resolves.toBeDefined();
    await expect(
      repository.rename({ ...board, descriptorEtag: 'W/"weak"' }, "x"),
    ).rejects.toThrow();
    await expect(repository.rename(board, "  ")).rejects.toThrow("name");
  });
  it("refuses descriptors outside the pod, invalid descriptors and malformed canvas JSON", async () => {
    const { repository, storage } = await fixture();
    const invalid = await storage.create(repository.container, "", {
      name: "invalid.ttl",
      contentType: "text/turtle",
    });
    await expect(repository.read(invalid.url)).rejects.toThrow("invalid drawing");
    const outside = await storage.create(
      repository.container,
      await descriptor(root + "whiteboards/outside.ttl", {
        sceneDocument: "https://elsewhere.example/canvas",
      }),
      { name: "outside.ttl", contentType: "text/turtle" },
    );
    await expect(repository.read(outside.url)).rejects.toThrow("outside");
    const board = await repository.create("x");
    await storage.write(board.blob, "{}", {
      contentType: "application/json",
      ifMatch: board.etag as string,
    });
    await expect(repository.read(board.descriptor)).rejects.toThrow("Invalid Excalidraw");
  });
  it("uses observed read validators and does not adopt a follow-up HEAD ETag", async () => {
    const { repository, storage } = await fixture();
    const create = storage.create.bind(storage);
    vi.spyOn(storage, "create").mockImplementation(async (...args) => ({
      ...(await create(...args)),
      etagSource: "follow-up",
    }));
    const b = await repository.create("");
    expect(b.title).toBe("Untitled board");
    expect(b.etag).toBeTruthy();
  });
  it("does not hide access failures as an empty collection", async () => {
    const { repository, storage } = await fixture();
    vi.spyOn(storage, "head").mockRejectedValue(new Error("access denied"));
    await expect(prepareWhiteboards(storage, index())).rejects.toThrow("access denied");
    vi.spyOn(storage, "listAll").mockImplementation(() => {
      throw new Error("access denied");
    });
    await expect(repository.list()).rejects.toThrow("access denied");
  });
  it("handles container creation races, rejects other failures and caps the board count", async () => {
    const { storage, repository } = await fixture();
    const original = storage.head.bind(storage);
    let first = true;
    vi.spyOn(storage, "head").mockImplementation((...args) => {
      if (first) {
        first = false;
        return Promise.reject(new StorageError("not-found", { url: args[0], method: "HEAD" }));
      }
      return original(...args);
    });
    await expect(prepareWhiteboards(storage, index())).resolves.toBeDefined();
    vi.spyOn(storage, "head").mockRejectedValue(
      new StorageError("not-found", { url: root, method: "HEAD" }),
    );
    vi.spyOn(storage, "create").mockRejectedValue(new Error("write failed"));
    await expect(prepareWhiteboards(storage, index())).rejects.toThrow("write failed");
    const b = {
      url: root + "whiteboards/a.ttl",
      kind: "resource" as const,
      types: [],
      contentType: null,
      size: null,
      modified: null,
    };
    vi.spyOn(storage, "listAll").mockImplementation(async function* () {
      yield { ...b, kind: "container" };
      yield { ...b, url: root + "whiteboards/blob.excalidraw" };
      for (let i = 0; i < 101; i++) yield b;
    });
    vi.spyOn(repository, "read").mockResolvedValue({ title: "Board" } as Board);
    expect(await repository.list()).toHaveLength(100);
    expect(repository.truncated).toBe(true);
  });
  it("opens the real SDK client on the demo pod", async () => {
    const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
    const repo = await openWhiteboards({
      mode: "demo",
      storageUrl: DEMO_ROOT,
      webId: DEMO_WEBID,
      displayName: "Fictional",
      fetch: pod.fetch,
      subscribe: pod.subscribe,
      reset: async () => {},
    });
    expect(repo.container).toBe(`${DEMO_ROOT}whiteboards/`);
  });
  it("seeds fictional sample scenes once and never replaces existing boards", async () => {
    const { repository } = await fixture();
    const a = seedSamples(repository);
    expect(seedSamples(repository)).toBe(a);
    await a;
    expect(await repository.list()).toHaveLength(2);
    expect(sampleScenes()[0]?.scene.type).toBe("excalidraw");
    const repo = new WhiteboardRepository(repository.storage, repository.container);
    await seedSamples(repo);
    expect(await repository.list()).toHaveLength(2);
  });
});
describe("single-flight autosave", () => {
  it("debounces and serialises the newest snapshot without losing a newer edit", async () => {
    vi.useFakeTimers();
    const { repository } = await fixture();
    const b = await repository.create("A", scene());
    const changed = vi.fn();
    const writer = new BoardAutosave(repository, b, changed, 50);
    const save = vi.spyOn(repository, "save");
    writer.update(emptyScene());
    writer.update(scene());
    await vi.advanceTimersByTimeAsync(50);
    expect(save).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls.at(-1)?.[0]).toBe("saved");
    writer.dispose();
  });
  it("keeps edits arriving while a save is in flight", async () => {
    const { repository } = await fixture();
    const b = await repository.create("A", scene());
    let release: () => void = () => {};
    const original = repository.save.bind(repository);
    const saves = vi.spyOn(repository, "save").mockImplementationOnce(async (...args) => {
      await new Promise<void>((r) => {
        release = r;
      });
      return original(...args);
    });
    const writer = new BoardAutosave(repository, b, vi.fn(), 60000);
    writer.update(emptyScene());
    const f = writer.flush();
    const latest = scene();
    writer.update(latest);
    const concurrent = writer.flush();
    release();
    await Promise.all([f, concurrent]);
    expect(saves).toHaveBeenCalledTimes(2);
    expect((await repository.read(b.descriptor)).scene).toEqual(latest);
    writer.dispose();
  });
  it.each([
    false,
    true,
  ])("retains failures and permits explicit retries (conflict=%s)", async (conflict) => {
    const { repository } = await fixture();
    const b = await repository.create("A", scene());
    const changed = vi.fn();
    const save = vi
      .spyOn(repository, "save")
      .mockRejectedValueOnce(
        conflict
          ? new StorageError("precondition-failed", { url: b.blob, method: "PUT" })
          : new Error("offline"),
      );
    const writer = new BoardAutosave(repository, b, changed, 60000);
    writer.update(emptyScene());
    await writer.flush();
    expect(changed.mock.calls.at(-1)?.[0]).toBe(conflict ? "conflict" : "error");
    await writer.flush();
    expect(save).toHaveBeenCalledTimes(1);
    await writer.retry();
    expect(changed.mock.calls.at(-1)?.[0]).toBe("saved");
    writer.dispose();
  });
});
describe("history, viewport, drafts and export", () => {
  it("undoes and redoes with monotonic revisions and deleted tombstones", () => {
    const h = history(emptyScene());
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
    expect(commit(h, emptyScene())).toBe(h);
    const added = commit(h, scene());
    const undone = undo(added);
    expect(undone.present.elements[0]?.isDeleted).toBe(true);
    const redone = redo(undone);
    expect(redone.present.elements[0]?.isDeleted).toBe(false);
    expect(redone.present.elements[0]?.version).toBeGreaterThan(
      undone.present.elements[0]?.version ?? 0,
    );
    expect(applyStyle(redone.present, ["one"], { opacity: 50 }).elements[0]?.opacity).toBe(50);
    let many = h;
    for (let i = 0; i < 55; i++) many = commit(many, { ...emptyScene(), count: i });
    expect(many.past.length).toBe(50);
  });
  it("zooms around a fixed point, clamps extremes and normalises drag boxes", () => {
    expect(canvasPoint(INITIAL_VIEW, 100, 100)).toEqual([20, 20]);
    const zoomed = zoomAt(INITIAL_VIEW, 2, [100, 100]);
    expect(canvasPoint(zoomed, 100, 100)).toEqual([20, 20]);
    expect(zoomAt(zoomed, 100, [0, 0]).zoom).toBe(8);
    expect(zoomAt(zoomed, 0.0001, [0, 0]).zoom).toBe(0.1);
    expect(dragBox([10, 20], [0, 0])).toEqual({ x: 0, y: 0, width: 10, height: 20 });
  });
  it("round trips only validated account-scoped whiteboard drafts", async () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
    const { repository } = await fixture();
    const b = await repository.create("2026-01-01", scene());
    expect(writeDrafts(storage, "me", root, [b])).toBe(true);
    expect(readDrafts(storage, "me", root)).toEqual([b]);
    expect(readDrafts(storage, "other", root)).toEqual([]);
    const k = [...map.keys()].find((k) => k.startsWith("whiteboard.drafts.v1:")) as string;
    const raw = JSON.parse(map.get(k) as string);
    raw.owner = "other";
    map.set(k, JSON.stringify(raw));
    expect(readDrafts(storage, "me", root)).toEqual([]);
    map.set(k, "broken");
    expect(readDrafts(storage, "me", root)).toEqual([]);
    writeDrafts(storage, "me", root, []);
    expect([...map.keys()].filter((k) => k.startsWith("whiteboard.drafts.v1:"))).toHaveLength(0);
    expect(
      writeDrafts(
        {
          ...storage,
          setItem: () => {
            throw new Error("quota");
          },
        },
        "me",
        root,
        [b],
      ),
    ).toBe(false);
  });
  it("rejects malformed draft records and overlarge cache entries", () => {
    const storage = {
      getItem: () => JSON.stringify({ owner: "me", root, boards: [{}] }),
      setItem: () => {},
      removeItem: () => {},
    };
    expect(readDrafts(storage, "me", root)).toEqual([]);
    expect(
      readDrafts({ ...storage, getItem: () => "x".repeat(17 * 1024 * 1024) }, "me", root),
    ).toEqual([]);
  });
  it("caps PNG raster sizes", () => {
    expect(pngSize(emptyScene())).toEqual({ width: 98, height: 98 });
    expect(pngSize(addElement(emptyScene(), rectangle(0, 0, 1000000, 1000000))).width).toBe(4096);
  });
  it("exports SVG-derived PNGs and always revokes temporary URLs", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const drawImage = vi.fn();
    vi.stubGlobal(
      "Image",
      class {
        onload = () => {};
        set src(_s: string) {
          this.onload();
        }
      },
    );
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({ drawImage }),
        toBlob: (cb: (b: Blob) => void) => cb(new Blob(["png"])),
      }),
    });
    expect(await scenePng(scene())).toBeInstanceOf(Blob);
    expect(drawImage).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalled();
  });
  it("surfaces PNG rendering, context and encoding failures", async () => {
    vi.stubGlobal(
      "Image",
      class {
        onerror = () => {};
        set src(_s: string) {
          this.onerror();
        }
      },
    );
    await expect(scenePng(scene())).rejects.toThrow("render");
    vi.stubGlobal(
      "Image",
      class {
        onload = () => {};
        set src(_s: string) {
          this.onload();
        }
      },
    );
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
    await expect(scenePng(scene())).rejects.toThrow("unavailable");
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (cb: (b: null) => void) => cb(null),
      }),
    });
    await expect(scenePng(scene())).rejects.toThrow("export");
  });
  it("downloads safe filenames and revokes the URL", async () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const a = { href: "", download: "", click };
    vi.stubGlobal("document", { createElement: () => a });
    await downloadBoard(new Blob(["svg"]), "A/<board>", "svg");
    expect(a.download).toBe("A__board_.svg");
    expect(click).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
  });
});

it("reuses registered containers, retains unreadable boards and provides offline access failures", async () => {
  const { disconnectedBoards } = await import("../src/apps/whiteboard/lib/repository");
  const { storage, repository } = await fixture();
  const types = index();
  vi.mocked(types.find).mockResolvedValue(["https://elsewhere.example/", repository.container]);
  expect((await prepareWhiteboards(storage, types)).container).toBe(repository.container);
  await storage.create(repository.container, "", {
    name: "interrupted.ttl",
    contentType: "text/turtle",
  });
  await repository.create("Readable", scene());
  expect(await repository.list()).toHaveLength(1);
  expect(repository.unreadable).toHaveLength(1);
  await expect(disconnectedBoards.read("x")).rejects.toThrow("Reconnect");
  await expect(disconnectedBoards.save({} as Board, emptyScene())).rejects.toThrow("Reconnect");
});

it("does not delete a canvas owned by another pod collection", async () => {
  const { repository, storage } = await fixture();
  const shared = await storage.create(root, serializeScene(scene()), {
    name: "shared.excalidraw",
    contentType: "application/json",
  });
  const descriptorUrl = `${repository.container}linked.ttl`;
  await storage.create(
    repository.container,
    await descriptor(descriptorUrl, { sceneDocument: shared.url }),
    { name: "linked.ttl", contentType: "text/turtle" },
  );
  const board = await repository.read(descriptorUrl);
  await repository.remove(board);
  expect(await (await storage.read(shared.url)).text()).toBe(serializeScene(board.scene));
});

it("coalesces demo seeding across Strict Mode repository instances", async () => {
  const { repository, storage } = await fixture();
  const other = new WhiteboardRepository(storage, repository.container);
  const key = {};
  const first = seedSamples(repository, key);
  expect(seedSamples(other, key)).toBe(first);
  await first;
  expect(await repository.list()).toHaveLength(2);
});

it("settles canvas and metadata writes without overwriting each other's fields", async () => {
  const { mergeBoardFields } = await import("../src/apps/whiteboard/state/board-fields");
  const { repository } = await fixture();
  const old = await repository.create("Old name", scene());
  const renamed = {
    ...old,
    title: "New name",
    descriptorEtag: '"new-name"',
    metadata: { ...old.metadata, title: "New name" },
  };
  const saved = { ...old, scene: emptyScene(), etag: '"new-canvas"' };
  expect(mergeBoardFields(renamed, saved, "canvas")).toMatchObject({
    title: "New name",
    descriptorEtag: '"new-name"',
    scene: saved.scene,
    etag: saved.etag,
  });
  expect(mergeBoardFields(saved, renamed, "metadata")).toMatchObject({
    title: "New name",
    scene: saved.scene,
    etag: saved.etag,
  });
  expect(mergeBoardFields(old, renamed, "all")).toBe(renamed);
});

// AUTHORED-BY Codex (GPT-6.1 Sol)
describe("review regressions", () => {
  it("isolates missing, denied, offline and out-of-pod boards from healthy entries", async () => {
    const { repository, storage } = await fixture();
    const good = await repository.create("Healthy");
    const missing = await repository.create("Missing blob");
    await storage.delete(missing.blob, { ifMatch: missing.etag as string });
    const denied = await repository.create("Denied");
    const offline = await repository.create("Offline");
    const outside = `${repository.container}outside.ttl`;
    await storage.create(
      repository.container,
      await descriptor(outside, { sceneDocument: "https://evil.example/scene" }),
      { name: "outside.ttl", contentType: "text/turtle" },
    );
    const read = storage.read.bind(storage);
    const reads = vi.spyOn(storage, "read").mockImplementation((url, options) => {
      if (url === denied.descriptor) throw new StorageError("forbidden", { url, method: "GET" });
      if (url === offline.blob) throw new Error("offline");
      return read(url, options);
    });
    expect((await repository.list()).map((b) => b.id)).toEqual([good.id]);
    expect(repository.unreadable.sort()).toEqual(
      [missing.id, denied.id, offline.id, outside].sort(),
    );
    expect(reads.mock.calls.some(([url]) => url.startsWith("https://evil.example/"))).toBe(false);
  });
  it("a 101st created board leaves the first page usable", async () => {
    const { repository } = await fixture();
    for (let i = 0; i < 101; i++) await repository.create(`Board ${i}`);
    expect(await repository.list()).toHaveLength(100);
    expect(repository.truncated).toBe(true);
    expect(repository.unreadable).toEqual([]);
  });
  it("recovers missing write validators from matching GET bodies for create, save and rename", async () => {
    const { repository, storage } = await fixture();
    const create = storage.create.bind(storage),
      write = storage.write.bind(storage);
    vi.spyOn(storage, "create").mockImplementation(async (...args) => ({
      ...(await create(...args)),
      etag: null,
      etagSource: "response",
    }));
    vi.spyOn(storage, "write").mockImplementation(async (...args) => ({
      ...(await write(...args)),
      etag: null,
      etagSource: "response",
    }));
    let b = await repository.create("A", scene());
    b = await repository.save(b, emptyScene());
    b = await repository.save(b, scene());
    b = await repository.rename(b, "B");
    b = await repository.rename(b, "C");
    expect(b.etag).toBeTruthy();
    expect(b.descriptorEtag).toBeTruthy();
    await repository.remove(b);
    expect(await repository.list()).toEqual([]);
  });
  it("routes mismatching follow-up bytes to autosave conflict without adopting another writer's ETag", async () => {
    const { repository, storage } = await fixture();
    const b = await repository.create("A", scene());
    const write = storage.write.bind(storage);
    vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => {
      const result = await write(...args);
      await write(b.blob, serializeScene(scene()), {
        contentType: "application/json",
        ifMatch: result.etag as string,
      });
      return { ...result, etag: '"other-writer"', etagSource: "follow-up" };
    });
    const changed = vi.fn();
    const writer = new BoardAutosave(repository, b, changed, 60000);
    writer.update(emptyScene());
    await writer.flush();
    expect(changed.mock.calls.at(-1)?.[0]).toBe("conflict");
    await expect(writer.finish()).resolves.toMatchObject({ id: b.id });
    writer.dispose();
  });
  it("commits descriptor deletion even when orphan cleanup fails", async () => {
    const { repository, storage } = await fixture();
    const b = await repository.create("A");
    const remove = storage.delete.bind(storage);
    vi.spyOn(storage, "delete").mockImplementation(async (url, options) => {
      if (url === b.blob) throw new Error("offline");
      return remove(url, options);
    });
    await expect(repository.remove(b)).resolves.toBeUndefined();
    expect(await repository.list()).toEqual([]);
    expect(await storage.read(b.blob)).toBeDefined();
  });
  it("awaits an in-flight autosave and its latest ETag before deletion", async () => {
    const { repository, storage } = await fixture();
    const b = await repository.create("A", scene());
    const save = repository.save.bind(repository);
    const gate = Promise.withResolvers<void>();
    vi.spyOn(repository, "save").mockImplementationOnce(async (...args) => {
      await gate.promise;
      return save(...args);
    });
    const remove = vi.spyOn(storage, "delete");
    const writer = new BoardAutosave(repository, b, vi.fn(), 60000);
    writer.update(emptyScene());
    const flight = writer.flush();
    const deleting = writer.finish().then((saved) => repository.remove(saved));
    writer.dispose();
    expect(remove).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([flight, deleting]);
    expect(await repository.list()).toEqual([]);
  });
  it("rejects combined paste overflow before committing and validates only the new snapshot", async () => {
    const { pasteScene } = await import("../src/apps/whiteboard/state/history");
    const full = {
      ...emptyScene(),
      elements: Array.from(
        { length: 5000 },
        (_, i) => ({ id: `${i}`, type: "future" }) as Board["scene"]["elements"][number],
      ),
    };
    const state = history(full);
    expect(() => pasteScene(full, scene())).toThrow("5,000");
    expect(state.present).toBe(full);
    let reads = 0;
    const base = emptyScene();
    Object.defineProperty(base, "probe", {
      enumerable: true,
      get: () => {
        reads++;
        return 1;
      },
    });
    const h = history(base);
    reads = 0;
    commit(h, scene());
    expect(reads).toBe(0);
  });
  it("stores a fixed palette regardless of theme", async () => {
    const { PALETTE, paletteColour } = await import("../src/apps/whiteboard/lib/palette");
    vi.stubGlobal("getComputedStyle", () => {
      throw new Error("theme read");
    });
    expect(paletteColour("--foreground")).toBe(DEFAULT_STYLE.strokeColor);
    for (const c of PALETTE) expect(paletteColour(c.token)).toMatch(/^#[\da-f]{6}$/);
    expect(paletteColour("none")).toBe("transparent");
  });
  it("preserves other signed-in drafts and fences late writes", async () => {
    const { activateDraftOwner } = await import("../src/apps/whiteboard/lib/drafts");
    const map = new Map<string, string>();
    const storage = {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
    const { repository } = await fixture();
    const b = await repository.create("Private", scene());
    activateDraftOwner(storage, "alice");
    writeDrafts(storage, "alice", root, [b]);
    activateDraftOwner(storage, "bob");
    expect(readDrafts(storage, "bob", root)).toEqual([]);
    expect(writeDrafts(storage, "alice", root, [b])).toBe("fenced");
    expect(readDrafts(storage, "alice", root)).toEqual([b]);
    activateDraftOwner(storage, "bob");
    writeDrafts(storage, "bob", root, [b]);
    activateDraftOwner(storage, null);
    expect(writeDrafts(storage, "bob", root, [b])).toBe("fenced");
    expect(readDrafts(storage, "alice", root)).toEqual([b]);
    activateDraftOwner(storage, null);
    expect([...map.values()].join()).not.toContain("Private");
  });
});

it("re-measures edited text at its original font size", async () => {
  const { editText } = await import("../src/apps/whiteboard/state/history");
  const s = addElement(emptyScene(), text(0, 0, "Before", { id: "large", fontSize: 48 }));
  const edited = editText(s, "large", "After\nSecond line");
  expect(edited.elements[0]).toMatchObject({ fontSize: 48, height: 120, width: 11 * 48 * 0.65 });
  expect(editText(s, "absent", "x")).toBe(s);
});

it("includes the visible zoom percentage in its accessible name and describes Shift selection", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { BoardEditor } = await import("../src/apps/whiteboard/components/editor");
  const { repository } = await fixture();
  const board = await repository.create("Labels");
  const markup = renderToStaticMarkup(
    React.createElement(BoardEditor, {
      board,
      repository,
      onBack: () => {},
      onChange: () => {},
      retain: () => {},
      onCopy: () => {},
      hasDraft: false,
    }),
  );
  expect(markup).toContain('aria-label="Reset zoom, 100%"');
  expect(markup).toContain("Shift to select multiple shapes");
});

it("never adopts a mismatching descriptor version after a rename", async () => {
  const { repository, storage } = await fixture();
  const b = await repository.create("A");
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => {
    const saved = await write(...args);
    await write(
      b.descriptor,
      await descriptor(b.descriptor, { ...b.metadata, title: "Concurrent title" }),
      { contentType: "text/turtle", ifMatch: saved.etag as string },
    );
    return { ...saved, etag: null, etagSource: "response" };
  });
  const error = await repository.rename(b, "My title").catch((e) => e);
  expect(isConflict(error)).toBe(true);
  expect((await repository.read(b.id)).title).toBe("Concurrent title");
});

it("pastes into a separate destination without counting clipboard originals twice", async () => {
  const { pasteScene } = await import("../src/apps/whiteboard/state/history");
  const source = {
    ...emptyScene(),
    elements: Array.from(
      { length: 3000 },
      (_, i) => ({ id: `source-${i}`, type: "future" }) as Board["scene"]["elements"][number],
    ),
    files: { source: "kept" },
  };
  const target = { ...scene(), files: { target: "kept" } };
  const pasted = pasteScene(target, source);
  expect(pasted.scene.elements).toHaveLength(3001);
  expect(pasted.ids).toHaveLength(3000);
  expect(pasted.scene.files).toEqual({ source: "kept", target: "kept" });
  expect(target.elements).toHaveLength(1);
  expect(() => commit(history(target), pasted.scene)).not.toThrow();
});

// AUTHORED-BY Codex GPT-6
it.each([
  "rename",
  "remove",
] as const)("certifies raw descriptor bytes for %s, including non-canonical Turtle", async (operation) => {
  const { repository, storage } = await fixture();
  const b = await repository.create("Raw descriptor");
  const raw = `# Keep original lexical representation\n${await (await storage.read(b.descriptor)).text()}\n`;
  await storage.write(b.descriptor, raw, {
    contentType: "text/turtle",
    ifMatch: b.descriptorEtag as string,
  });
  const observed = { ...(await repository.read(b.id)), descriptorEtag: null };
  if (operation === "rename")
    await expect(repository.rename(observed, "Renamed")).resolves.toMatchObject({
      title: "Renamed",
    });
  else await expect(repository.remove(observed)).resolves.toBeUndefined();
});

it("cancels oversized read-back streams instead of buffering unbounded text", async () => {
  const { LIMITS } = await import("@jeswr/excalidraw-scene");
  const { repository, storage } = await fixture();
  const b = await repository.create("Bounded");
  const cancel = vi.fn();
  const text = vi.fn(async () => serializeScene(b.scene));
  const read = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementation(async (url, options) => {
    if (url !== b.blob) return read(url, options);
    return {
      ...(await read(url, options)),
      text,
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(LIMITS.bytes + 1));
        },
        cancel,
      }),
    };
  });
  await expect(repository.save({ ...b, etag: null }, emptyScene())).rejects.toMatchObject({
    code: "payload-too-large",
  });
  expect(cancel).toHaveBeenCalled();
  expect(text).not.toHaveBeenCalled();
});

it("keeps created URLs when ETag read-back observes another writer", async () => {
  const { repository, storage } = await fixture();
  const create = storage.create.bind(storage);
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "create").mockImplementation(async (...args) => {
    const result = await create(...args);
    if (args[2]?.contentType === "application/json") {
      await write(result.url, serializeScene(scene()), {
        contentType: "application/json",
        ifMatch: result.etag as string,
      });
      return { ...result, etag: null };
    }
    return result;
  });
  const created = await repository.create("Created once");
  expect(created.etag).toBeNull();
  expect(created.descriptor).not.toBe("");
  expect((await repository.list()).map((b) => b.id)).toEqual([created.id]);
  await expect(repository.save(created, emptyScene())).rejects.toMatchObject({
    code: "precondition-failed",
  });
});

it("deletion drops pending edits on blocked writers and only awaits an in-flight save", async () => {
  const { repository } = await fixture();
  const b = await repository.create("Blocked");
  const save = vi.spyOn(repository, "save").mockRejectedValue(new Error("offline"));
  const writer = new BoardAutosave(repository, b, vi.fn(), 60000);
  writer.update(emptyScene());
  await writer.flush();
  writer.update(scene());
  await expect(writer.finish()).resolves.toEqual(b);
  await writer.retry();
  expect(save).toHaveBeenCalledTimes(1);
});

it.each([
  "var(--surface)",
  "url(https://evil.example/paint)",
])("keeps unsupported canvas backgrounds out of editor styles: %s", async (background) => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { BoardEditor } = await import("../src/apps/whiteboard/components/editor");
  const { repository } = await fixture();
  const board = await repository.create("Background");
  board.scene = { ...board.scene, appState: { viewBackgroundColor: background } };
  const html = renderToStaticMarkup(
    React.createElement(BoardEditor, {
      board,
      repository,
      onBack() {},
      onChange() {},
      retain() {},
      onCopy() {},
      hasDraft: false,
    }),
  );
  expect(html).not.toContain(background);
});

it("collects all of a signed-out owner's draft keys before removing any", async () => {
  const { activateDraftOwner, purgeDraftOwner } = await import("../src/apps/whiteboard/lib/drafts");
  const map = new Map<string, string>();
  let removing = false;
  const storage = {
    get length() {
      return map.size;
    },
    key(i: number) {
      expect(removing).toBe(false);
      return [...map.keys()][i] ?? null;
    },
    getItem: (k: string) => map.get(k) ?? null,
    setItem(k: string, v: string) {
      map.set(k, v);
    },
    removeItem(k: string) {
      removing = true;
      map.delete(k);
    },
  };
  const { repository } = await fixture();
  const b = await repository.create("Retained");
  activateDraftOwner(storage, "alice");
  writeDrafts(storage, "alice", root, [b]);
  writeDrafts(storage, "alice", `${root}other/`, [b]);
  activateDraftOwner(storage, "bob");
  writeDrafts(storage, "bob", root, [b]);
  purgeDraftOwner(storage, "alice");
  expect(readDrafts(storage, "alice", root)).toEqual([]);
  expect(readDrafts(storage, "alice", `${root}other/`)).toEqual([]);
  expect(readDrafts(storage, "bob", root)).toEqual([b]);
});

it("uses no-store at the authenticated fetch seam, including ETag certification reads", async () => {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const fetch = vi.fn(pod.fetch);
  const repo = await openWhiteboards({
    mode: "demo",
    storageUrl: DEMO_ROOT,
    webId: DEMO_WEBID,
    displayName: "Fictional",
    fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  });
  const b = await repo.create("Fresh");
  await repo.save({ ...b, etag: null }, emptyScene());
  expect(fetch).toHaveBeenCalled();
  expect(fetch.mock.calls.every(([, init]) => init?.cache === "no-store")).toBe(true);
});

it("retains created URLs when descriptor certification fails after initialisation", async () => {
  const { repository, storage } = await fixture();
  const write = storage.write.bind(storage);
  vi.spyOn(storage, "write").mockImplementationOnce(async (...args) => {
    const result = await write(...args);
    await write(
      result.url,
      await descriptor(result.url, { sceneDocument: `${root}other`, title: "Concurrent" }),
      {
        contentType: "text/turtle",
        ifMatch: result.etag as string,
      },
    );
    return { ...result, etag: null };
  });
  const b = await repository.create("Local");
  expect(b.descriptorEtag).toBeNull();
  expect(b.descriptor).not.toBe("");
  await expect(repository.rename(b, "Retry")).rejects.toMatchObject({
    code: "precondition-failed",
  });
});

it("discards unsent edits during deletion and does not restart a retired writer", async () => {
  const { repository } = await fixture();
  const b = await repository.create("Delete");
  const gate = Promise.withResolvers<Board>();
  const save = vi.spyOn(repository, "save").mockReturnValueOnce(gate.promise);
  const writer = new BoardAutosave(repository, b, vi.fn(), 60000);
  writer.update(emptyScene());
  const flight = writer.flush();
  writer.update(scene());
  const finish = writer.finish();
  gate.resolve({ ...b, etag: '"committed"' });
  await flight;
  expect((await finish).etag).toBe('"committed"');
  writer.update(scene());
  await writer.retry();
  expect(save).toHaveBeenCalledOnce();
});

// AUTHORED-BY Claude Opus 5.5
it("reports a board whose canvas is missing as damaged, never as deleted", async () => {
  const { repository, storage } = await fixture();
  const damaged = await repository.create("Damaged");
  await storage.delete(damaged.blob, { ifMatch: damaged.etag as string });
  const error = await repository.read(damaged.descriptor).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(StorageError);
  expect((error as Error).message).toBe("This board's canvas is missing from your pod");
  const denied = await repository.create("Denied canvas");
  const read = storage.read.bind(storage);
  vi.spyOn(storage, "read").mockImplementation((url, options) => {
    if (url === denied.blob) throw new StorageError("forbidden", { url, method: "GET" });
    return read(url, options);
  });
  await expect(repository.read(denied.descriptor)).rejects.toMatchObject({ code: "forbidden" });
  await storage.delete(damaged.descriptor, {
    ifMatch: damaged.descriptorEtag as string,
  });
  await expect(repository.read(damaged.descriptor)).rejects.toMatchObject({ code: "not-found" });
});
