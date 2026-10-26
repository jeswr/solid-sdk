// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  encodeUploadPath,
  keepBothName,
  MAX_UPLOAD_CHUNKS,
  normalizeUploadName,
  planChunks,
  UploadPlanningError,
} from "../src/apps/drive/lib/upload";

describe("Drive upload names", () => {
  it.each([
    ["Reports 2026.pdf", "Reports 2026.pdf"],
    ["  Budget.TAR.gz  ", "Budget.TAR.gz"],
    ["résumé 🐈.pdf", "résumé 🐈.pdf"],
    ["e\u0301.txt", "e\u0301.txt"],
    ["/\\:#?%*\u0000\u001f\u007f\u009f.txt", "-----------.txt"],
    ["README", "README"],
    [".gitignore", ".gitignore"],
    ["..config.json", "..config.json"],
    ["notes.", "notes."],
    ["O'Reilly (draft)!.md", "O'Reilly (draft)!.md"],
    ["a".repeat(200), "a".repeat(180)],
    [`${"a".repeat(200)}.tar.gz`, `${"a".repeat(173)}.tar.gz`],
    [`${"🐈".repeat(190)}.txt`, `${"🐈".repeat(176)}.txt`],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeUploadName(input)).toBe(expected);
  });

  it("caps folders without treating dots as extensions", () => {
    expect(normalizeUploadName(`Folder.${"x".repeat(200)}`, "folder")).toBe(
      `Folder.${"x".repeat(173)}`,
    );
    expect(() => normalizeUploadName(`a.${"x".repeat(179)}`)).toThrowError(
      new UploadPlanningError("invalid-name"),
    );
  });

  it.each([
    "",
    ".",
    "..",
    " .. ",
    "\ud800",
    "\udfff",
    12,
    null,
    undefined,
  ])("rejects invalid segments %j", (input) => {
    expect(() => normalizeUploadName(input as string)).toThrowError(
      new UploadPlanningError("invalid-path"),
    );
  });

  it("rejects empty trimmed names and unknown kinds", () => {
    expect(() => normalizeUploadName("   ")).toThrowError(new UploadPlanningError("invalid-name"));
    expect(() => normalizeUploadName("ok", "link" as "file")).toThrowError(
      new UploadPlanningError("invalid-input"),
    );
  });

  it("percent-encodes segments independently and marks containers", () => {
    expect(encodeUploadPath([" Reports 2026 ", "Résumé #1.pdf"], "file")).toBe(
      "Reports%202026/R%C3%A9sum%C3%A9%20-1.pdf",
    );
    expect(encodeUploadPath(["A/B", "Sub:folder"], "folder")).toBe("A-B/Sub-folder/");
    expect(() => encodeUploadPath([], "file")).toThrowError(
      new UploadPlanningError("invalid-path"),
    );
    expect(() => encodeUploadPath("a/b" as unknown as string[], "file")).toThrowError(
      new UploadPlanningError("invalid-path"),
    );
    expect(() => encodeUploadPath(["ok"], "link" as "file")).toThrowError(
      new UploadPlanningError("invalid-input"),
    );
  });

  it("uses the first free positive number before the full extension chain", () => {
    expect(keepBothName("notes.md", ["notes.md", "notes (1).md", "notes (3).md"])).toBe(
      "notes (2).md",
    );
    expect(keepBothName("Backup.TAR.gz", ["Backup.TAR.gz"])).toBe("Backup (1).TAR.gz");
    expect(keepBothName("README", ["README"])).toBe("README (1)");
    expect(keepBothName(".gitignore", [".gitignore"])).toBe(".gitignore (1)");
    expect(keepBothName(".config.json", [".config.json"])).toBe(".config (1).json");
    expect(keepBothName("a.txt", ["A.txt"])).toBe("a.txt");
    expect(keepBothName("notes (1).md", ["notes (1).md"])).toBe("notes (1) (1).md");
  });

  it("keeps numbered names within the cap, including multi-digit numbers", () => {
    const stem = "x".repeat(176);
    const occupied = [`${stem}.txt`];
    for (let n = 1; n <= 9; n += 1) occupied.push(`${"x".repeat(172)} (${n}).txt`);
    expect(keepBothName(`${stem}.txt`, occupied)).toBe(`${"x".repeat(171)} (10).txt`);
    expect(() => keepBothName(`a.${"x".repeat(175)}`, [`a.${"x".repeat(175)}`])).toThrowError(
      new UploadPlanningError("invalid-name"),
    );
  });

  it("validates occupied names without changing the caller's array", () => {
    const occupied = Object.freeze(["a.txt"]);
    expect(keepBothName("a.txt", occupied)).toBe("a (1).txt");
    expect(() => keepBothName("a", null as unknown as string[])).toThrowError(
      new UploadPlanningError("invalid-input"),
    );
    expect(() => keepBothName("a", [".."])).toThrowError(new UploadPlanningError("invalid-path"));
  });
});

describe("upload chunk ranges", () => {
  it.each([
    [0, 4, []],
    [1, 4, [{ index: 0, start: 0, end: 1 }]],
    [4, 4, [{ index: 0, start: 0, end: 4 }]],
    [
      8,
      4,
      [
        { index: 0, start: 0, end: 4 },
        { index: 1, start: 4, end: 8 },
      ],
    ],
    [
      9,
      4,
      [
        { index: 0, start: 0, end: 4 },
        { index: 1, start: 4, end: 8 },
        { index: 2, start: 8, end: 9 },
      ],
    ],
  ] as const)("plans %i bytes with chunk size %i", (size, chunkSize, expected) => {
    expect(planChunks(size, chunkSize)).toEqual(expected);
  });

  it("handles maximum safe integers without rounded or overflowing endpoints", () => {
    const size = Number.MAX_SAFE_INTEGER;
    expect(planChunks(size, size)).toEqual([{ index: 0, start: 0, end: size }]);
    expect(planChunks(size, size - 1)).toEqual([
      { index: 0, start: 0, end: size - 1 },
      { index: 1, start: size - 1, end: size },
    ]);
    expect(planChunks(MAX_UPLOAD_CHUNKS, 1)).toHaveLength(MAX_UPLOAD_CHUNKS);
    expect(() => planChunks(MAX_UPLOAD_CHUNKS + 1, 1)).toThrowError(
      new UploadPlanningError("plan-too-large"),
    );
  });

  it.each([
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "1",
    null,
    undefined,
  ])("rejects invalid byte size %j", (value) => {
    expect(() => planChunks(value as number, 1)).toThrowError(
      new UploadPlanningError("invalid-size"),
    );
  });

  it.each([
    0,
    -1,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "1",
    null,
    undefined,
  ])("rejects invalid chunk size %j even for empty files", (value) => {
    expect(() => planChunks(0, value as number)).toThrowError(
      new UploadPlanningError("invalid-chunk-size"),
    );
  });
});
