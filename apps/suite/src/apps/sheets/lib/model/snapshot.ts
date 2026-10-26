// AUTHORED-BY Codex GPT-6.1-Sol
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type Snapshot = { [key: string]: JsonValue };

/** Validate rather than silently dropping undefined, non-finite values or engine class instances. */
export function serializeSnapshot(snapshot: Snapshot): string {
  const ancestors = new Set<object>();
  function visit(value: unknown): void {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || value === null || ancestors.has(value)) {
      throw new TypeError("Snapshot must contain acyclic JSON values");
    }
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError("Snapshot must contain plain JSON objects");
    }
    ancestors.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) visit(value[i]);
    } else {
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string") throw new TypeError("Snapshot keys must be strings");
        visit((value as Snapshot)[key]);
      }
    }
    ancestors.delete(value);
  }
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
    throw new TypeError("Snapshot must be a JSON object");
  }
  visit(snapshot);
  return JSON.stringify(snapshot);
}

export function deserializeSnapshot(json: string): Snapshot {
  const value: Snapshot = JSON.parse(json);
  serializeSnapshot(value);
  return value;
}
