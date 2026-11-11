// AUTHORED-BY Codex GPT-6.1-Sol
/** Shared storage scenarios, lifecycle runner, feature gating, and deterministic reports. */
export { moveProbe, storageCases } from "./cases.js";
export { compareClaims, evaluateCase, runTarget } from "./harness.js";
export { optionalServiceCases, sq8Cases, trashProbe, versioningProbe } from "./optional-cases.js";
export { generateMatrix, writeReports } from "./report.js";
export { cssTarget } from "./targets/css.js";
export { selectTargets } from "./targets/index.js";
export { memoryTarget } from "./targets/memory.js";
export { sparqSolidTarget } from "./targets/sparq-solid.js";
export type * from "./types.js";
