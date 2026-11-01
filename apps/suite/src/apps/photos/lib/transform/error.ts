// AUTHORED-BY Codex GPT-6.1-Sol
export type TransformErrorCode =
  | "invalid-orientation"
  | "invalid-record"
  | "invalid-edit"
  | "invalid-crop"
  | "invalid-size"
  | "invalid-aspect-ratio";

/** Static messages never include caller metadata. */
export class TransformError extends Error {
  constructor(public readonly code: TransformErrorCode) {
    super(`Photo transform: ${code}`);
    this.name = "TransformError";
  }
}

export function requireTransform(condition: unknown, code: TransformErrorCode): asserts condition {
  if (!condition) throw new TransformError(code);
}

export function record(
  value: unknown,
  keys: readonly string[],
  code: TransformErrorCode,
): Record<string, unknown> {
  requireTransform(typeof value === "object" && value !== null && !Array.isArray(value), code);
  requireTransform(
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)),
    code,
  );
  return value as Record<string, unknown>;
}
