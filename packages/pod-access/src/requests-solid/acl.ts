// AUTHORED-BY Codex GPT-6
// Port of access-manager's own/nearest-ancestor ACL, create-only materialisation,
// set-semantics grants and bounded If-Match retry logic.
import { parseLinkHeaders } from "@jeswr/storage-capabilities";
import type { DatasetCore } from "@rdfjs/types";
import { AclResource, Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import { put, read, scoped, transport } from "./http.js";
import type { RequestMode } from "./inbox.js";
import { turtle, values } from "./rdf.js";
import { ACL, LDP } from "./vocab.js";

export class UnsupportedAccessModelError extends Error {
  constructor(readonly model: "acp" | "unknown") {
    super(`Cannot materialise access requests on an ${model} access model`);
    this.name = "UnsupportedAccessModelError";
  }
}

/** Inspect the target's Link headers. ACP wins if both models are advertised. */
export async function accessModel(options: {
  fetch: typeof fetch;
  target?: string;
  storage: string;
  signal?: AbortSignal;
}): Promise<"wac" | "acp" | "unknown"> {
  const target = scoped(options.storage, options.target ?? options.storage);
  const response = await transport(options.fetch, options.signal)(target, { method: "HEAD" });
  if (!response.ok) throw new Error(`Access model discovery failed (${response.status})`);
  const links = response.headers.get("link") ?? "";
  if (link(links, "http://www.w3.org/ns/solid/acp#accessControl", target)) return "acp";
  return link(links, "acl", target) ? "wac" : "unknown";
}

/** Authoritative bounded parsing: quoted parameters and foreign anchors cannot select an ACL. */
function link(header: string, relation: string, base: string): string | undefined {
  return parseLinkHeaders(header, base, { onOverflow: "throw", maxResolvedBytes: 32768 }).find(
    (entry) => entry.context === base && entry.rel.includes(relation.toLowerCase()),
  )?.target;
}

async function aclUrl(resource: string, storage: string, fetchFn: typeof fetch): Promise<string> {
  const response = await fetchFn(resource, { method: "HEAD" });
  const header = response.headers.get("link") ?? "";
  if (link(header, "http://www.w3.org/ns/solid/acp#accessControl", resource))
    throw new UnsupportedAccessModelError("acp");
  const target = link(header, "acl", resource);
  return scoped(storage, target === undefined ? `${resource}.acl` : new URL(target, resource).href);
}

const MODE_IRI: Readonly<Record<RequestMode, string>> = Object.freeze({
  read: ACL.Read,
  write: ACL.Write,
  append: ACL.Append,
});

function authSubject(auth: Authorization) {
  return auth.termType === "BlankNode"
    ? DataFactory.blankNode(auth.value)
    : DataFactory.namedNode(auth.value);
}

function addGrant(
  dataset: DatasetCore,
  url: string,
  resource: string,
  agent: string,
  modes: readonly RequestMode[],
): void {
  const acl = new AclResource(dataset, DataFactory);
  for (const auth of acl.authorizations) {
    // Reusing a multi-scope/group/origin node could widen this new agent's access.
    const subject = authSubject(auth);
    const scopes = values(dataset, subject, ACL.accessTo);
    if (
      scopes.length === 1 &&
      scopes[0] === resource &&
      values(dataset, subject, ACL.default).length === 0 &&
      values(dataset, subject, ACL.agentClass).length === 0 &&
      values(dataset, subject, ACL.agentGroup).length === 0 &&
      values(dataset, subject, ACL.origin).length === 0 &&
      [...auth.mode].sort().join() ===
        modes
          .map((mode) => MODE_IRI[mode])
          .sort()
          .join()
    ) {
      auth.agent.add(agent);
      return;
    }
  }
  let n = 0;
  while (dataset.match(DataFactory.namedNode(`${url}#grant-${n}`)).size) n++;
  const auth = new Authorization(`${url}#grant-${n}`, dataset, DataFactory);
  auth.type.add(ACL.Authorization);
  auth.accessTo = resource;
  auth.agent.add(agent);
  for (const mode of modes) auth.mode.add(MODE_IRI[mode]);
}

/** SDK-APP-04 seam: replace this one function with setGrants when that API lands. */
export async function applyGrant(
  target: string,
  storage: string,
  owner: string,
  agent: string,
  modes: readonly RequestMode[],
  fetchFn: typeof fetch,
): Promise<void> {
  const ownUrl = await aclUrl(target, storage, fetchFn);
  for (let attempt = 0; attempt < 3; attempt++) {
    const own = await read(ownUrl, fetchFn);
    if (own) {
      addGrant(own.dataset, ownUrl, target, agent, modes);
      if (await put(ownUrl, await turtle(own.dataset), fetchFn, own.etag)) return;
      continue;
    }
    // Missing own ACL: nearest ancestor only, copying every predicate of applicable nodes.
    const dataset = new Store();
    let current = new URL(".", target.endsWith("/") ? new URL("..", target) : target).href;
    let found = false;
    while (true) {
      scoped(storage, current);
      const parentUrl = await aclUrl(current, storage, fetchFn);
      const parent = await read(parentUrl, fetchFn);
      if (parent) {
        found = true;
        const acl = new AclResource(parent.dataset, DataFactory);
        for (const auth of acl.authorizations) {
          const subject = authSubject(auth);
          // CSS ignores the legacy acl:defaultForNew while NSS honours it; neither copying nor
          // dropping such a rule is safe without knowing the server, so refuse to guess.
          if (values(parent.dataset, subject, ACL.defaultForNew).includes(current))
            throw new Error(
              "This folder's sharing uses the legacy acl:defaultForNew rule; update it in your pod first",
            );
          if (!values(parent.dataset, subject, ACL.default).includes(current)) continue;
          const copy = new Authorization(
            `${ownUrl}#inherited-${dataset.size}`,
            dataset,
            DataFactory,
          );
          for (const q of parent.dataset.match(subject)) {
            if (q.predicate.value === ACL.accessTo || q.predicate.value === ACL.default) continue;
            dataset.add(DataFactory.quad(DataFactory.namedNode(copy.value), q.predicate, q.object));
          }
          copy.accessTo = target;
          if (target.endsWith("/")) copy.default = target;
        }
        break;
      }
      if (current === new URL(storage).href) break;
      current = new URL("..", current).href;
    }
    if (!found) throw new Error("No effective ACL found");
    // Preserve owner control even when the inherited rules provide no direct path.
    const ownerAuth = new Authorization(`${ownUrl}#owner`, dataset, DataFactory);
    ownerAuth.type.add(ACL.Authorization);
    ownerAuth.agent.add(owner);
    ownerAuth.accessTo = target;
    ownerAuth.mode.add(ACL.Control);
    if (target.endsWith("/")) ownerAuth.default = target;
    addGrant(dataset, ownUrl, target, agent, modes);
    if (await put(ownUrl, await turtle(dataset), fetchFn, null, true)) return;
  }
  throw new Error("ACL kept changing after three conditional attempts");
}

/**
 * Make sure a records container is readable and writable by the owner alone before anything is
 * written into, or trusted from, it. An existing ACL must name no one but the owner, and give the
 * owner Read, Write and Control over the folder and everything in it; otherwise the decision
 * stops, because grant records and receipts list recipients, purposes and targets, and pinned
 * decisions are trusted on recovery. A folder without its own ACL may have inherited someone
 * else's write access, so it is only made private while it is empty, and must still be empty
 * once private: anything already inside could have been written by someone else.
 */
export async function ensureOwnerOnlyContainer(
  container: string,
  storage: string,
  owner: string,
  fetchFn: typeof fetch,
): Promise<void> {
  scoped(storage, container);
  const head = await fetchFn(container, { method: "HEAD" });
  if (head.status === 404) await put(container, "", fetchFn, null, true);
  else if (!head.ok) throw new Error(`Records folder check failed (${head.status})`);
  const url = await aclUrl(container, storage, fetchFn);
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await read(url, fetchFn);
    if (existing) {
      const acl = new AclResource(existing.dataset, DataFactory);
      const own = new Set<string>();
      const inherited = new Set<string>();
      for (const auth of acl.authorizations) {
        const subject = authSubject(auth);
        const agents = values(existing.dataset, subject, ACL.agent);
        if (
          agents.some((agent) => agent !== owner) ||
          values(existing.dataset, subject, ACL.agentClass).length > 0 ||
          values(existing.dataset, subject, ACL.agentGroup).length > 0
        ) {
          throw new Error("The access records folder is shared; make it private first");
        }
        if (!agents.includes(owner)) continue;
        const modes = values(existing.dataset, subject, ACL.mode);
        if (values(existing.dataset, subject, ACL.accessTo).includes(container))
          for (const mode of modes) own.add(mode);
        if (values(existing.dataset, subject, ACL.default).includes(container))
          for (const mode of modes) inherited.add(mode);
      }
      const full = (modes: Set<string>) =>
        [ACL.Read, ACL.Write, ACL.Control].every((mode) => modes.has(mode));
      if (!full(own) || !full(inherited))
        throw new Error("The access records folder does not give you full control");
      return;
    }
    await assertEmpty(container, url, fetchFn);
    const dataset = new Store();
    const auth = new Authorization(`${url}#owner`, dataset, DataFactory);
    auth.type.add(ACL.Authorization);
    auth.agent.add(owner);
    auth.accessTo = container;
    auth.default = container;
    for (const mode of [ACL.Read, ACL.Write, ACL.Control]) auth.mode.add(mode);
    if (await put(url, await turtle(dataset), fetchFn, null, true)) {
      // Anything that arrived before the folder became private is untrusted.
      await assertEmpty(container, url, fetchFn);
      return;
    }
  }
  throw new Error("The access records folder ACL kept changing");
}

async function assertEmpty(container: string, acl: string, fetchFn: typeof fetch): Promise<void> {
  const listing = await read(container, fetchFn);
  const members = listing ? values(listing.dataset, container, LDP.contains) : [];
  if (members.some((member) => member !== acl))
    throw new Error(
      "The access records folder already has files but isn't private; review and clear it first",
    );
}
