// AUTHORED-BY Codex GPT-6.1-Sol

export type ExifErrorCode =
  | "invalid-input"
  | "invalid-jpeg"
  | "out-of-bounds"
  | "invalid-tiff"
  | "unsupported-type"
  | "invalid-ifd"
  | "invalid-tag"
  | "duplicate-exif";

/** Messages contain no input bytes or potentially private metadata. */
export class ExifError extends Error {
  constructor(public readonly code: ExifErrorCode) {
    super(`Exif reader: ${code}`);
    this.name = "ExifError";
  }
}

export function requireExif(condition: unknown, code: ExifErrorCode): asserts condition {
  if (!condition) throw new ExifError(code);
}
