// AUTHORED-BY Codex GPT-6.1-Sol
import type {
  NumberField,
  SmartPlaylist,
  SmartPlaylistRule,
  SmartPlaylistSort,
  TextField,
} from "./types";
import { dataRecord, isNumber, isText, requireSmart, SmartPlaylistError } from "./validation";

const textFields: readonly string[] = ["artist", "album", "genre"];
const numberFields: readonly string[] = ["year", "playCount", "lastPlayedAt", "rating"];
const textOperators: readonly string[] = ["eq", "ne", "contains", "startsWith", "endsWith"];
const numberOperators: readonly string[] = ["eq", "ne", "lt", "lte", "gt", "gte"];

function object(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  dataRecord(value, "invalid-playlist");
  requireSmart(
    Object.keys(value).every((key) => allowed.includes(key)),
    "invalid-playlist",
  );
  return value;
}

function rule(input: unknown): SmartPlaylistRule {
  const value = object(input, ["field", "operator", "value"]);
  requireSmart(
    typeof value.field === "string" && typeof value.operator === "string",
    "invalid-playlist",
  );
  if (textFields.includes(value.field)) {
    requireSmart(textOperators.includes(value.operator) && isText(value.value), "invalid-playlist");
  } else {
    requireSmart(
      numberFields.includes(value.field) && numberOperators.includes(value.operator),
      "invalid-playlist",
    );
    requireSmart(isNumber(value.field as NumberField, value.value), "invalid-playlist");
  }
  return { field: value.field, operator: value.operator, value: value.value } as SmartPlaylistRule;
}

function sort(input: unknown): SmartPlaylistSort {
  const value = object(input, ["field", "direction"]);
  requireSmart(
    typeof value.field === "string" &&
      ["title", ...textFields, ...numberFields].includes(value.field) &&
      (value.direction === "asc" || value.direction === "desc"),
    "invalid-playlist",
  );
  return { field: value.field as TextField | NumberField | "title", direction: value.direction };
}

/** Strict runtime schema: rejects extra keys, unsupported versions and operator/value mismatches. */
export function validateSmartPlaylist(input: unknown): SmartPlaylist {
  const value = object(input, ["version", "mode", "rules", "sort", "limit"]);
  requireSmart(
    value.version === 1 && (value.mode === "all" || value.mode === "any"),
    "invalid-playlist",
  );
  requireSmart(Array.isArray(value.rules), "invalid-playlist");
  // Array.from visits holes rather than silently omitting invalid rules.
  const rules = Array.from(value.rules, rule);
  const result: SmartPlaylist = { version: 1, mode: value.mode, rules };
  const sorting = Object.hasOwn(value, "sort") ? { sort: sort(value.sort) } : {};
  if (Object.hasOwn(value, "limit")) {
    requireSmart(
      Number.isSafeInteger(value.limit) && (value.limit as number) >= 0,
      "invalid-playlist",
    );
    return { ...result, ...sorting, limit: value.limit as number };
  }
  return { ...result, ...sorting };
}

/** Validates before writing; never relies on caller toJSON or drops unsupported properties. */
export function serializeSmartPlaylist(input: SmartPlaylist): string {
  return JSON.stringify(validateSmartPlaylist(input));
}

export function parseSmartPlaylist(json: string): SmartPlaylist {
  requireSmart(typeof json === "string", "invalid-json");
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    throw new SmartPlaylistError("invalid-json");
  }
  return validateSmartPlaylist(input);
}
