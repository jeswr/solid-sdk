// AUTHORED-BY Codex GPT-6.1-Sol
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
    const preserved = json.replace(
      /"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      (token: string, offset: number) => {
        if (token.startsWith('"')) {
          previousString = JSON.parse(token) as string;
          previousEnd = offset + token.length;
          return token;
        }
        const timestamp =
          (previousString === "createdTimestampUsec" ||
            previousString === "userEditedTimestampUsec") &&
          /^[ \r\n\t]*:[ \r\n\t]*$/.test(json.slice(previousEnd, offset));
        previousString = undefined;
        return timestamp ? `"${token}"` : token;
      },
    );
    return JSON.parse(preserved) as unknown;
  } catch {
    throw new KeepImportError("INVALID_KEEP_NOTE");
  }
}
