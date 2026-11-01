// AUTHORED-BY Codex GPT-6.1-Sol
import { MAX_TODOIST_CSV_BYTES, MAX_TODOIST_CSV_ROWS, TodoistImportError } from "./model";

/** Bound UTF-16 length first, then count UTF-8 bytes without allocating an encoded copy. */
export function checkSize(input: string): void {
  if (typeof input !== "string") throw new TodoistImportError("INVALID_CSV", 1);
  if (input.length > MAX_TODOIST_CSV_BYTES) throw new TodoistImportError("CSV_TOO_LARGE", 1);
  let bytes = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TodoistImportError("INVALID_CSV", 1);
      bytes += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TodoistImportError("INVALID_CSV", 1);
    } else {
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    }
    if (bytes > MAX_TODOIST_CSV_BYTES) throw new TodoistImportError("CSV_TOO_LARGE", 1);
  }
}

/**
 * First call without a visitor: validate syntax and count records without making
 * fields. Only after both size limits pass does the caller request materialisation.
 */
export function scanCsv(input: string, visit?: (cells: string[], line: number) => void): void {
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  let start = input.startsWith("\uFEFF") ? 1 : 0;
  let recordStart = start;
  let line = 1;
  let recordLine = 1;
  let records = 0;
  let cells: string[] = [];
  const field = (end: number) => {
    if (visit) {
      const raw = input.slice(start, end);
      cells.push(state === "closed" ? raw.slice(1, -1).replaceAll('""', '"') : raw);
    }
    state = "start";
  };
  const record = (end: number) => {
    // The first record is the header.
    if (++records > MAX_TODOIST_CSV_ROWS + 1) {
      throw new TodoistImportError("CSV_TOO_LARGE", recordLine);
    }
    field(end);
    visit?.(cells, recordLine);
    cells = [];
  };
  for (let i = start; i < input.length; i++) {
    const char = input[i];
    if (char === "\n" || (char === "\r" && input[i + 1] !== "\n")) line++;
    if (char === "\0") throw new TodoistImportError("INVALID_CSV", recordLine);
    if (state === "quoted") {
      if (char === '"') {
        if (input[i + 1] === '"') i++;
        else state = "closed";
      }
    } else if (char === ",") {
      field(i);
      start = i + 1;
    } else if (char === "\r" || char === "\n") {
      if (char === "\r") {
        if (input[i + 1] !== "\n") throw new TodoistImportError("INVALID_CSV", recordLine);
        i++;
        line++;
      }
      record(char === "\r" ? i - 1 : i);
      start = i + 1;
      recordStart = start;
      recordLine = line;
    } else if (char === '"' && state === "start") {
      state = "quoted";
    } else {
      if (char === '"' || state === "closed") {
        throw new TodoistImportError("INVALID_CSV", recordLine);
      }
      state = "plain";
    }
  }
  if (state === "quoted") throw new TodoistImportError("INVALID_CSV", recordLine);
  if (recordStart < input.length) record(input.length);
}
