// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
/** Parse a conservative Link-header subset; ambiguous/unsupported discovery fails closed. */
export function wacAclLink(header: string): string;
export function wacAclLink(header: string, allowAbsent: true): string | undefined;
export function wacAclLink(header: string, allowAbsent = false): string | undefined {
  const acls: string[] = [];
  let remaining = header;
  while (remaining.trim()) {
    const link =
      /^\s*<([^<>]*)>((?:\s*;\s*[\w-]+\s*=\s*(?:"(?:[^"\\]|\\.)*"|[^\s;,"]+))*)\s*(?:,|$)/.exec(
        remaining,
      );
    if (!link) throw new Error("Invalid chat ACL discovery Link header");
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
    const relations = (params.get("rel") ?? "").split(/\s+/);
    if (relations.includes("http://www.w3.org/ns/solid/acp#accessControl"))
      throw new Error("Unsupported chat access-control model: ACP");
    if (relations.includes("acl")) {
      if (params.has("anchor")) throw new Error("Unsupported anchored chat ACL link");
      acls.push(link[1] ?? "");
    }
  }
  if (allowAbsent && acls.length === 0) return undefined;
  if (acls.length !== 1 || !acls[0]) throw new Error("A unique WAC ACL link is required for chats");
  return acls[0];
}
