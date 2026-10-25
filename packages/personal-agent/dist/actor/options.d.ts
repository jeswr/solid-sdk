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
import { type Gate, type GateDecision } from "./gate.js";
/** Built-in tools explicitly denied to the Actor (it has no filesystem/shell/network reach). */
export declare const DENIED_TOOLS: readonly ["Bash", "Write", "Edit", "MultiEdit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "NotebookEdit"];
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
export declare function buildActorOptions(config: BuildActorOptionsConfig): ActorOptions;
//# sourceMappingURL=options.d.ts.map