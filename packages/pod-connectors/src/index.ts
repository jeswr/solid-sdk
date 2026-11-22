// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Adapter contracts and host ports. */

export { createOwnerOnlyDestinationVerifier } from "@jeswr/pod-access";
/** Shared source-run limits and typed partial-run budget failures. */
export { DEFAULT_RUN_LIMITS, RunBudgetExceededError, type RunLimits } from "./core/budget.js";
/** Typed connector failures. */
export * from "./core/errors.js";
/** File import contract and runner. */
export * from "./core/file-import.js";
/** API import runner and reports. */
export * from "./core/import-runner.js";
/** Fetch-backed Pod writer factory. */
export * from "./core/pod-writer.js";
/** Conditional storage-client-backed Pod writer. */
export {
  createStoragePodWriter,
  createWacImportStorage,
  type StoragePodWriterOptions,
} from "./core/storage-pod-writer.js";
export * from "./core/types.js";
/** File adapter registry. */
export * from "./file-adapters.js";
/** Catalog and host-injected configuration. */
export * from "./registry.js";
