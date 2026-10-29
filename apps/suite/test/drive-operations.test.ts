// AUTHORED-BY Codex
import { DataFactory, Parser, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSolidDriveClient,
  type DriveClient,
  DriveError,
  parentOf,
} from "../src/apps/drive/lib/client/client";
import {
  childUrl,
  contentTypeFor,
  copyItem,
  createFolder,
  deleteForever,
  extensionChange,
  isHidden,
  listTrash,
  measureUsage,
  moveItems,
  purgeExpired,
  recentFiles,
  renameItem,
  restoreItems,
  searchByName,
  trashFolderOf,
  trashItems,
  uploadFile,
  validateName,
} from "../src/apps/drive/lib/operations/operations";
import {
  addTrashRecord,
  emptyTrashIndex,
  serializeTrashIndex,
  type TrashEntry,
} from "../src/apps/drive/lib/operations/trash-index";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

const NOW = Date.UTC(2026, 9, 26, 12);
const DAY = 86_400_000;
const DRIVE = `${DEMO_ROOT}drive/`;
const INDEX = `${DRIVE}.trash/index.ttl`;
const NOTES = `${DRIVE}notes.md`;

async function setup() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW), now: () => NOW });
  // Every operation request goes through this spy, including recursive client moves.
  const fetch = vi.fn<typeof globalThis.fetch>(pod.fetch);
  const client = createSolidDriveClient({ storageUrl: DEMO_ROOT, fetch });
  return { pod, client, fetch };
}

function puts(fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>) {
  return fetch.mock.calls.filter(([, init]) => init?.method === "PUT");
}

function expectConditionalWrites(fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>) {
  const writes = fetch.mock.calls.filter(([, init]) =>
    ["PUT", "PATCH", "POST"].includes(init?.method ?? "GET"),
  );
  expect(writes.length).toBeGreaterThan(0);
  for (const [, init] of writes) {
    const headers = new Headers(init?.headers);
    expect(headers.has("if-match") || headers.has("if-none-match")).toBe(true);
  }
}

async function item(client: DriveClient, url = NOTES) {
  return client.stat(url);
}

async function trashOne(client: DriveClient, url = NOTES, at = NOW) {
  const result = await trashItems(client, DRIVE, [await item(client, url)], {
    now: new Date(at),
    webId: DEMO_WEBID,
  });
  expect(result.failed).toEqual([]);
  expect(result.done).toHaveLength(1);
  return result.done[0] as TrashEntry;
}

afterEach(() => vi.restoreAllMocks());

describe("Drive usage", () => {
  it("sums file bytes recursively, including hidden files and app-managed trash", async () => {
    const { pod, client } = await setup();
    await uploadFile(client, DRIVE, new Blob(["secret"]), ".hidden");
    await trashOne(client);
    const expected = pod
      .snapshot()
      .resources.filter(([url]) => url.startsWith(DRIVE))
      .reduce((sum, [, resource]) => sum + resource.body.byteLength, 0);
    expect(expected).toBeGreaterThan(0);
    expect(await measureUsage(client, DRIVE)).toBe(expected);
    expect(await measureUsage(client, `${DRIVE}Archive/`)).toBe(0);
  });

  it("rejects unavailable listings and counts missing sizes as zero", async () => {
    const { client } = await setup();
    const list = vi.spyOn(client, "list").mockImplementation(async (url) => {
      if (url !== DRIVE) throw new Error("unreadable folder");
      return [
        { url: `${DRIVE}bad/`, name: "bad", kind: "folder", size: 999 },
        { url: NOTES, name: "notes.md", kind: "file", size: 12 },
        { url: `${DRIVE}unknown`, name: "unknown", kind: "file" },
        { url: `${DRIVE}empty`, name: "empty", kind: "file", size: 0 },
      ];
    });
    await expect(measureUsage(client, DRIVE)).rejects.toThrow("unreadable folder");
    expect(list.mock.calls.map(([url]) => url)).toEqual([DRIVE, `${DRIVE}bad/`]);
    await expect(measureUsage(client, `${DRIVE}bad/`)).rejects.toThrow("unreadable folder");
    list.mockResolvedValue([
      { url: NOTES, name: "notes.md", kind: "file", size: 12 },
      { url: `${DRIVE}unknown`, name: "unknown", kind: "file" },
      { url: `${DRIVE}empty`, name: "empty", kind: "file", size: 0 },
    ]);
    expect(await measureUsage(client, DRIVE)).toBe(12);
  });

  it("never visits more than the container budget, even across batches of eight", async () => {
    const { client } = await setup();
    const folders = Array.from({ length: 12 }, (_, i) => `${DRIVE}${i}/`);
    const list = vi
      .spyOn(client, "list")
      .mockImplementation(async (url) =>
        url === DRIVE
          ? folders.map((url) => ({ url, name: "folder", kind: "folder" as const }))
          : [{ url: `${url}file`, name: "file", kind: "file", size: 1 }],
      );
    expect(await measureUsage(client, DRIVE, { maxContainers: 10 })).toBe(9);
    expect(list.mock.calls.map(([url]) => url)).toEqual([DRIVE, ...folders.slice(0, 9)]);
    list.mockClear();
    expect(await measureUsage(client, DRIVE, { maxContainers: 0 })).toBe(0);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("Drive names and media types", () => {
  it.each([
    ["Report.pdf", "Report.PDF", undefined],
    ["archive.tar.gz", "archive.tar.zip", { from: "gz", to: "zip" }],
    ["README", "readme.txt", { from: "", to: "txt" }],
    ["notes.md", "notes", { from: "md", to: "" }],
    [".hidden", ".other", undefined],
    ["trailing.", "README", undefined],
  ])("detects extension changes from %s to %s", (oldName, newName, expected) => {
    expect(extensionChange(oldName, newName)).toEqual(expected);
  });

  it.each([
    ["", "Enter a name"],
    ["  ", "Enter a name"],
    ["a/b", "Names can't contain /"],
    ["a".repeat(181), "Use 180 characters or fewer"],
    [".", "Choose another name"],
    [" .. ", "Choose another name"],
    ["💡".repeat(180), undefined],
    [" report.pdf ", undefined],
  ])("validates %s", (name, expected) => expect(validateName(name)).toBe(expected));

  it("encodes child names, identifies dot names, and uses declared or inferred media types", () => {
    expect(childUrl(DRIVE, "Budget 2026.csv")).toBe(`${DRIVE}Budget%202026.csv`);
    expect(childUrl(DRIVE, "Café 💡", true)).toBe(`${DRIVE}Caf%C3%A9%20%F0%9F%92%A1/`);
    expect(trashFolderOf(DRIVE)).toBe(`${DRIVE}.trash/`);
    expect(isHidden({ name: ".acl" })).toBe(true);
    expect(isHidden({ name: "visible" })).toBe(false);
    expect(contentTypeFor("notes.md", "text/custom")).toBe("text/custom");
    expect(contentTypeFor("notes.md", "application/octet-stream")).toBe("text/markdown");
    expect(contentTypeFor("photo.png", "")).toBe("image/png");
    expect(contentTypeFor("unknown")).toBe("application/octet-stream");
  });
});

describe("Drive writes against the demo pod", () => {
  it("fails on an existing name, keeps both with successive names, and skips without a write", async () => {
    const { pod, client, fetch } = await setup();
    const original = await (await client.read(NOTES)).text();
    const blob = new Blob(["new notes"], { type: "application/octet-stream" });
    await expect(uploadFile(client, DRIVE, blob, "notes.md")).rejects.toMatchObject({
      kind: "conflict",
      status: 412,
      url: NOTES,
    });
    for (const number of [1, 2]) {
      const result = await uploadFile(client, DRIVE, blob, "notes.md", "keep-both");
      expect(result).toMatchObject({
        url: childUrl(DRIVE, `notes (${number}).md`),
        name: `notes (${number}).md`,
        contentType: "text/markdown",
        kind: "file",
        size: blob.size,
        modified: expect.any(Date),
      });
      expect(await (await client.read(result?.url as string)).text()).toBe("new notes");
    }
    expect(await (await client.read(NOTES)).text()).toBe(original);
    expectConditionalWrites(fetch);
    const before = pod.snapshot();
    fetch.mockClear();
    expect(await uploadFile(client, DRIVE, blob, "notes.md", "skip")).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(pod.snapshot()).toEqual(before);
    expect(await uploadFile(client, DRIVE, new Blob(["fresh"]), "fresh.txt")).toMatchObject({
      url: `${DRIVE}fresh.txt`,
      contentType: "text/plain",
    });
    expectConditionalWrites(fetch);
  });

  it("replaces with the approved ETag and creates absent files without a replacement decision", async () => {
    const { client, fetch } = await setup();
    const approved = await client.stat(NOTES);
    fetch.mockClear();
    expect(
      await uploadFile(
        client,
        DRIVE,
        new Blob(["replacement"], { type: "text/custom" }),
        "notes.md",
        "replace",
        approved,
      ),
    ).toMatchObject({ url: NOTES, contentType: "text/custom" });
    expect(await (await client.read(NOTES)).text()).toBe("replacement");
    expect(new Headers(puts(fetch)[0]?.[1]?.headers).get("if-match")).toBe(approved.etag);
    expect(await uploadFile(client, DRIVE, new Blob(["new"]), "new.png")).toMatchObject({
      url: `${DRIVE}new.png`,
      contentType: "image/png",
    });
    expect(new Headers(puts(fetch)[1]?.[1]?.headers).get("if-none-match")).toBe("*");
    expectConditionalWrites(fetch);
  });

  it("creates normalized folders and renames files and whole folder trees", async () => {
    const { pod, client, fetch } = await setup();
    const url = await createFolder(client, DRIVE, "  New folder  ");
    expect(url).toBe(`${DRIVE}New%20folder/`);
    expect(await client.list(url)).toEqual([]);
    const notes = await item(client);
    const before = fetch.mock.calls.length;
    expect(await renameItem(client, notes, " notes.md ")).toBe(NOTES);
    expect(
      await renameItem(client, { url: DEMO_ROOT, kind: "folder", name: "root" }, "renamed"),
    ).toBe(DEMO_ROOT);
    expect(fetch.mock.calls).toHaveLength(before);
    const body = await (await client.read(NOTES)).text();
    expect(await renameItem(client, notes, "Memo.md")).toBe(`${DRIVE}Memo.md`);
    expect(pod.has(NOTES)).toBe(false);
    expect(await (await client.read(`${DRIVE}Memo.md`)).text()).toBe(body);
    const work = await item(client, `${DRIVE}Work/`);
    expect(await renameItem(client, work, "Projects")).toBe(`${DRIVE}Projects/`);
    expect(pod.has(`${DRIVE}Work/`)).toBe(false);
    expect((await client.list(`${DRIVE}Projects/`)).map((entry) => entry.name)).toEqual([
      "Budget 2026.csv",
      "Report.pdf",
    ]);
    expectConditionalWrites(fetch);
  });

  it("skips same-parent moves, reports unsafe folders and continues with other items", async () => {
    const { pod, client, fetch } = await setup();
    expect(await moveItems(client, [NOTES], DRIVE)).toEqual({ done: [], failed: [] });
    expect(fetch).not.toHaveBeenCalled();
    for (const target of [`${DRIVE}Work/`, `${DRIVE}Work/Nested/`]) {
      const result = await moveItems(client, [`${DRIVE}Work/`, NOTES], target);
      expect(result.failed).toEqual([
        { url: `${DRIVE}Work/`, error: new DriveError("conflict", 409, target) },
      ]);
      expect(result.done).toEqual([
        {
          from: NOTES,
          to: `${target}notes.md`,
          identity: { url: `${target}notes.md`, etag: expect.any(String) },
        },
      ]);
      expect(pod.has(NOTES)).toBe(false);
      expect(pod.has(`${target}notes.md`)).toBe(true);
      await client.move(`${target}notes.md`, NOTES, { kind: "confirm-move" });
    }
    const moved = await moveItems(client, [`${DRIVE}Photos/`], `${DRIVE}Archive/`);
    expect(moved).toEqual({
      done: [
        {
          from: `${DRIVE}Photos/`,
          to: `${DRIVE}Archive/Photos/`,
          identity: {
            url: `${DRIVE}Archive/Photos/`,
            etag: expect.any(String),
            children: [`${DRIVE}Archive/Photos/hills.png`, `${DRIVE}Archive/Photos/sunset.png`],
            tree: [
              {
                url: `${DRIVE}Archive/Photos/`,
                etag: expect.any(String),
                children: [`${DRIVE}Archive/Photos/hills.png`, `${DRIVE}Archive/Photos/sunset.png`],
              },
              { url: `${DRIVE}Archive/Photos/hills.png`, etag: expect.any(String) },
              { url: `${DRIVE}Archive/Photos/sunset.png`, etag: expect.any(String) },
            ],
          },
        },
      ],
      failed: [],
    });
    expect(pod.has(`${DRIVE}Archive/Photos/sunset.png`)).toBe(true);
    expectConditionalWrites(fetch);
  });

  it("copies next to the original using Copy of and collision suffixes", async () => {
    const { client, fetch } = await setup();
    const original = await (await client.read(NOTES)).text();
    for (const name of ["Copy of notes.md", "Copy of notes (1).md"]) {
      const url = await copyItem(client, NOTES);
      expect(url).toBe(childUrl(DRIVE, name));
      expect(await (await client.read(url)).text()).toBe(original);
      expect(await client.stat(url)).toMatchObject({ contentType: "text/markdown" });
    }
    expect(await (await client.read(NOTES)).text()).toBe(original);
    expectConditionalWrites(fetch);
  });

  it("retries racing keep-both names, stops after five conflicts, and propagates other errors", async () => {
    const { client } = await setup();
    const approved = await client.stat(NOTES);
    const write = vi.spyOn(client, "write");
    write.mockRejectedValueOnce(new DriveError("conflict", 412, NOTES));
    expect(
      await uploadFile(client, DRIVE, new Blob(["raced"]), "notes.md", "keep-both"),
    ).toMatchObject({ name: "notes (2).md" });
    expect(write.mock.calls.slice(0, 2).map(([url]) => url)).toEqual([
      childUrl(DRIVE, "notes (1).md"),
      childUrl(DRIVE, "notes (2).md"),
    ]);
    write.mockClear().mockRejectedValue(new DriveError("conflict", 412, NOTES));
    await expect(uploadFile(client, DRIVE, new Blob(), "notes.md", "keep-both")).rejects.toEqual(
      new DriveError("conflict", 412, NOTES),
    );
    expect(write).toHaveBeenCalledTimes(5);
    for (const error of [new Error("offline"), new DriveError("forbidden", 403, NOTES)]) {
      write.mockClear().mockRejectedValue(error);
      await expect(uploadFile(client, DRIVE, new Blob(), "notes.md", "keep-both")).rejects.toBe(
        error,
      );
      expect(write).toHaveBeenCalledTimes(1);
      vi.spyOn(client, "stat").mockRejectedValue(error);
      await expect(
        uploadFile(client, DRIVE, new Blob(), "notes.md", "replace", approved),
      ).rejects.toBe(error);
      expect(write).toHaveBeenCalledTimes(2);
    }
  });
});

describe("app-managed trash against the demo pod", () => {
  it("moves to UUID slots, stores PROV metadata, lists newest first and skips malformed dates", async () => {
    const { pod, client, fetch } = await setup();
    expect(await listTrash(client, DRIVE)).toEqual([]);
    const original = await item(client);
    const first = await trashOne(client, NOTES, NOW - DAY);
    const second = await trashOne(client, `${DRIVE}Work/Report.pdf`, NOW);
    expect(first.url).toMatch(
      new RegExp(`^${DRIVE.replaceAll(".", "\\.")}\\.trash/[0-9a-f-]{36}/notes\\.md$`),
    );
    expect(pod.has(NOTES)).toBe(false);
    expect(pod.has(first.url)).toBe(true);
    expect(first).toEqual({
      url: first.url,
      etag: expect.any(String),
      original: NOTES,
      trashedAt: new Date(NOW - DAY),
      trashedBy: DEMO_WEBID,
      name: "notes.md",
      contentType: original.contentType,
      size: original.size,
    });
    const graph = new Store(new Parser().parse(await (await client.read(INDEX)).text()));
    const object = (subject: string, predicate: string) =>
      graph.getObjects(DataFactory.namedNode(subject), DataFactory.namedNode(predicate), null);
    const prov = "http://www.w3.org/ns/prov#";
    expect(
      graph.getSubjects(
        DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
        DataFactory.namedNode(`${prov}Entity`),
        null,
      ),
    ).toHaveLength(2);
    expect(object(first.url, `${prov}wasDerivedFrom`)).toEqual([DataFactory.namedNode(NOTES)]);
    expect(object(first.url, `${prov}wasAttributedTo`)).toEqual([
      DataFactory.namedNode(DEMO_WEBID),
    ]);
    expect(object(first.url, `${prov}invalidatedAtTime`)[0]?.value).toBe(
      new Date(NOW - DAY).toISOString(),
    );
    expect(object(first.url, "http://purl.org/dc/terms/title")[0]?.value).toBe("notes.md");
    expect(object(first.url, "http://purl.org/dc/terms/format")[0]?.value).toBe("text/markdown");
    expect(Number(object(first.url, "http://www.w3.org/ns/posix/stat#size")[0]?.value)).toBe(
      original.size,
    );
    expect(await listTrash(client, DRIVE)).toEqual([second, first]);
    const text = await (await client.read(INDEX)).text();
    const etag = (await client.stat(INDEX)).etag as string;
    await client.write(
      INDEX,
      `${text}\n<urn:bad> a <${prov}Entity>; <${prov}wasDerivedFrom> <${NOTES}>; <${prov}invalidatedAtTime> "not-a-date"^^<http://www.w3.org/2001/XMLSchema#dateTime>.`,
      { contentType: "text/turtle", ifMatch: etag },
      { kind: "protect-ancestors" },
    );
    expect(await listTrash(client, DRIVE)).toEqual([second, first]);
    expectConditionalWrites(fetch);
  });

  it("trashes folders recursively and omits unavailable metadata using the default timestamp", async () => {
    const { pod, client, fetch } = await setup();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const result = await trashItems(client, DRIVE, [
        { url: `${DRIVE}Work/`, name: "Work", kind: "folder" },
      ]);
      expect(result.failed).toEqual([]);
      const entry = result.done[0] as TrashEntry;
      expect(entry).toEqual({
        url: entry.url,
        etag: expect.any(String),
        original: `${DRIVE}Work/`,
        name: "Work",
        trashedAt: new Date(NOW),
      });
      expect(entry.url.endsWith("/Work/")).toBe(true);
      expect(pod.has(`${entry.url}Report.pdf`)).toBe(true);
      expect(await listTrash(client, DRIVE)).toEqual([entry]);
      expectConditionalWrites(fetch);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores files, recreates deleted parents, and removes slots and records", async () => {
    const { pod, client, fetch } = await setup();
    const entry = await trashOne(client, `${DRIVE}Work/Report.pdf`);
    await client.remove(`${DRIVE}Work/`, { recursive: true });
    const result = await restoreItems(client, DRIVE, [entry]);
    expect(result).toEqual({ done: [{ entry, url: entry.original, renamed: false }], failed: [] });
    expect(pod.has(entry.original)).toBe(true);
    expect(pod.has(parentOf(entry.url) as string)).toBe(false);
    expect(await listTrash(client, DRIVE)).toEqual([]);
    expectConditionalWrites(fetch);
  });

  it.each([
    "notes.md",
    "README",
    "Archive",
  ])("restores a colliding %s with the restored suffix", async (name) => {
    const { pod, client, fetch } = await setup();
    const folder = name === "Archive";
    const url = childUrl(DRIVE, name, folder);
    if (name === "README") await uploadFile(client, DRIVE, new Blob(["readme"]), name);
    const entry = await trashOne(client, url);
    if (folder) await createFolder(client, DRIVE, name);
    else await uploadFile(client, DRIVE, new Blob(["new original"]), name);
    const restored = name === "notes.md" ? "notes (restored).md" : `${name} (restored)`;
    expect(await restoreItems(client, DRIVE, [entry])).toEqual({
      done: [{ entry, url: childUrl(DRIVE, restored, folder), renamed: true }],
      failed: [],
    });
    expect(pod.has(url)).toBe(true);
    expect(pod.has(childUrl(DRIVE, restored, folder))).toBe(true);
    expect(pod.has(parentOf(entry.url) as string)).toBe(false);
    expect(await listTrash(client, DRIVE)).toEqual([]);
    expectConditionalWrites(fetch);
  });

  it("deletes folder slots recursively and treats missing slots as already done", async () => {
    const { pod, client, fetch } = await setup();
    const work = await trashOne(client, `${DRIVE}Work/`);
    const notes = await trashOne(client);
    await client.remove(parentOf(notes.url) as string, { recursive: true });
    expect(await deleteForever(client, DRIVE, [work, notes])).toEqual({
      done: [work, notes],
      failed: [],
    });
    expect(pod.has(work.url)).toBe(false);
    expect(pod.has(`${work.url}Report.pdf`)).toBe(false);
    expect(pod.has(parentOf(work.url) as string)).toBe(false);
    expect(await listTrash(client, DRIVE)).toEqual([]);
    expectConditionalWrites(fetch);
  });

  it("purges only older-than-30-day entries up to the limit, keeping the exact boundary", async () => {
    const { pod, client } = await setup();
    const oldest = await trashOne(client, NOTES, NOW - 32 * DAY);
    const old = await trashOne(client, `${DRIVE}data.ttl`, NOW - 31 * DAY);
    const boundary = await trashOne(client, `${DRIVE}Photos/hills.png`, NOW - 30 * DAY);
    expect(await purgeExpired(client, DRIVE, { now: new Date(NOW), limit: 1 })).toEqual({
      done: [old],
      failed: [],
    });
    expect(pod.has(oldest.url)).toBe(true);
    expect(pod.has(boundary.url)).toBe(true);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      expect(await purgeExpired(client, DRIVE)).toEqual({ done: [oldest], failed: [] });
      expect(await purgeExpired(client, DRIVE)).toEqual({ done: [], failed: [] });
      expect(await purgeExpired(client, DRIVE, { now: new Date(NOW), days: 29, limit: 2 })).toEqual(
        { done: [boundary], failed: [] },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    new Error("offline"),
    new DriveError("forbidden", 403, NOTES),
  ])("collects batch failures while retaining durable pending intents (%s)", async (error) => {
    const { client } = await setup();
    const notes = await item(client);
    const move = vi.spyOn(client, "move").mockRejectedValue(error);
    const write = vi.spyOn(client, "write");
    expect(await trashItems(client, DRIVE, [notes])).toEqual({
      done: [],
      failed: [{ url: NOTES, error }],
    });
    const entry: TrashEntry = {
      url: `${DRIVE}.trash/00000000-0000-0000-0000-000000000000/notes.md`,
      original: NOTES,
      name: "notes.md",
      trashedAt: new Date(NOW),
    };
    const index = emptyTrashIndex();
    addTrashRecord(index, entry);
    await client.write(
      INDEX,
      await serializeTrashIndex(index),
      { contentType: "text/turtle" },
      { kind: "protect-ancestors" },
    );
    vi.spyOn(client, "stat").mockRejectedValue(error);
    expect(await restoreItems(client, DRIVE, [entry])).toEqual({
      done: [],
      failed: [{ url: entry.url, error }],
    });
    expect(move).toHaveBeenCalledTimes(1);
    vi.spyOn(client, "remove").mockRejectedValue(error);
    expect(await deleteForever(client, DRIVE, [entry])).toEqual({
      done: [],
      failed: [{ url: entry.url, error }],
    });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("continues after a missing trash source and ignores failure to remove an empty restored slot", async () => {
    const { client } = await setup();
    const result = await trashItems(client, DRIVE, [
      { url: `${DRIVE}missing`, name: "missing", kind: "file" },
      await item(client),
    ]);
    expect(result.done).toHaveLength(1);
    expect(result.failed).toEqual([
      { url: `${DRIVE}missing`, error: expect.objectContaining({ kind: "not-found" }) },
    ]);
    const entry = result.done[0] as TrashEntry;
    const remove = client.remove.bind(client);
    vi.spyOn(client, "remove").mockImplementation((url, options) =>
      url === parentOf(entry.url)
        ? Promise.reject(new Error("slot cleanup failed"))
        : remove(url, options),
    );
    expect(await restoreItems(client, DRIVE, [entry])).toEqual({
      done: [{ entry, url: NOTES, renamed: false }],
      failed: [],
    });
    expect(await listTrash(client, DRIVE)).toEqual([]);
  });

  it.each([
    false,
    true,
  ])("retries one real concurrent index update and preserves it (second conflict: %s)", async (twice) => {
    const { pod } = await setup();
    const concurrent: TrashEntry = {
      url: `${DRIVE}.trash/00000000-0000-0000-0000-000000000001/file`,
      original: `${DRIVE}other`,
      name: "other",
      trashedAt: new Date(NOW - DAY),
    };
    await pod.fetch(concurrent.url, { method: "PUT", body: "concurrent file" });
    let writes = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input) === INDEX && init?.method === "PUT") {
        writes += 1;
        if (writes === 1 || twice) {
          const index = emptyTrashIndex();
          addTrashRecord(index, concurrent);
          const head = await pod.fetch(INDEX, { method: "HEAD" });
          await pod.fetch(INDEX, {
            method: "PUT",
            headers: {
              "content-type": "text/turtle",
              ...(head.ok
                ? { "if-match": head.headers.get("etag") as string }
                : { "if-none-match": "*" }),
            },
            body: await serializeTrashIndex(index),
          });
        }
      }
      return pod.fetch(input, init);
    });
    const client = createSolidDriveClient({ storageUrl: DEMO_ROOT, fetch });
    const operation = trashItems(client, DRIVE, [await item(client)], { now: new Date(NOW) });
    if (twice)
      await expect(operation).resolves.toMatchObject({
        done: [],
        failed: [{ url: NOTES, error: { kind: "conflict", status: 412, url: INDEX } }],
        warnings: [{ kind: "trash-index-persistence" }],
      });
    else {
      const result = await operation;
      expect(await listTrash(client, DRIVE)).toEqual([
        result.done[0],
        { ...concurrent, etag: (await client.stat(concurrent.url)).etag },
      ]);
    }
    expect(writes).toBe(twice ? 2 : 3);
    expectConditionalWrites(fetch);
  });

  it("does not retry a non-conflict index write error", async () => {
    const { client } = await setup();
    const error = new Error("offline index");
    const write = vi.spyOn(client, "write").mockRejectedValue(error);
    await expect(trashItems(client, DRIVE, [await item(client)])).resolves.toMatchObject({
      done: [],
      failed: [{ url: NOTES, error }],
      warnings: [{ kind: "trash-index-persistence" }],
    });
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("recent files and name search", () => {
  it("scans the real tree newest first with limits, depth/container bounds, hidden filtering and duplicates", async () => {
    const { client } = await setup();
    await uploadFile(client, DRIVE, new Blob(["hidden"]), ".secret.md");
    await uploadFile(client, `${DRIVE}.hidden/`, new Blob(["hidden"]), "inside.md");
    const all = await recentFiles(client, [DRIVE]);
    expect(all.map((entry) => entry.name)).toEqual([
      "sunset.png",
      "notes.md",
      "Report.pdf",
      "Budget 2026.csv",
      "data.ttl",
      "hills.png",
    ]);
    expect(all.find((entry) => entry.name === "Report.pdf")?.folder).toBe(`${DRIVE}Work/`);
    expect(await recentFiles(client, [DRIVE], { limit: 2 })).toEqual(all.slice(0, 2));
    expect(
      (await recentFiles(client, [DRIVE], { maxDepth: 0 })).map((entry) => entry.name),
    ).toEqual(["notes.md", "data.ttl"]);
    expect(
      (await recentFiles(client, [DRIVE], { maxContainers: 1, concurrency: 1 })).map(
        (entry) => entry.name,
      ),
    ).toEqual(["notes.md", "data.ttl"]);
    expect(await recentFiles(client, [DRIVE, DRIVE])).toEqual(all);
    expect(await recentFiles(client, [], { maxContainers: 0 })).toEqual([]);
  });

  it("searches case-insensitively across files and folders, ignores hidden names and honors limits", async () => {
    const { client } = await setup();
    await uploadFile(client, DRIVE, new Blob(), ".notes.md");
    await uploadFile(client, `${DRIVE}.notes/`, new Blob(), "notes.md");
    expect((await searchByName(client, DRIVE, "  nOtEs  ")).map((entry) => entry.url)).toEqual([
      NOTES,
    ]);
    expect((await searchByName(client, DRIVE, "WORK")).map((entry) => entry.url)).toEqual([
      `${DRIVE}Work/`,
    ]);
    const all = await searchByName(client, DRIVE, ".");
    expect(all).toHaveLength(6);
    expect(await searchByName(client, DRIVE, ".", { limit: 2 })).toEqual(all.slice(0, 2));
    const list = vi.spyOn(client, "list");
    expect(await searchByName(client, DRIVE, "  ")).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it("rejects failing listings and skips files without modified metadata", async () => {
    const { client } = await setup();
    const list = client.list.bind(client);
    let failing = true;
    vi.spyOn(client, "list").mockImplementation(async (url) => {
      if (failing && url === `${DRIVE}Work/`) throw new Error("unreadable folder");
      return (await list(url)).map((entry) => {
        if (entry.url !== NOTES) return entry;
        const { modified: _modified, ...withoutDate } = entry;
        return withoutDate;
      });
    });
    await expect(recentFiles(client, [DRIVE])).rejects.toThrow("unreadable folder");
    await expect(searchByName(client, DRIVE, ".")).rejects.toThrow("unreadable folder");
    failing = false;
    expect((await recentFiles(client, [DRIVE])).some((entry) => entry.url === NOTES)).toBe(false);
    expect((await searchByName(client, DRIVE, ".")).some((entry) => entry.url === NOTES)).toBe(
      true,
    );
  });
});
