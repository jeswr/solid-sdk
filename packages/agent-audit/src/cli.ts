// AUTHORED-BY Codex GPT-6.1-Sol
import { nodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { type AuditOptions, auditArtifact } from "./reader.js";

/** Discover the storage root from the canonical agent/proposals/ layout. */
export function proposalStorage(proposal: string): string {
  const url = new URL(proposal);
  const marker = url.pathname.indexOf("/agent/proposals/");
  if (marker < 0 || url.username || url.password || url.search)
    throw new Error("Invalid proposal URL");
  url.pathname = url.pathname.slice(0, marker + 1);
  url.hash = "";
  return url.href;
}
/** Inject transport/resolvers for offline fixtures; default transport is anonymous and DNS-pinned. */
export async function runAuditCli(
  args: readonly string[],
  print: (line: string) => void,
  injected: Partial<Omit<AuditOptions, "proposal" | "root" | "at">> = {},
): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    print("Usage: audit <proposal-iri> [--at <YYYY-MM-DDTHH:mm:ss.sssZ>]");
    return 0;
  }
  if (args.length !== 1 && !(args.length === 3 && args[1] === "--at")) {
    print("Usage: audit <proposal-iri> [--at <YYYY-MM-DDTHH:mm:ss.sssZ>]");
    return 1;
  }
  try {
    const proposal = args[0] as string;
    const root = proposalStorage(proposal);
    const report = await auditArtifact({
      ...injected,
      fetch: injected.fetch ?? nodeGuardedFetch,
      root,
      proposal,
      ...(args.length === 3 ? { at: args[2] as string } : {}),
    });
    print(`AUDIT ${report.proposal}`);
    for (const link of report.authorityChain) print(link);
    for (const breach of report.breaches) print(`BREACH ${breach}`);
    print(report.scope);
    print(report.ok ? "PASS" : "FAIL");
    return report.ok ? 0 : 1;
  } catch {
    print("BREACH unwalkable: invalid proposal or unreadable trace");
    return 1;
  }
}
