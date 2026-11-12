// AUTHORED-BY Codex GPT-6.1-Sol
import { canonicalJson, digestOf } from "@jeswr/agent-model/core/canonical";
import { z } from "zod";
import {
  checkedRecord,
  digestSchema,
  entrySchema,
  GENESIS,
  type LedgerEntry,
  MAX_AUDIT_SEQ,
} from "./records.js";

export { type AuditProjectionNode, writeEntryGraph, writeHeadGraph } from "./prov.js";
export {
  type AuditRecord,
  type AuditTerms,
  checkedRecord,
  digestSchema,
  ENTRY_KINDS,
  entrySchema,
  GENESIS,
  instantSchema,
  type LedgerEntry,
  type LedgerRecord,
  ledgerRecordSchema,
  MAX_AUDIT_SEQ,
  recipientHashSchema,
  seal,
  taskIdSchema,
  termsSchema,
} from "./records.js";

export interface AuditHead {
  readonly seq: number;
  readonly hash: string;
}
export const auditHeadSchema = z.object({
  seq: z.number().int().min(1).max(MAX_AUDIT_SEQ),
  hash: digestSchema,
});
/** Validate the canonical lexical sequence and bounded published head. */
export function parseAuditHead(seq: string, hash: string): AuditHead {
  const parsed = auditHeadSchema.safeParse({
    seq: /^[1-9]\d*$/.test(seq) ? Number(seq) : NaN,
    hash,
  });
  if (!parsed.success) {
    const badHash = parsed.error.issues.some((issue) => issue.path[0] === "hash");
    throw new Error(
      badHash
        ? "Invalid audit head: Invalid hash"
        : "Invalid audit head: Audit range exceeds bound",
    );
  }
  return parsed.data;
}

/** Reject lossy JSON, getters and oversized records before they can be hashed. */
export function parseAuditEntry(value: unknown): LedgerEntry {
  const entry = entrySchema.parse(JSON.parse(canonicalJson(value)));
  checkedRecord(entry.record);
  return entry;
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
  return checkChain(input, false).result;
}

interface ChainCheck {
  readonly result: LedgerCheck;
  readonly entries: readonly LedgerEntry[];
}
function checkChain(input: readonly LedgerEntry[], range: boolean): ChainCheck {
  const fail = (problem: string, firstBadSeq?: number): ChainCheck => ({
    result: {
      ok: false,
      entries: input.length,
      problem,
      firstBadSeq,
      scope: CHAIN_SCOPE,
    },
    entries: [],
  });
  const entries: LedgerEntry[] = [];
  for (const value of input) {
    try {
      entries.push(parseAuditEntry(value));
    } catch {
      let seq: unknown;
      try {
        seq = value && Object.getOwnPropertyDescriptor(value, "seq")?.value;
      } catch {
        // A hostile Proxy may also reject the diagnostic read; the entry still fails closed.
      }
      return fail("malformed entry", typeof seq === "number" ? seq : undefined);
    }
  }
  const first = entries[0];
  let prev = GENESIS;
  let prunedThroughSeq: number | undefined;
  if (first && first.seq !== 1 && !range) {
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
  if (range && first && first.seq !== 1) prev = first.prev;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as LedgerEntry;
    if (e.seq !== (first as LedgerEntry).seq + i) return fail("sequence gap", e.seq);
    if (e.prev !== prev || (e.seq > 1 && e.prev === GENESIS)) return fail("broken link", e.seq);
    const { seq, at, record } = e;
    if (digestOf({ seq, at, prev, record }) !== e.hash) return fail("hash mismatch", e.seq);
    prev = e.hash;
  }
  return {
    result: { ok: true, entries: entries.length, prunedThroughSeq, scope: CHAIN_SCOPE },
    entries,
  };
}

export const AUDIT_SCOPE =
  "Checks the records shown here. It can't detect records that were never written.";
export const HEAD_MISSING = "The audit head is missing";
export interface RangeCheck {
  readonly ok: boolean;
  readonly firstBadSeq?: number | undefined;
  readonly problem?: string;
  readonly scope: string;
}
const RANGE_PROBLEMS: Record<string, string> = {
  "malformed entry": "Malformed record",
  "sequence gap": "Sequence gap",
  "broken link": "Broken link",
  "hash mismatch": "Hash mismatch",
};
/** Oldest first. A fetched subrange makes no claim about an omitted prefix. */
export function verifyRange(
  entries: readonly LedgerEntry[],
  head?: AuditHead,
  through?: number,
): RangeCheck {
  const fail = (problem: string, firstBadSeq?: number): RangeCheck => ({
    ok: false,
    problem,
    firstBadSeq,
    scope: AUDIT_SCOPE,
  });
  // Validate one snapshot of the head and use only it: the caller's object may change or
  // throw on a later read.
  let snapshot: AuditHead | undefined;
  if (head) {
    let parsed: ReturnType<typeof auditHeadSchema.safeParse>;
    try {
      parsed = auditHeadSchema.safeParse(head);
    } catch {
      return fail("Malformed head");
    }
    if (!parsed.success) return fail("Malformed head");
    snapshot = parsed.data;
  }
  const end = through === undefined ? snapshot?.seq : through;
  if (end !== undefined && !auditHeadSchema.shape.seq.safeParse(end).success)
    return fail("Invalid range endpoint");
  const { result: chain, entries: parsedEntries } = checkChain(entries, true);
  if (!chain.ok) return fail(RANGE_PROBLEMS[chain.problem as string] as string, chain.firstBadSeq);
  const last = parsedEntries.at(-1);
  if (end !== undefined && (!last || last.seq < end)) return fail(`Record ${end} is missing`, end);
  if (
    snapshot &&
    last &&
    (last.seq > snapshot.seq || (last.seq === snapshot.seq && last.hash !== snapshot.hash))
  )
    return fail("Head mismatch", last.seq);
  return { ok: true, scope: AUDIT_SCOPE };
}
/** A latest-range verdict requires the published head whenever records exist. */
export function verifyLatestRange(
  entries: readonly LedgerEntry[],
  head: AuditHead | undefined,
  through?: number,
): RangeCheck {
  if (!head && entries.length) return { ok: false, problem: HEAD_MISSING, scope: AUDIT_SCOPE };
  return verifyRange(entries, head, through);
}
