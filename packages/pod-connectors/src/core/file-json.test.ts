// AUTHORED-BY Codex GPT-6.1-Sol
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { chatgptFileAdapter } from "../chatgpt/file-adapter.js";
import { steamFileAdapter } from "../steam/file-adapter.js";
import type { ImportFile } from "./file-import.js";
import { jsonEntries, MAX_JSON_RECORD_BYTES, MAX_JSON_TOKEN_BYTES } from "./file-json.js";
import { fileImport, memoryFile } from "./testing.js";

async function collect(file: ImportFile, onSkip = () => {}) {
  const entries = [];
  for await (const entry of jsonEntries(file, ["", "games"], ["personaname"], onSkip))
    entries.push(entry);
  return entries;
}

function streamed(text: string, chunkSize = 16 * 1024): ImportFile {
  const bytes = new TextEncoder().encode(text);
  return {
    ...memoryFile("synthetic.json", text),
    stream: () => {
      let offset = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.length) controller.close();
          else {
            controller.enqueue(bytes.subarray(offset, offset + chunkSize));
            offset += chunkSize;
          }
        },
      });
    },
  };
}

describe("JSON allocation limits", () => {
  it.each([1, 7, 4096])("preserves escapes and UTF-8 across %i-byte chunks", async (size) => {
    const value = { title: 'Synthetic café 🌍 " \\ \n \u0001', nested: [true, null, -1.25e3] };
    expect(await collect(streamed(JSON.stringify([value]), size))).toEqual([{ path: "", value }]);
    expect(await collect(streamed('{"ignored":"\\u1234\\n","games":[1]}', size))).toEqual([
      { path: "games", value: 1 },
    ]);
  });

  it.each(["x", "é", "🌍"])("bounds tokens by UTF-8 bytes, including quotes (%s)", async (char) => {
    const width = new TextEncoder().encode(char).length;
    const text = char.repeat(Math.floor((MAX_JSON_TOKEN_BYTES - 2) / width));
    const skip = vi.fn();
    const entries = await collect(streamed(JSON.stringify([text, `${text}${char}`, 7])), skip);
    expect(entries).toEqual([
      { path: "", value: text },
      { path: "", value: 7 },
    ]);
    expect(skip).toHaveBeenCalledOnce();
  });

  it("counts raw record bytes, including whitespace, with an inclusive 4 MiB cap", async () => {
    const exact = `{"a":${" ".repeat(MAX_JSON_RECORD_BYTES - 7)}0}`;
    expect(new TextEncoder().encode(exact).length).toBe(MAX_JSON_RECORD_BYTES);
    const skip = vi.fn();
    expect(await collect(streamed(`[${exact}, ${exact},7]`), skip)).toEqual([
      { path: "", value: { a: 0 } },
      { path: "", value: 7 },
    ]);
    expect(skip).toHaveBeenCalledOnce();
  });

  it("bounds records consisting of individually admitted tokens and resumes at the next member", async () => {
    const part = "x".repeat(MAX_JSON_TOKEN_BYTES - 2);
    const record = { parts: Array.from({ length: 5 }, () => part) };
    const skip = vi.fn();
    expect(await collect(streamed(JSON.stringify([record, { name: "Synthetic" }])), skip)).toEqual([
      { path: "", value: { name: "Synthetic" } },
    ]);
    expect(skip).toHaveBeenCalledOnce();
  });

  it("skips oversized selected fields without losing later selectors", async () => {
    const skip = vi.fn();
    const text = `{"personaname":"${"x".repeat(MAX_JSON_TOKEN_BYTES)}","games":[1]}`;
    expect(await collect(streamed(text), skip)).toEqual([{ path: "games", value: 1 }]);
    expect(skip).toHaveBeenCalledOnce();
  });

  it.each([
    `{"${"x".repeat(MAX_JSON_TOKEN_BYTES)}":0,"games":[]}`,
    `{"ignored":"${"x".repeat(MAX_JSON_TOKEN_BYTES)}","games":[]}`,
    `{"ignored":${"1".repeat(MAX_JSON_TOKEN_BYTES + 1)},"games":[]}`,
  ])("fails token overflow outside a selected record (%#)", async (text) => {
    await expect(collect(streamed(text))).rejects.toThrow("JSON token exceeds");
  });

  it.each([
    '{"ignored":"\\q"}',
    '{"ignored":"\\u12z4"}',
    '{"ignored":"line\nbreak"}',
  ])("validates ignored strings without materializing them: %s", async (text) => {
    await expect(collect(streamed(text, 1))).rejects.toThrow("Invalid JSON");
  });

  it.each([
    steamFileAdapter,
    chatgptFileAdapter,
  ])("reports skipped records for $metadata.id", async (adapter) => {
    const huge = "x".repeat(MAX_JSON_TOKEN_BYTES);
    const file = streamed(
      JSON.stringify([
        { name: huge, title: huge },
        { name: "Synthetic", title: "Synthetic" },
      ]),
    );
    const { report } = await fileImport(adapter, file);
    expect(report.skipped).toBe(1);
    expect(report.state?.counts.skipped).toBe(1);
    expect(report.state?.counts.items).toBe(1);
  });

  it("bounds peak heap for a large ignored string and releases the stream on structural overflow", async () => {
    // A separate 64 MiB heap makes this independent of Vitest/other tests' heap.
    // Input is generated lazily: no whole-file string or byte buffer is retained.
    const moduleUrl = new URL("../../dist/core/file-json.js", import.meta.url).href;
    const script = `
      import assert from 'node:assert/strict';
      import { jsonEntries } from ${JSON.stringify(moduleUrl)};
      globalThis.gc();
      const baseline = process.memoryUsage().heapUsed;
      let peak = baseline;
      for (const selected of [false, true]) {
        let reads = 0, cancelled = false;
        const prefix = new TextEncoder().encode(selected ? '[{"ignored":"' : '{"ignored":"');
        const suffix = new TextEncoder().encode(selected ? '"},{"name":"Synthetic"}]' : '","games":[]}');
        const block = new Uint8Array(64 * 1024).fill(120);
        const stream = new ReadableStream({
          pull(controller) {
            peak = Math.max(peak, process.memoryUsage().heapUsed);
            if (reads === 0) controller.enqueue(prefix);
            else if (reads <= 64) controller.enqueue(block);
            else if (reads === 65) controller.enqueue(suffix);
            else controller.close();
            reads++;
          },
          cancel() { cancelled = true; }
        }, { highWaterMark: 0 });
        const file = { name: 'synthetic.json', size: 4 * 1024 * 1024 + 100, type: '',
          text: async () => { throw Error('Must stream'); }, stream: () => stream };
        let skips = 0;
        const entries = [];
        try {
          for await (const entry of jsonEntries(file, ['', 'games'], [], () => skips++)) entries.push(entry.value);
          assert.equal(selected, true);
          assert.equal(skips, 1);
          assert.deepEqual(entries, [{ name: 'Synthetic' }]);
        } catch (error) {
          if (selected) throw error;
          assert.match(error.message, /JSON token exceeds/);
          assert.equal(cancelled, true);
          assert.ok(reads <= 18, 'Stop at the token limit, before consuming the ignored string');
        }
        assert.equal(stream.locked, false);
      }
      assert.ok(peak - baseline < 32 * 1024 * 1024, 'Peak additional heap must stay below 32 MiB');
      console.log(peak - baseline);
    `;
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--max-old-space-size=64",
      "--expose-gc",
      "--input-type=module",
      "-e",
      script,
    ]);
    expect(Number(stdout.trim())).toBeLessThan(32 * 1024 * 1024);
  });
});
