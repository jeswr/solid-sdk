/**
 * The evidence ledger: an append-only, hash-chained JSONL log of the separate records
 * (verification, representation, source authority, authorisation, agreement, grant,
 * activity, outcome, rejection, message digests).
 *
 * The chain lets a reader detect modification, reordering or truncation-in-the-middle of
 * the entries it holds. It does NOT prove completeness: events the writer never recorded,
 * and truncation of the tail, are outside what the chain can show (CT-10). The ledger is
 * written by the runtime/enforcement components, not by domain handlers.
 *
 * Bounded retention (file ledger): the current segment rotates after `segmentMaxEntries`
 * entries; at most `maxSegments` archived segments are kept. Before the oldest segment is
 * deleted a `ledger-checkpoint` entry records its last sequence number and hash, so the
 * retained chain still verifies from that point. Deleting evidence is a governance decision:
 * a managed deployment must set these bounds from its retention policy (and archive before
 * pruning); the pilot defaults are only a safety bound.
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { digestOf } from "../core/canonical.js";
import { fsyncDir } from "./state.js";

/** Any record with a `type`; stored as its JSON form. */
export type LedgerRecord = { readonly type: string };

export interface LedgerEntry {
  readonly seq: number;
  readonly at: string;
  readonly prev: string;
  readonly record: { readonly type: string; readonly [key: string]: unknown };
  readonly hash: string;
}

const GENESIS = "sha-256:genesis";

export interface EvidenceLedger {
  append<T extends LedgerRecord>(record: T, at: string): LedgerEntry;
  entries(): readonly LedgerEntry[];
}

function seal(seq: number, at: string, prev: string, record: LedgerEntry["record"]): LedgerEntry {
  return { seq, at, prev, record, hash: digestOf({ seq, at, prev, record }) };
}

/** In-memory ledger (tests, demo, short-lived scenarios). */
export class MemoryLedger implements EvidenceLedger {
  protected readonly list: LedgerEntry[] = [];

  append<T extends LedgerRecord>(record: T, at: string): LedgerEntry {
    const prev = this.list.at(-1)?.hash ?? GENESIS;
    const entry = seal(this.list.length + 1, at, prev, JSON.parse(JSON.stringify(record)));
    this.list.push(entry);
    return entry;
  }

  entries(): readonly LedgerEntry[] {
    return this.list;
  }
}

export interface LedgerBounds {
  readonly segmentMaxEntries: number;
  readonly maxSegments: number;
}

export const DEFAULT_LEDGER_BOUNDS: LedgerBounds = { segmentMaxEntries: 5_000, maxSegments: 40 };

function readSegment(path: string): LedgerEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LedgerEntry);
}

/**
 * File-backed ledger: each append is one fsync'd JSONL line in the current segment. Only
 * the tail (last entry, current count) is kept in memory.
 */
export class FileLedger implements EvidenceLedger {
  private last: LedgerEntry | undefined;
  private currentCount = 0;
  private readonly bounds: LedgerBounds;

  constructor(
    private readonly path: string,
    bounds: Partial<LedgerBounds> = {},
  ) {
    this.bounds = { ...DEFAULT_LEDGER_BOUNDS, ...bounds };
    const current = readSegment(path);
    this.currentCount = current.length;
    this.last = current.at(-1) ?? readSegment(this.segments().at(-1) ?? "").at(-1);
  }

  /** Archived segment paths, oldest first. */
  segments(): string[] {
    const dir = dirname(this.path);
    const prefix = `${basename(this.path)}.seg-`;
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.startsWith(prefix))
      .sort()
      .map((f) => join(dir, f));
  }

  private writeLine(entry: LedgerEntry): void {
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
    const fd = openSync(this.path, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.last = entry;
    this.currentCount++;
  }

  private sealNext(record: LedgerEntry["record"], at: string): LedgerEntry {
    return seal(
      (this.last?.seq ?? 0) + 1,
      at,
      this.last?.hash ?? GENESIS,
      JSON.parse(JSON.stringify(record)),
    );
  }

  append<T extends LedgerRecord>(record: T, at: string): LedgerEntry {
    if (this.currentCount >= this.bounds.segmentMaxEntries) this.rotate(at);
    const entry = this.sealNext(record as unknown as LedgerEntry["record"], at);
    this.writeLine(entry);
    return entry;
  }

  private rotate(at: string): void {
    const next =
      this.segments().length === 0
        ? 1
        : Number.parseInt((this.segments().at(-1) ?? "").split(".seg-")[1] ?? "0", 10) + 1;
    renameSync(this.path, `${this.path}.seg-${String(next).padStart(6, "0")}`);
    fsyncDir(dirname(this.path));
    this.currentCount = 0;
    const archived = this.segments();
    const excess = archived.length - this.bounds.maxSegments;
    if (excess <= 0) return;
    const pruned = archived.slice(0, excess);
    const lastPruned = readSegment(pruned.at(-1) as string).at(-1);
    // Checkpoint FIRST, then delete: the retained chain stays verifiable from here.
    this.writeLine(
      this.sealNext(
        {
          type: "ledger-checkpoint",
          prunedSegments: pruned.map((p) => basename(p)),
          lastPrunedSeq: lastPruned?.seq ?? 0,
          lastPrunedHash: lastPruned?.hash ?? GENESIS,
          note: "older evidence removed under the configured retention bound",
        },
        at,
      ),
    );
    for (const p of pruned) rmSync(p, { force: true });
    fsyncDir(dirname(this.path));
  }

  /** All retained entries (archived segments + current), oldest first. Bounded by policy. */
  entries(): readonly LedgerEntry[] {
    return [...this.segments().flatMap(readSegment), ...readSegment(this.path)];
  }
}

export interface LedgerCheck {
  readonly ok: boolean;
  readonly entries: number;
  readonly firstBadSeq?: number;
  readonly problem?: string;
  /** Present when older entries were pruned under a recorded checkpoint. */
  readonly prunedThroughSeq?: number;
  readonly scope: string;
}

/** Recompute the chain. Reports the first inconsistency. */
export function verifyLedger(entries: readonly LedgerEntry[]): LedgerCheck {
  const scope =
    "chain integrity of the entries present; does not establish that unrecorded events did not occur or that the tail was not truncated";
  const fail = (e: LedgerEntry, problem: string): LedgerCheck => ({
    ok: false,
    entries: entries.length,
    firstBadSeq: e.seq,
    problem,
    scope,
  });
  const first = entries[0];
  let prev = GENESIS;
  let prunedThroughSeq: number | undefined;
  if (first && first.seq !== 1) {
    // A pruned prefix is acceptable only if a retained checkpoint attests its end.
    const cp = entries.find(
      (e) =>
        e.record.type === "ledger-checkpoint" &&
        e.record.lastPrunedSeq === first.seq - 1 &&
        e.record.lastPrunedHash === first.prev,
    );
    if (!cp) return fail(first, "missing prefix without a checkpoint");
    prev = first.prev;
    prunedThroughSeq = first.seq - 1;
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e) break;
    if (e.seq !== (first?.seq ?? 1) + i) return fail(e, "sequence gap");
    if (e.prev !== prev) return fail(e, "broken link");
    if (seal(e.seq, e.at, e.prev, e.record).hash !== e.hash) return fail(e, "hash mismatch");
    prev = e.hash;
  }
  return {
    ok: true,
    entries: entries.length,
    ...(prunedThroughSeq !== undefined ? { prunedThroughSeq } : {}),
    scope,
  };
}
