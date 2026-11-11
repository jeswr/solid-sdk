// AUTHORED-BY Codex GPT-6.1-Sol
import {
  discoverWacAcl,
  ownerOnlyWacAcl,
  validateDedicatedWacAcl,
  validateOwnerOnlyWacAcl,
} from "@jeswr/pkg-memory";
import { parseWacAllow } from "@jeswr/storage-capabilities";
import { DataFactory as df, type Store } from "n3";
import { requirePodScopedUrl } from "./auth.js";
import { parseBoundedRdf, serializeBoundedTurtle } from "./bounded-rdf.js";
import { MAX_CONTENT_BYTES } from "./content.js";
import { MemoryNode, status } from "./memory-context.js";
import type { PodPort, PodReadResult } from "./pod-port.js";

/** Retain the raw header because the caller's permissions cannot prove public permissions. */
function publicMutation(header?: string): boolean {
  if (header === undefined) return false;
  const permissions = parseWacAllow(header);
  if (!permissions) throw new Error("acl_unverifiable");
  return permissions.public.some((mode) => ["write", "append", "control"].includes(mode));
}
async function aclDataset(pod: PodPort, url: string) {
  const raw = await pod.read(url, { accept: "text/turtle", redirect: "error" });
  if ((raw.url && raw.url !== url) || raw.isContainer || raw.body.byteLength > MAX_CONTENT_BYTES)
    throw new Error("acl_unverifiable");
  return {
    raw,
    dataset: await parseBoundedRdf(
      new TextDecoder("utf-8", { fatal: true }).decode(raw.body),
      raw.contentType,
      url,
    ),
  };
}

/** Missing ACL capability is explicitly unknown. Advertised but unprovable ACLs deny.
 * An absent resource ACL inherits the nearest ancestor's default authorizations.
 */
export async function verifyContextAcl(
  pod: PodPort,
  url: string,
  raw: PodReadResult,
): Promise<boolean> {
  if (publicMutation(raw.wacAllow)) throw new Error("public_write");
  if (!pod.head) return false;
  let target = url;
  let advertised = false;
  for (;;) {
    const metadata = await pod.head(target);
    if (metadata.aclError) throw new Error("acl_unverifiable");
    if (publicMutation(metadata.wacAllow)) throw new Error("public_write");
    if (!metadata.acl) {
      if (!advertised) return false;
      throw new Error("acl_unverifiable");
    }
    advertised = true;
    const acl = await discoverWacAcl({ root: pod.root, head: async () => metadata }, target);
    try {
      const { dataset } = await aclDataset(pod, acl);
      validateOwnerOnlyWacAcl(dataset, target, pod.webId, target !== url);
      return true;
    } catch (error) {
      if (status(error) !== 404 || target === pod.root) throw new Error("acl_unverifiable");
      target = requirePodScopedUrl(
        { podRoot: pod.root },
        new URL(target.endsWith("/") ? "../" : ".", target).href,
      );
    }
  }
}

/** Setup needs exclusive reads as well as exclusive mutation authority. */
function validatePrivateAcl(dataset: Store, target: string, owner: string, inherit: boolean): void {
  validateOwnerOnlyWacAcl(dataset, target, owner, inherit);
  const acl = "http://www.w3.org/ns/auth/acl#";
  for (const subject of dataset.getSubjects(null, null, null)) {
    const rule = new MemoryNode(subject, dataset, df);
    if (
      ["agentClass", "agentGroup", "origin"].some((name) => rule.terms(acl + name).size) ||
      [...rule.terms(`${acl}agent`)].some((term) => term.value !== owner)
    )
      throw new Error("Shared ACL audience");
  }
}

/** Same typed owner-only ACL writer as NanopubStore, with conditional replacement only. */
export async function protectContextResource(
  pod: PodPort,
  target: string,
  inherit: boolean,
): Promise<void> {
  const acl = await discoverWacAcl(pod, target);
  let existing: Awaited<ReturnType<typeof aclDataset>> | undefined;
  try {
    existing = await aclDataset(pod, acl);
  } catch (error) {
    if (status(error) !== 404) throw error;
  }
  if (existing) {
    validateDedicatedWacAcl(existing.dataset, target);
    let alreadyPrivate = false;
    try {
      validatePrivateAcl(existing.dataset, target, pod.webId, inherit);
      alreadyPrivate = true;
    } catch {
      /* A dedicated orphan ACL may be tightened before private content is created. */
    }
    if (alreadyPrivate) {
      if ((await discoverWacAcl(pod, target)) !== acl) throw new Error("acl_unverifiable");
      return;
    }
    if (!existing.raw.etag || !/^"[\x21\x23-\x7E\x80-\xFF]*"$/.test(existing.raw.etag))
      throw new Error("Strong ETag required for context ACL");
  }
  const dataset = ownerOnlyWacAcl(target, pod.webId, acl, inherit);
  await pod.write(
    acl,
    new TextEncoder().encode(serializeBoundedTurtle(dataset)),
    "text/turtle",
    existing ? { ifMatch: existing.raw.etag } : { ifNoneMatch: "*" },
  );
  // Confirm the actual association and effective rules, rather than trusting a successful PUT.
  const confirmed = await discoverWacAcl(pod, target);
  if (confirmed !== acl) throw new Error("acl_unverifiable");
  validatePrivateAcl((await aclDataset(pod, acl)).dataset, target, pod.webId, inherit);
}
