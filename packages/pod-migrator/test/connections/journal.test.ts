// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { journalKey, type RunReport, readPreviousRun, saveReport } from "../../src/journal.js";
import { samplePlan, sourceRoot, sourceWebId, targetRoot, targetWebId } from "./fixtures.js";

const report: RunReport = {
  version: 1,
  status: "running",
  source: { root: sourceRoot, webId: sourceWebId },
  target: { root: targetRoot, webId: targetWebId },
  startedAt: "2026-11-11T12:00:00Z",
  plan: samplePlan,
  resolutions: {},
  progress: null,
  result: null,
  log: [{ at: "2026-11-11T12:00:00Z", message: "Started" }],
};
afterEach(() => vi.unstubAllGlobals());
it("restores a running report as interrupted without executable state", () => {
  const saved = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => saved.get(key),
    setItem: (key: string, value: string) => saved.set(key, value),
  });
  expect(saveReport(report)).toBe(true);
  expect(saved.has(journalKey)).toBe(true);
  expect(readPreviousRun()?.status).toBe("interrupted");
  expect(readPreviousRun()?.result).toBeNull();
});
it.each([
  "invalid",
  JSON.stringify({ ...report, log: [{}] }),
  JSON.stringify({ ...report, result: { copied: [] } }),
])("ignores malformed reports %s", (value) => {
  vi.stubGlobal("sessionStorage", { getItem: () => value });
  expect(readPreviousRun()).toBeNull();
});
it("tolerates blocked browser storage", () => {
  vi.stubGlobal("sessionStorage", {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  });
  expect(saveReport(report)).toBe(false);
  expect(readPreviousRun()).toBeNull();
});
