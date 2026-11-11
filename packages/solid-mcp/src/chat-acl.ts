// AUTHORED-BY Codex GPT-6.1-Sol
import { validateDedicatedWacAcl } from "@jeswr/pkg-memory";
import { ownerOnlyChatAcl } from "@jeswr/solid-chat-interop";
import { isAmbiguousResourceTarget } from "@jeswr/storage-capabilities";
import type { Store } from "n3";
import { requirePodScopedWriteUrl } from "./auth.js";
import { parseBoundedRdf } from "./bounded-rdf.js";
import { requireDataMutationPath, strongWriteEtag } from "./generic-mutation.js";
import { PodOutput } from "./output.js";
import type { PodConditions, PodPort } from "./pod-port.js";

const unavailable = () => new Error("Chat protection unavailable");

/** @internal A per-ChatWriter capability for its fixed owner-only ACL bodies. */
export function chatAclAccess(pod: PodPort) {
  const base = new URL("private/chats/", pod.root).href;
  const bindings = new Map<string, string>();
  const output = new PodOutput(pod);

  function scoped(url: string): string {
    const target = requirePodScopedWriteUrl({ podRoot: pod.root }, url);
    if (target !== url || !target.startsWith(base) || isAmbiguousResourceTarget(url))
      throw unavailable();
    return target;
  }

  async function discover(url: string): Promise<string> {
    const target = scoped(url);
    requireDataMutationPath(target);
    const metadata = await output.head(target);
    if (!metadata.acl || !metadata.auxiliaryResources?.includes(metadata.acl)) throw unavailable();
    const acl = scoped(metadata.acl);
    if (acl === target || /\.(acr|meta)\/*$/iu.test(acl)) throw unavailable();
    if (bindings.has(acl) && bindings.get(acl) !== target) throw unavailable();
    bindings.set(acl, target);
    return acl;
  }

  async function write(
    acl: string,
    body: Uint8Array,
    contentType: string,
    cond: PodConditions,
  ): Promise<{ etag?: string } | undefined> {
    const target = bindings.get(acl);
    if (!target) return undefined;
    scoped(acl);
    if (
      contentType !== "text/turtle" ||
      cond.ifMatch !== undefined ||
      cond.ifNoneMatch !== undefined
    )
      throw unavailable();
    const expected = ownerOnlyChatAcl(acl, target, pod.webId);
    const supplied = await parseBoundedRdf(new TextDecoder().decode(body), contentType, acl);
    const same = (dataset: Store) =>
      dataset.size === expected.size && [...expected].every((quad) => dataset.has(quad));
    if (!same(supplied)) throw unavailable();
    // Recheck the association through the current guarded port immediately before mutation.
    if ((await discover(target)) !== acl) throw unavailable();
    let condition: PodConditions = { ifNoneMatch: "*" };
    try {
      const existing = await output.read(acl, { accept: "text/turtle", redirect: "error" });
      if (existing.url && existing.url !== acl) throw unavailable();
      if (existing.contentType.split(";")[0]?.trim().toLowerCase() !== "text/turtle")
        throw unavailable();
      const dataset = await parseBoundedRdf(
        new TextDecoder().decode(existing.body),
        "text/turtle",
        acl,
      );
      validateDedicatedWacAcl(dataset, target);
      // Identical owner-only ACLs need no replacement, including on idempotent replay.
      if (same(dataset)) return { etag: existing.etag };
      if (!existing.etag || !strongWriteEtag(existing.etag)) throw unavailable();
      condition = { ifMatch: existing.etag };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        (!("status" in error && error.status === 404) && !/\bHTTP 404\b/u.test(error.message))
      )
        throw error;
    }
    // This is the sole bypass: URL, association, body and precondition are fixed above.
    // Generic pod_write/solid_write never receive this capability.
    return pod.write(acl, body, contentType, condition);
  }

  return { discover, write };
}
