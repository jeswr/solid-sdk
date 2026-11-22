// AUTHORED-BY Claude Opus 5.5
// The single entry point apps import (00-sdk-assumptions A-1): every façade hook and helper.
// The narrower subpaths (`./search`, `./preferences`, `./offline`) stay for existing callers.
// No "use client" here: server routes call `decodeRef` and `classifyError`, and the hook
// modules re-exported below carry their own directive.

export type { ErrorCategory } from "./errors.js";
export { classifyError } from "./errors.js";
export * from "./index.js";
export * from "./offline.js";
export * from "./preferences/index.js";
export {
  decodeIdentifierRef,
  decodeRef,
  encodeIdentifierRef,
  encodeRef,
  RefError,
} from "./refs.js";
export * from "./search/index.js";
export type { SuiteCaps, SuiteCapsContext } from "./suite-caps.js";
export { deriveSuiteCaps } from "./suite-caps.js";
