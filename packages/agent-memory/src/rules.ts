// AUTHORED-BY Codex GPT-6.1-Sol
import { parseDocument } from "yaml";

/** Conservative, explicit import schema: rules: [{ id, rule }]. No implicit coercion or aliases. */
export function communicationRules(input: string): { id: string; rule: string }[] {
  if (new TextEncoder().encode(input).length > 1_048_576)
    throw new RangeError("Communication rules exceed the import size limit");
  const document = parseDocument(input, { uniqueKeys: true, customTags: [] });
  if (document.errors.length || document.warnings.length)
    throw new TypeError("Invalid communication rules YAML");
  const value: unknown = document.toJS({ maxAliasCount: 0 });
  if (typeof value !== "object" || value === null || !("rules" in value))
    throw new TypeError("Expected a rules array");
  const rules = value.rules;
  if (!Array.isArray(rules) || !rules.length || rules.length > 1000)
    throw new TypeError("Expected 1 to 1000 communication rules");
  const ids = new Set<string>();
  return rules.map((row: unknown) => {
    if (
      typeof row !== "object" ||
      row === null ||
      !("id" in row) ||
      !("rule" in row) ||
      typeof row.id !== "string" ||
      typeof row.rule !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(row.id) ||
      !row.rule.trim() ||
      row.rule.length > 16_384 ||
      ids.has(row.id) ||
      Object.keys(row).some((key) => key !== "id" && key !== "rule")
    )
      throw new TypeError("Expected unique communication rules with id and rule strings");
    ids.add(row.id);
    return { id: row.id, rule: row.rule };
  });
}
