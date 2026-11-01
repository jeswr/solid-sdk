// AUTHORED-BY Codex GPT-6

/**
 * HTTP(S) URLs whose paths have one routing interpretation. Check the original path before
 * URL parsing removes dot segments or turns backslashes into separators. Encoded percent
 * signs are refused too, so another decoding pass cannot introduce separators or dots.
 * Query/fragment values do not participate in path containment.
 */
export function safePathUrl(value: string): URL | null {
  const path = value.split(/[?#]/, 1)[0];
  if (/[\\\s]/.test(path) || /%(?:2f|5c|2e|25)/i.test(path) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path))
    return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** A confined resource must not gain query/fragment semantics, even empty components.
 * URL.search/hash erase empty delimiters, so inspect the original IRI first. */
export function safeTargetUrl(value: string): URL | null {
  if (/[?#]/.test(value)) return null;
  const url = safePathUrl(value);
  return url && !url.username && !url.password ? url : null;
}
