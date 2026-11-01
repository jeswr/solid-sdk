// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  type DroppedEntry,
  diffFolderTree,
  type ExistingEntry,
  encodeUploadPath,
  planUploads,
  type UploadPlanInput,
  UploadPlanningError,
} from "../src/apps/drive/lib/upload";

const destination = "https://pod.example.org/drive/";
const file = (path: string[], size = 5): DroppedEntry => ({ kind: "file", path, size });
const folder = (path: string[]): DroppedEntry => ({ kind: "folder", path });
const remote = (path: string[], etag?: string): ExistingEntry => ({
  kind: "file",
  path,
  ...(etag === undefined ? {} : { etag }),
});
function input(overrides: Partial<UploadPlanInput> = {}): UploadPlanInput {
  return {
    targetContainer: destination,
    entries: [],
    existing: [],
    policy: "keep-both",
    chunkSize: 4,
    ...overrides,
  };
}
function invalid(overrides: Record<string, unknown>): () => unknown {
  return () => planUploads({ ...input(), ...overrides } as unknown as UploadPlanInput);
}

describe("pure upload plans", () => {
  it("plans an empty drop and a single new file with a create precondition", () => {
    expect(planUploads(input())).toEqual({ folders: [], files: [] });
    expect(planUploads(input({ entries: [file(["notes.md"])] }))).toEqual({
      folders: [],
      files: [
        {
          sourcePath: ["notes.md"],
          path: ["notes.md"],
          targetPath: "notes.md",
          targetUrl: `${destination}notes.md`,
          size: 5,
          chunks: [
            { index: 0, start: 0, end: 4 },
            { index: 1, start: 4, end: 5 },
          ],
          operation: { action: "create", ifNoneMatch: "*" },
        },
      ],
    });
  });

  it("plans normalized folder drops depth-first, including empty and implicit folders", () => {
    const entries = [
      file(["Z", "z.txt"]),
      file(["A", "Sub:folder", "Résumé #1.pdf"]),
      folder(["A"]),
      folder(["A-"]),
      folder(["A", "Empty"]),
    ];
    const result = planUploads(input({ entries, existing: [folder(["A"])] }));
    expect(result.folders).toEqual([
      { path: ["A"], targetPath: "A/", targetUrl: `${destination}A/`, action: "skip" },
      {
        path: ["A", "Empty"],
        targetPath: "A/Empty/",
        targetUrl: `${destination}A/Empty/`,
        action: "create",
      },
      {
        path: ["A", "Sub-folder"],
        targetPath: "A/Sub-folder/",
        targetUrl: `${destination}A/Sub-folder/`,
        action: "create",
      },
      { path: ["A-"], targetPath: "A-/", targetUrl: `${destination}A-/`, action: "create" },
      { path: ["Z"], targetPath: "Z/", targetUrl: `${destination}Z/`, action: "create" },
    ]);
    expect(result.files.map((item) => item.targetPath)).toEqual([
      "Z/z.txt",
      "A/Sub-folder/R%C3%A9sum%C3%A9%20-1.pdf",
    ]);
    expect(result.files[1]?.sourcePath).toEqual(["A", "Sub:folder", "Résumé #1.pdf"]);
    expect(diffFolderTree(entries, [folder(["A"]), folder(["Unrelated"])])).toEqual(
      result.folders.map(({ targetUrl: _, ...change }) => change),
    );
    expect(diffFolderTree([], [])).toEqual([]);
  });

  it("keeps both using existing and pending names scoped to each parent", () => {
    const result = planUploads(
      input({
        entries: [
          file(["notes.md"]),
          file([" notes.md "]),
          file(["Other", "notes.md"]),
          file(["backup.tar.gz"]),
        ],
        existing: [
          remote(["notes.md"]),
          remote(["notes (1).md"]),
          remote(["notes (3).md"]),
          remote(["backup.tar.gz"]),
        ],
      }),
    );
    expect(result.files.map((item) => item.targetPath)).toEqual([
      "notes%20(2).md",
      "notes%20(4).md",
      "Other/notes.md",
      "backup%20(1).tar.gz",
    ]);
    expect(result.files.every((item) => item.operation.action === "create")).toBe(true);
  });

  it("reserves existing and dropped folder names when numbering files", () => {
    const result = planUploads(
      input({
        entries: [file(["a.txt"]), folder(["a (1).txt"]), folder(["a (3).txt"])],
        existing: [remote(["a.txt"]), folder(["a (2).txt"])],
      }),
    );
    expect(result.files[0]?.path).toEqual(["a (4).txt"]);
  });

  it("keeps capped paths stable and numbers existing and pending collisions", () => {
    const name = "a".repeat(179);
    const longName = `${name} tail`;
    const parent = "b".repeat(179);
    const result = planUploads(
      input({
        entries: [file([longName]), file([`${name} other`]), file([`${parent} tail`, longName])],
        existing: [remote([name])],
      }),
    );
    expect(result.files.map((item) => item.path)).toEqual([
      [`${"a".repeat(176)} (1)`],
      [`${"a".repeat(176)} (2)`],
      [parent, name],
    ]);
    for (const item of result.files) {
      expect(encodeUploadPath(item.path, "file")).toBe(item.targetPath);
      expect(item.targetUrl).toBe(destination + item.targetPath);
    }
    for (const item of result.folders) {
      expect(encodeUploadPath(item.path, "folder")).toBe(item.targetPath);
    }
  });

  it("preserves a capped dotted file's extension across existing and pending collisions", () => {
    const dots = ".".repeat(172);
    const name = `${dots}a.tar.gz`;
    const source = `${dots}ab.tar.gz`;
    const nextSource = `${dots}abc.tar.gz`;
    const result = planUploads(
      input({
        entries: [file([source]), file([nextSource])],
        existing: [remote([name]), remote([`${dots.slice(0, -3)} (1).tar.gz`])],
      }),
    );
    expect(result.files.map((item) => item.sourcePath)).toEqual([[source], [nextSource]]);
    expect(result.files.map((item) => item.path)).toEqual([
      [`${dots.slice(0, -3)} (2).tar.gz`],
      [`${dots.slice(0, -3)} (3).tar.gz`],
    ]);
    for (const item of result.files) {
      expect([...(item.path[0] as string)]).toHaveLength(180);
      expect(encodeUploadPath(item.path, "file")).toBe(item.targetPath);
      expect(item.targetUrl).toBe(destination + item.targetPath);
      expect(item.operation).toEqual({ action: "create", ifNoneMatch: "*" });
    }
  });

  it.each([
    { existing: [] },
    { existing: [remote([`${".".repeat(173)}.tar.gz`])] },
  ])("rejects a capped file with an ambiguous extension before planning uploads (%j)", ({
    existing,
  }) => {
    expect(invalid({ entries: [file([`${".".repeat(180)}a.tar.gz`])], existing })).toThrowError(
      new UploadPlanningError("invalid-name"),
    );
  });

  it("replaces only an existing file with its supplied strong ETag", () => {
    const result = planUploads(
      input({
        policy: "replace",
        entries: [file(["notes.md"]), file(["new.md"], 0)],
        existing: [remote(["notes.md"], '"v1"')],
      }),
    );
    expect(result.files.map((item) => item.operation)).toEqual([
      { action: "replace", ifMatch: '"v1"' },
      { action: "create", ifNoneMatch: "*" },
    ]);
    expect(result.files[1]?.chunks).toEqual([]);
    expect(
      invalid({
        policy: "replace",
        entries: [file(["notes.md"])],
        existing: [remote(["notes.md"])],
      }),
    ).toThrowError(new UploadPlanningError("missing-etag"));
  });

  it("skips conflicts without allocating chunks, retaining the original target", () => {
    const result = planUploads(
      input({
        policy: "skip",
        chunkSize: 1,
        entries: [
          file(["notes.md"], Number.MAX_SAFE_INTEGER),
          file(["new.txt"]),
          file([" new.txt "]),
        ],
        existing: [remote(["notes.md"])],
      }),
    );
    expect(result.files.map((item) => item.operation.action)).toEqual(["skip", "create", "skip"]);
    expect(result.files[0]?.chunks).toEqual([]);
    expect(result.files[0]?.targetUrl).toBe(`${destination}notes.md`);
    expect(result.files[2]?.chunks).toEqual([]);
    expect(
      invalid({ entries: [file(["large"], Number.MAX_SAFE_INTEGER)], chunkSize: 1 }),
    ).toThrowError(new UploadPlanningError("plan-too-large"));
  });

  it("encodes literal existing names without normalizing a listing", () => {
    const existing = [remote(["A%?#.txt"]), remote(["O'Reilly.txt"])];
    expect(
      planUploads(input({ existing, entries: [file(["A%?#.txt"])] })).files[0]?.targetPath,
    ).toBe("A---.txt");
    expect(
      planUploads(input({ targetContainer: "http://pod.example.org/", entries: [file(["a"])] }))
        .files[0]?.targetUrl,
    ).toBe("http://pod.example.org/a");
    expect(
      planUploads(
        input({ targetContainer: "https://pod.example.org/My%20Drive/", entries: [file(["a"])] }),
      ).files[0]?.targetUrl,
    ).toBe("https://pod.example.org/My%20Drive/a");
  });

  it("returns fresh plain data without mutating frozen inputs", () => {
    const entries = Object.freeze([
      Object.freeze({
        kind: "file" as const,
        path: Object.freeze(["Work", " Report.pdf "]),
        size: 7,
      }),
    ]);
    const existing = Object.freeze([
      Object.freeze({ kind: "folder" as const, path: Object.freeze(["Work"]) }),
    ]);
    const value = Object.freeze(input({ entries, existing }));
    const first = planUploads(value);
    expect(planUploads(value)).toEqual(first);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    (first.files[0]?.sourcePath as string[])[0] = "changed";
    (first.folders[0]?.path as string[])[0] = "changed";
    expect(entries[0]?.path).toEqual(["Work", " Report.pdf "]);
    expect(existing[0]?.path).toEqual(["Work"]);
    expect(planUploads(value).files[0]?.sourcePath).toEqual(["Work", " Report.pdf "]);
  });
});

describe("fail-closed tree validation", () => {
  it.each([
    [file(["same"]), file(["same"])],
    [folder(["same"]), folder(["same"])],
    [file(["same"]), folder(["same"])],
    [folder(["A#"]), folder(["A?"])],
    [file(["A#", "a"]), file(["A?", "b"])],
    [file(["x".repeat(181), "a"]), file(["x".repeat(182), "b"])],
  ])("rejects ambiguous source paths or merged folders %j", (...entries) => {
    expect(invalid({ entries })).toThrowError(new UploadPlanningError("ambiguous-drop"));
  });

  it.each([
    [file(["A"]), file(["A", "child"])],
    [file(["A", "child"]), file(["A"])],
    [folder(["A#"]), file(["A?"])],
  ])("rejects file/folder collisions inside the drop %j", (...entries) => {
    expect(invalid({ entries })).toThrowError(new UploadPlanningError("kind-conflict"));
  });

  it.each(["keep-both", "replace", "skip"])("rejects existing kind collisions for %s", (policy) => {
    expect(invalid({ policy, entries: [file(["A"])], existing: [folder(["A"])] })).toThrowError(
      new UploadPlanningError("kind-conflict"),
    );
    expect(
      invalid({ policy, entries: [file(["A", "child"])], existing: [remote(["A"])] }),
    ).toThrowError(new UploadPlanningError("kind-conflict"));
  });

  it.each([
    { existing: [] },
    { existing: [remote(["a.txt"], '"v1"')] },
  ])("rejects Replace collisions with pending uploads", ({ existing }) => {
    expect(
      invalid({ policy: "replace", entries: [file(["a.txt"]), file([" a.txt "])], existing }),
    ).toThrowError(new UploadPlanningError("ambiguous-drop"));
  });

  it.each([
    [folder(["A"]), folder(["A"])],
    [remote(["A"]), folder(["A"])],
    [remote(["Missing", "child"])],
    [remote(["A"]), remote(["A", "child"])],
    [remote(["A/B"])],
    [folder(["A\\B"])],
    [remote(["control\n"])],
    [{ ...remote(["a"]), etag: "*" }],
    [{ ...remote(["a"]), etag: 'W/"weak"' }],
    [{ ...remote(["a"]), etag: "unquoted" }],
    [{ ...remote(["a"]), etag: undefined }],
    [{ ...remote(["a"]), etag: 3 }],
  ])("rejects incomplete or inconsistent listings %j", (...existing) => {
    expect(invalid({ existing })).toThrowError(new UploadPlanningError("invalid-listing"));
  });

  it.each([
    null,
    [],
    "file",
    {},
    { kind: "link", path: ["a"] },
    { kind: "file", path: ["a"] },
    { kind: "folder", path: ["a"], size: 1 },
    { kind: "file", path: ["a"], size: -1 },
    { kind: "file", path: [], size: 1 },
    { kind: "file", path: [".."], size: 1 },
  ])("returns typed errors for malformed drops %j", (entry) => {
    expect(invalid({ entries: [entry] })).toThrow(UploadPlanningError);
  });

  it.each([null, 0, {}, "a", undefined])("rejects malformed tree arrays %j", (value) => {
    expect(invalid({ entries: value })).toThrowError(new UploadPlanningError("invalid-input"));
    expect(invalid({ existing: value })).toThrowError(new UploadPlanningError("invalid-input"));
  });

  it.each([
    null,
    { kind: "link", path: ["a"] },
    { kind: "file", path: ["."] },
  ])("rejects malformed listing entries %j", (entry) => {
    expect(invalid({ existing: [entry] })).toThrow(UploadPlanningError);
  });

  it("rejects extra keys, symbols, prototypes, hidden properties, and accessors", () => {
    const accessor = Object.defineProperty({}, "path", {
      enumerable: true,
      get: () => {
        throw new Error("must not execute");
      },
    });
    const hidden = Object.defineProperty({ kind: "file", path: ["a"] }, "size", { value: 1 });
    const symbol = { ...file(["a"]), [Symbol("extra")]: 1 };
    for (const entry of [{ ...file(["a"]), extra: true }, symbol, new Date(), accessor, hidden]) {
      expect(invalid({ entries: [entry] })).toThrowError(new UploadPlanningError("invalid-input"));
    }
    const plain = Object.assign(Object.create(null), file(["a"]));
    expect(planUploads(input({ entries: [plain] })).files).toHaveLength(1);
    expect(() => planUploads(null as unknown as UploadPlanInput)).toThrowError(
      new UploadPlanningError("invalid-input"),
    );
    expect(invalid({ extra: true })).toThrowError(new UploadPlanningError("invalid-input"));
    expect(invalid({ policy: "overwrite" })).toThrowError(new UploadPlanningError("invalid-input"));
    expect(invalid({ chunkSize: 0 })).toThrowError(new UploadPlanningError("invalid-chunk-size"));
  });

  it("keeps private inputs out of error messages", () => {
    const invoke = invalid({
      policy: "replace",
      entries: [file(["Private Report.pdf"])],
      existing: [remote(["Private Report.pdf"])],
    });
    expect(invoke).toThrowError(/^Upload planning: missing-etag$/);
    try {
      invoke();
    } catch (error) {
      expect(error).toMatchObject({ name: "UploadPlanningError", code: "missing-etag" });
    }
  });
});

describe("destination URL validation", () => {
  it.each([
    null,
    7,
    "not a URL",
    "/drive/",
    "https://pod.example.org/drive",
    "ftp://pod.example.org/drive/",
    "https://user@pod.example.org/drive/",
    "https://user:pass@pod.example.org/drive/",
    "https://pod.example.org/drive/?x=1",
    "https://pod.example.org/drive/#x",
    " https://pod.example.org/drive/",
    "https://POD.example.org/drive/",
    "https://pod.example.org/drive/../",
    "https://pod.example.org/%2e%2e/",
    "https://pod.example.org/%zz/",
    "https://pod.example.org/%FF/",
    "https://pod.example.org/%2F/",
    "https://pod.example.org/%5C/",
    "https://pod.example.org/%00/",
    "https://pod.example.org//",
    "https://pod.example.org/a//b/",
    "https://pod.example.org/%61/",
  ])("rejects noncanonical or unsafe destination %j", (targetContainer) => {
    expect(invalid({ targetContainer })).toThrowError(new UploadPlanningError("invalid-target"));
  });
});
