// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseLinkHeaders } from "@jeswr/storage-capabilities";

const ACP = "http://www.w3.org/ns/solid/acp#accesscontrol";

/** All advertised access-control/description URLs; malformed or foreign-context links fail closed. */
export function auxiliaryResourceLinks(header: string, base: string): string[] {
  const context = new URL(base).href;
  const resources: string[] = [];
  for (const link of parseLinkHeaders(header, base, {
    onOverflow: "throw",
    onMalformed: "throw",
  })) {
    if (link.context !== context) throw new Error("Ambiguous auxiliary resource link");
    if (!link.rel.some((rel) => ["acl", "describedby", "linkset", ACP].includes(rel))) continue;
    const url = new URL(link.target);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error("Invalid auxiliary resource URL");
    resources.push(url.href);
  }
  return resources;
}

export function wacAclLink(header: string, base: string): string {
  const context = new URL(base).href;
  const acls: string[] = [];
  for (const link of parseLinkHeaders(header, base, {
    onOverflow: "throw",
    onMalformed: "throw",
  })) {
    if (link.context !== context) throw new Error("Unsupported anchored chat ACL link");
    if (link.rel.includes(ACP)) throw new Error("Unsupported chat access-control model: ACP");
    if (link.rel.includes("acl")) {
      const url = new URL(link.target);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
        throw new Error("Invalid chat ACL URL");
      acls.push(url.href);
    }
  }
  if (acls.length !== 1) throw new Error("A unique WAC ACL link is required for chats");
  return acls[0] as string;
}
