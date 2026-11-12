// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { MigrationPlan, MigrationResult, Progress, Resolutions } from "./types.js";
export const journalKey = "pod-migrator:run-report:v1";
export interface RunReport {
  version: 1;
  status: "running" | "finished" | "interrupted";
  source: { root: string; webId: string };
  target: { root: string; webId: string };
  startedAt: string;
  plan: MigrationPlan;
  resolutions: Resolutions;
  progress: Progress | null;
  result: MigrationResult | null;
  log: { at: string; message: string }[];
}

export function readPreviousRun(key = journalKey): RunReport | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as RunReport;
    if (
      data?.version !== 1 ||
      !["running", "finished", "interrupted"].includes(data.status) ||
      typeof data.source?.root !== "string" ||
      typeof data.target?.root !== "string" ||
      !Array.isArray(data.log) ||
      !data.log.every((entry) => typeof entry?.at === "string" && typeof entry.message === "string")
    )
      return null;
    const result = data.result;
    if (
      result !== null &&
      (!Array.isArray(result?.copied) ||
        !result.copied.every((url) => typeof url === "string") ||
        !Array.isArray(result.aclWritten) ||
        !result.aclWritten.every((url) => typeof url === "string") ||
        !Array.isArray(result.failed) ||
        !result.failed.every(
          (entry) => typeof entry?.url === "string" && typeof entry.error === "string",
        ) ||
        !Array.isArray(result.skipped) ||
        !result.skipped.every(
          (entry) => typeof entry?.url === "string" && typeof entry.reason === "string",
        ) ||
        !Array.isArray(result.log) ||
        !result.log.every(
          (entry) =>
            typeof entry?.at === "string" &&
            typeof entry.message === "string" &&
            ["info", "warn", "error"].includes(entry.level),
        ) ||
        typeof result.verified !== "boolean" ||
        typeof result.cancelled !== "boolean")
    )
      return null;
    return { ...data, status: data.status === "running" ? "interrupted" : data.status };
  } catch {
    return null;
  }
}

export function saveReport(report: RunReport): boolean {
  try {
    sessionStorage.setItem(journalKey, JSON.stringify(report));
    return true;
  } catch {
    return false;
  }
}

export function downloadReport(report: RunReport): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "pod-migration-report.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
