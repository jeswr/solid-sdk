/** The gate verdict (a `PermissionResult` subset). */
export type GateDecision = {
    readonly behavior: "allow";
    readonly updatedInput?: Record<string, unknown>;
} | {
    readonly behavior: "deny";
    readonly message: string;
    readonly interrupt?: boolean;
};
/** The read-only pod MCP tools the Actor may always use. */
export declare const POD_READ_TOOLS: readonly ["mcp__pod__solid_list", "mcp__pod__solid_read", "mcp__pod__solid_search"];
/** The single proposals-container write tool (a second, narrowly-scoped MCP server). */
export declare const PROPOSAL_WRITE_TOOL = "mcp__proposals__solid_write";
/** Config for {@link createGate}. */
export interface GateConfig {
    /** The ONLY container a write may target (the proposals container). */
    readonly proposalsContainer: string;
    /** The allowed read tools (default {@link POD_READ_TOOLS}). */
    readonly readTools?: readonly string[];
    /** The allowed proposals write tool (default {@link PROPOSAL_WRITE_TOOL}). */
    readonly writeTool?: string;
}
/** The gate function: `(toolName, input) → allow | deny`. */
export type Gate = (toolName: string, input: Record<string, unknown>) => GateDecision;
/**
 * Build the fail-closed gate. Deny-by-default: a read tool → allow; the write tool → allow
 * ONLY if the input carries at least one URL and EVERY URL in it is strictly within the
 * proposals container; anything else → deny.
 */
export declare function createGate(config: GateConfig): Gate;
//# sourceMappingURL=gate.d.ts.map