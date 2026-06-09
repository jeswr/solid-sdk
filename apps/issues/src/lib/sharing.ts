import { AclResource, Authorization, AcrDataset, wacToAcp, acpToWac } from "@solid/object";
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { Store, DataFactory } from "n3";
import type { DatasetCore } from "@rdfjs/types";
import { Writer } from "n3";
import { WriteError } from "./errors";

const ACL = "http://www.w3.org/ns/auth/acl#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const ACP_ACR = "http://www.w3.org/ns/solid/acp#AccessControlResource";

/** Access modes the app exposes (a deliberately small subset of WAC). */
export interface Access {
  read: boolean;
  write: boolean;
  /** acl:Control — can read/write the ACL itself. */
  control: boolean;
}

export interface Collaborator {
  webId: string;
  access: Access;
}

const empty = (): Access => ({ read: false, write: false, control: false });
const some = (a: Access) => a.read || a.write || a.control;
const opts = (fetchImpl?: typeof fetch) => (fetchImpl ? { fetch: fetchImpl } : undefined);

function serialize(dataset: DatasetCore): Promise<string> {
  const writer = new Writer({ format: "text/turtle" });
  for (const q of dataset) writer.addQuad(q);
  return new Promise((resolve, reject) =>
    writer.end((err, result) => (err ? reject(err) : resolve(result))),
  );
}

function aclLinkFrom(linkHeader: string | null, base: string): string | undefined {
  if (!linkHeader) return undefined;
  for (const part of linkHeader.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel\s*=\s*"?acl"?/i.exec(part);
    if (m) return new URL(m[1], base).toString();
  }
  return undefined;
}

/** Find a resource's access-control document URL from its `Link: rel="acl"` header. */
async function discoverAclUrl(resourceUrl: string, doFetch: typeof fetch): Promise<string> {
  for (const method of ["HEAD", "GET"] as const) {
    const res = await doFetch(resourceUrl, { method });
    const url = aclLinkFrom(res.headers.get("link"), resourceUrl);
    if (url) return url;
  }
  throw new Error(`No acl link advertised for ${resourceUrl}`);
}

function datasetHasType(ds: DatasetCore, typeIri: string): boolean {
  for (const _ of ds.match(null, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(typeIri))) {
    return true;
  }
  return false;
}

interface LoadedAcl {
  aclUrl: string;
  /** The access rules as a WAC dataset (ACP is translated in via acpToWac). */
  wac: DatasetCore;
  etag: string | null;
  kind: "wac" | "acp";
}

async function loadAcl(resourceUrl: string, doFetch: typeof fetch, fetchImpl?: typeof fetch): Promise<LoadedAcl> {
  const aclUrl = await discoverAclUrl(resourceUrl, doFetch);
  try {
    const { dataset, etag } = await fetchRdf(aclUrl, opts(fetchImpl));
    if (datasetHasType(dataset, ACP_ACR)) {
      const wac = new Store();
      acpToWac(new AcrDataset(dataset, DataFactory), wac);
      return { aclUrl, wac, etag, kind: "acp" };
    }
    return { aclUrl, wac: dataset, etag, kind: "wac" };
  } catch (e) {
    // No resource-specific ACL yet (access is inherited) — we'll create one.
    if (e instanceof RdfFetchError && e.status === 404) {
      return { aclUrl, wac: new Store(), etag: null, kind: "wac" };
    }
    throw e;
  }
}

/** Read named-agent collaborators (the owner is excluded) and their merged modes. */
function readCollaborators(wac: DatasetCore, ownerWebId: string): Collaborator[] {
  const byAgent = new Map<string, Access>();
  for (const auth of new AclResource(wac, DataFactory).authorizations) {
    for (const agent of auth.agent) {
      if (agent === ownerWebId) continue;
      const prev = byAgent.get(agent) ?? empty();
      byAgent.set(agent, {
        read: prev.read || auth.canRead,
        write: prev.write || auth.canWrite,
        control: prev.control || auth.canReadWriteAcl,
      });
    }
  }
  return [...byAgent].map(([webId, access]) => ({ webId, access }));
}

/**
 * Build a canonical WAC ACL granting the owner full control plus each collaborator
 * their modes. Rebuilding (rather than mutating an unknown structure) guarantees
 * the owner never loses control — fail-closed (AGENTS.md §Access control).
 */
function buildAcl(
  aclUrl: string,
  resourceUrl: string,
  ownerWebId: string,
  collaborators: Collaborator[],
  publicRead = false,
): Store {
  const ds = new Store();

  const owner = new Authorization(`${aclUrl}#owner`, ds, DataFactory);
  owner.type.add(`${ACL}Authorization`);
  owner.accessTo = resourceUrl;
  owner.agent.add(ownerWebId);
  owner.canRead = true;
  owner.canWrite = true;
  owner.canReadWriteAcl = true;

  if (publicRead) {
    const anyone = new Authorization(`${aclUrl}#public`, ds, DataFactory);
    anyone.type.add(`${ACL}Authorization`);
    anyone.accessTo = resourceUrl;
    anyone.accessibleToAny = true; // acl:agentClass foaf:Agent
    anyone.canRead = true;
  }

  collaborators.filter((c) => some(c.access)).forEach((c, i) => {
    const auth = new Authorization(`${aclUrl}#c${i}`, ds, DataFactory);
    auth.type.add(`${ACL}Authorization`);
    auth.accessTo = resourceUrl;
    auth.agent.add(c.webId);
    auth.canRead = c.access.read;
    auth.canWrite = c.access.write;
    auth.canReadWriteAcl = c.access.control;
  });

  return ds;
}

async function writeAcl(
  loaded: LoadedAcl,
  resourceUrl: string,
  ownerWebId: string,
  collaborators: Collaborator[],
  doFetch: typeof fetch,
  publicRead = false,
): Promise<void> {
  const wac = buildAcl(loaded.aclUrl, resourceUrl, ownerWebId, collaborators, publicRead);
  let target: DatasetCore = wac;
  if (loaded.kind === "acp") {
    const acr = new Store();
    wacToAcp(new AclResource(wac, DataFactory), acr);
    target = acr;
  }
  const headers: Record<string, string> = { "content-type": "text/turtle" };
  if (loaded.etag) headers["if-match"] = loaded.etag;
  const res = await doFetch(loaded.aclUrl, { method: "PUT", headers, body: await serialize(target) });
  if (!res.ok && res.status !== 205) throw new WriteError(loaded.aclUrl, res.status);
}

/** List the named agents a resource is shared with (excluding the owner). */
export async function listCollaborators(
  resourceUrl: string,
  ownerWebId: string,
  fetchImpl?: typeof fetch,
): Promise<Collaborator[]> {
  const doFetch = fetchImpl ?? fetch;
  const loaded = await loadAcl(resourceUrl, doFetch, fetchImpl);
  return readCollaborators(loaded.wac, ownerWebId);
}

/**
 * Grant `webId` the given access on `resourceUrl`, preserving the owner's control
 * and everyone else's existing access. Works on WAC (.acl) and ACP (.acr) servers.
 */
export async function setAccess(
  resourceUrl: string,
  ownerWebId: string,
  webId: string,
  access: Access,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const doFetch = fetchImpl ?? fetch;
  const loaded = await loadAcl(resourceUrl, doFetch, fetchImpl);
  const collaborators = readCollaborators(loaded.wac, ownerWebId).filter((c) => c.webId !== webId);
  if (some(access)) collaborators.push({ webId, access });
  await writeAcl(loaded, resourceUrl, ownerWebId, collaborators, doFetch);
}

/**
 * Make a resource publicly readable while keeping the owner in control and
 * preserving existing named collaborators. Used for the public type index, which
 * other people must be able to read to discover the owner's tracker.
 */
export async function grantPublicRead(
  resourceUrl: string,
  ownerWebId: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const doFetch = fetchImpl ?? fetch;
  const loaded = await loadAcl(resourceUrl, doFetch, fetchImpl);
  const collaborators = readCollaborators(loaded.wac, ownerWebId);
  await writeAcl(loaded, resourceUrl, ownerWebId, collaborators, doFetch, true);
}

/** Revoke all of `webId`'s access on `resourceUrl`. */
export function removeAccess(
  resourceUrl: string,
  ownerWebId: string,
  webId: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  return setAccess(resourceUrl, ownerWebId, webId, empty(), fetchImpl);
}
