// AUTHORED-BY Codex GPT-6.1-Sol
import type { ImportFile } from "./file-import.js";
import { fileText } from "./file-stream.js";

/** Tokenize without buffering the export. Only one string/scalar is retained. */
async function* tokens(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let token = "";
  let quoted = false;
  let escaped = false;
  for await (const chunk of chunks) {
    for (const char of chunk) {
      if (quoted) {
        token += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') {
          quoted = false;
          yield token;
          token = "";
        }
      } else if (/\s|[\uFEFF]/.test(char) || '{}[],:"'.includes(char)) {
        if (token) yield token;
        token = "";
        if (char === '"') {
          token = char;
          quoted = true;
        } else if ("{}[],:".includes(char)) yield char;
      } else token += char;
    }
  }
  if (quoted) throw new Error("Unterminated JSON string in export.");
  if (token) yield token;
}

export interface JsonEntry {
  readonly path: string;
  readonly value: unknown;
}

/** Select array members and optional root fields; retain at most one selected
 * value, not the whole JSON tree. Paths name object properties (no array indexes).
 * A depth cap protects the parser from hostile nesting. No URLs are dereferenced.
 */
export async function* jsonEntries(
  file: ImportFile,
  arrays: readonly string[],
  fields: readonly string[] = [],
): AsyncGenerator<JsonEntry> {
  const iterator = tokens(fileText(file));
  const next = async (): Promise<string> => {
    const item = await iterator.next();
    if (item.done) throw new Error("Unexpected end of JSON export.");
    return item.value;
  };
  const expect = (actual: string, expected: string) => {
    if (actual !== expected) throw new Error("Invalid JSON export structure.");
  };
  const rawValue = async (first: string, depth: number): Promise<unknown> => {
    let raw = first;
    let nesting = first === "{" || first === "[" ? 1 : 0;
    while (nesting > 0) {
      const token = await next();
      if (token === "{" || token === "[") nesting++;
      if (token === "}" || token === "]") nesting--;
      if (depth + nesting > 64) throw new Error("JSON export is nested too deeply.");
      raw += ` ${token}`;
    }
    return JSON.parse(raw);
  };
  async function* visit(path: string, first: string, depth: number): AsyncGenerator<JsonEntry> {
    if (depth > 64) throw new Error("JSON export is nested too deeply.");
    if (fields.includes(path)) {
      yield { path, value: await rawValue(first, depth) };
    } else if (first === "{") {
      let key = await next();
      if (key === "}") return;
      while (true) {
        if (!key.startsWith('"')) throw new Error("Invalid JSON object key.");
        const name: unknown = JSON.parse(key);
        expect(await next(), ":");
        yield* visit(path ? `${path}.${name}` : String(name), await next(), depth + 1);
        const end = await next();
        if (end === "}") break;
        expect(end, ",");
        key = await next();
      }
    } else if (first === "[") {
      let value = await next();
      if (value === "]") return;
      while (true) {
        if (arrays.includes(path)) yield { path, value: await rawValue(value, depth + 1) };
        else yield* visit(`${path}[]`, value, depth + 1);
        const end = await next();
        if (end === "]") break;
        expect(end, ",");
        value = await next();
      }
    } else {
      const value: unknown = JSON.parse(first);
      if (typeof value === "object" && value !== null) throw new Error("Invalid JSON value.");
    }
  }
  try {
    yield* visit("", await next(), 0);
    if (!(await iterator.next()).done) throw new Error("Trailing data in JSON export.");
  } finally {
    await iterator.return(undefined);
  }
}
