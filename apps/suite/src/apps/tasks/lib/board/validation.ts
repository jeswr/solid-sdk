// AUTHORED-BY Codex GPT-6.1-Sol

export type BoardErrorCode = "invalid-input" | "unknown-status" | "invalid-order" | "invalid-state";

export class BoardError extends Error {
  override readonly name = "BoardError";
  constructor(
    readonly code: BoardErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function requireInput(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BoardError("invalid-input", message);
}

export function identifier(value: unknown): asserts value is string {
  requireInput(
    typeof value === "string" && value.trim().length > 0,
    "Expected a nonempty identifier",
  );
}

export function uniqueStrings(value: unknown): asserts value is readonly string[] {
  requireInput(Array.isArray(value), "Expected an array of unique identifiers");
  const seen = new Set<string>();
  for (const entry of value) {
    identifier(entry);
    requireInput(!seen.has(entry), "Duplicate identifier");
    seen.add(entry);
  }
}
