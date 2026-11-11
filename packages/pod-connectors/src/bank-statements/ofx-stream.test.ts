// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { fileImport } from "../core/testing.js";
import { bankStatementsFileAdapter } from "./file-adapter.js";
import { ofxTransactions } from "./ofx-stream.js";

const START = "<STMTTRN><DTPOSTED>20260120<TRNAMT>-1<NAME>";
const END = "</STMTTRN>";
const SMALL = `${START}Synthetic transaction${END}`;

async function* chunks(text: string, size: number): AsyncGenerator<string> {
  for (let offset = 0; offset < text.length; offset += size)
    yield text.slice(offset, offset + size);
}

describe("incremental OFX scanner", () => {
  it.each([
    1, 7, 65536,
  ])("retains bounded account/currency context across sections (%i)", async (size) => {
    const text = `<OFX><STMTRS><CURDEF>GBP<BANKID>synthetic-bank<ACCTID>synthetic-current${SMALL}</STMTRS><CCSTMTRS><CURDEF>EUR<ACCTID>synthetic-card${SMALL}</CCSTMTRS></OFX>`;
    const result = await Array.fromAsync(ofxTransactions(chunks(text, size), vi.fn()));
    expect(result).toEqual([
      { block: SMALL, currency: "GBP", bankId: "synthetic-bank", accountId: "synthetic-current" },
      { block: SMALL, currency: "EUR", accountId: "synthetic-card" },
    ]);
  });

  it("marks overlong metadata invalid even if a later currency is valid", async () => {
    const text = `<STMTRS><ACCTID>${"x".repeat(257)}<CURDEF>GBP${SMALL}`;
    const result = await Array.fromAsync(ofxTransactions(chunks(text, 1), vi.fn()));
    expect(result[0]?.currency).toBe("");
    const { report } = await fileImport(
      bankStatementsFileAdapter,
      new File([text.replace("<STMTRS>", "<OFX><STMTRS>")], "a.ofx"),
    );
    expect(report.written).toEqual([]);
    expect(report.skipped).toBe(1);
  });
  it("reads a transaction spread across thousands of chunks", async () => {
    const block = `${START}${"x".repeat(60 * 1024)}${END}`;
    const skip = vi.fn();
    const result = await Array.fromAsync(
      ofxTransactions(chunks(`<OFX><CURDEF>GBP\r\n${block}</OFX>`, 7), skip),
    );
    expect(result).toEqual([{ block, currency: "GBP" }]);
    expect(skip).not.toHaveBeenCalled();
  });

  it.each([
    1, 31, 200_000,
  ])("enforces the exact 64 KiB limit in %i-character chunks", async (size) => {
    const block = `${START}${"x".repeat(64 * 1024 - START.length - END.length)}${END}`;
    const skip = vi.fn();
    const result = await Array.fromAsync(
      ofxTransactions(chunks(`${block}${block.replace(END, `x${END}`)}${SMALL}`, size), skip),
    );
    expect(result.map((value) => value.block)).toEqual([block, SMALL]);
    expect(skip).toHaveBeenCalledTimes(1);
  });

  it("discards an oversized transaction and resumes at the next one", async () => {
    const skip = vi.fn();
    const result = await Array.fromAsync(
      ofxTransactions(chunks(`${START}${"x".repeat(2 * 1024 * 1024)}${END}${SMALL}`, 31), skip),
    );
    expect(result).toEqual([{ block: SMALL, currency: undefined }]);
    expect(skip).toHaveBeenCalledTimes(1);
  });

  it.each([
    "unterminated",
    "x".repeat(128 * 1024),
  ])("counts an unfinished transaction once (%#)", async (text) => {
    const skip = vi.fn();
    expect(await Array.fromAsync(ofxTransactions(chunks(`${START}${text}`, 17), skip))).toEqual([]);
    expect(skip).toHaveBeenCalledTimes(1);
  });

  it("counts UTF-8 bytes and preserves split multibyte text", async () => {
    const block = `${START}${"🌍".repeat(16_000)}${END}`;
    const tooLarge = `${START}${"é".repeat(33_000)}${END}`;
    const skip = vi.fn();
    // Native decoding emits complete code points; choose boundaries around the
    // scanner's overlap that would otherwise split a surrogate pair.
    async function* unicodeChunks() {
      yield START;
      for (let i = 0; i < 16_000; i++) yield "🌍";
      yield END;
      yield tooLarge;
    }
    expect(await Array.fromAsync(ofxTransactions(unicodeChunks(), skip))).toEqual([
      { block, currency: undefined },
    ]);
    expect(skip).toHaveBeenCalledTimes(1);
  });

  it("accepts case-insensitive split delimiters and recovers from an unfinished record", async () => {
    const skip = vi.fn();
    const block = SMALL.toLowerCase();
    expect(
      await Array.fromAsync(ofxTransactions(chunks(`${START}unfinished${block}`, 1), skip)),
    ).toEqual([{ block, currency: undefined }]);
    expect(skip).toHaveBeenCalledTimes(1);
  });

  it("reports skipped oversized records without counting them as imported items", async () => {
    const text = `<OFX>${START}${"x".repeat(128 * 1024)}${END}${SMALL}</OFX>`;
    const { report } = await fileImport(bankStatementsFileAdapter, new File([text], "bank.ofx"));
    expect(report.skipped).toBe(1);
    expect(report.state?.counts).toEqual({ documents: 1, items: 2, skipped: 1 });
  });
});
