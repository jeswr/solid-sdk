// AUTHORED-BY Codex GPT-6.1-Sol
import { jsonPointer, pagingKind, selectionPaginationDescription } from "@jeswr/site-executor";
import type { Extraction } from "@jeswr/site-model";
import { matchRequest } from "./templates.js";
import type { CandidateParam, EndpointCandidate } from "./types.js";

/** Require a witnessed starting request and its continuation with identical scope.
 * A lone page number cannot establish either the base or the continuation rule. */
export function learnedPagination(
  candidate: EndpointCandidate,
  parameter: CandidateParam,
  extraction: Extraction | undefined,
): string | undefined {
  const kind = pagingKind(parameter.name);
  if (
    parameter.location !== "query" ||
    (kind !== "page" && kind !== "offset") ||
    extraction?.format !== "json" ||
    extraction.itemPath === undefined
  )
    return undefined;
  const samples = candidate.samples.flatMap((r) => {
    if (
      !["crawl", "demonstration"].includes(r.phase) ||
      r.blocked ||
      r.bodyTruncated ||
      r.status === undefined ||
      r.status < 200 ||
      r.status >= 300 ||
      !r.bodySample
    )
      return [];
    const values = matchRequest(candidate, r);
    if (!values || !/^(0|[1-9]\d*)$/.test(values[parameter.name] ?? "")) return [];
    try {
      const doc = JSON.parse(r.bodySample);
      if (
        doc &&
        Object.entries(doc).some(([k, v]) => /^(error|errors|redirect|ajaxRedirect)$/i.test(k) && v)
      )
        return [];
      const rows = jsonPointer(doc, extraction.itemPath as string);
      if (!Array.isArray(rows)) return [];
      const position = Number(values[parameter.name]);
      const scope = JSON.stringify(
        Object.entries(values)
          .filter(([name]) => name !== parameter.name)
          .sort(),
      );
      return Number.isSafeInteger(position) ? [{ position, span: rows.length, scope }] : [];
    } catch {
      return [];
    }
  });
  const first = samples.find((sample) => sample.position === 0) ?? samples[0];
  if (!first || (first.position !== 0 && (kind !== "page" || first.position !== 1)))
    return undefined;
  const next = first.position + (kind === "page" ? 1 : first.span);
  if (!first.span || !samples.some((r) => r.scope === first.scope && r.position === next))
    return undefined;
  return selectionPaginationDescription(kind, first.position);
}
