// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { generateMatrix, writeReports } from "./report.js";
import type { TargetReport } from "./types.js";

test("matrix orders targets and rows, escapes cells and distinguishes absent results", () => {
  const reports: TargetReport[] = [
    {
      target: "z",
      results: [{ test: "b|c\nd", status: "skip", feature: "move", reason: "target-lacks:move" }],
    },
    { target: "a", results: [{ test: "a", status: "pass", feature: null, reason: null }] },
  ];
  expect(generateMatrix(reports)).toBe(generateMatrix([...reports].reverse()));
  expect(generateMatrix(reports)).toContain("| Scenario / feature | a | z |");
  expect(generateMatrix(reports)).toContain("| a | pass | not-run |");
  expect(generateMatrix(reports)).toContain("| b\\|c d | not-run | skip (target-lacks:move) |");
  expect(generateMatrix([])).toContain("# Storage conformance matrix");
  for (const id of [
    "SC-ROLES-commenter",
    "SC-TRASH-roundtrip",
    "SC-VERSIONS-roundtrip",
    "SC-TYPEINDEX-register-find",
    "SC-PREFS-create-update-412",
  ]) {
    expect(generateMatrix(reports)).toContain(`| ${id} | not-run | not-run |`);
  }
  for (const feature of ["accessControl", "typeIndex", "trash", "versioning"])
    expect(generateMatrix(reports)).toContain(`| claims:${feature} | not-run | not-run |`);
});

test("writes per-target JSON and matrix, rejects traversal target names", async () => {
  const directory = await mkdtemp(join(tmpdir(), "conformance-report-"));
  const report: TargetReport = {
    target: "memory-lws",
    results: [{ test: "SC-LIST-0", status: "pass", feature: null, reason: null }],
  };
  try {
    await writeReports([report], directory);
    expect(
      JSON.parse(await readFile(join(directory, "reports", "memory-lws.json"), "utf8")),
    ).toEqual(report.results);
    expect(await readFile(join(directory, "MATRIX.md"), "utf8")).toBe(generateMatrix([report]));
    await expect(writeReports([{ ...report, target: "../outside" }], directory)).rejects.toThrow(
      "Invalid target name",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
