// AUTHORED-BY Codex GPT-6.1-Sol
import { ChunkSlices } from "./chunk-slices.js";
import { MAX_CSV_HEADER_CHARS, parseCsv, parseCsvRows } from "./csv.js";
import { type ImportFile, MAX_FILE_BYTES } from "./file-import.js";

/** Prefer File.stream(); text-only host implementations remain compatible. */
export async function* fileText(file: ImportFile): AsyncGenerator<string> {
  if (!file.stream) {
    const text = await file.text();
    if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) throw sizeError();
    yield text;
    return;
  }
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let ended = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        ended = true;
        break;
      }
      bytes += next.value.byteLength;
      if (bytes > MAX_FILE_BYTES) throw sizeError();
      yield decoder.decode(next.value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    try {
      if (!ended) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

function sizeError(): Error {
  return new Error("Export exceeds the 64 MiB import limit. Please split the export.");
}

export const MAX_XML_TAG_BYTES = 64 * 1024;
export const MAX_XML_TEXT_BYTES = 1024 * 1024;
export const MAX_TEXT_LINE_BYTES = 1024 * 1024;
export const MAX_CSV_RECORD_BYTES = 4 * 1024 * 1024;

type OnSkip = () => void;

/** Count UTF-8 bytes before slicing or retaining input. Overflow releases all
 * earlier slices; the scanner continues only to find a safe unit boundary.
 */
class BoundedUnit {
  private readonly slices = new ChunkSlices();
  private bytes = 0;
  chars = 0;
  oversized = false;

  constructor(private readonly limit: number) {}

  push(chunk: string, start: number, end: number, retain = true): void {
    if (this.oversized) return;
    for (let i = start; i < end; i++) {
      const code = chunk.codePointAt(i) as number;
      this.bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      if (this.bytes > this.limit) {
        this.oversized = true;
        this.slices.clear();
        return;
      }
      if (code > 0xffff) i++;
    }
    this.chars += end - start;
    if (retain) this.capture(chunk.slice(start, end));
  }

  capture(slice: string): void {
    if (!this.oversized) this.slices.push(slice);
  }

  text(): string {
    return this.slices.text();
  }

  reset(): void {
    this.slices.clear();
    this.bytes = 0;
    this.chars = 0;
    this.oversized = false;
  }
}

/** Logical CSV records, preserving quoted newlines and chunk-split escapes.
 * Oversized data rows are skipped at an unquoted newline. A missing header or
 * unterminated quoted row cannot be recovered safely and fails the import.
 */
export async function* csvRecords(
  chunks: AsyncIterable<string>,
  onSkip: OnSkip = () => {},
): AsyncGenerator<string> {
  const record = new BoundedUnit(MAX_CSV_RECORD_BYTES);
  let quoted = false;
  let cr = false;
  let header = true;
  const push = (chunk: string, start: number, end: number) => {
    if (header && record.chars + end - start > MAX_CSV_HEADER_CHARS)
      throw new Error("CSV header exceeds the 64 KiB character import limit.");
    record.push(chunk, start, end);
  };
  for await (const chunk of chunks) {
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];
      if (cr && char === "\n") {
        cr = false;
        start = i + 1;
        continue;
      }
      cr = false;
      if (char === '"') quoted = !quoted;
      if (!quoted && (char === "\n" || char === "\r")) {
        push(chunk, start, i);
        if (record.oversized) onSkip();
        else {
          const text = record.text();
          if (text.trim()) {
            yield text;
            header = false;
          }
        }
        record.reset();
        start = i + 1;
        cr = char === "\r";
      }
    }
    push(chunk, start, chunk.length);
  }
  if (quoted) throw new Error("Unterminated quoted CSV record in export.");
  if (record.oversized) onSkip();
  else {
    const text = record.text();
    if (text.trim()) yield text;
  }
}

export async function* csvRows(
  file: ImportFile,
  onSkip: OnSkip = () => {},
): AsyncGenerator<Record<string, string>> {
  yield* csvRowsFromChunks(fileText(file), onSkip);
}

/** Shared by sniffed bank files and ordinary CSV exports; parse headers once. */
export async function* csvRowsFromChunks(
  chunks: AsyncIterable<string>,
  onSkip: OnSkip = () => {},
): AsyncGenerator<Record<string, string>> {
  let headers: readonly string[] | undefined;
  for await (const record of csvRecords(chunks, onSkip)) {
    if (headers === undefined) headers = parseCsv(record).headers;
    else {
      const cells = parseCsvRows(record)[0];
      if (cells)
        yield Object.fromEntries(headers.map((header, i) => [header, (cells[i] ?? "").trim()]));
    }
  }
}

/** Oversized lines are discarded through CR/LF or EOF and counted once. */
export async function* textLines(
  chunks: AsyncIterable<string>,
  onSkip: OnSkip = () => {},
): AsyncGenerator<string> {
  const line = new BoundedUnit(MAX_TEXT_LINE_BYTES);
  let cr = false;
  for await (const chunk of chunks) {
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];
      if (cr && char === "\n") {
        cr = false;
        start = i + 1;
        continue;
      }
      cr = false;
      if (char === "\n" || char === "\r") {
        line.push(chunk, start, i);
        if (line.oversized) onSkip();
        else yield line.text();
        line.reset();
        start = i + 1;
        cr = char === "\r";
      }
    }
    line.push(chunk, start, chunk.length);
  }
  if (line.oversized) onSkip();
  else if (line.chars) yield line.text();
}

/** XML markup tokens only; character data, comments and CDATA retain no text.
 * Oversized tags are skipped at an unquoted `>`; text nodes at the next `<`.
 * No entity expansion, DTD processing or external I/O. Unterminated markup
 * fails instead of treating a later fragment as an independent record.
 * With selectedName, retain only matching opening tags; ignored names and
 * attributes are scanned and byte-counted without allocating their text.
 */
export async function* xmlTags(
  chunks: AsyncIterable<string>,
  onSkip: OnSkip = () => {},
  selectedName?: string,
): AsyncGenerator<string> {
  const token = new BoundedUnit(MAX_XML_TAG_BYTES);
  const text = new BoundedUnit(MAX_XML_TEXT_BYTES);
  // Count CDATA's closing delimiter too, so split `]]>` markers need no buffer.
  const cdataText = new BoundedUnit(MAX_XML_TEXT_BYTES + 3);
  let mode: "text" | "tag" | "comment" | "cdata" = "text";
  let quote = "";
  let prefixLength = 0;
  let comment = false;
  let cdata = false;
  let closingRun = 0;
  const selectedPrefix = selectedName === undefined ? undefined : `<${selectedName}`;
  let retaining = selectedPrefix === undefined;
  let matching = false;
  let matched = 0;
  for await (const chunk of chunks) {
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i] as string;
      if (mode === "comment" || mode === "cdata") {
        if (char === (mode === "comment" ? "-" : "]")) closingRun = Math.min(2, closingRun + 1);
        else {
          if (char === ">" && closingRun === 2) {
            if (mode === "cdata") {
              cdataText.push(chunk, start, i + 1, false);
              if (cdataText.oversized) onSkip();
              cdataText.reset();
            }
            mode = "text";
            start = i + 1;
          }
          closingRun = 0;
        }
        continue;
      }
      if (mode === "text") {
        if (char !== "<") continue;
        text.push(chunk, start, i, false);
        if (text.oversized) onSkip();
        text.reset();
        mode = "tag";
        start = i;
        prefixLength = 1;
        comment = true;
        cdata = true;
        retaining = selectedPrefix === undefined;
        matching = selectedPrefix !== undefined;
        matched = 1;
        continue;
      }
      if (matching && selectedPrefix !== undefined) {
        if (matched < selectedPrefix.length) {
          matching = char === selectedPrefix[matched];
          matched++;
        } else {
          retaining = /[\s/>]/.test(char);
          matching = false;
          if (retaining) {
            // Prefix bytes in earlier chunks were already counted. Count the
            // remaining prefix before retaining this trusted, fixed-size name.
            token.push(chunk, start, i, false);
            token.capture(selectedPrefix);
            start = i;
          }
        }
      }
      // Recognise only fixed-size comment/CDATA prefixes, without building
      // per-character strings even when a prefix spans tiny input chunks.
      if (comment || cdata) {
        comment &&= char === "<!--"[prefixLength];
        cdata &&= char === "<![CDATA["[prefixLength];
        prefixLength++;
        if ((comment && prefixLength === 4) || (cdata && prefixLength === 9)) {
          mode = comment ? "comment" : "cdata";
          token.reset();
          closingRun = 0;
          start = i + 1;
          continue;
        }
      }
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ">") {
        token.push(chunk, start, i + 1, retaining);
        if (token.oversized) onSkip();
        else if (retaining) yield token.text();
        token.reset();
        mode = "text";
        start = i + 1;
      }
    }
    if (mode === "tag") token.push(chunk, start, chunk.length, retaining);
    else if (mode === "text") text.push(chunk, start, chunk.length, false);
    else if (mode === "cdata") cdataText.push(chunk, start, chunk.length, false);
  }
  if (mode !== "text") throw new Error(`Unterminated XML ${mode} in export.`);
  if (text.oversized) onSkip();
}
