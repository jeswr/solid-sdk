// AUTHORED-BY Codex GPT-6.1-Sol
import { z } from "zod";
import { canonicalJson } from "./canonical.js";

type JsonValue = z.infer<ReturnType<typeof z.json>>;
// Zod's JSON/record parsers copy objects while dropping own __proto__ properties.
// Validate the canonical JSON data model without transforming opaque content.
export const json = z.custom<JsonValue>((value) => {
  try {
    canonicalJson(value);
    return true;
  } catch {
    return false;
  }
}, "expected canonicalisable JSON");

export function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    json.safeParse(value).success
  );
}

export const jsonObject = z.custom<Record<string, JsonValue>>(isJsonObject, "expected JSON object");
