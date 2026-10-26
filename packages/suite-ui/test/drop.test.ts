// AUTHORED-BY Codex GPT-6.1-Sol
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
