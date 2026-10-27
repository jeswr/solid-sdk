// AUTHORED-BY Codex GPT-6.1-Sol
import { MAX_EXPORT_BYTES, ScrobbleError } from "./types";

type Visit = (start: number, end: number, line: number) => void;
const space = (char: string) => char === " " || char === "\t" || char === "\r" || char === "\n";
const newline = (text: string, i: number) =>
  text[i] === "\n" || (text[i] === "\r" && text[i + 1] !== "\n");

/** No encoding buffer, splitting, JSON parsing or row allocation before size preflight. */
export function checkBytes(inputs: readonly string[]): void {
  let units = 0;
  for (const text of inputs) units += text.length;
  if (units > MAX_EXPORT_BYTES) throw new ScrobbleError("EXPORT_TOO_LARGE");
  let bytes = 0;
  for (const text of inputs) {
    for (let i = 0; i < text.length; i++) {
      const unit = text.charCodeAt(i);
      if (unit < 0x80) bytes++;
      else if (unit < 0x800) bytes += 2;
      else if (unit >= 0xd800 && unit <= 0xdbff) {
        const low = text.charCodeAt(++i);
        if (!(low >= 0xdc00 && low <= 0xdfff)) throw new ScrobbleError("INVALID_EXPORT");
        bytes += 4;
      } else {
        if (unit >= 0xdc00 && unit <= 0xdfff) throw new ScrobbleError("INVALID_EXPORT");
        bytes += 3;
      }
      if (bytes > MAX_EXPORT_BYTES) throw new ScrobbleError("EXPORT_TOO_LARGE");
    }
  }
}

/** Scan only record boundaries; JSON.parse validates each bounded record on the second pass. */
export function scanListenBrainz(text: string, visit: Visit): void {
  let start = text.startsWith("\uFEFF") ? 1 : 0;
  let line = 1;
  while (start < text.length && space(text.charAt(start))) {
    if (newline(text, start)) line++;
    start++;
  }
  if (start === text.length) throw new ScrobbleError("INVALID_EXPORT");
  if (text[start] === "[") {
    scanArray(text, start + 1, line, visit);
    return;
  }
  // JSON Lines: blank lines are ignored; multiline JSON objects are never guessed at.
  let rowStart = start;
  let rowLine = line;
  for (let i = start; i <= text.length; i++) {
    if (i === text.length || text[i] === "\r" || text[i] === "\n") {
      let first = rowStart;
      while (first < i && space(text.charAt(first))) first++;
      if (first < i) visit(first, i, rowLine);
      if (text[i] === "\r" && text[i + 1] === "\n") i++;
      rowStart = i + 1;
      rowLine++;
    }
  }
}

function scanArray(text: string, start: number, firstLine: number, visit: Visit): void {
  let line = firstLine;
  let recordLine = line;
  let recordStart = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let emptyAllowed = true;
  for (let i = start; i < text.length; i++) {
    const char = text.charAt(i);
    if (newline(text, i)) line++;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (depth === 0 && (char === "," || char === "]")) {
      if (recordStart < 0) {
        if (char === "," || !emptyAllowed) throw new ScrobbleError("INVALID_EXPORT");
      } else visit(recordStart, i, recordLine);
      if (char === "]") {
        for (let tail = i + 1; tail < text.length; tail++) {
          if (!space(text.charAt(tail))) throw new ScrobbleError("INVALID_EXPORT");
        }
        return;
      }
      recordStart = -1;
      emptyAllowed = false;
      continue;
    }
    if (recordStart < 0 && !space(char)) {
      recordStart = i;
      recordLine = line;
    }
    if (char === '"') quoted = true;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") {
      if (--depth < 0) throw new ScrobbleError("INVALID_EXPORT");
    }
  }
  throw new ScrobbleError("INVALID_EXPORT");
}

/** Strict comma-separated RFC 4180 quoting; CRLF and LF record separators. */
export function scanCsv(text: string, visit: Visit): void {
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  let rowStart = text.startsWith("\uFEFF") ? 1 : 0;
  let rowLine = 1;
  let line = 1;
  for (let i = rowStart; i < text.length; i++) {
    const char = text[i];
    if (state === "quoted") {
      if (char === '"') {
        if (text[i + 1] === '"') i++;
        else state = "closed";
      } else if (newline(text, i)) line++;
    } else if (char === ",") state = "start";
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] !== "\n") throw new ScrobbleError("INVALID_EXPORT");
      visit(rowStart, i, rowLine);
      if (char === "\r") i++;
      rowStart = i + 1;
      rowLine = ++line;
      state = "start";
    } else if (char === '"' && state === "start") state = "quoted";
    else {
      if (char === '"' || state === "closed") throw new ScrobbleError("INVALID_EXPORT");
      state = "plain";
    }
  }
  if (state === "quoted") throw new ScrobbleError("INVALID_EXPORT");
  if (rowStart < text.length) visit(rowStart, text.length, rowLine);
}

/** Decode a single record only after scanCsv has validated syntax and row count. */
export function csvFields(row: string): string[] {
  const fields: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i <= row.length; i++) {
    if (i === row.length || (row[i] === "," && !quoted)) {
      const raw = row.slice(start, i);
      fields.push(raw.startsWith('"') ? raw.slice(1, -1).replace(/""/g, '"') : raw);
      start = i + 1;
    } else if (row[i] === '"') quoted = !quoted;
  }
  return fields;
}
