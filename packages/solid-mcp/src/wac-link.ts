// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseLinkHeaders } from "@jeswr/storage-capabilities";
import type { PodHeadResult } from "./pod-port.js";

const ACP = "http://www.w3.org/ns/solid/acp#accesscontrol";
const AUXILIARY_RELATIONS = ["acl", "describedby", "linkset", ACP];

/** One strict parser for WAC and generic auxiliary-resource discovery. */
function discoveryLinks(header: string, base: string) {
  const context = new URL(base).href;
  const links = parseLinkHeaders(header, base, {
    onOverflow: "throw",
    onMalformed: "throw",
  });
  // Keep the legacy rejection of incomplete members and unsafe raw URI references.
  // URL resolution can otherwise erase control characters before validation.
  let remaining = header;
  while (remaining.trim()) {
    const member =
      /^\s*<([^<>]*)>((?:\s*;\s*[\w-]+\s*=\s*(?:"(?:[^"\\]|\\.)*"|[^\s;,"]+))*)\s*(?:,|$)/.exec(
        remaining,
      );
    if (!member || (member[0].endsWith(",") && !remaining.slice(member[0].length).trim()))
      throw new Error("Invalid chat ACL discovery Link header");
    const target = member[1] ?? "";
    if (/[\s<>\\\p{Cc}]/u.test(target)) throw new Error("Invalid auxiliary discovery target");
    new URL(target, base);
    remaining = remaining.slice(member[0].length);
  }
  for (const link of links) {
    if (link.context !== context) throw new Error("Ambiguous auxiliary resource link");
    if (!link.rel.some((rel) => AUXILIARY_RELATIONS.includes(rel))) continue;
    // Governing associations retain the stricter unanchored-only policy.
    if (
      link.rel.some((rel) => ["acl", "describedby", ACP].includes(rel)) &&
      link.parameters.some(([name]) => name === "anchor")
    )
      throw new Error("Unsupported anchored chat ACL link");
    const url = new URL(link.target);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error("Invalid auxiliary resource URL");
  }
  return links;
}

/** Complete auxiliary discovery, exposing a WAC ACL only when ACP is absent. */
export function auxiliaryLinks(
  header: string,
  base: string,
): Pick<PodHeadResult, "acl" | "acr" | "describedby" | "auxiliaryResources"> {
  const links = discoveryLinks(header, base);
  const acr = links.filter((link) => link.rel.includes(ACP)).map((link) => link.target);
  const acls = links.filter((link) => link.rel.includes("acl")).map((link) => link.target);
  if (acls.length > 1) throw new Error("A unique WAC ACL link is required for chats");
  const describedby = links
    .filter((link) => link.rel.includes("describedby"))
    .map((link) => link.target);
  return {
    ...(acr.length ? { acr } : acls[0] ? { acl: acls[0] } : {}),
    ...(describedby.length ? { describedby } : {}),
    auxiliaryResources: links
      .filter((link) => link.rel.some((rel) => AUXILIARY_RELATIONS.includes(rel)))
      .map((link) => link.target),
  };
}

/** WAC writers additionally require an ACL; metadata-only discovery is insufficient. */
export function wacAclLink(header: string, base: string): string {
  const { acl, acr } = auxiliaryLinks(header, base);
  if (acr) throw new Error("Unsupported chat access-control model: ACP");
  if (!acl) throw new Error("A unique WAC ACL link is required for chats");
  return acl;
}
