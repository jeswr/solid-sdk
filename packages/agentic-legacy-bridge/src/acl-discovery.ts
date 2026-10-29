// AUTHORED-BY Codex GPT-6.1-Sol
import { validateWacAcl } from "@jeswr/solid-chat-interop";
import { DataFactory } from "n3";
import { readAclRdf } from "./acl-rdf.js";
import { assertNoRedirect } from "./import.js";
import { canonicalContainer, isWithinBase } from "./safe-iri.js";

function wacAclLink(header: string): string {
  const acls: string[] = [];
  let remaining = header;
  while (remaining.trim()) {
    const link =
      /^\s*<([^<>]*)>((?:\s*;\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+\s*(?:=\s*(?:"(?:[^"\\]|\\.)*"|[!#$%&'*+.^_`|~0-9A-Za-z-]+))?)*)\s*(?:,|$)/.exec(
        remaining,
      );
    if (!link) throw new Error("Invalid ACL discovery Link header");
    remaining = remaining.slice(link[0].length);
    const params = new Map<string, string>();
    for (const param of (link[2] ?? "").matchAll(
      /;\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*(?:=\s*("(?:[^"\\]|\\.)*"|[!#$%&'*+.^_`|~0-9A-Za-z-]+))?/g,
    )) {
      const name = (param[1] ?? "").toLowerCase();
      const raw = param[2] ?? "";
      // Repeated hreflang/extension attributes are allowed. Singular descriptive
      // attributes use their first occurrence (RFC 8288); only rel duplicates
      // obscure the ACL association and retain our fail-closed rejection.
      if (name === "rel" && params.has(name))
        throw new Error("Ambiguous ACL discovery Link header");
      if (!params.has(name))
        params.set(name, raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw);
    }
    // RFC 8288 compares registered and extension relations case-insensitively.
    const relations = (params.get("rel") ?? "").toLowerCase().split(/\s+/);
    if (relations.includes("http://www.w3.org/ns/solid/acp#accessControl".toLowerCase()))
      throw new Error("Unsupported access-control model: ACP");
    if (relations.includes("acl")) {
      if (params.has("anchor")) throw new Error("Unsupported anchored ACL link");
      acls.push(link[1] ?? "");
    }
  }
  if (acls.length !== 1 || !acls[0]) throw new Error("A unique WAC ACL link is required");
  return acls[0];
}

/** Discover and validate an existing container's own WAC ACL before any private writes.
 * Missing/ambiguous links, unsupported models, redirects and out-of-container ACLs fail closed.
 */
export async function discoverWacAcl(
  fetch: typeof globalThis.fetch,
  container: string,
): Promise<string> {
  const target = canonicalContainer(container);
  if (!target || new URL(container).username || new URL(container).password)
    throw new Error("Unsafe ACL container URL");
  const response = await fetch(target, { method: "HEAD", redirect: "manual" });
  assertNoRedirect(response, "HEAD", target);
  if (!response.ok) throw new Error(`ACL discovery failed: HTTP ${response.status}`);
  const acl = new URL(wacAclLink(response.headers.get("link") ?? ""), target);
  if (acl.username || acl.password || acl.hash || acl.search || !isWithinBase(acl.href, target))
    throw new Error("Unsafe ACL resource URL");
  if (acl.pathname.endsWith(".acr")) throw new Error("Unsupported access-control model: ACP");
  const existing = await fetch(acl.href, {
    method: "GET",
    redirect: "manual",
    headers: { accept: "text/turtle" },
  });
  assertNoRedirect(existing, "GET", acl.href);
  if (existing.status !== 404) {
    if (!existing.ok) throw new Error(`ACL read failed: HTTP ${existing.status}`);
    const type = (existing.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "text/turtle") throw new Error("Unsupported ACL content type");
    const dataset = await readAclRdf(existing, acl.href);
    // The shared validator does not inspect this legacy inheritance scope.
    // Refuse it anywhere in the document before replacing access-bearing data.
    if (
      dataset.match(
        null,
        DataFactory.namedNode("http://www.w3.org/ns/auth/acl#defaultForNew"),
        null,
      ).size > 0
    )
      throw new Error("Unsupported ACL scope: defaultForNew");
    validateWacAcl(dataset, target);
  }
  return acl.href;
}
