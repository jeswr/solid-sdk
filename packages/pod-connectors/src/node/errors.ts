// AUTHORED-BY Codex GPT-6.1-Sol

/** Stable CLI failure categories. Messages never contain transport errors or credentials. */
export class NodeRuntimeError extends Error {
  constructor(
    readonly kind: "config" | "auth" | "import" | "cancelled",
    message: string,
  ) {
    super(message);
    this.name = "NodeRuntimeError";
  }
}

/** Validate a configured HTTPS URL without accepting embedded credentials. */
export function httpsUrl(value: unknown, allowFragment = false): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid URL");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (!allowFragment && url.hash))
    throw new Error("Invalid URL");
  return url.href;
}

/** Narrow JSON objects without trusting an asserted TypeScript interface. */
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid object");
  return value as Record<string, unknown>;
}

/** Require a nonempty string without incorporating its value in diagnostics. */
export function textValue(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid string");
  return value;
}
