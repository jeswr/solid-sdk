// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { type AuditFetch, loadTrace, proposalStorage, runAuditCli } from "@jeswr/agent-audit";
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";

/** Demo rule references, selected from executor outcomes rather than inbound claims. */
export function d2Rule(reason: string): string | undefined {
  if (reason === "prohibition") return "urn:d2:rule:no-transfer";
  if (reason === "limit:spendPerDay" || reason === "limit.spendPerDay") return "limit:spendPerDay";
  return undefined;
}

/** Print hash-checked decision evidence, then retain the independent auditor's verdict. */
export async function runD2AuditCli(
  args: readonly string[],
  print: (line: string) => void,
  io?: AuditFetch,
): Promise<number> {
  try {
    if (args.length !== 1) throw new Error("Expected one proposal");
    const proposal = args[0] as string;
    const root = proposalStorage(proposal);
    const url = new URL(root);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname))
      throw new Error("Local CSS only");
    const transport = io ?? createNodeGuardedFetch({ allowLoopback: true, maxRedirects: 0 });
    const trace = await loadTrace(transport, root);
    for (const entry of trace.entries) {
      const record = entry.record;
      if (record.type === "ledger-checkpoint" || record.proposal !== proposal) continue;
      print(
        `ENTRY ${entry.seq} ${record.type} ${record.decision ?? record.status ?? "proposed"}${
          record.reason ? ` reason=${record.reason}` : ""
        }${d2Rule(record.reason ?? "") ? ` rule=${d2Rule(record.reason ?? "")}` : ""}`,
      );
    }
    // Refusals have no transmission. The upstream auditor must report missing-prov,
    // not certify a payment that never happened. Hash-checked entries are still visible.
    return runAuditCli(args, print, { fetch: transport });
  } catch {
    print("BREACH unreadable D-2 trace (loopback CSS proposal required)");
    return 1;
  }
}

if (import.meta.main) process.exitCode = await runD2AuditCli(process.argv.slice(2), console.log);
