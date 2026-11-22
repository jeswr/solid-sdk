// AUTHORED-BY Codex GPT-6.1-Sol
// Ported from personal-agent/src/pilot/store/ledger.ts.
import { canonicalJson } from "@jeswr/agent-model/core/canonical";
import { GENESIS, type LedgerEntry, type LedgerRecord, seal } from "./records.js";

export interface EvidenceLedger {
  append(record: LedgerRecord, at: string): LedgerEntry;
  entries(): readonly LedgerEntry[];
}
/** A retained gate decision is immutable across retries, including after a failed mirror. */
export function gateDecisionReplay(
  entries: readonly LedgerEntry[],
  record: LedgerRecord,
): LedgerEntry | undefined {
  if (record.type !== "gate-decision") return;
  const matches = entries.filter(
    (entry) => entry.record.type !== "ledger-checkpoint" && entry.record.id === record.id,
  );
  const existing = matches[0];
  if (!existing) return;
  if (matches.length !== 1 || canonicalJson(existing.record) !== canonicalJson(record))
    throw new Error("Audit replay conflict");
  return existing;
}
export class MemoryLedger implements EvidenceLedger {
  private readonly list: LedgerEntry[] = [];
  append(record: LedgerRecord, at: string): LedgerEntry {
    const entry = seal(this.list.length + 1, at, this.list.at(-1)?.hash ?? GENESIS, record);
    const existing = gateDecisionReplay(this.list, entry.record);
    if (existing) return structuredClone(existing);
    this.list.push(entry);
    return structuredClone(entry);
  }
  entries(): readonly LedgerEntry[] {
    return structuredClone(this.list);
  }
}
export { CHAIN_SCOPE, type LedgerCheck, verifyLedger } from "./verify.js";
