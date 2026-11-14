// AUTHORED-BY Claude Opus 5.5
// Session liveness proof: a learned read that only answers with data in a live session.
import { createHash } from "node:crypto";
import type { Extraction } from "@jeswr/site-model";
import { attribute, elementText, jsonPointer, parseHtml, selectElements } from "./dom.js";
import { jsonEnvelope, responsePageError } from "./response-evidence.js";

/** Status, media type and opaque structure of a learned read's success response. */
export interface LivenessSignature {
  status: number;
  contentType: string;
  structure: string;
}

/**
 * A learned read-gated GET, sent with the same session after a deletion's absence read. Every
 * input is a witnessed constant: nothing comes from the write, so the read never addresses the
 * deleted item.
 */
export interface LivenessRead {
  operation: string;
  bind: Record<string, { value: string }>;
  signature: LivenessSignature;
}

/** Bounded rows inspected for item-level presence; the signature never depends on the count. */
const ROWS = 20;
const SELF = new Set(["", ".", ":scope"]);

const presentScalar = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some(presentScalar)
    : (typeof value === "string" && value.trim() !== "") ||
      (typeof value === "number" && Number.isFinite(value)) ||
      typeof value === "boolean";

/**
 * Success evidence for a liveness read, or undefined. It needs a 2xx response of the
 * extraction's format without any failure or authentication marker (the shared page-error
 * predicate: authentication headings, password inputs, login/SSO forms, failure envelopes),
 * and at least one row carrying an item-level field. The structure is the JSON envelope
 * (ancestor keys of the collection, or the main item's keys) or the HTML document paths that
 * lead to the rows, so a login page, an empty envelope or a different document never matches.
 */
export function livenessSignature(
  status: number,
  contentType: string | undefined,
  body: string,
  extraction: Extraction,
): LivenessSignature | undefined {
  if (!Number.isSafeInteger(status) || status < 200 || status >= 300 || !body.trim()) return;
  const media = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (extraction.format === "json" ? !/json/.test(media) : !/html/.test(media)) return;
  if (responsePageError(body, media, false)) return;
  let structure: unknown;
  try {
    if (extraction.format === "json") {
      const doc: unknown = JSON.parse(body);
      const envelope = jsonEnvelope(doc, extraction.itemPath);
      if (envelope.failed || !envelope.keys) return;
      const root = jsonPointer(doc, extraction.itemPath ?? "");
      const rows = Array.isArray(root) ? root : [root];
      if (!rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row)))
        return;
      const present = rows
        .slice(0, ROWS)
        .some((row) =>
          extraction.fields.some((field) => presentScalar(jsonPointer(row, field.path))),
        );
      if (!present) return;
      structure = [
        "json",
        envelope.keys,
        Array.isArray(root) ? "array" : Object.keys(root as object).sort(),
      ];
    } else {
      const doc = parseHtml(body);
      const roots = extraction.itemPath ? selectElements(extraction.itemPath, doc, ROWS) : [doc];
      const matched = roots.flatMap((root) =>
        extraction.fields.flatMap((field) =>
          (SELF.has(field.path.trim()) ? [root] : selectElements(field.path, root, ROWS)).filter(
            (el) => {
              const value =
                field.attribute && "attribs" in el
                  ? attribute(el, field.attribute)
                  : elementText(el);
              return value !== undefined && value.trim() !== "";
            },
          ),
        ),
      );
      if (!matched.length) return;
      const path = (node: (typeof matched)[number]) => {
        const names: string[] = [];
        for (let at: typeof node | null = node; at && "name" in at; at = at.parent as typeof at)
          names.unshift(at.name.toLowerCase());
        return names.join(">");
      };
      const rows = extraction.itemPath ? roots : matched;
      structure = ["html", [...new Set(rows.map(path))].sort()];
    }
  } catch {
    return;
  }
  return {
    status,
    contentType: media,
    structure: createHash("sha256").update(JSON.stringify(structure)).digest("hex"),
  };
}
