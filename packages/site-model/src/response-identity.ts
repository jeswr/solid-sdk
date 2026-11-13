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
  const identifier = at >= 0 ? segments[at + 1] : segments.at(-1);
  if (!identifier || !/^(?:\d+|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(identifier))
    return undefined;
  // The caller enforces origin and secret checks. Queries/fragments are never identity IRIs.
  url.search = "";
  url.hash = "";
  return { url: url.href, identifier };
}
