// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { safeHttpIri, serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import { Store } from "n3";
import { type PodPort, podStatus } from "./pod-port.js";
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

const encode = (value: string) => new TextEncoder().encode(value);
const decode = (value: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(value);
async function optional(pod: PodPort, url: string) {
  try {
    return await pod.read(url);
  } catch (error) {
    if (podStatus(error) === 404) return undefined;
    throw error;
  }
}
/** Internal shared primitive. Never replaces a shared or unsupported ACL. */
export async function protectOwnerOnlyResource(
  pod: PodPort,
  target: string,
  inherit: boolean,
  options: WacDiscoveryOptions = {},
  protection?: { aclUrl: string; existing: Awaited<ReturnType<typeof optional>> },
) {
  const aclUrl = protection?.aclUrl ?? (await discoverWacAcl(pod, target, options));
  const existing = protection ? protection.existing : await optional(pod, aclUrl);
  if (existing) {
    if (!existing.etag || !/^"[^"\r\n]*"(?![\s\S])/.test(existing.etag))
      throw new Error("A strong ETag is required to replace a resource");
    if (existing.contentType.split(";")[0]?.trim().toLowerCase() !== "text/turtle")
      throw unavailable();
    try {
      validateDedicatedWacAcl(
        await parseRdf(decode(existing.body), "text/turtle", { baseIRI: aclUrl }),
        target,
      );
    } catch {
      throw unavailable();
    }
  }
  const dataset = new Store();
  const rule = new RdfNode(`${aclUrl}#owner`, dataset)
    .link(`${NS.rdf}type`, `${ACL}Authorization`)
    .link(`${ACL}agent`, pod.webId)
    .link(`${ACL}accessTo`, target);
  if (inherit) rule.link(`${ACL}default`, target);
  for (const mode of ["Read", "Write", "Control"]) rule.link(`${ACL}mode`, ACL + mode);
  await pod.write(
    aclUrl,
    encode(await serialize([...dataset])),
    "text/turtle",
    existing ? { ifMatch: existing.etag } : { ifNoneMatch: "*" },
  );
}
/** Create a dedicated owner-only WAC container, protecting it before any private bytes.
 * Existing shared ancestors and their ACLs are preserved; absent ancestors are protected.
 * Missing WAC discovery (including LWS/ACP) fails closed. No ACL URL is guessed.
 */
export async function ensureOwnerOnlyContainer(
  pod: PodPort,
  containerUrl: string,
  options: WacDiscoveryOptions = {},
): Promise<void> {
  let root: URL;
  let target: URL;
  try {
    root = new URL(pod.root);
    target = new URL(containerUrl);
    if (
      safeHttpIri(pod.root) !== pod.root ||
      !pod.root.endsWith("/") ||
      root.search ||
      root.hash ||
      root.username ||
      root.password ||
      safeHttpIri(pod.webId) !== pod.webId ||
      safeHttpIri(containerUrl) !== containerUrl ||
      target.origin !== root.origin ||
      !target.pathname.startsWith(root.pathname) ||
      target.pathname === root.pathname ||
      !containerUrl.endsWith("/") ||
      target.search ||
      target.hash ||
      target.username ||
      target.password ||
      /%2f|%5c/i.test(target.pathname)
    )
      throw unavailable();
  } catch {
    throw unavailable();
  }
  let current = pod.root;
  for (const part of target.pathname.slice(root.pathname.length).split("/").filter(Boolean)) {
    current = new URL(`${part}/`, current).href;
    const existing = await optional(pod, current);
    if (current !== containerUrl && existing) continue;
    const aclUrl = await discoverWacAcl(pod, current, options);
    const protection = { aclUrl, existing: await optional(pod, aclUrl) };
    if (current === containerUrl || !protection.existing)
      await protectOwnerOnlyResource(pod, current, true, options, protection);
    // CSS may create the container implicitly on an ACL write.
    if (!existing && !(await optional(pod, current))) {
      const dataset = new Store();
      new RdfNode(current, dataset).link(
        `${NS.rdf}type`,
        "http://www.w3.org/ns/ldp#BasicContainer",
      );
      await pod.write(current, encode(await serialize([...dataset])), "text/turtle", {
        ifNoneMatch: "*",
      });
    }
  }
}
