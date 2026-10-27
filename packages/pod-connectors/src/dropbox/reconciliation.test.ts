// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { asStore } from "../core/dataset.js";
import { fixtureFetch } from "../core/fixture-fetch.js";
import type { ImportContext } from "../core/types.js";
import { DigitalDocument, PodThing } from "../core/vocab.js";
import { dropboxAdapter } from "./adapter.js";
import type { DropboxEntry } from "./fixtures.js";

const DOC = "https://pod.example/integrations/dropbox/documents/files.ttl";

function file(dataset: Store, id: string, path: string): DigitalDocument {
  const item = new DigitalDocument(`${DOC}#file-id${id}`, dataset, DataFactory).mark();
  item.identifier = `id:${id}`;
  item.name = id;
  item.description = path;
  return item;
}

async function importEntries(entries: DropboxEntry[], existing?: Store) {
  const write = vi.fn<ImportContext["write"]>(async (doc) => ({
    url: DOC,
    category: doc.category,
    forClass: doc.forClass,
  }));
  const outcome = await dropboxAdapter.import({
    api: fixtureFetch("dropbox", [
      {
        method: "POST",
        url: "https://api.dropboxapi.com/2/files/list_folder",
        json: { entries, cursor: "next", has_more: false },
      },
    ]),
    cursor: existing ? "previous" : undefined,
    resolve: () => DOC,
    read: async () => existing,
    write,
    progress: () => {},
  });
  expect(outcome.cursor).toBe("next");
  expect(write).toHaveBeenCalledTimes(1);
  return asStore(write.mock.calls[0][0].dataset);
}

describe("Dropbox delta reconciliation", () => {
  it("removes folder descendants when a file takes the folder path", async () => {
    const existing = new Store();
    file(existing, "child", "/Folder/child.txt");
    file(existing, "nested", "/Folder/nested/child.txt");
    file(existing, "sibling", "/Folder-other/child.txt");
    const dataset = await importEntries(
      [{ ".tag": "file", id: "id:replacement", path_lower: "/folder", name: "replacement" }],
      existing,
    );
    expect(
      dataset
        .getSubjects(null, null, null)
        .map((s) => s.value)
        .sort(),
    ).toEqual([`${DOC}#file-idreplacement`, `${DOC}#file-idsibling`]);
    const replayed = await importEntries([], dataset);
    expect(replayed.size).toBe(dataset.size);
    // A failed import must not corrupt a host-owned read cache.
    expect(existing.getSubjects(null, null, null)).toHaveLength(3);
  });

  it("removes a same-path file for a folder while retaining its children", async () => {
    const existing = new Store();
    file(existing, "old", "/Folder");
    file(existing, "child", "/Folder/child.txt");
    const dataset = await importEntries([{ ".tag": "folder", path_lower: "/folder" }], existing);
    expect(dataset.getSubjects(null, null, null).map((s) => s.value)).toEqual([
      `${DOC}#file-idchild`,
    ]);
    const replayed = await importEntries([], dataset);
    expect(replayed.size).toBe(dataset.size);
  });

  it("keeps indexes current for renamed ids, reused paths and later tombstones", async () => {
    const existing = new Store();
    file(existing, "moving", "/Old.txt").contentSize = "1 KB";
    file(existing, "replaced", "/New.txt");
    const dataset = await importEntries(
      [
        { ".tag": "file", id: "id:moving", path_display: "/New.txt", name: "Moved" },
        { ".tag": "deleted", path_lower: "/old.txt" },
        { ".tag": "file", id: "id:temporary", path_display: "/Temp/nested/file.txt" },
        { ".tag": "deleted", path_lower: "/temp" },
      ],
      existing,
    );
    expect(dataset.getSubjects(null, null, null).map((s) => s.value)).toEqual([
      `${DOC}#file-idmoving`,
    ]);
    const moved = new DigitalDocument(`${DOC}#file-idmoving`, dataset, DataFactory);
    expect(moved.name).toBe("Moved");
    expect(moved.description).toBe("/New.txt");
    expect(moved.contentSize).toBeUndefined();
  });

  it("bounds dataset traversal and path reads when replacing 2,000 records", async () => {
    const count = 2_000;
    const existing = new Store();
    const entries: DropboxEntry[] = Array.from({ length: count }, (_, i) => {
      file(existing, String(i), `/Folder/file-${i}.txt`);
      return {
        ".tag": "file",
        id: `id:${i}`,
        name: "Updated",
        path_lower: `/folder/file-${i}.txt`,
      };
    });
    const iterate = Store.prototype[Symbol.iterator];
    const budget = count * 40;
    let visited = 0;
    const scans = vi.spyOn(Store.prototype, Symbol.iterator).mockImplementation(function* (
      this: Store,
    ) {
      for (const quad of iterate.call(this)) {
        visited += 1;
        if (visited > budget) throw new Error("Dropbox dataset traversal budget exceeded");
        yield quad;
      }
    });
    const paths = vi.spyOn(PodThing.prototype, "description", "get");
    try {
      const dataset = await importEntries(entries, existing);
      expect(visited).toBeLessThanOrEqual(budget);
      expect(paths.mock.calls.length).toBeLessThanOrEqual(count * 2);
      expect(dataset.getSubjects(null, null, null)).toHaveLength(count);
      expect(new DigitalDocument(`${DOC}#file-id0`, dataset, DataFactory).name).toBe("Updated");
    } finally {
      scans.mockRestore();
      paths.mockRestore();
    }
  });
});
