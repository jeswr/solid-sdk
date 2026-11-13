// AUTHORED-BY Codex GPT-6
// Rule W sees concrete fields, including model constants and CSRF decoration.
import type { CsrfRule } from "@jeswr/site-model";
import type { CompiledRequest } from "./compile.js";
import { canonicalJson } from "./gate.js";

export interface WireField {
  name: string;
  value: string;
  location: "query" | "path" | "header" | "body";
}

const TRANSPORT_HEADERS = new Set([
  "content-type",
  "content-length",
  "accept",
  "cookie",
  "origin",
  "referer",
]);
const pointerPart = (name: string): string => name.replaceAll("~", "~0").replaceAll("/", "~1");

export function csrfFieldName(compiled: CompiledRequest, rule: CsrfRule): string {
  return (
    rule.target.kind === "form" && compiled.body?.kind === "json"
      ? `/${pointerPart(rule.target.name)}`
      : rule.target.name
  ).toLowerCase();
}

/** Session/vault headers are attached by send(), so never appear in this inventory. */
export function effectiveWireFields(compiled: CompiledRequest): WireField[] {
  const fields: WireField[] = [];
  const add = (name: string, value: string, location: WireField["location"]): void => {
    fields.push({ name: name.toLowerCase(), value, location });
  };
  for (const [name, value] of compiled.url.searchParams) add(name, value, "query");
  for (const [name, value] of compiled.pathFields ?? []) add(name, value, "path");
  for (const [name, value] of new Headers(compiled.headers))
    if (!TRANSPORT_HEADERS.has(name.toLowerCase())) add(name, value, "header");
  if (compiled.body?.kind === "json") {
    const walk = (node: unknown, pointer: string): void => {
      if (pointer !== "" || node === null || typeof node !== "object")
        add(
          pointer,
          node !== null && typeof node === "object" ? canonicalJson(node) : String(node),
          "body",
        );
      if (node !== null && typeof node === "object")
        for (const [name, value] of Object.entries(node))
          walk(value, `${pointer}/${pointerPart(name)}`);
    };
    walk(compiled.body.value, "");
  } else if (compiled.body)
    for (const [name, value] of compiled.body.fields) add(name, value, "body");
  return fields;
}
