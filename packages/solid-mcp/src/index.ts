// AUTHORED-BY Codex GPT-6
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
// Shared by session capture; keep config, DPoP and WAC behavior identical to stdio.
export { type ChatPodConfig, createChatPodPort } from "./chat-tools.js";
export { type CliConfig, loadCliConfig } from "./cli-config.js";
export { createCliFetch } from "./client-credentials.js";
export {
  createContextToolRegistry,
  readSharedContext,
  SHARED_CONTEXT_PATH,
  type SharedContextResult,
  sharedContextUrl,
} from "./context-tools.js";
export { type FetchResult, fetchDocument } from "./fetch.js";
export type { MemoryClientInfo } from "./memory-tools.js";
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
  type PodHeadResult,
  type PodPort,
  type PodReadOptions,
  type PodReadResult,
  type PodSource,
} from "./pod-port.js";
export { createSolidMcpServer, type SolidMcpServerConfig } from "./server.js";
export { createStoragePodPort } from "./storage-pod-port.js";
export { createPodToolRegistry, type PodTool, registerPodTools } from "./tools.js";
