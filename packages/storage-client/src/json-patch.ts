// AUTHORED-BY Claude Opus 5.5
import type { JsonPatchOp } from "./types.js";

/** Why a patch could not be applied: malformed (`invalid`) or not applicable to this document (`conflict`). */
export class JsonPatchError extends Error {
  constructor(
    readonly kind: "invalid" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "JsonPatchError";
  }
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Container = Json[] | { [key: string]: Json };

/** RFC 6901: "" is the whole document; "/a~1b/~0c" → ["a/b", "~c"]. */
function parsePointer(pointer: unknown, member: string): string[] {
  if (typeof pointer !== "string")
    throw new JsonPatchError("invalid", `${member} must be a string`);
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new JsonPatchError("invalid", `${member} must be a JSON Pointer: ${pointer}`);
  }
  return pointer
    .slice(1)
    .split("/")
    .map((token) => {
      if (/~(?![01])/.test(token)) {
        throw new JsonPatchError("invalid", `Invalid escape in JSON Pointer: ${pointer}`);
      }
      return token.replaceAll("~1", "/").replaceAll("~0", "~");
    });
}

function isContainer(value: Json | undefined): value is Container {
  return typeof value === "object" && value !== null;
}

/** Array index per RFC 6901: "0" or a digit string without leading zeros. */
function arrayIndex(token: string, length: number, allowEnd: boolean): number {
  if (allowEnd && token === "-") return length;
  if (!/^(0|[1-9]\d*)$/.test(token)) {
    throw new JsonPatchError("conflict", `Invalid array index: ${token}`);
  }
  const index = Number(token);
  if (index > (allowEnd ? length : length - 1)) {
    throw new JsonPatchError("conflict", `Array index out of bounds: ${token}`);
  }
  return index;
}

function has(object: { [key: string]: Json }, key: string): boolean {
  return Object.hasOwn(object, key);
}

function get(document: Json, tokens: readonly string[]): Json {
  let current: Json = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      current = current[arrayIndex(token, current.length, false)] as Json;
    } else if (isContainer(current) && has(current, token)) {
      current = current[token] as Json;
    } else {
      throw new JsonPatchError("conflict", `Path not found: /${tokens.join("/")}`);
    }
  }
  return current;
}

function parentOf(document: Json, tokens: readonly string[]): { parent: Container; key: string } {
  const parent = get(document, tokens.slice(0, -1));
  if (!isContainer(parent)) {
    throw new JsonPatchError("conflict", `Parent is not a container: /${tokens.join("/")}`);
  }
  return { parent, key: tokens[tokens.length - 1] as string };
}

function add(document: Json, tokens: readonly string[], value: Json): Json {
  if (tokens.length === 0) return value;
  const { parent, key } = parentOf(document, tokens);
  if (Array.isArray(parent)) parent.splice(arrayIndex(key, parent.length, true), 0, value);
  // defineProperty: "__proto__" is an ordinary member name, never a prototype assignment.
  else
    Object.defineProperty(parent, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return document;
}

function remove(document: Json, tokens: readonly string[]): Json {
  if (tokens.length === 0) throw new JsonPatchError("conflict", "Cannot remove the whole document");
  const { parent, key } = parentOf(document, tokens);
  if (Array.isArray(parent)) {
    parent.splice(arrayIndex(key, parent.length, false), 1);
  } else {
    if (!has(parent, key))
      throw new JsonPatchError("conflict", `Path not found: /${tokens.join("/")}`);
    delete parent[key];
  }
  return document;
}

/** Structural equality per RFC 6902 §4.6 (object member order is irrelevant). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => jsonEqual(item, b[index]))
    );
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every(
      (key) =>
        Object.hasOwn(b, key) &&
        jsonEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}

function clone(value: unknown): Json {
  if (value === undefined) throw new JsonPatchError("invalid", "Operation is missing its value");
  try {
    return JSON.parse(JSON.stringify(value)) as Json;
  } catch {
    throw new JsonPatchError("invalid", "Operation value is not JSON");
  }
}

/**
 * Apply an RFC 6902 JSON Patch. The input is not modified; the patch is atomic (all or nothing).
 * @throws {JsonPatchError} `invalid` for malformed operations, `conflict` when a path or test fails.
 */
export function applyJsonPatch(document: unknown, ops: readonly JsonPatchOp[]): unknown {
  if (!Array.isArray(ops)) throw new JsonPatchError("invalid", "A JSON Patch is an array");
  let result = clone(document);
  for (const op of ops) {
    if (typeof op !== "object" || op === null) {
      throw new JsonPatchError("invalid", "Each operation must be an object");
    }
    const path = parsePointer(op.path, "path");
    switch (op.op) {
      case "add":
        if (!("value" in op)) throw new JsonPatchError("invalid", "add requires a value");
        result = add(result, path, clone(op.value));
        break;
      case "remove":
        result = remove(result, path);
        break;
      case "replace":
        if (!("value" in op)) throw new JsonPatchError("invalid", "replace requires a value");
        result =
          path.length === 0 ? clone(op.value) : add(remove(result, path), path, clone(op.value));
        break;
      case "move": {
        const from = parsePointer(op.from, "from");
        if (from.length < path.length && from.every((token, index) => token === path[index])) {
          throw new JsonPatchError("conflict", "Cannot move a value into one of its children");
        }
        const value = get(result, from);
        // Moving a location onto itself (including the root) is a no-op once it exists.
        if (from.length === path.length && from.every((token, index) => token === path[index])) {
          break;
        }
        result = add(remove(result, from), path, value);
        break;
      }
      case "copy": {
        const from = parsePointer(op.from, "from");
        result = add(result, path, clone(get(result, from)));
        break;
      }
      case "test":
        if (!("value" in op)) throw new JsonPatchError("invalid", "test requires a value");
        if (!jsonEqual(get(result, path), op.value)) {
          throw new JsonPatchError("conflict", `Test failed at ${op.path}`);
        }
        break;
      default:
        throw new JsonPatchError(
          "invalid",
          `Unknown operation: ${String((op as { op: unknown }).op)}`,
        );
    }
  }
  return result;
}
