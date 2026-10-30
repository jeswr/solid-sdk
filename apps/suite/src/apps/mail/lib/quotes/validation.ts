// AUTHORED-BY Codex GPT-6.1-Sol
/** Inclusive limits on the original UTF-8 body, before newline/flowed decoding. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** LF count + 1; a terminal newline includes a final empty physical line. */
export const MAX_BODY_LINES = 50_000;

export type QuoteErrorCode = "BODY_TOO_LARGE" | "INVALID_TEXT";

/** Does not disclose any message content. */
export class QuoteError extends Error {
  constructor(public readonly code: QuoteErrorCode) {
    super(`Mail quotes: ${code}`);
    this.name = "QuoteError";
  }
}

/** Allocation-free, bounded preflight before splitting, copying or matching text. */
export function validateBody(body: string): void {
  if (typeof body !== "string") throw new QuoteError("INVALID_TEXT");
  // UTF-8 takes at least one byte per UTF-16 code unit.
  if (body.length > MAX_BODY_BYTES) throw new QuoteError("BODY_TOO_LARGE");
  let bytes = 0;
  let lines = 1;
  for (let i = 0; i < body.length; i++) {
    const unit = body.charCodeAt(i);
    if (unit === 0) throw new QuoteError("INVALID_TEXT");
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = body.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new QuoteError("INVALID_TEXT");
      bytes += 4;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new QuoteError("INVALID_TEXT");
    } else {
      bytes += unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
      if (unit === 10) lines++;
    }
    if (bytes > MAX_BODY_BYTES || lines > MAX_BODY_LINES) {
      throw new QuoteError("BODY_TOO_LARGE");
    }
  }
}
