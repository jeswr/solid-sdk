// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * `@jeswr/solid-mcp` — a Model Context Protocol (MCP) server that exposes a Solid
 * pod to MCP clients as Resources + Tools over an injectable authenticated fetch.
 *
 * Public API:
 *   - {@link createSolidMcpServer} — build the McpServer for a pod.
 *   - {@link SolidMcpConfig} — the auth seam / config contract.
 *   - the pod operations + auth helpers, for programmatic use / testing.
 *
 * @packageDocumentation
 */

export {
  normalizePodRoot,
  podScopedUrlOrUndefined,
  requirePodScopedUrl,
  requirePodScopedWriteUrl,
  type SolidMcpConfig,
  writesEnabled,
} from "./auth.js";
export {
  listContainer,
  type PodChild,
  type ReadRdfResult,
  type ReadResult,
  readRdf,
  readResource,
  type SearchMatch,
  type SearchOptions,
  search,
  writeResource,
} from "./pod.js";
export {
  createFetchPodPort,
  type PodConditions,
  type PodEntry,
  type PodPort,
  type PodReadOptions,
  type PodReadResult,
  type PodSource,
} from "./pod-port.js";
export { createSolidMcpServer, type SolidMcpServerConfig } from "./server.js";
export { createPodToolRegistry, type PodTool, registerPodTools } from "./tools.js";
