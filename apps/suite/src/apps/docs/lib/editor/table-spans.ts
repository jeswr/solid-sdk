// AUTHORED-BY Codex
/** Spans are bounded integers before any table renderer or plugin sees them. */
export function normaliseTableSpan(value: unknown): number | null {
  const span = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(span) && span >= 1 && span <= 1000 ? span : null;
}

/** Retain import diagnostics even though the schema also repairs HTML spans. */
export function normaliseHtmlTableSpans(root: ParentNode, invalid: () => void): void {
  for (const cell of root.querySelectorAll("td, th")) {
    for (const key of ["colspan", "rowspan"]) {
      const value = cell.getAttribute(key);
      if (value === null) continue;
      const span = normaliseTableSpan(value);
      if (span === null) invalid();
      cell.setAttribute(key, String(span ?? 1));
    }
  }
}
