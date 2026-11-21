// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Ported from personal-agent/src/pilot/store/ledger.ts. Single writer per path.
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
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { basename, dirname, join } from "path";
import { type EvidenceLedger, gateDecisionReplay } from "./ledger.js";
import { GENESIS, type LedgerEntry, type LedgerRecord, linkedGateHead, seal } from "./records.js";
import { verifyLedger } from "./verify.js";

export interface LedgerBounds {
  readonly segmentMaxEntries: number;
  readonly maxSegments: number;
}
export const DEFAULT_LEDGER_BOUNDS: LedgerBounds = { segmentMaxEntries: 5000, maxSegments: 40 };
function readSegment(path: string): LedgerEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LedgerEntry);
}
function sync(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
/** fsync each append; checkpoint durable before retention deletes an archive. */
export class FileLedger implements EvidenceLedger {
  private last: LedgerEntry | undefined;
  private currentCount: number;
  private readonly bounds: LedgerBounds;
  constructor(
    private readonly path: string,
    bounds: Partial<LedgerBounds> = {},
  ) {
    this.bounds = { ...DEFAULT_LEDGER_BOUNDS, ...bounds };
    if (
      !Number.isSafeInteger(this.bounds.segmentMaxEntries) ||
      this.bounds.segmentMaxEntries < 2 ||
      !Number.isSafeInteger(this.bounds.maxSegments) ||
      this.bounds.maxSegments < 1
    )
      throw new Error("Invalid ledger bounds");
    const entries = this.entries();
    if (!verifyLedger(entries).ok) throw new Error("Ledger integrity failure");
    this.last = entries.at(-1);
    this.currentCount = readSegment(path).length;
  }
  segments(): string[] {
    const dir = dirname(this.path);
    if (!existsSync(dir)) return [];
    const prefix = `${basename(this.path)}.seg-`;
    return readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && /^\d{12}$/.test(f.slice(prefix.length)))
      .sort()
      .map((f) => join(dir, f));
  }
  private writeLine(entry: LedgerEntry): void {
    const existed = existsSync(this.path);
    const tail = existed ? readFileSync(this.path, "utf8") : "";
    const separator = tail.length > 0 && !tail.endsWith("\n") ? "\n" : "";
    appendFileSync(this.path, `${separator}${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    sync(this.path);
    if (!existed) sync(dirname(this.path));
    this.last = entry;
    this.currentCount++;
  }
  private next(record: LedgerRecord, at: string): LedgerEntry {
    return seal((this.last?.seq ?? 0) + 1, at, this.last?.hash ?? GENESIS, record);
  }
  append(record: LedgerRecord, at: string): LedgerEntry {
    // Validate before rotation: rejected input must never prune evidence.
    const candidate = this.next(record, at);
    const onDisk = this.entries();
    if (!verifyLedger(onDisk).ok || onDisk.at(-1)?.hash !== this.last?.hash)
      throw new Error("Ledger changed outside this writer");
    const existing = gateDecisionReplay(onDisk, candidate.record);
    if (existing) return existing;
    // Retention can append checkpoints. Keep a signed anchor adjacent to its predecessor;
    // let the following ordinary append handle rotation and pruning.
    if (this.last?.record.type === "record-anchor" && record.type === "record-anchor")
      throw new Error("Audit head is already anchored");
    if (record.type !== "record-anchor" && this.currentCount >= this.bounds.segmentMaxEntries)
      this.rotate(at, onDisk);
    const entry = this.next(record, at);
    this.writeLine(entry);
    return structuredClone(entry);
  }
  private rotate(at: string, entries: readonly LedgerEntry[]): void {
    renameSync(this.path, `${this.path}.seg-${String(this.last?.seq).padStart(12, "0")}`);
    sync(dirname(this.path));
    this.currentCount = 0;
    const archived = this.segments();
    const excess = archived.length - this.bounds.maxSegments;
    if (excess <= 0) return;
    // The newest anchor may be awaiting its separate gate witness. Keep both candidates
    // and their predecessors until a later anchor supersedes them.
    const protectedHeads = entries
      .filter(({ record }) => record.type === "record-anchor")
      .slice(-2);
    const protectedSeq = protectedHeads[0] ? protectedHeads[0].seq - 1 : Infinity;
    let lastPrunedGate: ReturnType<typeof linkedGateHead>;
    const includeGateLink = ({ record }: LedgerEntry) => {
      const link = linkedGateHead(record);
      if (link && (!lastPrunedGate || link.seq > lastPrunedGate.seq)) lastPrunedGate = link;
    };
    for (const entry of entries) {
      if (entry.record.type === "ledger-checkpoint") includeGateLink(entry);
    }
    for (const p of archived.slice(0, excess)) {
      const segment = readSegment(p);
      const last = segment.at(-1) as LedgerEntry;
      if (last.seq >= protectedSeq) break;
      for (const entry of segment) includeGateLink(entry);
      // Every interrupted deletion prefix needs its own durable checkpoint.
      this.writeLine(
        this.next(
          {
            type: "ledger-checkpoint",
            lastPrunedSeq: last.seq,
            lastPrunedHash: last.hash,
            ...(lastPrunedGate && { lastPrunedGate }),
          },
          at,
        ),
      );
      rmSync(p);
      sync(dirname(this.path));
    }
  }
  entries(): readonly LedgerEntry[] {
    return [...this.segments().flatMap(readSegment), ...readSegment(this.path)];
  }
}
