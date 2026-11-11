// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
/** Parse a conservative Link-header subset; ambiguous/unsupported discovery fails closed. */
function parseLinks(header: string): Array<{ target: string; params: Map<string, string> }> {
  const links: Array<{ target: string; params: Map<string, string> }> = [];
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
    links.push({ target: link[1] ?? "", params });
  }
  return links;
}

/** All advertised access-control/description URLs; malformed or anchored metadata is unknown. */
export function auxiliaryResourceLinks(header: string, base: string): string[] {
  const resources: string[] = [];
  for (const { target, params } of parseLinks(header)) {
    const relations = (params.get("rel") ?? "").toLowerCase().split(/\s+/);
    if (
      !relations.some((rel) =>
        ["acl", "describedby", "http://www.w3.org/ns/solid/acp#accesscontrol"].includes(rel),
      )
    )
      continue;
    if (!target || params.has("anchor")) throw new Error("Ambiguous auxiliary resource link");
    resources.push(new URL(target, base).href);
  }
  return resources;
}

export function wacAclLink(header: string): string {
  const acls: string[] = [];
  for (const { target, params } of parseLinks(header)) {
    const relations = (params.get("rel") ?? "").split(/\s+/);
    if (relations.includes("http://www.w3.org/ns/solid/acp#accessControl"))
      throw new Error("Unsupported chat access-control model: ACP");
    if (relations.includes("acl")) {
      if (params.has("anchor")) throw new Error("Unsupported anchored chat ACL link");
      acls.push(target);
    }
  }
  if (acls.length !== 1 || !acls[0]) throw new Error("A unique WAC ACL link is required for chats");
  return acls[0];
}
