// AUTHORED-BY Codex GPT-6.1-Sol
// Structural selection witnesses use the existing Parameter and Flow contract.
import type { Operation, Parameter } from "./types.js";
import { SCHEMA } from "./types.js";
import { templateVariables } from "./validate.js";

export const SELECTION_IDENTITIES = Object.freeze(
  ["identifier", "sku", "productID", "orderNumber"].map((name) => SCHEMA + name),
);

export function isSelectionFilter(name: string): boolean {
  const decoded = decodeURIComponent(name);
  return (
    /^(q|query|search|keyword|keywords|term|s|text)$/i.test(decoded) ||
    (/^filters?(?:\[.+\]|\..+)$/i.test(decoded) &&
      !/^filters?(?:\[placeholder\]|\.placeholder)$/i.test(decoded))
  );
}

/** A required flow-only body input deliberately omitted from an explicit body template.
 * It witnesses the resolver's identity without adding a field to the demonstrated request.
 * Names/descriptions have no special meaning; its Flow binding identifies the source read.
 */
export function selectionWitnesses(operation: Operation): Parameter[] {
  const template = operation.request.bodyTemplate;
  if (operation.effect === "read" || template === undefined) return [];
  const decoded =
    operation.request.contentType === "application/json"
      ? template
      : [...new URLSearchParams(template).values()].join(" ");
  const variables = templateVariables(operation.request.urlTemplate).variables;
  return operation.inputs.filter(
    (p) =>
      p.required &&
      !p.path.length &&
      p.default === undefined &&
      (p.location === "body" || p.location === "form") &&
      !decoded.includes(`{${p.name}}`) &&
      !variables.includes(p.name),
  );
}
