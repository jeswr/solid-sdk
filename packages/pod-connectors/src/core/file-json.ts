// AUTHORED-BY Codex GPT-6.1-Sol
import { ChunkSlices } from "./chunk-slices.js";
import type { ImportFile } from "./file-import.js";
import { fileText } from "./file-stream.js";

export const MAX_JSON_TOKEN_BYTES = 1024 * 1024;
export const MAX_JSON_RECORD_BYTES = 4 * 1024 * 1024;

interface Token {
  readonly kind: string;
  readonly raw?: string;
}

/** Keep slices of input chunks, never one allocation per character. Selected
 * records retain their raw JSON; ignored strings retain no text at all.
 */
class JsonReader {
  private readonly source: AsyncGenerator<string>;
  private chunk = "";
  private offset = 0;
  private recordStart = 0;
  private record: ChunkSlices | undefined;
  private recordBytes = 0;
  private oversized = false;

  constructor(file: ImportFile) {
    this.source = fileText(file);
  }

  private flushRecord(): void {
    if (this.record && !this.oversized && this.offset > this.recordStart)
      this.record.push(this.chunk.slice(this.recordStart, this.offset));
    this.recordStart = this.offset;
  }

  private async available(): Promise<boolean> {
    while (this.offset === this.chunk.length) {
      this.flushRecord();
      const next = await this.source.next();
      if (next.done) return false;
      this.chunk = next.value;
      this.offset = 0;
      this.recordStart = 0;
    }
    return true;
  }

  private overflow(limit: "token" | "record"): void {
    if (!this.record) throw new Error(`JSON ${limit} exceeds the import byte limit.`);
    if (!this.oversized) this.record.clear();
    this.oversized = true;
  }

  private advance(): number {
    const code = this.chunk.codePointAt(this.offset) as number;
    const bytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    this.offset += code > 0xffff ? 2 : 1;
    if (this.record && !this.oversized) {
      this.recordBytes += bytes;
      if (this.recordBytes > MAX_JSON_RECORD_BYTES) this.overflow("record");
    }
    return bytes;
  }

  beginRecord(): void {
    this.record = new ChunkSlices();
    this.recordStart = this.offset;
    this.recordBytes = 0;
    this.oversized = false;
  }

  endRecord(): string | undefined {
    this.flushRecord();
    const raw = this.oversized ? undefined : this.record?.text();
    this.record = undefined;
    this.oversized = false;
    return raw;
  }

  /** Strings are validated while scanning, including when their text is ignored.
   * Only routing keys need decoding outside a selected record.
   */
  async next(retainString = false): Promise<Token | undefined> {
    while (await this.available()) {
      while (
        this.offset < this.chunk.length &&
        /[\s\uFEFF]/.test(this.chunk[this.offset] as string)
      )
        this.advance();
      if (this.offset < this.chunk.length) break;
    }
    if (!(await this.available())) return undefined;
    const first = this.chunk[this.offset] as string;
    if ("{}[],:".includes(first)) {
      this.advance();
      return { kind: first };
    }
    const quoted = first === '"';
    const pieces = new ChunkSlices();
    let start = this.offset;
    let bytes = this.advance();
    let escaped = false;
    let unicode = 0;
    let complete = false;
    let tokenOversized = false;
    const retain = () => !this.oversized && (!quoted || retainString);
    while (true) {
      if (this.offset === this.chunk.length) {
        if (retain()) pieces.push(this.chunk.slice(start, this.offset));
        start = this.offset;
        if (!(await this.available())) break;
        start = this.offset;
      }
      const char = this.chunk[this.offset] as string;
      if (!quoted && /[\s\uFEFF{}[\],:"]/.test(char)) break;
      if (quoted) {
        if (unicode) {
          if (!/[0-9a-fA-F]/.test(char)) throw new Error("Invalid JSON Unicode escape.");
          unicode--;
        } else if (escaped) {
          if (!'"\\/bfnrtu'.includes(char)) throw new Error("Invalid JSON string escape.");
          unicode = char === "u" ? 4 : 0;
          escaped = false;
        } else if (char === "\\") escaped = true;
        else if (char === '"') complete = true;
        else if (char.charCodeAt(0) < 0x20) throw new Error("Invalid JSON string character.");
      }
      bytes += this.advance();
      if (bytes > MAX_JSON_TOKEN_BYTES && !tokenOversized) {
        tokenOversized = true;
        this.overflow("token");
        pieces.clear();
      }
      if (complete) break;
    }
    if (quoted && !complete) throw new Error("Unterminated JSON string in export.");
    if (retain() && this.offset > start) pieces.push(this.chunk.slice(start, this.offset));
    const raw = retain() ? pieces.text() : undefined;
    if (!quoted && raw !== undefined) {
      const value: unknown = JSON.parse(raw);
      if (typeof value === "object" && value !== null) throw new Error("Invalid JSON scalar.");
    }
    return { kind: quoted ? "string" : "scalar", raw };
  }

  async close(): Promise<void> {
    await this.source.return(undefined);
  }
}

export interface JsonEntry {
  readonly path: string;
  readonly value: unknown;
}

/** Select array members and optional root fields without retaining the export.
 * An oversized selected value is discarded and counted once through onSkip.
 * Overflow outside a selected value (including routing keys) fails the file.
 */
export async function* jsonEntries(
  file: ImportFile,
  arrays: readonly string[],
  fields: readonly string[] = [],
  onSkip: () => void = () => {},
): AsyncGenerator<JsonEntry> {
  const reader = new JsonReader(file);
  const next = async (retainString = false): Promise<Token> => {
    const token = await reader.next(retainString);
    if (!token) throw new Error("Unexpected end of JSON export.");
    return token;
  };
  const expect = (actual: Token, expected: string) => {
    if (actual.kind !== expected) throw new Error("Invalid JSON export structure.");
  };
  // Validate the grammar even for discarded values. Keys inside selected or
  // ignored records need no allocation; only keys on selector paths are decoded.
  async function* visit(
    path: string,
    first: Token,
    depth: number,
    selected = false,
    ignored = false,
  ): AsyncGenerator<JsonEntry> {
    if (depth > 64) throw new Error("JSON export is nested too deeply.");
    if (first.kind === "{") {
      let key = await next(!selected && !ignored);
      if (key.kind === "}") return;
      while (true) {
        expect(key, "string");
        const name = key.raw === undefined ? "" : String(JSON.parse(key.raw));
        const child = selected || ignored ? "" : path ? `${path}.${name}` : name;
        expect(await next(), ":");
        const relevant =
          !selected &&
          !ignored &&
          [...arrays, ...fields].some(
            (target) =>
              target === child || target.startsWith(`${child}.`) || target.startsWith(`${child}[]`),
          );
        if (relevant && fields.includes(child)) yield* record(child, depth + 1);
        else yield* visit(child, await next(), depth + 1, selected, !relevant);
        const end = await next();
        if (end.kind === "}") break;
        expect(end, ",");
        key = await next(!selected && !ignored);
      }
    } else if (first.kind === "[") {
      const select = !selected && !ignored && arrays.includes(path);
      let firstMember = true;
      while (true) {
        // Start before reading a member so its first token is also bounded.
        if (select) reader.beginRecord();
        const value = await next();
        if (firstMember && value.kind === "]") {
          if (select) reader.endRecord();
          return;
        }
        yield* visit(`${path}[]`, value, depth + 1, selected || select, ignored);
        if (select) {
          const raw = reader.endRecord();
          if (raw === undefined) onSkip();
          else yield { path, value: JSON.parse(raw) };
        }
        const end = await next();
        if (end.kind === "]") break;
        expect(end, ",");
        firstMember = false;
      }
    } else if (first.kind !== "string" && first.kind !== "scalar") {
      throw new Error("Invalid JSON value.");
    }
  }
  async function* record(path: string, depth: number): AsyncGenerator<JsonEntry> {
    reader.beginRecord();
    yield* visit(path, await next(), depth, true);
    const raw = reader.endRecord();
    if (raw === undefined) onSkip();
    else yield { path, value: JSON.parse(raw) };
  }
  try {
    yield* visit("", await next(), 0);
    if (await reader.next()) throw new Error("Trailing data in JSON export.");
  } finally {
    await reader.close();
  }
}
