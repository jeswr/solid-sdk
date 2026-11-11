// AUTHORED-BY Codex GPT-6.1-Sol
import type { SearchQuery } from "./types.js";

/** Validate an absolute HTTP(S) IRI before placing it inside a SPARQL IRIREF. */
export function httpIri(value: string): string {
  if (
    !/^https?:\/\//i.test(value) ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: SPARQL IRIREF forbids these characters.
    /[\u0000-\u0020<>"{}|^`\\\u007f]/u.test(value) ||
    /%(?![\da-f]{2})/i.test(value)
  )
    throw new TypeError("Search requires an absolute HTTP(S) IRI");
  const url = new URL(value);
  if (url.username || url.password) throw new TypeError("Search IRIs must not embed credentials");
  return value;
}

/** Validate paging before any query or network I/O. One extra row detects another page. */
export function pagination(q: SearchQuery): { limit: number; offset: number } {
  const limit = q.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new RangeError("Search limit must be an integer between 1 and 1000");
  let offset = 0;
  if (q.cursor !== undefined) {
    try {
      const decoded = atob(q.cursor);
      offset = Number(decoded);
      if (!/^(0|[1-9][0-9]*)$/.test(decoded) || btoa(decoded) !== q.cursor) throw new TypeError();
    } catch {
      throw new TypeError("Invalid search cursor");
    }
  }
  if (!Number.isSafeInteger(offset + limit + 1)) throw new RangeError("Search offset is too large");
  return { limit, offset };
}

/**
 * The single server/local SELECT template. JSON string escaping is also SPARQL string
 * escaping (including quotes, backslashes and control characters); IRIs are validated separately.
 * Grouping produces one deterministic row per subject across labels, types and resource graphs.
 */
export function buildSearchQuery(q: SearchQuery, options: { origin?: string } = {}): string {
  const { limit, offset } = pagination(q);
  // Results must be HTTP(S) resources; a server is further held to the storage origin.
  // Both filters run before LIMIT/OFFSET so a stray subject never shortens or breaks a page.
  const origin =
    options.origin === undefined
      ? ""
      : `\n  FILTER(STRSTARTS(STR(?s), ${JSON.stringify(`${new URL(httpIri(options.origin)).origin}/`)}))`;
  const text = JSON.stringify(q.text ?? "");
  const types = q.types?.map((type) => `<${httpIri(type)}>`);
  const within = q.within?.map((prefix) => {
    const url = new URL(httpIri(prefix));
    if (url.search || url.hash)
      throw new TypeError("Search containers must not have query or fragment");
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return `STRSTARTS(STR(?s), ${JSON.stringify(url.href)})`;
  });
  const relevance = q.orderBy !== "modified";
  return `PREFIX dct: <http://purl.org/dc/terms/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <https://schema.org/>
PREFIX wf: <http://www.w3.org/2005/01/wf/flow#>
PREFIX sioc: <http://rdfs.org/sioc/ns#>
SELECT ?s (MIN(STR(?label)) AS ?title) (MIN(STR(?type)) AS ?resultType)
  (MAX(?changed) AS ?modified) (MIN(STR(?description)) AS ?snippet)
  (MIN(STR(?format)) AS ?contentType)
WHERE {
  GRAPH ?g { ?s (dct:title|rdfs:label|schema:name|<http://schema.org/name>|wf:description|sioc:name) ?label }
  FILTER(isIRI(?s) && isLiteral(?label))
  FILTER(STRSTARTS(LCASE(STR(?s)), "http://") || STRSTARTS(LCASE(STR(?s)), "https://"))${origin}
  FILTER(CONTAINS(LCASE(STR(?label)), LCASE(${text})))
  ${within?.length ? `FILTER(${within.join(" || ")})` : ""}
  ${types?.length ? `VALUES ?type { ${types.join(" ")} }\n  GRAPH ?tg { ?s a ?type }` : "OPTIONAL { GRAPH ?tg { ?s a ?type } }"}
  OPTIONAL { GRAPH ?mg { ?s dct:modified ?changed } }
  OPTIONAL { GRAPH ?dg { ?s (dct:description|schema:description|sioc:content) ?description } }
  OPTIONAL { GRAPH ?fg { ?s dct:format ?format } }
  ${relevance ? `BIND(IF(LCASE(STR(?label)) = LCASE(${text}), 2, IF(STRSTARTS(LCASE(STR(?label)), LCASE(${text})), 1, 0)) AS ?score)` : ""}
}
GROUP BY ?s
ORDER BY ${relevance ? "DESC(MAX(?score)) " : ""}DESC(?modified) ASC(?s)
LIMIT ${limit + 1}
OFFSET ${offset}`;
}
