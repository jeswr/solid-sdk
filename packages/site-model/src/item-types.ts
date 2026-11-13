// AUTHORED-BY Codex GPT-6.1-Sol
import { SCHEMA } from "./types.js";

/** Endpoint-owned words only: never infer a record class from a user's query. */
export function endpointItemType(
  endpoint: string,
): { itemType: string; additionalType?: string } | undefined {
  const url = new URL(endpoint.replace(/\{[^}]*\}/g, ""));
  const dispatch = [...url.searchParams].find(([key]) =>
    /^(namespace|resource|collection|dataset)$/i.test(key),
  )?.[1];
  const words = (dispatch ?? url.pathname)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  // Refund records have no schema.org document class. RefundTypeEnumeration describes
  // refund policies, not records; Invoice would incorrectly imply money is due.
  const table: Array<[RegExp, string, string?]> = [
    [/\bcredit\s*memos?\b/, "Thing", "credit memo"],
    [/\brefunds?\b/, "Thing", "refund"],
    [/\binvoices?\b/, "Invoice"],
    [/\b(shipments?|parcels?|deliveries)\b/, "ParcelDelivery"],
    [/\b(customer|user) groups?\b/, "Thing"],
    [/\b(customers?|people|persons?)\b/, "Person"],
    [/\bproducts?\b/, "Product"],
    [/\borders?\b/, "Order"],
  ];
  for (const [pattern, type, additionalType] of table)
    if (pattern.test(words))
      return { itemType: SCHEMA + type, ...(additionalType ? { additionalType } : {}) };
  return undefined;
}
