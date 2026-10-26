// AUTHORED-BY Codex GPT-6.1-Sol
import { parseCsv } from "./csv.js";
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

/** Logical CSV records, preserving quoted newlines and chunk-split escapes. */
export async function* csvRecords(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let record = "";
  let quoted = false;
  let cr = false;
  for await (const chunk of chunks) {
    for (const char of chunk) {
      if (cr && char === "\n") {
        cr = false;
        continue;
      }
      cr = false;
      if (char === '"') quoted = !quoted;
      if (!quoted && (char === "\n" || char === "\r")) {
        if (record.trim()) yield record;
        record = "";
        cr = char === "\r";
      } else record += char;
    }
  }
  if (record.trim()) yield record;
}

export async function* csvRows(file: ImportFile): AsyncGenerator<Record<string, string>> {
  let header: string | undefined;
  for await (const record of csvRecords(fileText(file))) {
    if (header === undefined) header = record;
    else {
      const row = parseCsv(`${header}\n${record}`).rows[0];
      if (row) yield { ...row };
    }
  }
}

export async function* textLines(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let line = "";
  let cr = false;
  for await (const chunk of chunks) {
    for (const char of chunk) {
      if (cr && char === "\n") {
        cr = false;
        continue;
      }
      cr = false;
      if (char === "\n" || char === "\r") {
        yield line;
        line = "";
        cr = char === "\r";
      } else line += char;
    }
  }
  if (line) yield line;
}

/** XML markup tokens only; discard character data, comments and CDATA incrementally.
 * No entity expansion, DTD processing or external I/O. Quotes can contain `>`.
 */
export async function* xmlTags(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let token = "";
  let quote = "";
  let ignored: "" | "comment" | "cdata" = "";
  let suffix = "";
  for await (const chunk of chunks) {
    for (const char of chunk) {
      if (ignored) {
        suffix = (suffix + char).slice(-3);
        if (suffix === (ignored === "comment" ? "-->" : "]]>")) {
          ignored = "";
          suffix = "";
        }
        continue;
      }
      if (!token) {
        if (char === "<") token = char;
        continue;
      }
      token += char;
      if (token === "<!--" || token === "<![CDATA[") {
        ignored = token === "<!--" ? "comment" : "cdata";
        token = "";
      } else if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === ">") {
        yield token;
        token = "";
      }
    }
  }
}
