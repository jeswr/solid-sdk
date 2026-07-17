// AUTHORED-BY Claude Fable 5
/**
 * `@jeswr/solid-showcase-kit/testing` — node-side helpers for repo gates and e2e suites.
 * This subpath MAY use node builtins; the package root must stay browser-safe.
 */

export { type BannerIdentity, disclaimerAssertions } from "./assertions.js";
export {
  type InsigniaFinding,
  type InsigniaOptions,
  type InsigniaRule,
  type InsigniaTreeOptions,
  insigniaFindings,
  insigniaPathFindings,
  insigniaRules,
  SCANNED_EXTENSIONS,
  SKIPPED_DIRECTORIES,
  scanInsigniaTree,
} from "./insignia.js";
