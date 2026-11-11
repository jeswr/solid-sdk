// AUTHORED-BY Codex (GPT-6.1 Sol)
import { addElement, emptyScene, rectangle, serializeScene, text } from "@jeswr/excalidraw-scene";
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
    await expect(repository.save({ ...next, etag: null }, scene())).rejects.toThrow("safe version");
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
    expect(b.etag).toBe(null);
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
    vi.spyOn(repository, "read").mockResolvedValue({} as Board);
    await expect(repository.list()).rejects.toThrow("100 boards");
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
    const k = [...map.keys()][0] as string;
    const raw = JSON.parse(map.get(k) as string);
    raw.owner = "other";
    map.set(k, JSON.stringify(raw));
    expect(readDrafts(storage, "me", root)).toEqual([]);
    map.set(k, "broken");
    expect(readDrafts(storage, "me", root)).toEqual([]);
    writeDrafts(storage, "me", root, []);
    expect(map.size).toBe(0);
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
