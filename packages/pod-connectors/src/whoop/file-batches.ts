// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import { parseCsv, parseCsvRows } from "../core/csv.js";
import type { FileImportContext } from "../core/file-import.js";
import { csvRecords } from "../core/file-stream.js";
import { timestamp } from "./model.js";

export interface CsvSource {
  name: string;
  text: string;
}
interface Row {
  key: string;
  name: string;
  header: string;
  text: string;
}
interface Cursor {
  file: string;
  before: string;
}
const normal = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
async function digest(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Scan byte-bounded input, retaining only the newest row batch plus one lookahead.
 * The digest binds the host-owned cursor to the export contents, and CSV entry names.
 * Row ordinals break timestamp ties, including duplicate and malformed source rows. */
export async function newestRows(sources: CsvSource[], ctx: FileImportContext, limit: number) {
  sources.sort((a, b) => a.name.localeCompare(b.name));
  const hashes: string[] = [];
  for (const source of sources) {
    ctx.signal?.throwIfAborted();
    hashes.push(`${source.name}:${await digest(source.text)}`);
  }
  const file = await digest(hashes.join("\n"));
  let before: string | undefined;
  if (ctx.cursor?.startsWith('{"file":')) {
    try {
      const saved = JSON.parse(ctx.cursor) as Cursor;
      // `before: ""` marks a finished traversal of this export. Re-importing it starts a
      // fresh traversal: rewrites are idempotent and restore shards removed since.
      if (saved.file === file && typeof saved.before === "string" && saved.before)
        before = saved.before;
    } catch {
      throw new Error("Invalid WHOOP file cursor.");
    }
  }
  // Every batch rescans the whole export. Count malformed source records only in the
  // traversal's first batch, so resumed batches do not inflate the skip total.
  const firstBatch = before === undefined;
  // A min heap keeps the newest `limit + 1` rows in O(rows * log(limit)) work.
  const heap: Row[] = [];
  const retain = (row: Row) => {
    if (before !== undefined && row.key >= before) return;
    if (heap.length === limit + 1) {
      if (row.key <= (heap[0] as Row).key) return;
      heap[0] = row;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1,
          right = left + 1;
        let small = i;
        if (left < heap.length && (heap[left] as Row).key < (heap[small] as Row).key) small = left;
        if (right < heap.length && (heap[right] as Row).key < (heap[small] as Row).key)
          small = right;
        if (small === i) break;
        [heap[i], heap[small]] = [heap[small] as Row, heap[i] as Row];
        i = small;
      }
    } else {
      heap.push(row);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2);
        if ((heap[parent] as Row).key <= row.key) break;
        heap[i] = heap[parent] as Row;
        i = parent;
      }
      heap[i] = row;
    }
  };
  let ordinal = 0;
  for (const source of sources) {
    let header: string | undefined;
    let headers: string[] = [];
    for await (const text of csvRecords(oneText(source.text), () => {
      if (firstBatch) ctx.skip();
    })) {
      ctx.signal?.throwIfAborted();
      if (header === undefined) {
        header = text;
        headers = parseCsv(text).headers.map(normal);
        if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
          throw new Error("Ambiguous WHOOP CSV headers.");
        if (
          !["sleep onset", "workout start time", "cycle start time"].some((h) =>
            headers.includes(normal(h)),
          )
        )
          throw new Error("Unrecognised WHOOP CSV headers.");
        continue;
      }
      const cells = parseCsvRows(text, ",", headers.length)[0] ?? [];
      const read = (...names: string[]) =>
        names.map((name) => cells[headers.indexOf(normal(name))]?.trim()).find(Boolean);
      const at = timestamp(
        read("Workout start time", "Sleep onset", "Cycle start time"),
        read("Workout timezone", "Sleep timezone", "Cycle timezone"),
      );
      const key = `${at?.toISOString() ?? "0000"}|${String(ordinal++).padStart(12, "0")}`;
      retain({ key, name: source.name, header, text });
    }
    if (header === undefined) throw new Error("Missing WHOOP CSV header.");
  }
  return {
    rows: heap.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0)),
    cursor: (key: string) => JSON.stringify({ file, before: key } satisfies Cursor),
    // A distinct completion value: returning no cursor would let the import session keep
    // an older partial cursor. The next run of the same export starts fresh from it.
    complete: JSON.stringify({ file, before: "" } satisfies Cursor),
  };
}
async function* oneText(text: string) {
  yield text;
}
