// AUTHORED-BY Codex GPT-6.1-Sol
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { amazonOrdersFileAdapter } from "../amazon-orders/file-adapter.js";
import { appleHealthFileAdapter } from "../apple-health/file-adapter.js";
import { bankStatementsFileAdapter } from "../bank-statements/file-adapter.js";
import { goodreadsFileAdapter } from "../goodreads/file-adapter.js";
import { netflixFileAdapter } from "../netflix/file-adapter.js";
import { uberFileAdapter } from "../uber/file-adapter.js";
import {
  MAX_WHATSAPP_CONTINUATION_LINES,
  MAX_WHATSAPP_MESSAGE_BYTES,
  whatsappFileAdapter,
} from "../whatsapp/file-adapter.js";
import type { ImportFile } from "./file-import.js";
import {
  csvRecords,
  csvRows,
  fileText,
  MAX_CSV_RECORD_BYTES,
  MAX_TEXT_LINE_BYTES,
  MAX_XML_TAG_BYTES,
  MAX_XML_TEXT_BYTES,
  textLines,
  xmlTags,
} from "./file-stream.js";
import { fileImport, memoryFile } from "./testing.js";

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

function streamed(text: string, chunkSize = 16 * 1024): ImportFile {
  const bytes = new TextEncoder().encode(text);
  return {
    ...memoryFile("synthetic-export", text),
    text: vi.fn().mockRejectedValue(new Error("Must stream")),
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

// Every admitted unit is inclusive of its byte cap. A later unit must survive
// overflow, even when the discarded unit contains misleading quoted delimiters.
describe("non-JSON allocation limits", () => {
  it.each(["x", "é", "🌍"])("bounds text lines by UTF-8 bytes (%s)", async (char) => {
    const width = new TextEncoder().encode(char).length;
    const exact = char.repeat(MAX_TEXT_LINE_BYTES / width);
    const skip = vi.fn();
    expect(
      await collect(textLines(fileText(streamed(`${exact}\r\n${exact}${char}\r\nlast`)), skip)),
    ).toEqual([exact, "last"]);
    expect(skip).toHaveBeenCalledOnce();
  });

  it.each([
    4096,
    Number.MAX_SAFE_INTEGER,
  ])("bounds XML tags across %i-byte chunks", async (size) => {
    const prefix = '<Workout name="';
    const exact = `${prefix}${"é".repeat((MAX_XML_TAG_BYTES - prefix.length - 3) / 2)}"/>`;
    expect(new TextEncoder().encode(exact).length).toBe(MAX_XML_TAG_BYTES);
    const skip = vi.fn();
    expect(
      await collect(
        xmlTags(
          fileText(streamed(`${exact}${exact.replace('"/>', '>🌍"/>')}<Workout/>`, size)),
          skip,
        ),
      ),
    ).toEqual([exact, "<Workout/>"]);
    expect(skip).toHaveBeenCalledOnce();
  });

  it.each([1, 7, 4096])("retains only selected XML opening tags (%i-byte chunks)", async (size) => {
    const exact = `<Workout name="${"x".repeat(MAX_XML_TAG_BYTES - 18)}"/>`;
    const skip = vi.fn();
    const xml = `<Root><WorkoutExtra/><Record name="Synthetic > ignored"/>${exact}<Workout name="${"x".repeat(MAX_XML_TAG_BYTES)}"/><Workout>ignored text</Workout></Root>`;
    expect(await collect(xmlTags(fileText(streamed(xml, size)), skip, "Workout"))).toEqual([
      exact,
      "<Workout>",
    ]);
    expect(skip).toHaveBeenCalledOnce();
  });

  it.each([
    4096,
    Number.MAX_SAFE_INTEGER,
  ])("discards XML text nodes without buffering (%i-byte chunks)", async (size) => {
    const exact = "🌍".repeat(MAX_XML_TEXT_BYTES / 4);
    const skip = vi.fn();
    const text = `<Ignored>${exact}</Ignored><Ignored>${exact}x</Ignored><Workout/>`;
    expect(await collect(xmlTags(fileText(streamed(text, size)), skip))).toEqual([
      "<Ignored>",
      "</Ignored>",
      "<Ignored>",
      "</Ignored>",
      "<Workout/>",
    ]);
    expect(skip).toHaveBeenCalledOnce();
  });

  it("bounds CDATA text by UTF-8 bytes without retaining it", async () => {
    const exact = "🌍".repeat(MAX_XML_TEXT_BYTES / 4);
    const skip = vi.fn();
    expect(
      await collect(
        xmlTags(
          fileText(streamed(`<![CDATA[${exact}]]><![CDATA[${exact}x]]><Workout/>`, 4096)),
          skip,
        ),
      ),
    ).toEqual(["<Workout/>"]);
    expect(skip).toHaveBeenCalledOnce();
  });

  it.each([
    4096,
    Number.MAX_SAFE_INTEGER,
  ])("bounds CSV records, including quotes and embedded CRLF (%i-byte chunks)", async (size) => {
    const exact = `"${"é".repeat((MAX_CSV_RECORD_BYTES - 2) / 2)}"`;
    const skip = vi.fn();
    const oversized = `"${"🌍".repeat(MAX_CSV_RECORD_BYTES / 4)}\r\n""still quoted""\n"`;
    const text = `Name\r\n${exact}\r\n${oversized}\r\nlast`;
    expect(await collect(csvRows(streamed(text, size), skip))).toEqual([
      { Name: exact.slice(1, -1) },
      { Name: "last" },
    ]);
    expect(skip).toHaveBeenCalledOnce();
  });

  it.each(["line", "record", "text", "tag"])("counts an oversized final %s once", async (unit) => {
    const skip = vi.fn();
    const file = streamed(
      unit === "record"
        ? `Name\n${"x".repeat(MAX_CSV_RECORD_BYTES + 1)}`
        : unit === "tag"
          ? `<Workout name="${"x".repeat(MAX_XML_TAG_BYTES)}"/>`
          : "x".repeat(MAX_TEXT_LINE_BYTES + 1),
    );
    const source = fileText(file);
    if (unit === "record") expect(await collect(csvRecords(source, skip))).toEqual(["Name"]);
    else if (unit === "line") expect(await collect(textLines(source, skip))).toEqual([]);
    else expect(await collect(xmlTags(source, skip))).toEqual([]);
    expect(skip).toHaveBeenCalledOnce();
  });

  it.each([
    1, 7,
  ])("preserves split XML prefixes, closing markers and CSV escapes (%i-byte chunks)", async (size) => {
    const xml = '<Root><!-- -- ---><![CDATA[]]]]><Workout name="A > B"/></Root>';
    expect(await collect(xmlTags(fileText(streamed(xml, size))))).toEqual([
      "<Root>",
      '<Workout name="A > B"/>',
      "</Root>",
    ]);
    expect(await collect(csvRows(streamed('Name,Value\r\n"A""B\nC",🌍\r\nlast,é', size)))).toEqual([
      { Name: 'A"B\nC', Value: "🌍" },
      { Name: "last", Value: "é" },
    ]);
  });

  it.each([
    ['Name\n"unterminated', "quoted CSV record"],
    [`Name\n"${"x".repeat(MAX_CSV_RECORD_BYTES + 1)}`, "quoted CSV record"],
    ['<Workout name="unterminated', "XML tag"],
    [`<Workout name="${"x".repeat(MAX_XML_TAG_BYTES)}`, "XML tag"],
    ["<!--unterminated", "XML comment"],
    ["<![CDATA[unterminated", "XML cdata"],
  ])("fails when no safe boundary exists (%#)", async (text, error) => {
    const file = streamed(text);
    const source = text.startsWith("Name") ? csvRecords(fileText(file)) : xmlTags(fileText(file));
    await expect(collect(source)).rejects.toThrow(`Unterminated ${error}`);
  });

  it("cancels and unlocks on header overflow before reading the rest of the file", async () => {
    const cancel = vi.fn();
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads++;
          controller.enqueue(new Uint8Array(16 * 1024).fill(120));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const file = { ...memoryFile("synthetic.csv", ""), stream: () => stream };
    await expect(collect(csvRows(file))).rejects.toThrow("CSV header exceeds");
    expect(reads).toBe(5);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it.each([
    { adapter: netflixFileAdapter, header: "Title,Date", row: "Synthetic,1/20/2026" },
    {
      adapter: amazonOrdersFileAdapter,
      header: "Order ID,Product Name",
      row: "synthetic,Synthetic",
    },
    {
      adapter: uberFileAdapter,
      header: "City,Begin Trip Time",
      row: "Synthetic,2026-01-01 12:00:00",
    },
    { adapter: goodreadsFileAdapter, header: "Book Id,Title", row: "100,Synthetic" },
    {
      adapter: bankStatementsFileAdapter,
      header: "Date,Description,Amount",
      row: "2026-01-01,Synthetic,-1",
    },
  ])("reports skipped CSV records for $adapter.metadata.id", async ({ adapter, header, row }) => {
    const file = streamed(
      `${header}\n${"x".repeat(MAX_CSV_RECORD_BYTES + 1)}\n${row},extra\n${row}`,
    );
    const { report } = await fileImport(adapter, file);
    expect(report.skipped).toBe(2);
    expect(report.state?.counts.skipped).toBe(2);
  });

  it("reports skipped XML tags and text while preserving the next workout", async () => {
    const file = streamed(
      `<Ignored>${"x".repeat(MAX_XML_TEXT_BYTES + 1)}</Ignored><Workout name="${"x".repeat(MAX_XML_TAG_BYTES)}"/><Workout duration="1"/>`,
    );
    const { report } = await fileImport(appleHealthFileAdapter, file);
    expect(report.skipped).toBe(2);
    expect(report.state?.counts.skipped).toBe(2);
    expect(report.state?.counts.items).toBe(1);
  });

  it("discards a WhatsApp message interrupted by an oversized line until a new timestamp", async () => {
    const text = `[20/01/2026, 12:00:00] Synthetic: discard\n${"x".repeat(MAX_TEXT_LINE_BYTES + 1)}\nignored continuation\n[20/01/2026, 12:01:00] Synthetic: keep`;
    const { report, pod } = await fileImport(whatsappFileAdapter, streamed(text));
    expect(report.skipped).toBe(1);
    expect(report.state?.counts.skipped).toBe(1);
    expect(report.state?.counts.items).toBe(1);
    const values = [...pod.dataset(report.written[0]?.url ?? "")].map((quad) => quad.object.value);
    expect(values).toContain("keep");
    expect(values).not.toContain("discard");
  });

  it.each(["x", "é", "🌍"])("bounds aggregate WhatsApp message bytes (%s)", async (char) => {
    const prefix = "[20/01/2026, 12:00:00] Synthetic: ";
    const body = "x".repeat(128);
    const remaining = MAX_WHATSAPP_MESSAGE_BYTES - prefix.length - body.length - 1;
    const width = new TextEncoder().encode(char).length;
    const continuation = char.repeat(Math.floor(remaining / width)) + "x".repeat(remaining % width);
    const exact = `${prefix}${body}\n${continuation}`;
    expect(new TextEncoder().encode(exact).length).toBe(MAX_WHATSAPP_MESSAGE_BYTES);
    const { report, pod } = await fileImport(
      whatsappFileAdapter,
      streamed(`${exact}\n${exact}x\nignored\n${prefix}keep`, 4096),
    );
    expect(report.skipped).toBe(1);
    expect(report.state?.counts.skipped).toBe(1);
    expect(report.state?.counts.items).toBe(2);
    const texts = pod
      .dataset(report.written[0]?.url ?? "")
      .getObjects(null, "https://schema.org/text", null);
    expect(texts.map((term) => term.value)).toEqual([`${body}\n${continuation}`, "keep"]);
  });

  it.each([
    1, 7, 4096,
  ])("bounds WhatsApp continuations, including empty lines (%i-byte chunks)", async (size) => {
    const prefix = "[20/01/2026, 12:00:00] Synthetic: ";
    const exact = `${prefix}at cap\n${"\n".repeat(MAX_WHATSAPP_CONTINUATION_LINES)}`;
    const oversized = `${prefix}discard\n${"x\n".repeat(MAX_WHATSAPP_CONTINUATION_LINES + 1)}ignored\n`;
    const { report, pod } = await fileImport(
      whatsappFileAdapter,
      streamed(`${exact}${oversized}${prefix}keep`, size),
    );
    expect(report.skipped).toBe(1);
    expect(report.state?.counts.skipped).toBe(1);
    expect(report.state?.counts.items).toBe(2);
    const texts = pod
      .dataset(report.written[0]?.url ?? "")
      .getObjects(null, "https://schema.org/text", null);
    expect(texts.map((term) => term.value)).toEqual([
      `at cap${"\n".repeat(MAX_WHATSAPP_CONTINUATION_LINES)}`,
      "keep",
    ]);
  });

  it.each([
    "timestamp",
    "eof",
  ])("counts an overflowing WhatsApp message once before %s", async (end) => {
    const prefix = "[20/01/2026, 12:00:00] Synthetic: ";
    const oversized = "x".repeat(MAX_TEXT_LINE_BYTES + 1);
    const tail = end === "timestamp" ? `\n${prefix}keep again` : "";
    const { report } = await fileImport(
      whatsappFileAdapter,
      streamed(`${prefix}keep\n${prefix}discard\n${oversized}\n${oversized}\nignored${tail}`),
    );
    expect(report.skipped).toBe(1);
    expect(report.state?.counts.skipped).toBe(1);
    expect(report.state?.counts.items).toBe(end === "timestamp" ? 2 : 1);
  });

  it("counts the WhatsApp timestamp, sender and line separators toward the byte cap", async () => {
    const prefix = "[20/01/2026, 12:00:00] Synthetic: ";
    const line = `${prefix}${"x".repeat(MAX_WHATSAPP_MESSAGE_BYTES - prefix.length)}`;
    const { report } = await fileImport(
      whatsappFileAdapter,
      streamed(`${prefix}keep\n${line}\n\n`),
    );
    expect(report.skipped).toBe(1);
    expect(report.state?.counts.items).toBe(1);
  });

  it("bounds WhatsApp heap for a million short continuations", async () => {
    const moduleUrl = new URL("../../dist/whatsapp/file-adapter.js", import.meta.url).href;
    const script = `
      import assert from 'node:assert/strict';
      import { whatsappFileAdapter } from ${JSON.stringify(moduleUrl)};
      globalThis.gc();
      const baseline = process.memoryUsage().heapUsed;
      let peak = baseline, reads = 0, skips = 0, writes = 0;
      const sample = () => peak = Math.max(peak, process.memoryUsage().heapUsed);
      const encoder = new TextEncoder();
      const prefix = encoder.encode('[20/01/2026, 12:00:00] Synthetic: discard\\n');
      const block = encoder.encode('x\\n'.repeat(32 * 1024));
      const suffix = encoder.encode('[20/01/2026, 12:01:00] Synthetic: keep');
      const stream = new ReadableStream({
        pull(controller) {
          sample();
          if (reads === 0) controller.enqueue(prefix);
          else if (reads <= 32) controller.enqueue(block);
          else if (reads === 33) controller.enqueue(suffix);
          else controller.close();
          reads++;
        }
      }, { highWaterMark: 0 });
      await whatsappFileAdapter.importFile({ name: 'synthetic.txt', size: 3 * 1024 * 1024,
        type: 'text/plain', text: async () => { throw Error('Must stream'); }, stream: () => stream }, {
        maxRows: 100_000, resolve: slug => 'https://synthetic.test/' + slug,
        progress: sample, skip: () => { skips++; sample(); },
        write: async doc => {
          sample();
          writes++;
          assert.deepEqual(doc.dataset.getObjects(null, 'https://schema.org/text', null).map(term => term.value), ['keep']);
        }
      });
      assert.equal(skips, 1);
      assert.equal(writes, 1);
      assert.equal(stream.locked, false);
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

  it("bounds peak heap for large units, including ignored XML and admitted CSV cells", async () => {
    // Lazy inputs and a separate 64 MiB heap expose string-concatenation ropes
    // independently of Vitest's heap. The CSV case exercises cell parsing too.
    const moduleUrl = new URL("../../dist/core/file-stream.js", import.meta.url).href;
    const script = `
      import assert from 'node:assert/strict';
      import { csvRows, fileText, textLines, xmlTags } from ${JSON.stringify(moduleUrl)};
      globalThis.gc();
      const baseline = process.memoryUsage().heapUsed;
      let peak = baseline;
      for (const kind of ['tag', 'ignored-tag', 'text', 'comment', 'cdata', 'line', 'record', 'cell', 'columns']) {
        globalThis.gc();
        let reads = 0, skips = 0, seen = 0;
        const encoder = new TextEncoder();
        const prefix = encoder.encode(kind === 'tag' ? '<Workout name="' : kind === 'ignored-tag' ? '<Record name="' :
          kind === 'text' ? '<Ignored>' : kind === 'comment' ? '<!--' : kind === 'cdata' ? '<![CDATA[' : kind === 'columns' ? 'Name\\n' : kind === 'record' || kind === 'cell' ? 'Name\\n"' : '');
        const suffix = encoder.encode(kind === 'tag' || kind === 'ignored-tag' ? '"/><Workout/>' :
          kind === 'text' ? '</Ignored><Workout/>' : kind === 'comment' ? '--><Workout/>' : kind === 'cdata' ? ']]><Workout/>' : kind === 'record' || kind === 'cell' ? '"\\nlast' : '\\nlast');
        const block = kind === 'columns' ? encoder.encode('x,'.repeat(32 * 1024)) : new Uint8Array(64 * 1024).fill(120);
        const blocks = kind === 'cell' || kind === 'columns' ? 63 : 64;
        const stream = new ReadableStream({
          pull(controller) {
            peak = Math.max(peak, process.memoryUsage().heapUsed);
            if (reads === 0) controller.enqueue(prefix);
            else if (reads <= blocks) controller.enqueue(block);
            else if (reads === blocks + 1) controller.enqueue(suffix);
            else controller.close();
            reads++;
          }
        }, { highWaterMark: 0 });
        const file = { name: 'synthetic', size: 5 * 1024 * 1024, type: '',
          text: async () => { throw Error('Must stream'); }, stream: () => stream };
        const skip = () => skips++;
        const source = kind === 'record' || kind === 'cell' || kind === 'columns' ? csvRows(file, skip) :
          kind === 'line' ? textLines(fileText(file), skip) : xmlTags(fileText(file), skip, kind === 'ignored-tag' ? 'Workout' : undefined);
        for await (const value of source) {
          seen++;
          peak = Math.max(peak, process.memoryUsage().heapUsed);
          if (kind === 'cell' && seen === 1) assert.equal(value.Name.length, blocks * block.length);
        }
        assert.equal(skips, kind === 'cell' || kind === 'comment' ? 0 : 1);
        assert.equal(seen, kind === 'text' ? 3 : kind === 'cell' ? 2 : 1);
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
