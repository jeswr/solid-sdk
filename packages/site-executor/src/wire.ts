// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// Rule W sees concrete fields, including model constants and CSRF decoration.
import type { CsrfRule } from "@jeswr/site-model";
import { type CompiledRequest, normaliseFormFieldName } from "./compile.js";
import { canonicalJson } from "./gate.js";

export interface WireField {
  name: string;
  value: string;
  location: "query" | "path" | "header" | "body";
  /** A decorated reserved path slot, never a planner input. */
  sessionToken?: true;
}

const pointerPart = (name: string): string => name.replaceAll("~", "~0").replaceAll("/", "~1");

export function csrfFieldName(compiled: CompiledRequest, rule: CsrfRule): string {
  const name =
    rule.target.kind === "form" && compiled.body?.kind === "json"
      ? `/${pointerPart(rule.target.name)}`
      : rule.target.kind === "form" && compiled.body?.kind === "multipart"
        ? normaliseFormFieldName(rule.target.name, true)
        : rule.target.name;
  return rule.target.kind === "header" ? name.toLowerCase() : name;
}

/** Session/vault headers are attached by send(), so never appear in this inventory. */
export function effectiveWireFields(compiled: CompiledRequest): WireField[] {
  const fields: WireField[] = [];
  const add = (name: string, value: string, location: WireField["location"]): void => {
    fields.push({ name: location === "header" ? name.toLowerCase() : name, value, location });
  };
  for (const [name, value] of compiled.url.searchParams) add(name, value, "query");
  for (const [name, value] of compiled.pathFields ?? []) {
    fields.push({
      name,
      value,
      location: "path",
      ...(compiled.pathTokens?.names.includes(name) ? { sessionToken: true } : {}),
    });
  }
  const headers = new Headers(compiled.headers);
  for (const name of compiled.modelHeaders) {
    const value = headers.get(name);
    if (value !== null) add(name, value, "header");
  }
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

/** Token values after decoration and the send path's body/header normalization. */
export function transmittedCsrfSecrets(compiled: CompiledRequest): string[] {
  const fields = effectiveWireFields(compiled);
  return compiled.csrf.flatMap((rule) => {
    const location =
      rule.target.kind === "header"
        ? "header"
        : rule.target.kind === "form"
          ? "body"
          : compiled.pathTokens?.names.includes(rule.target.name)
            ? "path"
            : "query";
    return fields
      .filter(
        (field) => field.location === location && field.name === csrfFieldName(compiled, rule),
      )
      .flatMap((field) => [
        field.value,
        // Retain the encoded spelling from the actual final URL as well as the
        // decoded slot. No parallel implementation of URL encoding is needed.
        ...(location === "path"
          ? compiled.url.pathname.split("/").filter((part) => {
              try {
                return decodeURIComponent(part) === field.value;
              } catch {
                return false;
              }
            })
          : []),
      ]);
  });
}
