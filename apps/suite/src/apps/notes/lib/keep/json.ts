// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  KeepImportError,
  MAX_KEEP_LABELS,
  MAX_KEEP_LIST_ITEMS,
  MAX_KEEP_NOTE_BYTES,
} from "./types";

/** Top-level arrays whose item counts are bounded before JSON.parse materialises them. */
const BOUNDED_ARRAYS: Readonly<Record<string, number>> = {
  listContent: MAX_KEEP_LIST_ITEMS,
  labels: MAX_KEEP_LABELS,
};

/** Bounded UTF-8 byte counting: stop before parsing or allocating decoded data. */
function checkSize(json: string): void {
  if (json.length > MAX_KEEP_NOTE_BYTES) throw new KeepImportError("NOTE_TOO_LARGE");
  let bytes = 0;
  for (const character of json) {
    const unit = character.charCodeAt(0);
    bytes += character.length === 2 ? 4 : unit <= 0x7f ? 1 : unit <= 0x7ff ? 2 : 3;
    if (bytes > MAX_KEEP_NOTE_BYTES) throw new KeepImportError("NOTE_TOO_LARGE");
  }
}

/**
 * Quote only numeric timestamp values, before JSON.parse can round their digits.
 * String tokens are consumed whole, including escaped keys and embedded JSON.
 * All other JSON grammar/field types are still checked by JSON.parse/validation.
 */
export function decodeKeepJson(json: string): unknown {
  checkSize(json);
  try {
    let previousString: string | undefined;
    let previousEnd = 0;
    let offset = 0;
    let copiedThrough = 0;
    const parts: string[] = [];
    // Container stack: array frames count separators against their item limit.
    const frames: { array: boolean; limit: number; separators: number }[] = [];
    const afterKey = (start: number) =>
      previousString !== undefined &&
      /^[ \r\n\t]*:[ \r\n\t]*$/.test(json.slice(previousEnd, start));
    // Never restart at an escaped quote after an unterminated string. Each
    // token consumes a disjoint span, keeping malformed input linear as well.
    while (offset < json.length) {
      const start = offset;
      const character = json.charAt(offset);
      if (character === '"') {
        offset += 1;
        while (offset < json.length && json[offset] !== '"') {
          offset += json[offset] === "\\" ? 2 : 1;
        }
        offset += 1;
        previousString = JSON.parse(json.slice(start, offset)) as string;
        previousEnd = offset;
      } else if (character === "-" || (character >= "0" && character <= "9")) {
        offset += 1;
        while (offset < json.length && "0123456789.eE+-".includes(json.charAt(offset))) {
          offset += 1;
        }
        const token = json.slice(start, offset);
        // Check number grammar before quoting, so malformed tokens cannot be
        // turned into valid JSON strings. Timestamp spelling stays exact.
        JSON.parse(token);
        const timestamp =
          (previousString === "createdTimestampUsec" ||
            previousString === "userEditedTimestampUsec") &&
          afterKey(start);
        if (timestamp) {
          parts.push(json.slice(copiedThrough, start), `"${token}"`);
          copiedThrough = offset;
        }
        previousString = undefined;
      } else {
        if (character === "{" || character === "[") {
          const bounded =
            character === "[" &&
            frames.length === 1 &&
            !frames[0]!.array &&
            previousString !== undefined &&
            Object.hasOwn(BOUNDED_ARRAYS, previousString) &&
            afterKey(start);
          frames.push({
            array: character === "[",
            limit: bounded ? BOUNDED_ARRAYS[previousString!]! : Number.POSITIVE_INFINITY,
            separators: 0,
          });
          // The pending key is consumed once its value starts, so later
          // brackets never rescan the gap after it (keeps the scan linear).
          previousString = undefined;
        } else if (character === "}" || character === "]") {
          frames.pop();
        } else if (character === ",") {
          const frame = frames.at(-1);
          // N items need N - 1 separators; trailing commas are rejected by JSON.parse.
          if (frame?.array && ++frame.separators >= frame.limit) {
            throw new KeepImportError("INVALID_KEEP_NOTE");
          }
        }
        offset += 1;
      }
    }
    parts.push(json.slice(copiedThrough));
    return JSON.parse(parts.join("")) as unknown;
  } catch {
    throw new KeepImportError("INVALID_KEEP_NOTE");
  }
}
