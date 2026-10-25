// AUTHORED-BY Codex GPT-6.1-Sol

/** A Link field value with its target and anchor context resolved against the response URL. */
export interface ParsedLink {
  readonly target: string;
  readonly context: string;
  /** Case-normalised relation types; extension URIs are compared case-insensitively too. */
  readonly rel: readonly string[];
  /** Unquoted parameters, with lower-case names; repeated hreflang/extension parameters survive. */
  readonly parameters: readonly (readonly [string, string])[];
}

/**
 * Parse combined or separate Link field values (RFC 8288 §§3.1–3.5).
 * Targets and anchors resolve independently against the response URL. Singleton parameters
 * use their first occurrence. Extended attributes such as title* are retained in wire encoding.
 * A malformed member ends its field; other fields still parse. Invalid URLs and links without
 * relations are ignored. An invalid response URL throws TypeError.
 */
export function parseLinkHeaders(
  values: string | readonly string[] | null,
  responseUrl: string,
): readonly ParsedLink[] {
  const base = new URL(responseUrl).href;
  const links: ParsedLink[] = [];
  for (const value of typeof values === "string" ? [values] : (values ?? [])) {
    // Match a complete member before interpreting it: commas inside <> or quotes are data.
    const member =
      /[ \t,]*<([^<>]*)>((?:[ \t]*;[ \t]*[!#$%&'*+\-.^_\x60|~\da-z]+[ \t]*(?:=[ \t]*(?:[!#$%&'*+\-.^_\x60|~\da-z]+|"(?:[^"\\\r\n]|\\[^\r\n])*"))?)*)[ \t]*(?:,|$)/iy;
    for (let match = member.exec(value); match !== null; match = member.exec(value)) {
      const parameters: [string, string][] = [];
      const parameter =
        /;[ \t]*([!#$%&'*+\-.^_\x60|~\da-z]+)[ \t]*(?:=[ \t]*([!#$%&'*+\-.^_\x60|~\da-z]+|"(?:[^"\\\r\n]|\\[^\r\n])*"))?/gi;
      for (const part of (match[2] as string).matchAll(parameter)) {
        const name = (part[1] as string).toLowerCase();
        const raw = part[2] ?? "";
        const unquoted = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw;
        if (
          ["rel", "anchor", "media", "title", "title*", "type"].includes(name) &&
          parameters.some(([key]) => key === name)
        ) {
          continue;
        }
        parameters.push([name, unquoted]);
      }
      const rel = (parameters.find(([name]) => name === "rel")?.[1] ?? "")
        .toLowerCase()
        .split(/[ \t]+/)
        .filter(Boolean);
      if (rel.length === 0) continue;
      try {
        links.push({
          target: new URL(match[1] as string, base).href,
          context: new URL(parameters.find(([name]) => name === "anchor")?.[1] ?? base, base).href,
          rel,
          parameters,
        });
      } catch {
        // A malformed target or anchor cannot establish a usable link.
      }
    }
  }
  return links;
}
