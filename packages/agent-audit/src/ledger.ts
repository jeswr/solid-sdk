// AUTHORED-BY Codex GPT-6.1-Sol
// Ported from personal-agent/src/pilot/store/ledger.ts.
import { digestOf } from "@jeswr/agent-model";
import { entrySchema, GENESIS, type LedgerEntry, type LedgerRecord, seal } from "./records.js";

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
export interface LedgerCheck {
  readonly ok: boolean;
  readonly entries: number;
  readonly firstBadSeq?: number;
  readonly problem?: string;
  readonly prunedThroughSeq?: number;
  readonly scope: string;
}
export const CHAIN_SCOPE =
  "Integrity of retained entries only; unrecorded events and tail truncation cannot be detected without an independently trusted head.";
/** Checkpoints attest retention, not independent proof of the deleted prefix. */
export function verifyLedger(input: readonly LedgerEntry[]): LedgerCheck {
  const fail = (problem: string, firstBadSeq?: number): LedgerCheck => ({
    ok: false,
    entries: input.length,
    problem,
    firstBadSeq,
    scope: CHAIN_SCOPE,
  });
  const entries: LedgerEntry[] = [];
  for (const value of input) {
    const parsed = entrySchema.safeParse(value);
    if (!parsed.success) return fail("malformed entry");
    entries.push(parsed.data);
  }
  const first = entries[0];
  let prev = GENESIS;
  let prunedThroughSeq: number | undefined;
  if (first && first.seq !== 1) {
    if (
      !entries.some(
        (e) =>
          e.record.type === "ledger-checkpoint" &&
          e.record.lastPrunedSeq === first.seq - 1 &&
          e.record.lastPrunedHash === first.prev,
      )
    )
      return fail("missing prefix without a checkpoint", first.seq);
    prev = first.prev;
    prunedThroughSeq = first.seq - 1;
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as LedgerEntry;
    if (e.seq !== (first as LedgerEntry).seq + i) return fail("sequence gap", e.seq);
    if (e.prev !== prev) return fail("broken link", e.seq);
    const { seq, at, record } = e;
    if (digestOf({ seq, at, prev, record }) !== e.hash) return fail("hash mismatch", e.seq);
    prev = e.hash;
  }
  return { ok: true, entries: entries.length, prunedThroughSeq, scope: CHAIN_SCOPE };
}
