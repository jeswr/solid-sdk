// AUTHORED-BY Codex GPT-6.1-Sol
export type PreviewErrorCode = "input-too-large" | "too-many-tags" | "invalid-html" | "invalid-url";

/** Messages never include untrusted input or URL credentials. */
export class PreviewError extends Error {
  constructor(public readonly code: PreviewErrorCode) {
    super(`Link preview rejected: ${code}`);
    this.name = "PreviewError";
  }
}
