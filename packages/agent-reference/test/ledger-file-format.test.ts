// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import {
  FileLedger,
  LEDGER_GENESIS,
  type LedgerEntry,
  readLedgerSegment,
  verifyLedgerAtHead,
  verifyLedgerRange,
} from "../src/store/ledger.js";

const now = "2026-11-20T09:00:00Z";
const temp = (run: (path: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "record-format-"));
  try {
    run(join(dir, "record.jsonl"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

it("writes N-Quads blocks ending with the entry hash and reopens at the same head", () =>
  temp((path) => {
    const ledger = new FileLedger(path);
    const first = ledger.append({ type: "event", value: [4, 2, 4] }, now);
    const second = ledger.append({ type: "event", value: null }, now);
    const text = readFileSync(path, "utf8");
    expect(text).toMatch(/^<urn:awp:/);
    expect(text.trimEnd().split("\n").at(-1)).toContain("#entryHash>");
    const reopened = new FileLedger(path);
    expect(readLedgerSegment(path)).toEqual([first, second]);
    expect(reopened.entries()).toEqual([first, second]);
    expect(reopened.head()).toEqual(ledger.head());
    expect(verifyLedgerAtHead(reopened.entries(), ledger.head()).ok).toBe(true);
  }));

it("keeps a legacy checkpointed segment in JSONL until rotation", () =>
  temp((path) => {
    for (const suffix of ["", ".seg-000002"])
      cpSync(
        new URL("fixtures/legacy/ledger-v1/record.jsonl" + suffix, import.meta.url),
        path + suffix,
      );
    const original = readFileSync(path, "utf8");
    const ledger = new FileLedger(path, { segmentMaxEntries: 3, maxSegments: 4 });
    expect(verifyLedgerAtHead(ledger.entries(), ledger.head())).toMatchObject({
      ok: true,
      prunedThroughSeq: 2,
    });
    ledger.append({ type: "event", value: 7 }, now);
    const extended = readFileSync(path, "utf8");
    expect(extended.startsWith(original + "{")).toBe(true);
    ledger.append({ type: "event", value: 8 }, now);
    expect(readFileSync(path + ".seg-000003", "utf8")).toBe(extended);
    expect(readFileSync(path, "utf8")).toMatch(/^<urn:awp:/);
    const reopened = new FileLedger(path);
    expect(reopened.entries()).toEqual(ledger.entries());
    expect(verifyLedgerAtHead(reopened.entries(), ledger.head()).ok).toBe(true);
  }));

it("recovers a saved prefix across both formats and preserves the prefix bytes", () =>
  temp((path) => {
    const legacy = new FileLedger(path, { segmentFormat: "jsonl" });
    legacy.append({ type: "event" }, now);
    const bytes = readFileSync(path);
    const saved = legacy.head();
    const ledger = new FileLedger(path, { segmentMaxEntries: 2 });
    ledger.append({ type: "uncommitted" }, now);
    ledger.append({ type: "uncommitted" }, now);
    expect(readFileSync(path, "utf8")).toMatch(/^<urn:awp:/);
    expect(() => ledger.recoverUncommittedSuffix({ ...saved, hash: "wrong" })).toThrow(
      "invalid saved head",
    );
    ledger.recoverUncommittedSuffix(saved);
    expect(readFileSync(path + ".seg-000001")).toEqual(bytes);
    expect(ledger.head()).toEqual(saved);
    ledger.append({ type: "replacement" }, now);
    expect(verifyLedgerAtHead(ledger.entries(), ledger.head()).ok).toBe(true);
  }));

it.each(["false", "null", "[]", '"entry"', "0"])("rejects %s as the first JSONL entry", (line) =>
  temp((path) => {
    const ledger = new FileLedger(path, { segmentFormat: "jsonl" });
    const first = ledger.append({ type: "event", value: 1 }, now);
    const last = ledger.append({ type: "event", value: 2 }, now);
    const saved = ledger.head();
    const tampered = { ...last, record: { ...last.record, value: 3 } };
    writeFileSync(path, `${line}\n${JSON.stringify(first)}\n${JSON.stringify(tampered)}\n`);

    expect(() => verifyLedgerAtHead(ledger.entries(), saved)).toThrow(
      "Stored ledger entries require a record",
    );
  }));

it.each(["head", "range"])("rejects a missing row during %s verification", (mode) =>
  temp((path) => {
    const ledger = new FileLedger(path);
    const entry = ledger.append({ type: "event" }, now);
    const rows: LedgerEntry[] = [];
    rows[1] = entry;
    const result =
      mode === "head"
        ? verifyLedgerAtHead(rows, ledger.head())
        : verifyLedgerRange(rows, LEDGER_GENESIS, ledger.head());
    expect(result.ok).toBe(false);
  }));

it.each(["before", "between"])("rejects a non-entry JSONL line %s retained entries", (position) =>
  temp((path) => {
    const ledger = new FileLedger(path, { segmentFormat: "jsonl" });
    const first = ledger.append({ type: "event", value: 1 }, now);
    const second = ledger.append({ type: "event", value: 2 }, now);
    const saved = ledger.head();
    const uncommitted = ledger.append({ type: "event", value: 3 }, now);
    const lines = [first, second, uncommitted].map((entry) => JSON.stringify(entry));
    lines.splice(position === "before" ? 0 : 1, 0, "false");
    const corrupted = `${lines.join("\n")}\n`;
    writeFileSync(path, corrupted);

    expect(() => new FileLedger(path)).toThrow("Stored ledger entries require a record");
    expect(() => ledger.recoverUncommittedSuffix(saved)).toThrow(
      "Stored ledger entries require a record",
    );
    expect(readFileSync(path, "utf8")).toBe(corrupted);
  }));

it("restores the JSONL final newline at the saved head before appending", () =>
  temp((path) => {
    const legacy = new FileLedger(path, { segmentFormat: "jsonl" });
    const first = legacy.append({ type: "event", value: 1 }, now);
    const saved = legacy.head();
    const complete = readFileSync(path, "utf8");
    writeFileSync(path, complete.slice(0, -1));

    const reopened = new FileLedger(path);
    reopened.recoverUncommittedSuffix(saved);
    expect(readFileSync(path, "utf8")).toBe(complete);
    const second = reopened.append({ type: "event", value: 2 }, now);
    expect(readLedgerSegment(path)).toEqual([first, second]);
    expect(verifyLedgerAtHead(readLedgerSegment(path), reopened.head()).ok).toBe(true);
  }));

it.each(["jsonl", "nquads"] as const)("round-trips a record type containing NUL in %s", (format) =>
  temp((path) => {
    const ledger = new FileLedger(path, { segmentFormat: format });
    const record = { type: "custom\u0000event" };
    const entry = ledger.append(record, now);
    const reopened = new FileLedger(path);
    expect(reopened.entries()).toEqual([entry]);
    expect(reopened.entries()[0]?.record).toEqual(record);
    expect(verifyLedgerAtHead(reopened.entries(), ledger.head()).ok).toBe(true);
  }));

it("rejects malformed and truncated final blocks", () =>
  temp((path) => {
    const ledger = new FileLedger(path);
    ledger.append({ type: "event" }, now);
    appendFileSync(path, readFileSync(path, "utf8").split("\n")[0] + "\n");
    expect(() => readLedgerSegment(path)).toThrow(/incomplete/i);
    expect(() => new FileLedger(path)).toThrow();
  }));

it("refuses an incomplete terminator, a malformed quad and a foreign graph", () =>
  temp((path) => {
    const ledger = new FileLedger(path);
    ledger.append({ type: "event" }, now);
    const complete = readFileSync(path, "utf8");
    writeFileSync(path, complete.slice(0, -1));
    expect(() => readLedgerSegment(path)).toThrow(/incomplete/i);
    writeFileSync(path, "broken quad\n" + complete);
    expect(() => readLedgerSegment(path)).toThrow();
    writeFileSync(path, "<urn:x> <urn:y> <urn:z> <urn:foreign> .\n" + complete);
    expect(() => readLedgerSegment(path)).toThrow("another graph");
  }));

it("recovers JSONL by filtering sequence numbers and rewriting the retained rows", () =>
  temp((path) => {
    const ledger = new FileLedger(path, { segmentFormat: "jsonl" });
    const first = ledger.append({ type: "event" }, now);
    const second = ledger.append({ type: "event" }, now);
    const saved = ledger.head();
    const retained = readFileSync(path, "utf8");
    const uncommitted = ledger.append({ type: "event" }, now);
    writeFileSync(
      path,
      [first, uncommitted, second].map((entry) => ` ${JSON.stringify(entry)}\r\n`).join(""),
    );
    ledger.recoverUncommittedSuffix(saved);
    expect(readFileSync(path, "utf8")).toBe(retained);
    expect(verifyLedgerAtHead(ledger.entries(), saved).ok).toBe(true);
  }));

it("refuses JSONL recovery when an older archive contains an uncommitted row", () =>
  temp((path) => {
    const ledger = new FileLedger(path, { segmentFormat: "jsonl", segmentMaxEntries: 1 });
    ledger.append({ type: "event", value: 1 }, now);
    ledger.append({ type: "event", value: 2 }, now);
    const saved = ledger.head();
    const archive = `${path}.seg-000001`;
    const uncommitted = ledger.append({ type: "event", value: 3 }, now);
    const active = readFileSync(path, "utf8");
    appendFileSync(archive, `${JSON.stringify(uncommitted)}\n`);
    const corrupted = readFileSync(archive, "utf8");

    const reopened = new FileLedger(path);
    expect(() => reopened.recoverUncommittedSuffix(saved)).toThrow(
      "uncommitted rows precede retained rows",
    );
    expect(readFileSync(archive, "utf8")).toBe(corrupted);
    expect(readFileSync(path, "utf8")).toBe(active);
    expect(reopened.head()).toEqual(ledger.head());
  }));

it("refuses N-Quads recovery when the saved entries are not a byte prefix", () =>
  temp((path) => {
    const ledger = new FileLedger(path);
    ledger.append({ type: "event" }, now);
    const firstBlock = readFileSync(path, "utf8");
    ledger.append({ type: "event" }, now);
    const saved = ledger.head();
    const retained = readFileSync(path, "utf8");
    ledger.append({ type: "event" }, now);
    const suffix = readFileSync(path, "utf8").slice(retained.length);
    const corrupted = firstBlock + suffix + retained.slice(firstBlock.length);
    writeFileSync(path, corrupted);
    expect(() => ledger.recoverUncommittedSuffix(saved)).toThrow("invalid saved head");
    expect(readFileSync(path, "utf8")).toBe(corrupted);
  }));
