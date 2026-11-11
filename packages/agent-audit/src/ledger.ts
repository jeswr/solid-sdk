// AUTHORED-BY Codex GPT-6.1-Sol
// Ported from personal-agent/src/pilot/store/ledger.ts.
import { GENESIS, type LedgerEntry, type LedgerRecord, seal } from "./records.js";

export interface EvidenceLedger {
  append(record: LedgerRecord, at: string): LedgerEntry;
  entries(): readonly LedgerEntry[];
}
export class MemoryLedger implements EvidenceLedger {
  private readonly list: LedgerEntry[] = [];
  append(record: LedgerRecord, at: string): LedgerEntry {
    const entry = seal(this.list.length + 1, at, this.list.at(-1)?.hash ?? GENESIS, record);
    this.list.push(entry);
    return structuredClone(entry);
  }
  entries(): readonly LedgerEntry[] {
    return structuredClone(this.list);
  }
}
export { CHAIN_SCOPE, type LedgerCheck, verifyLedger } from "./verify.js";
