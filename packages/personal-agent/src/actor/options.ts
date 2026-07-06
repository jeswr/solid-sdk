// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Build the fail-closed Claude Agent SDK `query()` option set for the Actor (§3.3). This
 * is the trust boundary that must be audited — one option object:
 *  - `mcpServers` — the pod exposed as MCP tools (a READ-ONLY `pod` server + a single
 *    proposals-container WRITE server), over the owner's authed fetch;
 *  - `allowedTools` — ONLY the pod read tools + the one proposals write tool;
 *  - `disallowedTools` — the dangerous built-ins (shell / filesystem / network) explicitly
 *    denied belt-and-braces;
 *  - `permissionMode: "dontAsk"` — deny anything not explicitly allowed;
 *  - `canUseTool` — the programmatic {@link Gate}, a second fence enforcing per-container
 *    write scoping the allowlist cannot express.
 *
 * The shape is defined STRUCTURALLY (no hard dependency on the optional Agent SDK) so it is
 * pure + unit-testable; the live Actor (`claude-actor.ts`) fills the real MCP configs.
 */
import {
  createGate,
  type Gate,
  type GateDecision,
  POD_READ_TOOLS,
  PROPOSAL_WRITE_TOOL,
} from "./gate.js";

/** Built-in tools explicitly denied to the Actor (it has no filesystem/shell/network reach). */
export const DENIED_TOOLS = [
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",
  "NotebookEdit",
] as const;

/** The §3.3 option set (a structural subset of the Agent SDK `Options`). */
export interface ActorOptions {
  readonly mcpServers: Record<string, unknown>;
  readonly allowedTools: string[];
  readonly disallowedTools: string[];
  readonly permissionMode: "dontAsk";
  readonly canUseTool: (toolName: string, input: Record<string, unknown>) => Promise<GateDecision>;
}

/** Config for {@link buildActorOptions}. */
export interface BuildActorOptionsConfig {
  /** The proposals container the write tool is scoped to (drives the gate). */
  readonly proposalsContainer: string;
  /** The MCP server configs, keyed by name (`pod` read-only + `proposals` write). */
  readonly mcpServers: Record<string, unknown>;
  /** Override the gate (defaults to {@link createGate} over `proposalsContainer`). */
  readonly gate?: Gate;
}

/** Assemble the Actor's fail-closed option set. */
export function buildActorOptions(config: BuildActorOptionsConfig): ActorOptions {
  const gate = config.gate ?? createGate({ proposalsContainer: config.proposalsContainer });
  return {
    mcpServers: config.mcpServers,
    allowedTools: [...POD_READ_TOOLS, PROPOSAL_WRITE_TOOL],
    disallowedTools: [...DENIED_TOOLS],
    permissionMode: "dontAsk",
    canUseTool: async (toolName, input) => gate(toolName, input),
  };
}
