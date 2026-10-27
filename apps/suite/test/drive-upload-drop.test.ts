// AUTHORED-BY Claude Opus 5.5

import { describe, expect, it } from "vitest";
import { readDrop } from "../src/apps/drive/state/dropped-files";
import { targetFolder } from "../src/apps/drive/state/uploads";

const text = (name: string) => new File(["x"], name, { type: "text/plain" });

function fileEntry(file: File, fail = false): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name: file.name,
    file: (ok: (file: File) => void, error?: (reason: DOMException) => void) =>
      fail ? error?.(new DOMException("gone", "NotFoundError")) : ok(file),
  } as unknown as FileSystemFileEntry;
}

/** Hands out `children` one per readEntries call, as Chromium does in batches. */
function folderEntry(name: string, children: FileSystemEntry[]): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let next = 0;
      return {
        readEntries: (ok: (entries: FileSystemEntry[]) => void) => ok(children.slice(next, ++next)),
      };
    },
  } as unknown as FileSystemDirectoryEntry;
}

type Item = { entry?: FileSystemEntry | null; file?: File | null; kind?: string };
function transfer(items: Item[] | undefined, files: File[] = []): DataTransfer {
  return {
    items: items?.map(({ entry, file, kind = "file" }) => ({
      kind,
      webkitGetAsEntry: entry === undefined ? undefined : () => entry,
      getAsFile: () => file ?? null,
    })),
    files,
  } as unknown as DataTransfer;
}

describe("readDrop", () => {
  it("walks dropped folders, keeping each file's path inside the drop", async () => {
    const a = text("a.txt");
    const b = text("b.txt");
    const loose = text("loose.txt");
    const reports = folderEntry("Reports", [
      fileEntry(a),
      folderEntry("q3", [fileEntry(b)]),
      folderEntry("empty", []),
    ]);
    const dropped = await readDrop(
      transfer([{ entry: reports }, { entry: null, file: loose }, { kind: "string" }]),
    );
    expect(dropped).toEqual([
      { file: a, path: "Reports/a.txt" },
      { file: b, path: "Reports/q3/b.txt" },
      { file: loose, path: "loose.txt" },
    ]);
  });

  it("uploads the flat file list when nothing dropped is a folder", async () => {
    const a = text("a.txt");
    expect(await readDrop(transfer([{ entry: fileEntry(a) }], [a]))).toEqual([
      { file: a, path: "a.txt" },
    ]);
    // Browsers without DataTransfer items or entries, and items without a file.
    expect(await readDrop(transfer(undefined, [a]))).toEqual([{ file: a, path: "a.txt" }]);
    expect(await readDrop(transfer([{ file: a }, { file: null }], [a]))).toEqual([
      { file: a, path: "a.txt" },
    ]);
  });

  it("rejects when a dropped folder's file can no longer be read", async () => {
    const drop = transfer([{ entry: folderEntry("Gone", [fileEntry(text("a.txt"), true)]) }]);
    await expect(readDrop(drop)).rejects.toThrow("gone");
  });
});

describe("targetFolder", () => {
  it("places dropped and picked files in their nested folders", () => {
    const root = "https://pod.example/drive/";
    expect(targetFolder(root, { file: text("b.txt"), path: "My Reports/q3/b.txt" })).toBe(
      `${root}My%20Reports/q3/`,
    );
    expect(targetFolder(root, { file: text("a.txt"), path: "a.txt" })).toBe(root);
    expect(targetFolder(root, text("a.txt"))).toBe(root);
  });
});
