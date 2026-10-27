// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { KeepImportError, MAX_KEEP_NOTE_BYTES } from "./types";

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
          /^[ \r\n\t]*:[ \r\n\t]*$/.test(json.slice(previousEnd, start));
        if (timestamp) {
          parts.push(json.slice(copiedThrough, start), `"${token}"`);
          copiedThrough = offset;
        }
        previousString = undefined;
      } else {
        offset += 1;
      }
    }
    parts.push(json.slice(copiedThrough));
    return JSON.parse(parts.join("")) as unknown;
  } catch {
    throw new KeepImportError("INVALID_KEEP_NOTE");
  }
}
