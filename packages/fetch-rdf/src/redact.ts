// AUTHORED-BY Codex GPT-6.1-Sol

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!url.username && !url.password && !value.includes("?") && !value.includes("#"))
      return value;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return (value.split(/[?#]/, 1)[0] ?? "").replace(/(\/\/)[^/]*@/, "$1");
  }
}

export function redactText(value: string): string {
  return value.replace(
    /[a-z][a-z\d+.-]*:(?:\/\/[^\s<>"'`]+|[^\s<>"'`]*[?#][^\s<>"'`]*)/gi,
    redactUrl,
  );
}

/** Preserve safe cause identity; copy unsafe causes without mutating caller errors. */
export function redactCause(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (typeof value === "string") return redactText(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  let changed = false;
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ("value" in descriptor) {
      const original = descriptor.value;
      descriptor.value =
        key === "url" && typeof original === "string"
          ? redactUrl(original)
          : redactCause(original, seen);
      changed ||= descriptor.value !== original;
    }
    Object.defineProperty(copy, key, descriptor);
  }
  return changed ? copy : value;
}
