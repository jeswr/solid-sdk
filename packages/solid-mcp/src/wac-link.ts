// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
/** One conservative parser for WAC and generic auxiliary-resource discovery. */
export function auxiliaryLinks(header: string): { acl?: string; describedby?: string[] } {
  const acls: string[] = [];
  const describedby: string[] = [];
  let remaining = header;
  while (remaining.trim()) {
    const link =
      /^\s*<([^<>]*)>((?:\s*;\s*[\w-]+\s*=\s*(?:"(?:[^"\\]|\\.)*"|[^\s;,"]+))*)\s*(?:,|$)/.exec(
        remaining,
      );
    if (!link || (link[0].endsWith(",") && !remaining.slice(link[0].length).trim()))
      throw new Error("Invalid chat ACL discovery Link header");
    const target = link[1] ?? "";
    if (/[\s<>\\\p{Cc}]/u.test(target)) throw new Error("Invalid auxiliary discovery target");
    // Validate every URI-reference, including relations we do not otherwise consume.
    new URL(target, "https://example.org/");
    remaining = remaining.slice(link[0].length);
    const params = new Map<string, string>();
    for (const param of (link[2] ?? "").matchAll(
      /;\s*([\w-]+)\s*=\s*("(?:[^"\\]|\\.)*"|[^\s;,"]+)/g,
    )) {
      const name = (param[1] ?? "").toLowerCase();
      const raw = param[2] ?? "";
      if (params.has(name)) throw new Error("Ambiguous chat ACL discovery Link header");
      params.set(name, raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw);
    }
    const relations = (params.get("rel") ?? "").toLowerCase().split(/\s+/);
    if (relations.includes("http://www.w3.org/ns/solid/acp#accesscontrol"))
      throw new Error("Unsupported chat access-control model: ACP");
    if (relations.includes("acl") || relations.includes("describedby")) {
      if (params.has("anchor")) throw new Error("Unsupported anchored chat ACL link");
      if (!target) throw new Error("Invalid auxiliary discovery target");
      if (relations.includes("acl")) acls.push(target);
      if (relations.includes("describedby")) describedby.push(target);
    }
  }
  if (acls.length > 1) throw new Error("A unique WAC ACL link is required for chats");
  return {
    ...(acls[0] ? { acl: acls[0] } : {}),
    ...(describedby.length ? { describedby } : {}),
  };
}

/** WAC writers additionally require an ACL; metadata-only discovery is insufficient. */
export function wacAclLink(header: string): string {
  const { acl } = auxiliaryLinks(header);
  if (!acl) throw new Error("A unique WAC ACL link is required for chats");
  return acl;
}
