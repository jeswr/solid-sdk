// AUTHORED-BY Codex GPT-6.1-Sol

export type NotesErrorCode =
  | "invalid-input"
  | "invalid-order-key"
  | "mixed-ordering"
  | "invalid-transition"
  | "unsupported-capture"
  | "segmenter-unavailable";

/** Machine-readable failures; messages never echo note content. */
export class NotesError extends Error {
  override readonly name = "NotesError";

  constructor(
    readonly code: NotesErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Keep strings intact, including whitespace; reject ill-formed UTF-16. */
export function assertText(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.isWellFormed()) {
    throw new NotesError("invalid-input", "Expected well-formed Unicode text");
  }
}

export function assertLabels(labels: readonly string[]): void {
  if (!Array.isArray(labels)) {
    throw new NotesError("invalid-input", "Expected a label array");
  }
  for (const label of labels) {
    assertText(label);
    if (label.length === 0) {
      throw new NotesError("invalid-input", "Labels must be nonempty");
    }
  }
}
