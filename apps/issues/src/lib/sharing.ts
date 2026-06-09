import { AclResource, Authorization, Group, AcrDataset, wacToAcp, acpToWac } from "@solid/object";
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
export interface GroupGrant {
  groupIri: string;
  access: Access;
}
export interface Grants {
  agents: Collaborator[];
  groups: GroupGrant[];
}

const empty = (): Access => ({ read: false, write: false, control: false });
const some = (a: Access) => a.read || a.write || a.control;
const merge = (a: Access, b: Access): Access => ({
  read: a.read || b.read,
  write: a.write || b.write,
  control: a.control || b.control,
});
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

async function discoverAclUrl(resourceUrl: string, doFetch: typeof fetch): Promise<string> {
  for (const method of ["HEAD", "GET"] as const) {
    const res = await doFetch(resourceUrl, { method });
    const url = aclLinkFrom(res.headers.get("link"), resourceUrl);
    if (url) return url;
  }
  throw new Error(`No acl link advertised for ${resourceUrl}`);
}

function datasetHasType(ds: DatasetCore, typeIri: string): boolean {
  for (const _ of ds.match(null, DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(typeIri))) return true;
  return false;
}

interface LoadedAcl {
  aclUrl: string;
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
    if (e instanceof RdfFetchError && e.status === 404) {
      return { aclUrl, wac: new Store(), etag: null, kind: "wac" };
    }
    throw e;
  }
}

/** Read named-agent and group grants (the owner is excluded). */
function readGrants(wac: DatasetCore, ownerWebId: string): Grants {
  const byAgent = new Map<string, Access>();
  const byGroup = new Map<string, Access>();
  for (const auth of new AclResource(wac, DataFactory).authorizations) {
    const access = { read: auth.canRead, write: auth.canWrite, control: auth.canReadWriteAcl };
    for (const agent of auth.agent) {
      if (agent === ownerWebId) continue;
      byAgent.set(agent, merge(byAgent.get(agent) ?? empty(), access));
    }
    const group = auth.agentGroup?.value;
    if (group) byGroup.set(group, merge(byGroup.get(group) ?? empty(), access));
  }
  return {
    agents: [...byAgent].map(([webId, access]) => ({ webId, access })),
    groups: [...byGroup].map(([groupIri, access]) => ({ groupIri, access })),
  };
}

/**
 * Build a canonical WAC ACL granting the owner full control plus each agent and
 * group their modes. Rebuilding guarantees the owner never loses control
 * (fail-closed; AGENTS.md §Access control).
 */
function buildAcl(
  aclUrl: string,
  resourceUrl: string,
  ownerWebId: string,
  grants: Grants,
  publicRead = false,
): Store {
  const ds = new Store();
  // On a container, also grant acl:default so the rule cascades to members
  // (sharing the whole tracker shares its issues); on a file, accessTo only.
  const isContainer = resourceUrl.endsWith("/");
  const aim = (auth: Authorization) => {
    auth.type.add(`${ACL}Authorization`);
    auth.accessTo = resourceUrl;
    if (isContainer) auth.default = resourceUrl;
  };

  const owner = new Authorization(`${aclUrl}#owner`, ds, DataFactory);
  aim(owner);
  owner.agent.add(ownerWebId);
  owner.canRead = true;
  owner.canWrite = true;
  owner.canReadWriteAcl = true;

  if (publicRead) {
    const anyone = new Authorization(`${aclUrl}#public`, ds, DataFactory);
    aim(anyone);
    anyone.accessibleToAny = true; // acl:agentClass foaf:Agent
    anyone.canRead = true;
  }

  grants.agents.filter((c) => some(c.access)).forEach((c, i) => {
    const auth = new Authorization(`${aclUrl}#c${i}`, ds, DataFactory);
    aim(auth);
    auth.agent.add(c.webId);
    auth.canRead = c.access.read;
    auth.canWrite = c.access.write;
    auth.canReadWriteAcl = c.access.control;
  });

  grants.groups.filter((g) => some(g.access)).forEach((g, i) => {
    const auth = new Authorization(`${aclUrl}#g${i}`, ds, DataFactory);
    aim(auth);
    auth.agentGroup = new Group(g.groupIri, ds, DataFactory);
    auth.canRead = g.access.read;
    auth.canWrite = g.access.write;
    auth.canReadWriteAcl = g.access.control;
  });

  return ds;
}

async function writeAcl(loaded: LoadedAcl, resourceUrl: string, ownerWebId: string, grants: Grants, doFetch: typeof fetch, publicRead = false): Promise<void> {
  const wac = buildAcl(loaded.aclUrl, resourceUrl, ownerWebId, grants, publicRead);
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

/** List all grants (named agents + groups) on a resource, excluding the owner. */
export async function listGrants(resourceUrl: string, ownerWebId: string, fetchImpl?: typeof fetch): Promise<Grants> {
  const doFetch = fetchImpl ?? fetch;
  const loaded = await loadAcl(resourceUrl, doFetch, fetchImpl);
  return readGrants(loaded.wac, ownerWebId);
}

/** List the named agents a resource is shared with (excluding the owner). */
export async function listCollaborators(resourceUrl: string, ownerWebId: string, fetchImpl?: typeof fetch): Promise<Collaborator[]> {
  return (await listGrants(resourceUrl, ownerWebId, fetchImpl)).agents;
}

/** Grant `webId` the given access, preserving the owner, other agents, and groups. */
export async function setAccess(resourceUrl: string, ownerWebId: string, webId: string, access: Access, fetchImpl?: typeof fetch): Promise<void> {
  const doFetch = fetchImpl ?? fetch;
  const loaded = await loadAcl(resourceUrl, doFetch, fetchImpl);
  const grants = readGrants(loaded.wac, ownerWebId);
  grants.agents = grants.agents.filter((c) => c.webId !== webId);
  if (some(access)) grants.agents.push({ webId, access });
  await writeAcl(loaded, resourceUrl, ownerWebId, grants, doFetch);
}

/** Grant a group the given access, preserving the owner, agents, and other groups. */
export async function setGroupAccess(resourceUrl: string, ownerWebId: string, groupIri: string, access: Access, fetchImpl?: typeof fetch): Promise<void> {
  const doFetch = fetchImpl ?? fetch;
  const loaded = await loadAcl(resourceUrl, doFetch, fetchImpl);
  const grants = readGrants(loaded.wac, ownerWebId);
  grants.groups = grants.groups.filter((g) => g.groupIri !== groupIri);
  if (some(access)) grants.groups.push({ groupIri, access });
  await writeAcl(loaded, resourceUrl, ownerWebId, grants, doFetch);
}

/** Make a resource publicly readable while keeping the owner in control and preserving grants. */
export async function grantPublicRead(resourceUrl: string, ownerWebId: string, fetchImpl?: typeof fetch): Promise<void> {
  const doFetch = fetchImpl ?? fetch;
  const loaded = await loadAcl(resourceUrl, doFetch, fetchImpl);
  await writeAcl(loaded, resourceUrl, ownerWebId, readGrants(loaded.wac, ownerWebId), doFetch, true);
}

/** Revoke all of `webId`'s access on `resourceUrl`. */
export function removeAccess(resourceUrl: string, ownerWebId: string, webId: string, fetchImpl?: typeof fetch): Promise<void> {
  return setAccess(resourceUrl, ownerWebId, webId, empty(), fetchImpl);
}
