// AUTHORED-BY Codex GPT-6
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
export const jointPaths = new Set([
  "cohort-count/main",
  "cohort-count/branch-1",
  "cohort-count/branch-2",
  "platform-income/main",
  "salary-benchmark/main",
  "salary-benchmark/branch-1",
]);
export const traceHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function recordedJoint(root, previous, scenario, path) {
  if (!jointPaths.has(`${scenario}/${path}`)) return undefined;
  const row = previous.find((r) => r.scenario === scenario && r.path === path);
  if (
    !row ||
    !["runs", "disagrees"].includes(row.status) ||
    row.recordedWith?.commit !== "61989f5" ||
    row.recordedWith?.package !== "sparq-verifiable-aggregate" ||
    row.recordedWith?.method !== "sparq-aggregate/1" ||
    row.recordedWith?.sha256 !==
      "9832ef937efbcc8970db3f70ec4e72e3384a867f3ecb40a1be81ea002a6a6830" ||
    !/^[a-f0-9]{64}$/.test(row.traceSha256 ?? "") ||
    row.trace !== `${scenario}${path === "main" ? "" : `--${path}`}--baseline.json`
  )
    throw new Error(`Missing authenticated recorded joint trace: ${scenario}/${path}`);
  if (traceHash(readFileSync(join(root, "traces", row.trace))) !== row.traceSha256)
    throw new Error(`Recorded joint trace SHA-256 mismatch: ${scenario}/${path}`);
  return structuredClone(row);
}
