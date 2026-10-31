// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { afterEach, expect, it } from "vitest";
import { FileLedger } from "../src/file-ledger.js";
import { MemoryLedger, verifyLedger } from "../src/ledger.js";
import { checkedRecord, ENTRY_KINDS, GENESIS, type LedgerEntry, seal } from "../src/records.js";
import { required } from "./fixture.js";

export const AT = "2026-10-26T12:00:00.000Z";
export const record = {
  type: "ingest",
  id: "urn:event:1",
  agent: "https://example.org/agent#me",
  owner: "https://example.org/owner#me",
} as const;
const dirs: string[] = [];
function file() {
  const dir = mkdtempSync(join(tmpdir(), "audit-ledger-"));
  dirs.push(dir);
  return join(dir, "ledger.jsonl");
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
it("accepts every specified kind, snapshots input/output and uses the pilot hash shape", () => {
  const ledger = new MemoryLedger();
  expect(verifyLedger([]).ok).toBe(true);
  for (const type of ENTRY_KINDS) ledger.append({ ...record, type }, AT);
  ledger.append(
    {
      ...record,
      type: "model-call",
      model: "gpt-5.4",
      provider: "openai",
      context: "reader",
      tokens: 1,
    },
    AT,
  );
  const e = ledger.append({ ...record }, AT);
  e.record.type = "control";
  const entries = ledger.entries() as LedgerEntry[];
  required(entries[0]).hash = "bad";
  expect(verifyLedger(ledger.entries()).ok).toBe(true);
  expect(ledger.entries()[0]).toEqual(seal(1, AT, GENESIS, record));
});
it("detects modification, reordering, middle truncation, missing prefix and broken links", () => {
  const l = new MemoryLedger();
  for (let i = 0; i < 4; i++) l.append(record, AT);
  const e = l.entries();
  expect(verifyLedger([{ ...required(e[0]), at: "2026-10-27T12:00:00.000Z" }]).problem).toBe(
    "hash mismatch",
  );
  expect(verifyLedger([required(e[0]), required(e[2]), required(e[1])]).problem).toBe(
    "sequence gap",
  );
  expect(verifyLedger([required(e[0]), required(e[2]), required(e[3])]).ok).toBe(false);
  expect(verifyLedger(e.slice(1)).problem).toContain("missing prefix");
  expect(verifyLedger([{ ...required(e[0]), prev: required(e[1]).hash }]).problem).toBe(
    "broken link",
  );
  expect(verifyLedger([null] as unknown as LedgerEntry[]).problem).toBe("malformed entry");
  expect(verifyLedger(e.slice(0, -1))).toMatchObject({
    ok: true,
    scope: expect.stringContaining("tail truncation"),
  });
});
it("refuses non-JSON values, bodies, raw recipients, unknown fields and invalid metadata", () => {
  for (const value of [
    { ...record, body: "private" },
    { ...record, recipientHashes: ["person@example.org"] },
    { ...record, type: "other" },
    { ...record, reason: "free text" },
    { ...record, tokens: -1 },
    { ...record, hidden: undefined },
  ])
    expect(() => checkedRecord(value)).toThrow();
  expect(() => checkedRecord({ ...record, id: `urn:${"a".repeat(65536)}` })).toThrow("bound");
  expect(() => seal(1, "bad", GENESIS, record)).toThrow();
});
it("persists, reopens, rotates, checkpoints before pruning and preserves a verifiable prefix", () => {
  const path = file();
  const ledger = new FileLedger(path, { segmentMaxEntries: 2, maxSegments: 1 });
  for (let i = 0; i < 12; i++) {
    ledger.append(record, AT);
    expect(verifyLedger(ledger.entries()).ok).toBe(true);
  }
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(ledger.segments()).toHaveLength(1);
  expect(verifyLedger(ledger.entries()).prunedThroughSeq).toBeGreaterThan(0);
  const reopened = new FileLedger(path, { segmentMaxEntries: 2, maxSegments: 1 });
  expect(reopened.entries()).toEqual(ledger.entries());
  reopened.append(record, AT);
  expect(verifyLedger(reopened.entries()).ok).toBe(true);
  expect(() => ledger.append(record, AT)).toThrow("outside");
  expect(readFileSync(path, "utf8")).not.toContain("private");
});
it("reopens an archived-only tail after a rotation crash", () => {
  const path = file();
  const l = new FileLedger(path);
  l.append(record, AT);
  writeFileSync(`${path}.seg-000000000001`, readFileSync(path));
  rmSync(path);
  writeFileSync(`${path}.seg-garbage`, "ignored");
  const next = new FileLedger(path);
  expect(next.append(record, AT).seq).toBe(2);
  expect(verifyLedger(next.entries()).ok).toBe(true);
});
it("rejects corrupt storage and invalid bounds without deleting evidence", () => {
  const path = file();
  const l = new FileLedger(path, { segmentMaxEntries: 2, maxSegments: 1 });
  l.append(record, AT);
  l.append(record, AT);
  expect(() => l.append({ ...record, body: "private" } as never, AT)).toThrow();
  expect(l.segments()).toHaveLength(0);
  for (const b of [
    { segmentMaxEntries: 1 },
    { segmentMaxEntries: 2.5 },
    { maxSegments: 0 },
    { maxSegments: NaN },
  ])
    expect(() => new FileLedger(path, b)).toThrow("bounds");
  appendFileSync(path, "null\n");
  expect(() => l.append(record, AT)).toThrow("outside");
  expect(() => new FileLedger(path)).toThrow("integrity");
  writeFileSync(path, "{\n");
  expect(() => new FileLedger(path)).toThrow();
  expect(new FileLedger(join(path, "missing", "ledger")).segments()).toEqual([]);
});
