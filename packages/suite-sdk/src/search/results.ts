// AUTHORED-BY Codex GPT-6.1-Sol
import { httpIri, pagination } from "./query.js";
import type { SearchPage, SearchQuery, SearchResult } from "./types.js";

/** Common SPARQL JSON row shape, also produced by the local bindings adapter. */
export type Row = Record<string, unknown>;

function value(row: Row, name: string, expected: "uri" | "literal"): string | undefined {
  const term = row[name] as { type?: string; value?: string } | undefined;
  if (term === undefined) return undefined;
  if (
    term === null ||
    typeof term.value !== "string" ||
    (term.type !== expected && !(expected === "literal" && term.type === "typed-literal"))
  )
    throw new TypeError("Invalid SPARQL search binding");
  return term.value;
}

function result(row: Row): SearchResult {
  const url = value(row, "s", "uri");
  const title = value(row, "title", "literal");
  if (url === undefined || title === undefined)
    throw new TypeError("Missing SPARQL search binding");
  const parent = new URL(httpIri(url));
  const path = parent.pathname.replace(/\/$/, "");
  parent.pathname = path.slice(0, path.lastIndexOf("/") + 1);
  parent.search = "";
  parent.hash = "";
  const modified = value(row, "modified", "literal");
  const date = modified === undefined ? undefined : new Date(modified);
  return {
    url,
    title,
    parent: parent.href,
    type: value(row, "resultType", "literal"),
    snippet: value(row, "snippet", "literal"),
    contentType: value(row, "contentType", "literal"),
    modified: date && Number.isFinite(date.getTime()) ? date : undefined,
  };
}

/** Parse, trim the lookahead row, and issue the same cursor on both execution paths. */
export function searchPage(source: SearchPage["source"], rows: Row[], q: SearchQuery): SearchPage {
  const { limit, offset } = pagination(q);
  return {
    source,
    results: rows.slice(0, limit).map(result),
    ...(rows.length > limit ? { next: btoa(String(offset + limit)) } : {}),
  };
}

/** Check the SPARQL Protocol SELECT envelope before parsing its bindings. */
export function jsonRows(json: unknown): Row[] {
  const rows = (json as { results?: { bindings?: unknown } } | null)?.results?.bindings;
  if (!Array.isArray(rows) || rows.some((row) => row === null || typeof row !== "object"))
    throw new TypeError("Invalid SPARQL search results");
  return rows;
}
