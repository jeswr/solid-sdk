// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { expect, it } from "vitest";
import { FileLedger, readLedgerSegment, verifyLedgerAtHead } from "../src/store/ledger.js";

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

it("refuses recovery when uncommitted entries are interleaved with the saved prefix", () =>
  temp((path) => {
    const ledger = new FileLedger(path, { segmentFormat: "jsonl" });
    const first = ledger.append({ type: "event" }, now);
    const second = ledger.append({ type: "event" }, now);
    const saved = ledger.head();
    const uncommitted = ledger.append({ type: "event" }, now);
    const corrupted =
      [first, uncommitted, second].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
    writeFileSync(path, corrupted);
    expect(() => ledger.recoverUncommittedSuffix(saved)).toThrow("invalid saved head");
    expect(readFileSync(path, "utf8")).toBe(corrupted);
  }));
