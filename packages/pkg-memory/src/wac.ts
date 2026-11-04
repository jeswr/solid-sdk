// AUTHORED-BY Codex GPT-6
import { safeHttpIri } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import { Store } from "n3";
import type { PodPort } from "./pod-port.js";
import { NS, RdfNode } from "./rdf.js";

const ACL = "http://www.w3.org/ns/auth/acl#";
const unavailable = () => new Error("WAC protection unavailable");

/** Additional caller-owned boundary for server-advertised ACL URLs. */
export interface WacDiscoveryOptions {
  /** Must return true before the ACL may be read or written; exceptions deny. */
  allowAclUrl?: (aclUrl: string) => boolean;
}

/** Resolve only the port's advertised WAC capability, including for absent resources. */
export async function discoverWacAcl(
  pod: Pick<PodPort, "root" | "head">,
  target: string,
  options: WacDiscoveryOptions = {},
) {
  try {
    const metadata = await pod.head?.(target);
    if (!metadata?.acl || safeHttpIri(metadata.acl) !== metadata.acl) throw unavailable();
    const root = new URL(pod.root);
    const acl = new URL(metadata.acl);
    if (
      acl.origin !== root.origin ||
      !root.pathname.endsWith("/") ||
      !acl.pathname.startsWith(root.pathname) ||
      acl.pathname === root.pathname ||
      acl.username ||
      acl.password ||
      acl.hash ||
      acl.search ||
      /%2f|%5c/i.test(acl.pathname) ||
      acl.pathname.endsWith(".acr") ||
      acl.href === target
    )
      throw unavailable();
    if (options.allowAclUrl && !options.allowAclUrl(acl.href)) throw unavailable();
    return acl.href;
  } catch {
    // Discovery failures must never reveal a server URL or private backend diagnostic.
    throw unavailable();
  }
}

/** Prove every statement belongs to WAC authorizations dedicated to this exact target.
 * Unknown models, unscoped rules, legacy inheritance elsewhere and shared ACLs refuse replacement.
 */
export function validateDedicatedWacAcl(existing: DatasetCore, target: string): void {
  const dataset = new Store([...existing]);
  if (!dataset.size) throw unavailable();
  const predicates = new Set(
    ["accessTo", "default", "defaultForNew", "agent", "agentClass", "agentGroup", "origin", "mode"]
      .map((name) => ACL + name)
      .concat(`${NS.rdf}type`),
  );
  for (const subject of dataset.getSubjects(null, null, null)) {
    const rule = new RdfNode(subject, dataset);
    const types = [...rule.terms(`${NS.rdf}type`)];
    if (
      types.length !== 1 ||
      types[0]?.termType !== "NamedNode" ||
      types[0].value !== `${ACL}Authorization`
    )
      throw unavailable();
    for (const predicate of dataset.getPredicates(subject, null, null)) {
      if (!predicates.has(predicate.value)) throw unavailable();
      if ([...rule.terms(predicate.value)].some((term) => term.termType !== "NamedNode"))
        throw unavailable();
    }
    let scopes = 0;
    for (const name of ["accessTo", "default", "defaultForNew"]) {
      const targets = [...rule.terms(ACL + name)];
      scopes += targets.length;
      if (
        targets.some((term) => term.value !== target) ||
        (name !== "accessTo" && targets.length > 0 && !target.endsWith("/"))
      )
        throw unavailable();
    }
    if (!scopes) throw unavailable();
    const modes = [...rule.terms(`${ACL}mode`)];
    if (
      !modes.length ||
      modes.some(
        (term) =>
          !["Read", "Write", "Append", "Control"].includes(term.value.slice(ACL.length)) ||
          !term.value.startsWith(ACL),
      ) ||
      !["agent", "agentClass", "agentGroup"].some((name) => rule.terms(ACL + name).size)
    )
      throw unavailable();
  }
}
