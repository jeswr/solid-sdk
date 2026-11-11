// AUTHORED-BY Codex GPT-6.1-Sol
export class PreferencesError extends Error {
  constructor(
    readonly code:
      | "invalid-key"
      | "invalid-json"
      | "too-large"
      | "session-changed"
      | "unsafe-location"
      | "missing-etag"
      | "unsupported-access",
  ) {
    super(`Preferences: ${code}`);
    this.name = "PreferencesError";
  }
}

export function validateKey(key: string): void {
  if (typeof key !== "string" || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(key))
    throw new PreferencesError("invalid-key");
}

export function assertSize(json: string): void {
  if (new TextEncoder().encode(json).byteLength > 65_536) throw new PreferencesError("too-large");
}

/** Reject lossy/non-JSON values before touching either persistence layer. */
export function encode(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value, function (key, item) {
      const original = this[key];
      if (
        item === undefined ||
        original === undefined ||
        typeof original === "function" ||
        typeof original === "symbol" ||
        (typeof original === "number" && !Number.isFinite(original)) ||
        (original !== null &&
          typeof original === "object" &&
          !Array.isArray(original) &&
          Object.getPrototypeOf(original) !== Object.prototype &&
          Object.getPrototypeOf(original) !== null) ||
        (original !== null && typeof original === "object" && typeof original.toJSON === "function")
      )
        throw new Error("Not JSON");
      return item;
    });
  } catch {
    throw new PreferencesError("invalid-json");
  }
  assertSize(json);
  return json;
}
