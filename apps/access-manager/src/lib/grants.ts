// AUTHORED-BY Claude Fable 5
//
// Dashboard aggregations over walked nodes: the BY-RESOURCE view ("what is
// shared, with whom, in which modes, direct or inherited") and the BY-AGENT
// view ("who can see what"). Public (foaf:Agent) and any-authenticated
// (acl:AuthenticatedAgent) access are surfaced as prominent pseudo-agents.

import type { WacMode } from "./acl.js";
import type { WalkedNode } from "./storage-walk.js";

/** Sentinel "agents" for class-based access, kept distinct from WebIDs. */
export const PUBLIC_AGENT = "public";
export const AUTHENTICATED_AGENT = "authenticated";

export interface ResourceShare {
  url: string;
  isContainer: boolean;
  /** false = access comes from an ancestor's acl:default. */
  inherited: boolean;
  aclUrl?: string;
  shares: ShareLine[];
  /** The node carries public (foaf:Agent) access — flag prominently. */
  hasPublicAccess: boolean;
  aclError?: string;
}

export interface ShareLine {
  /** A WebID, or the PUBLIC_AGENT / AUTHENTICATED_AGENT sentinels. */
  agent: string;
  modes: WacMode[];
  /** The authorization node this line came from (edit handle). */
  authIri: string;
  inherited: boolean;
}

export interface AgentHolding {
  agent: string;
  resources: { url: string; modes: WacMode[]; inherited: boolean; authIri: string }[];
}

/** Project one walked node into share lines (excluding the owner's own line). */
export function shareLines(node: WalkedNode, ownerWebId: string): ShareLine[] {
  const lines: ShareLine[] = [];
  for (const entry of node.entries) {
    const inherited = !node.aclOwned;
    for (const agent of entry.agents) {
      if (agent === ownerWebId) continue;
      lines.push({ agent, modes: entry.modes, authIri: entry.authIri, inherited });
    }
    if (entry.isPublic) {
      lines.push({ agent: PUBLIC_AGENT, modes: entry.modes, authIri: entry.authIri, inherited });
    }
    if (entry.isAuthenticated) {
      lines.push({
        agent: AUTHENTICATED_AGENT,
        modes: entry.modes,
        authIri: entry.authIri,
        inherited,
      });
    }
  }
  return lines;
}

/** BY-RESOURCE: nodes that are shared beyond the owner, with their lines. */
export function byResource(nodes: readonly WalkedNode[], ownerWebId: string): ResourceShare[] {
  const out: ResourceShare[] = [];
  for (const node of nodes) {
    const lines = shareLines(node, ownerWebId);
    if (lines.length === 0 && node.aclError === undefined) continue;
    out.push({
      url: node.url,
      isContainer: node.isContainer,
      inherited: !node.aclOwned,
      ...(node.aclUrl !== undefined ? { aclUrl: node.aclUrl } : {}),
      shares: lines,
      hasPublicAccess: lines.some((l) => l.agent === PUBLIC_AGENT),
      ...(node.aclError !== undefined ? { aclError: node.aclError } : {}),
    });
  }
  return out;
}

/** BY-AGENT: every non-owner agent and what it can reach. */
export function byAgent(nodes: readonly WalkedNode[], ownerWebId: string): AgentHolding[] {
  const map = new Map<string, AgentHolding>();
  for (const node of nodes) {
    for (const line of shareLines(node, ownerWebId)) {
      let holding = map.get(line.agent);
      if (!holding) {
        holding = { agent: line.agent, resources: [] };
        map.set(line.agent, holding);
      }
      holding.resources.push({
        url: node.url,
        modes: line.modes,
        inherited: line.inherited,
        authIri: line.authIri,
      });
    }
  }
  // Public first, then authenticated, then WebIDs alphabetically.
  const rank = (a: string) => (a === PUBLIC_AGENT ? 0 : a === AUTHENTICATED_AGENT ? 1 : 2);
  return [...map.values()].sort(
    (a, b) => rank(a.agent) - rank(b.agent) || a.agent.localeCompare(b.agent),
  );
}
