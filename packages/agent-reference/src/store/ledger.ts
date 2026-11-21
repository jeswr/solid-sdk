// AUTHORED-BY Codex GPT-6.2 Sol
/**
 * The evidence ledger: an append-only, hash-chained log of the separate records
 * (verification, representation, source authority, authorisation, agreement, grant,
 * activity, outcome, rejection, message digests).
 *
 * The chain lets a reader detect modification, reordering or truncation-in-the-middle of
 * the entries it holds. It does NOT prove completeness: events the writer never recorded,
 * and truncation of the tail, are outside what the chain can show (CT-10). The ledger is
 * written by the runtime/enforcement components, not by domain handlers.
 *
 * Bounded retention (file ledger): the current segment rotates after `segmentMaxEntries`
 * entries; retention keeps `maxSegments` archived segments after pruning. Before a segment
 * is deleted a `ledger-checkpoint` entry records its last sequence number and hash, so the
 * retained chain still verifies from that point. Runtimes with an independent durable head
 * save that head before deleting any segments. Deleting evidence is a governance decision:
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
  // biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
} from "fs";
import { DataFactory } from "n3";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { basename, dirname, join } from "path";
import { digestOf } from "../core/canonical.js";
import { recordEntryDataset, recordEntryFrom } from "../model/store/record.js";
import { decodeLocalStoreUtf8, readNQuads, writeNQuads } from "../wire/store-quads.js";
import { fsyncDir, writeFileDurable } from "./state.js";

/** Any record with a `type`; stored as its JSON form. */
export type LedgerRecord = { readonly type: string };

export interface LedgerEntry {
  readonly seq: number;
  readonly at: string;
  readonly prev: string;
  readonly record: { readonly type: string; readonly [key: string]: unknown };
  readonly hash: string;
  /** Present on entries that support withholding the record while proving the chain. */
  readonly recordDigest?: string;
}

export type LedgerRangeEntry =
  | LedgerEntry
  | (Omit<LedgerEntry, "record" | "recordDigest"> & {
      readonly recordDigest?: string;
      readonly record: null;
    });

/** The public chain fields a peer may attest after reviewing a private legacy approval row. */
export function legacyApprovalRedaction(entry: LedgerEntry): LedgerRangeEntry | undefined {
  if (entry.record.type !== "approval" || typeof entry.record.jws !== "string") return undefined;
  const { seq, at, prev, hash, recordDigest } = entry;
  return { seq, at, prev, hash, record: null, ...(recordDigest ? { recordDigest } : {}) };
}

const GENESIS = "sha-256:genesis";

export interface LedgerHead {
  readonly seq: number;
  readonly hash: string;
}

export const LEDGER_GENESIS: LedgerHead = Object.freeze({ seq: 0, hash: GENESIS });

export interface EvidenceLedger {
  /** The writer's head, maintained independently of entries supplied to a reader. */
  head?(): LedgerHead;
  enableRangeCommitments?(): void;
  deferPruning?(): void;
  /** Resume writes at a verified state-store head, excluding any uncommitted tail. */
  recoverUncommittedSuffix?(head: LedgerHead): void;
  /** Write retention checkpoints and return the deletion to perform after saving the head. */
  preparePruning?(at: string): (() => void) | undefined;
  readonly requiresTrustedCheckpoint?: boolean;
  append<T extends LedgerRecord>(record: T, at: string): LedgerEntry;
  entries(): readonly LedgerEntry[];
}

function requireFiniteNumber(_key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new TypeError("Corrupt ledger: non-finite number");
  return value;
}

function snapshotRecord(record: LedgerRecord): LedgerEntry["record"] {
  return JSON.parse(JSON.stringify(record, requireFiniteNumber));
}

function ledgerDigest(value: unknown): string {
  // JSON serialization would otherwise collapse non-finite numbers to null.
  JSON.stringify(value, requireFiniteNumber);
  return digestOf(value);
}

function seal(
  seq: number,
  at: string,
  prev: string,
  record: LedgerEntry["record"],
  committed = false,
): LedgerEntry {
  if (!committed) return { seq, at, prev, record, hash: ledgerDigest({ seq, at, prev, record }) };
  const recordDigest = ledgerDigest(record);
  return {
    seq,
    at,
    prev,
    record,
    recordDigest,
    hash: ledgerDigest({ seq, at, prev, recordDigest }),
  };
}

function validSeal(entry: LedgerRangeEntry): boolean {
  const { seq, at, prev, record, recordDigest, hash } = entry;
  if (recordDigest !== undefined)
    return (
      (record === null || ledgerDigest(record) === recordDigest) &&
      ledgerDigest({ seq, at, prev, recordDigest }) === hash
    );
  return record !== null && seal(seq, at, prev, record).hash === hash;
}

/** In-memory ledger (tests, demo, short-lived scenarios). */
export class MemoryLedger implements EvidenceLedger {
  protected readonly list: LedgerEntry[] = [];
  private committed = false;
  private tip: LedgerHead = { seq: 0, hash: GENESIS };

  enableRangeCommitments(): void {
    this.committed = true;
  }

  head(): LedgerHead {
    return { ...this.tip };
  }

  append<T extends LedgerRecord>(record: T, at: string): LedgerEntry {
    const entry = seal(this.tip.seq + 1, at, this.tip.hash, snapshotRecord(record), this.committed);
    this.list.push(entry);
    this.tip = { seq: entry.seq, hash: entry.hash };
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

export interface FileLedgerOptions extends Partial<LedgerBounds> {
  /** Format for segments created by this writer. Existing segments keep their format. */
  readonly segmentFormat?: "nquads" | "jsonl";
}

type SegmentFormat = NonNullable<FileLedgerOptions["segmentFormat"]>;
// Every block ends with the entry's own entryHash statement. Matching the
// subject and predicate keeps identical text inside a literal from closing a block.
const ENTRY_BOUNDARY =
  /^\s*<(urn:awp:record:[a-f0-9]{64})>[ \t]+<https:\/\/w3id\.org\/jeswr\/awp#entryHash>[ \t]+/;

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLedgerRecord(value: unknown): value is LedgerEntry["record"] {
  return isRecordObject(value) && typeof value.type === "string";
}

function readLegacyLine(line: string): LedgerEntry {
  const entry: unknown = JSON.parse(line, requireFiniteNumber);
  if (!isRecordObject(entry) || !isLedgerRecord(entry.record))
    throw new TypeError("Stored ledger entries require a record");
  if (
    typeof entry.seq !== "number" ||
    !Number.isSafeInteger(entry.seq) ||
    entry.seq < 1 ||
    typeof entry.hash !== "string" ||
    !entry.hash
  )
    throw new TypeError("Corrupt ledger: JSONL row has an invalid sequence or hash");
  return entry as unknown as LedgerEntry;
}

function writeLegacyLine(path: string, entry: LedgerEntry): void {
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
}

function writeLegacyRecovery(path: string, entries: readonly LedgerEntry[]): void {
  writeFileDurable(path, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""), "wx");
}

function writeRecordBlock(path: string, entry: LedgerEntry): void {
  const lines = writeNQuads(recordEntryDataset(entry)).split("\n");
  const index = lines.findIndex((line) => ENTRY_BOUNDARY.test(line));
  if (index < 0) throw new TypeError("Missing record entry hash");
  const [hashLine] = lines.splice(index, 1);
  lines.splice(-1, 0, hashLine!);
  appendFileSync(path, lines.join("\n"), { encoding: "utf8" });
}

type SegmentRow = { entry: LedgerEntry; end: number };

// Share decoded prefixes across short-lived ledger instances. Compare the actual
// bytes on every read; file size, mtime, and the entry's own hash are not cache keys.
const DECODED_SEGMENT_BYTES = 16 * 1024 * 1024;
const decodedSegments = new Map<string, { bytes: Buffer; rows: readonly SegmentRow[] }>();
let decodedSegmentBytes = 0;

function forgetDecodedSegment(path: string): void {
  decodedSegmentBytes -= decodedSegments.get(path)?.bytes.length ?? 0;
  decodedSegments.delete(path);
}

function rememberDecodedSegment(path: string, bytes: Buffer, rows: readonly SegmentRow[]): void {
  if (bytes.length > DECODED_SEGMENT_BYTES) return;
  decodedSegments.set(path, { bytes, rows });
  decodedSegmentBytes += bytes.length;
  for (const oldest of decodedSegments.keys()) {
    if (decodedSegmentBytes <= DECODED_SEGMENT_BYTES) break;
    forgetDecodedSegment(oldest);
  }
}

function readSegment(path: string) {
  const bytes = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
  const cached = decodedSegments.get(path);
  forgetDecodedSegment(path);
  const prefix =
    cached && bytes.subarray(0, cached.bytes.length).equals(cached.bytes) ? cached : undefined;
  const text = decodeLocalStoreUtf8(bytes.subarray(prefix?.bytes.length ?? 0));
  const first = text.trimStart()[0];
  // Store RDF begins with a named subject (or a comment). Legacy JSON can begin with a scalar.
  const format: SegmentFormat | undefined =
    prefix || first === "<" || first === "#" ? "nquads" : text ? "jsonl" : undefined;
  const rows = prefix ? [...prefix.rows] : [];
  const offset = rows.at(-1)?.end ?? 0;
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let start = 0;
  let end = 0;
  for (const line of lines) {
    end += line.length + 1;
    if (format === "jsonl") {
      if (!line.trim()) throw new TypeError("Corrupt ledger: blank JSONL row");
      rows.push({ entry: readLegacyLine(line), end });
      continue;
    }
    if (!line.trim()) continue;
    const match = ENTRY_BOUNDARY.exec(line);
    if (!match?.[1]) continue;
    if (end > text.length) throw new TypeError("Incomplete record block");
    const graph = match[1];
    const dataset = readNQuads(text.slice(start, end));
    if (dataset.countQuads(null, null, null, DataFactory.namedNode(graph)) !== dataset.size)
      throw new TypeError("Record block contains another graph");
    const entry = recordEntryFrom(dataset, graph);
    if (entry.record === null) throw new TypeError("Stored ledger entries require a record");
    rows.push({ entry: entry as LedgerEntry, end: offset + end });
    start = end;
  }
  if (format === "nquads" && text.slice(start).trim())
    throw new TypeError("Incomplete record block");
  // A saved prefix must end at a block boundary so an append can resume parsing there.
  if (format === "nquads" && start === text.length) rememberDecodedSegment(path, bytes, rows);
  return { format, rows, bytes };
}

/** Read one retained segment, choosing its durable format from the first non-blank byte. */
export function readLedgerSegment(path: string): LedgerEntry[] {
  const { format, rows } = readSegment(path);
  // The public rows must never alias the private cache, even through nested values.
  return rows.map(({ entry }) => (format === "nquads" ? structuredClone(entry) : entry));
}

/**
 * File-backed ledger: each append writes and fsyncs one block in the current segment.
 * Only the tail (last entry, current count and format) is kept in memory.
 */
export class FileLedger implements EvidenceLedger {
  readonly requiresTrustedCheckpoint = true;
  private last: LedgerHead | undefined;
  private currentCount = 0;
  private committed = false;
  private pruningDeferred = false;
  private readonly bounds: LedgerBounds;
  private readonly segmentFormat: SegmentFormat;
  private currentFormat?: SegmentFormat;

  constructor(
    private readonly path: string,
    bounds: FileLedgerOptions = {},
  ) {
    this.bounds = { ...DEFAULT_LEDGER_BOUNDS, ...bounds };
    this.segmentFormat = bounds.segmentFormat ?? "nquads";
    const current = readSegment(path);
    this.currentFormat = current.format;
    this.currentCount = current.rows.length;
    const tail =
      current.rows.at(-1)?.entry ?? readSegment(this.segments().at(-1) ?? "").rows.at(-1)?.entry;
    if (tail) this.last = { seq: tail.seq, hash: tail.hash };
    this.committed = tail?.recordDigest !== undefined;
  }

  enableRangeCommitments(): void {
    this.committed = true;
  }

  deferPruning(): void {
    this.pruningDeferred = true;
  }

  head(): LedgerHead {
    return this.last ? { seq: this.last.seq, hash: this.last.hash } : { seq: 0, hash: GENESIS };
  }

  recoverUncommittedSuffix(head: LedgerHead): void {
    const paths = [...this.segments(), this.path];
    const segments = paths.map((path) => {
      const segment = readSegment(path);
      const kept = segment.rows.filter(({ entry }) => entry.seq <= head.seq);
      return { path, ...segment, kept };
    });
    const prefix = segments.flatMap(({ kept }) => kept.map(({ entry }) => entry));
    const lastKept = segments.findLastIndex(({ kept }) => kept.length > 0);
    // Earlier segments stay intact, and the last RDF segment is recovered by byte prefix.
    const interleaved = segments.some(({ format, kept, rows }, index) => {
      if (index < lastKept) return kept.length !== rows.length;
      return format === "nquads" && kept.length > 0 && kept.at(-1) !== rows[kept.length - 1];
    });
    if (interleaved)
      throw new Error(
        "Cannot resume the evidence ledger at an invalid saved head: uncommitted rows precede retained rows",
      );
    if (!verifyLedgerAtHead(prefix, head).ok)
      throw new Error("Cannot resume the evidence ledger at an invalid saved head");
    // Drop the newest segments first. Every intermediate state retains the saved head.
    this.currentCount = 0;
    this.currentFormat = undefined;
    for (const { path, kept, rows, bytes, format } of segments.reverse()) {
      const tail = kept.at(-1);
      if (!tail) {
        rmSync(path, { force: true });
        forgetDecodedSegment(path);
        fsyncDir(dirname(this.path));
        continue;
      }
      if (format === "jsonl" || kept.length !== rows.length) {
        const tmp = `${this.path}.recovery-tmp`;
        rmSync(tmp, { force: true });
        if (format === "jsonl")
          writeLegacyRecovery(
            tmp,
            kept.map(({ entry }) => entry),
          );
        else writeFileDurable(tmp, decodeLocalStoreUtf8(bytes).slice(0, tail.end), "wx");
        renameSync(tmp, path);
        forgetDecodedSegment(path);
        fsyncDir(dirname(this.path));
      }
      if (path === this.path) {
        this.currentCount = kept.length;
        this.currentFormat = format;
      }
      break;
    }
    const tail = prefix.at(-1);
    this.last = tail && { seq: tail.seq, hash: tail.hash };
    this.committed ||= tail?.recordDigest !== undefined;
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
    const existed = existsSync(this.path);
    const format = this.currentFormat ?? this.segmentFormat;
    if (format === "jsonl") writeLegacyLine(this.path, entry);
    else writeRecordBlock(this.path, entry);
    const fd = openSync(this.path, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (!existed) fsyncDir(dirname(this.path));
    this.last = { seq: entry.seq, hash: entry.hash };
    this.currentFormat = format;
    this.currentCount++;
  }

  private sealNext(record: LedgerEntry["record"], at: string): LedgerEntry {
    return seal((this.last?.seq ?? 0) + 1, at, this.last?.hash ?? GENESIS, record, this.committed);
  }

  append<T extends LedgerRecord>(record: T, at: string): LedgerEntry {
    const snapshot = snapshotRecord(record);
    if (this.currentCount >= this.bounds.segmentMaxEntries) this.rotate(at);
    const entry = this.sealNext(snapshot, at);
    this.writeLine(entry);
    return entry;
  }

  private rotate(at: string): void {
    const next =
      this.segments().length === 0
        ? 1
        : Number.parseInt((this.segments().at(-1) ?? "").split(".seg-")[1] ?? "0", 10) + 1;
    renameSync(this.path, `${this.path}.seg-${String(next).padStart(6, "0")}`);
    forgetDecodedSegment(this.path);
    fsyncDir(dirname(this.path));
    this.currentCount = 0;
    this.currentFormat = undefined;
    if (!this.pruningDeferred) this.preparePruning(at)?.();
  }

  preparePruning(at: string): (() => void) | undefined {
    const archived = this.segments();
    const excess = archived.length - this.bounds.maxSegments;
    if (excess <= 0) return undefined;
    const pruned = archived.slice(0, excess);
    // Every possible retained prefix needs a checkpoint if deletion is interrupted.
    for (const path of pruned) {
      const lastPruned = readSegment(path).rows.at(-1)?.entry;
      if (!lastPruned) throw Error("Cannot checkpoint an empty ledger segment");
      this.writeLine(
        this.sealNext(
          {
            type: "ledger-checkpoint",
            prunedSegments: [basename(path)],
            lastPrunedSeq: lastPruned.seq,
            lastPrunedHash: lastPruned.hash,
            note: "older evidence removed under the configured retention bound",
          },
          at,
        ),
      );
    }
    return () => {
      for (const path of pruned) {
        rmSync(path, { force: true });
        forgetDecodedSegment(path);
        fsyncDir(dirname(this.path));
      }
    };
  }

  /** All retained entries (archived segments + current), oldest first. Bounded by policy. */
  entries(): readonly LedgerEntry[] {
    return [...this.segments().flatMap(readLedgerSegment), ...readLedgerSegment(this.path)];
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
  const fail = (e: LedgerEntry | undefined, problem: string): LedgerCheck => ({
    ok: false,
    entries: entries.length,
    firstBadSeq: e?.seq,
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
        e?.record?.type === "ledger-checkpoint" &&
        e.record.lastPrunedSeq === first.seq - 1 &&
        e.record.lastPrunedHash === first.prev,
    );
    if (!cp) return fail(first, "missing prefix without a checkpoint");
    prev = first.prev;
    prunedThroughSeq = first.seq - 1;
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || !isLedgerRecord(e.record)) return fail(e, "invalid ledger entry");
    if (e.seq !== (first?.seq ?? 1) + i) return fail(e, "sequence gap");
    if (e.prev !== prev) return fail(e, "broken link");
    if (!validSeal(e)) return fail(e, "hash mismatch");
    prev = e.hash;
  }
  return {
    ok: true,
    entries: entries.length,
    ...(prunedThroughSeq !== undefined ? { prunedThroughSeq } : {}),
    scope,
  };
}

/** Verify the retained entries against a head obtained from a trusted writer or witness. */
export function verifyLedgerAtHead(
  entries: readonly LedgerEntry[],
  head: LedgerHead | undefined,
): LedgerCheck {
  const check = verifyLedger(entries);
  if (!check.ok) return check;
  const tail = entries.at(-1);
  return head && head.seq === (tail?.seq ?? 0) && head.hash === (tail?.hash ?? GENESIS)
    ? check
    : { ...check, ok: false, problem: "record does not match a trusted head" };
}

/**
 * Brief 31 item 4: recompute a range of the chain that starts after an anchor entry. The
 * first entry must follow the anchor's sequence and link to its hash; the rest must link
 * through. Whether the anchor itself is attested is the caller's check.
 */
export function verifyLedgerRange(
  entries: readonly LedgerRangeEntry[],
  anchor: LedgerHead,
  terminal?: LedgerHead,
  witnessedApprovals?: ReadonlySet<string>,
): LedgerCheck {
  const scope =
    "chain integrity of the entries after an attested anchor; does not establish entries before the anchor or after the last one";
  const fail = (e: LedgerRangeEntry | undefined, problem: string): LedgerCheck => ({
    ok: false,
    entries: entries.length,
    firstBadSeq: e?.seq,
    problem,
    scope,
  });
  const tail = entries.at(-1);
  if (!tail || !terminal)
    return { ok: false, entries: entries.length, problem: "missing range terminal", scope };
  let prev = anchor.hash;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e) return fail(e, "invalid ledger entry");
    if (e.seq !== anchor.seq + 1 + i) return fail(e, "sequence gap");
    if (e.prev !== prev) return fail(e, i === 0 ? "anchor link" : "broken link");
    if (
      !validSeal(e) &&
      !(
        e.record === null &&
        e.recordDigest === undefined &&
        witnessedApprovals?.has(ledgerDigest(e))
      )
    )
      return fail(e, "hash mismatch");
    prev = e.hash;
  }
  if (terminal.seq !== tail.seq || terminal.hash !== tail.hash)
    return fail(tail, "range does not match its terminal");
  return { ok: true, entries: entries.length, scope };
}
