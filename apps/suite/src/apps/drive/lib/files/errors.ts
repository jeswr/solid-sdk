// AUTHORED-BY Codex GPT-6.1-Sol
export type FileErrorCode =
  | "invalid-name"
  | "name-too-long"
  | "invalid-iri"
  | "outside-root"
  | "invalid-size"
  | "invalid-bytes"
  | "invalid-locale";

/** Pure-library failures; messages never include caller-provided names or IRIs. */
export class FileError extends Error {
  constructor(public readonly code: FileErrorCode) {
    super(`Drive files: ${code}`);
    this.name = "FileError";
  }
}

export function validString(value: string, code: FileErrorCode): void {
  if (typeof value !== "string" || !value.isWellFormed()) throw new FileError(code);
}
