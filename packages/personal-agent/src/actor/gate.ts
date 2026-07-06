// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The Actor's programmatic permission gate — the `canUseTool` callback (§3.3), a SECOND
 * fence on top of `permissionMode: "dontAsk"` + the tool allowlist. Its job is the one
 * thing the allowlist alone cannot express: per-CONTAINER write scoping. The Actor may
 * READ the pod (list/read/search) and may WRITE ONLY into the proposals container — it
 * PROPOSES, it never executes, and it can never write outside that one container (so it
 * can neither rewrite a provenance anchor nor touch its own mandate).
 *
 * FAIL-CLOSED by construction: anything not explicitly a read tool or a proposals-scoped
 * write is DENIED (Bash / Write / Edit / WebFetch / any unknown tool). A write whose input
 * carries no in-scope URL — or ANY URL outside the proposals container — is denied.
 *
 * The returned {@link GateDecision} is a subset of the Claude Agent SDK's `PermissionResult`,
 * so the live Actor wires it directly as `canUseTool`.
 */
import { isWithinBase } from "@jeswr/agentic-legacy-bridge";

/** The gate verdict (a `PermissionResult` subset). */
export type GateDecision =
  | { readonly behavior: "allow"; readonly updatedInput?: Record<string, unknown> }
  | { readonly behavior: "deny"; readonly message: string; readonly interrupt?: boolean };

/** The read-only pod MCP tools the Actor may always use. */
export const POD_READ_TOOLS = [
  "mcp__pod__solid_list",
  "mcp__pod__solid_read",
  "mcp__pod__solid_search",
] as const;

/** The single proposals-container write tool (a second, narrowly-scoped MCP server). */
export const PROPOSAL_WRITE_TOOL = "mcp__proposals__solid_write";

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

const DENY_UNKNOWN: GateDecision = {
  behavior: "deny",
  message: "tool not permitted for the Actor (read-only + proposals-container writes only)",
};

/**
 * Collect every http(s) URL string ANYWHERE in the input (recursing into nested objects
 * and arrays, depth-bounded). solid_write's schema is flat, but scanning the whole input
 * is strictly safer: no URL a write carries can be out of scope, wherever it sits.
 */
function urlValues(input: unknown, depth = 0): string[] {
  const urls: string[] = [];
  if (depth > 6 || input == null) return urls;
  if (typeof input === "string") {
    try {
      const parsed = new URL(input);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") urls.push(input);
    } catch {
      // not a URL — ignore
    }
    return urls;
  }
  if (Array.isArray(input)) {
    for (const item of input) urls.push(...urlValues(item, depth + 1));
    return urls;
  }
  if (typeof input === "object") {
    for (const value of Object.values(input as Record<string, unknown>)) {
      urls.push(...urlValues(value, depth + 1));
    }
  }
  return urls;
}

/**
 * Build the fail-closed gate. Deny-by-default: a read tool → allow; the write tool → allow
 * ONLY if the input carries at least one URL and EVERY URL in it is strictly within the
 * proposals container; anything else → deny.
 */
export function createGate(config: GateConfig): Gate {
  const readTools = new Set(config.readTools ?? POD_READ_TOOLS);
  const writeTool = config.writeTool ?? PROPOSAL_WRITE_TOOL;
  const base = config.proposalsContainer;

  return (toolName, input) => {
    if (readTools.has(toolName)) return { behavior: "allow" };
    if (toolName === writeTool) {
      const urls = urlValues(input ?? {});
      if (urls.length === 0) {
        return { behavior: "deny", message: "write refused: no in-scope target URL" };
      }
      const allWithin = urls.every((url) => isWithinBase(url, base));
      if (!allWithin) {
        return {
          behavior: "deny",
          message: "write refused: target escapes the proposals container",
        };
      }
      return { behavior: "allow" };
    }
    return DENY_UNKNOWN;
  };
}
