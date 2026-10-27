// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { captureDrop, type DropEntry, filesFromPicker, readDrop } from "../src/uploads/drop.js";

const file = (name: string) => new File([name], name, { type: "text/plain" });
const entry = (name: string): DropEntry => ({
  name,
  isFile: true,
  isDirectory: false,
  file: (ok) => ok(file(name)),
});
const directory = (name: string, batches: DropEntry[][]): DropEntry => ({
  name,
  isFile: false,
  isDirectory: true,
  createReader: () => {
    let index = 0;
    return { readEntries: (ok) => ok(batches[index++] ?? []) };
  },
});
describe("folder drops", () => {
  it("bounds discovered children while ancestors still hold unvisited siblings", async () => {
    const read = vi.fn();
    const tree = directory("Root", [
      [directory("Nested", [[{ ...entry("last"), file: read }, entry("other")]]), entry("sibling")],
    ]);
    await expect(readDrop({ entries: [tree], files: [] }, { maxEntries: 4 })).rejects.toMatchObject(
      { code: "limit-exceeded" },
    );
    expect(read).not.toHaveBeenCalled();
  });
  it("applies finite default entry and depth limits", async () => {
    await expect(
      readDrop({ entries: [], files: Array.from({ length: 10_001 }, () => file("many")) }),
    ).rejects.toMatchObject({ code: "limit-exceeded", limit: "maxEntries" });
    let tree = directory("leaf", []);
    for (let depth = 0; depth < 33; depth++) tree = directory("nested", [[tree]]);
    await expect(readDrop({ entries: [tree], files: [] })).rejects.toMatchObject({
      code: "limit-exceeded",
      limit: "maxDepth",
    });
  });
  it.each([
    { maxEntries: -1 },
    { maxDepth: Number.POSITIVE_INFINITY },
    { timeoutMs: 0 },
    { maxEntries: 1.5 },
  ])("rejects invalid bounds %j", async (options) => {
    await expect(readDrop({ entries: [], files: [] }, options)).rejects.toThrow(RangeError);
  });
  it("applies picker limits to files and their deduplicated directories, and honors cancellation", () => {
    const picked = file("notes.txt");
    Object.defineProperty(picked, "webkitRelativePath", { value: "Root/Nested/notes.txt" });
    expect(() => filesFromPicker([picked], { maxDepth: 1 })).toThrow(
      expect.objectContaining({ code: "limit-exceeded", limit: "maxDepth" }),
    );
    expect(() => filesFromPicker([picked], { maxEntries: 2 })).toThrow(
      expect.objectContaining({ code: "limit-exceeded", limit: "maxEntries" }),
    );
    expect(filesFromPicker([picked], { maxEntries: 3 }).directories).toEqual([
      "Root/",
      "Root/Nested/",
    ]);
    const controller = new AbortController();
    controller.abort();
    expect(() => filesFromPicker([], { signal: controller.signal })).toThrow(
      expect.objectContaining({ code: "aborted" }),
    );
  });
  it("bounds the total files and directories before returning any partial upload", async () => {
    const read = vi.fn((ok: (value: File) => void) => ok(file("last")));
    await expect(
      readDrop(
        {
          entries: [directory("Root", [[entry("one"), { ...entry("last"), file: read }]])],
          files: [],
        },
        { maxEntries: 2 },
      ),
    ).rejects.toMatchObject({ code: "limit-exceeded", limit: "maxEntries" });
    expect(read).not.toHaveBeenCalled();
    await expect(
      readDrop({ entries: [], files: [file("one"), file("two")] }, { maxEntries: 1 }),
    ).rejects.toMatchObject({ code: "limit-exceeded" });
  });
  it("bounds directory depth including empty directories", async () => {
    const captured = { entries: [directory("Root", [[directory("Child", [])]])], files: [] };
    await expect(readDrop(captured, { maxDepth: 0 })).rejects.toMatchObject({
      code: "limit-exceeded",
      limit: "maxDepth",
    });
    expect((await readDrop(captured, { maxDepth: 1 })).directories).toEqual([
      "Root/",
      "Root/Child/",
    ]);
  });
  it.each([
    "file",
    "directory",
  ])("aborts a stalled %s callback and ignores late completion", async (kind) => {
    const controller = new AbortController();
    const subsequent = vi.fn();
    let finish = () => {};
    const stalled: DropEntry =
      kind === "file"
        ? {
            ...entry("stalled"),
            file: (ok) => {
              finish = () => ok(file("stalled"));
            },
          }
        : {
            ...directory("stalled", []),
            createReader: () => ({
              readEntries: (ok) => {
                finish = () => ok([{ ...entry("later"), file: subsequent }]);
              },
            }),
          };
    const pending = readDrop({ entries: [stalled], files: [] }, { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ code: "aborted" });
    controller.abort();
    finish();
    await assertion;
    expect(subsequent).not.toHaveBeenCalled();
    await expect(
      readDrop({ entries: [stalled], files: [] }, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
  });
  it("times out a stalled directory reader", async () => {
    vi.useFakeTimers();
    try {
      const pending = readDrop(
        {
          entries: [
            { ...directory("stalled", []), createReader: () => ({ readEntries: () => {} }) },
          ],
          files: [],
        },
        { timeoutMs: 10 },
      );
      const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(10);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
  it("captures two files and a folder, exhausts directory batches and retains empty folders", async () => {
    const entries = [
      entry("one.txt"),
      entry("two.txt"),
      directory("Project", [
        [entry("a.txt")],
        [directory("Empty", []), directory("Nested", [[entry("b.txt")]])],
      ]),
    ];
    const captured = captureDrop(
      entries.map((value) => ({
        kind: "file",
        webkitGetAsEntry: () => value,
        getAsFile: () => null,
      })),
      [],
    );
    const result = await readDrop(captured);
    expect(result.files.map((value) => value.path)).toEqual([
      "one.txt",
      "two.txt",
      "Project/a.txt",
      "Project/Nested/b.txt",
    ]);
    expect(result.directories).toEqual(["Project/", "Project/Empty/", "Project/Nested/"]);
  });
  it("uses fallback APIs and captures File objects before the event expires", async () => {
    const getAsFile = vi.fn(() => file("fallback.txt"));
    const captured = captureDrop(
      [
        { kind: "string", getAsFile },
        { kind: "file", webkitGetAsEntry: () => null, getAsFile },
        { kind: "file", getAsFile: () => null },
      ],
      [],
    );
    getAsFile.mockImplementation(() => {
      throw new Error("event expired");
    });
    expect((await readDrop(captured)).files[0]?.path).toBe("fallback.txt");
    expect((await readDrop(captureDrop([], [file("old-browser.txt")]))).files[0]?.path).toBe(
      "old-browser.txt",
    );
  });
  it("rejects read failures and invalid paths instead of returning a partial upload", async () => {
    await expect(
      readDrop({
        entries: [{ ...entry("x"), file: (_, fail) => fail(new DOMException("denied")) }],
        files: [],
      }),
    ).rejects.toThrow("denied");
    await expect(
      readDrop({
        entries: [
          {
            ...directory("x", []),
            createReader: () => ({ readEntries: (_, fail) => fail(new DOMException("denied")) }),
          },
        ],
        files: [],
      }),
    ).rejects.toThrow("denied");
    for (const name of ["..", ".", "", "a/b", "a\\b", "a\0b"])
      await expect(readDrop({ entries: [entry(name)], files: [] })).rejects.toThrow(
        "Invalid dropped path",
      );
    await expect(
      readDrop({ entries: [{ name: "broken", isFile: false, isDirectory: false }], files: [] }),
    ).rejects.toThrow("Unreadable");
  });
  it("collects directory-picker paths and rejects traversal segments", () => {
    const picked = file("notes.txt");
    Object.defineProperty(picked, "webkitRelativePath", { value: "Project/Notes/notes.txt" });
    expect(filesFromPicker([picked, file("one.txt")])).toMatchObject({
      directories: ["Project/", "Project/Notes/"],
      files: [{ path: "Project/Notes/notes.txt" }, { path: "one.txt" }],
    });
    const bad = file("bad.txt");
    Object.defineProperty(bad, "webkitRelativePath", { value: "../bad.txt" });
    expect(() => filesFromPicker([bad])).toThrow();
  });
});
