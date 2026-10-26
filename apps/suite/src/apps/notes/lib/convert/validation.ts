// AUTHORED-BY Codex GPT-6.1-Sol
export type NotesConversionErrorCode =
  | "invalid-input"
  | "unsupported-node"
  | "unsupported-mark"
  | "unsupported-attribute"
  | "invalid-structure"
  | "invalid-index"
  | "limit-exceeded";

/** No messages echo document text, attribute values, or link destinations. */
export class NotesConversionError extends Error {
  override readonly name = "NotesConversionError";
  constructor(readonly code: NotesConversionErrorCode) {
    super(`Notes conversion: ${code}`);
  }
}
export function requireValue(
  condition: unknown,
  code: NotesConversionErrorCode = "invalid-input",
): asserts condition {
  if (!condition) throw new NotesConversionError(code);
}

export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireValue(typeof value === "object" && value !== null && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null);
  requireValue(
    Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key)),
    "unsupported-attribute",
  );
  requireValue(
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => descriptor.enumerable && "value" in descriptor,
    ),
  );
  return value as Record<string, unknown>;
}

/** Dense JSON arrays only; never invoke user-defined accessors while transforming. */
export function array(value: unknown): unknown[] {
  requireValue(Array.isArray(value));
  requireValue(Object.getPrototypeOf(value) === Array.prototype);
  requireValue(Reflect.ownKeys(value).length === value.length + 1);
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    requireValue(descriptor?.enumerable && "value" in descriptor);
  }
  return value;
}

export function text(value: unknown): asserts value is string {
  requireValue(typeof value === "string" && value.isWellFormed());
}
