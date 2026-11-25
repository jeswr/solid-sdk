// AUTHORED-BY Codex GPT-6.1-Sol
/** An explicit id route or a terminal numeric/UUID segment in a server redirect. */
export function responseIdentity(
  location: string,
): { url: string; identifier: string } | undefined {
  const url = new URL(location);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) return undefined;
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((v) => decodeURIComponent(v));
  const at = segments.findIndex((v) => /^(id|identifier)$/i.test(v));
  // Common canonical routes append a human-readable slug to a numeric identity.
  const tail = segments.at(-1) ?? "";
  const identifier =
    at >= 0
      ? segments[at + 1]
      : /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/i.test(tail) && /^\d+$/.test(segments.at(-2) ?? "")
        ? segments.at(-2)
        : tail;
  if (!identifier || !/^(?:\d+|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(identifier))
    return undefined;
  // The caller enforces origin and secret checks. Queries/fragments are never identity IRIs.
  url.search = "";
  url.hash = "";
  return { url: url.href, identifier };
}
