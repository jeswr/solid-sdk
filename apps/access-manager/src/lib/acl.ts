// AUTHORED-BY Claude Fable 5
//
// The WAC data layer — the security core of the app. It READS and EDITS .acl
// documents exclusively through @solid/object's typed accessors (`AclResource`
// / `Authorization`, whose Set properties are live write-through wrappers over
// the dataset) — NEVER hand-concatenated triples — and serialises via n3.Writer.
//
// Model (the solid-wac resolution walk):
//   - A resource's ACCESS is governed by its OWN .acl if that document exists,
//     else by the nearest ancestor container's .acl via `acl:default` entries
//     (child → root walk, fail-closed: no ACL found anywhere = no access data).
//   - `acl:accessTo` entries apply to the named resource itself; `acl:default`
//     entries apply to DESCENDANTS of the named container (inheritance).
//
// Every edit is guarded:
//   - conditional writes (If-Match from the read ETag; 412 → re-read + re-apply
//     via `updateAclWithRetry`, surfacing a conflict after bounded retries);
//   - a SELF-LOCKOUT guard — an edit that would leave the owner without
//     acl:Control on the governing resource is refused (LockoutError).

import type { DatasetCore } from "@rdfjs/types";
import { AclResource, Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import {
  PreconditionFailedError,
  putIfMatch,
  putIfNoneMatch,
  type ReadRdf,
  readRdf,
  type SolidFetch,
} from "./http.js";
import { toTurtle, tryRead } from "./rdf.js";
import { ACL, FOAF } from "./vocab.js";

export type WacMode = "Read" | "Write" | "Append" | "Control";
export const ALL_MODES: readonly WacMode[] = ["Read", "Write", "Append", "Control"];

const MODE_IRI: Record<WacMode, string> = {
  Read: ACL.Read,
  Write: ACL.Write,
  Append: ACL.Append,
  Control: ACL.Control,
};
const IRI_MODE: Record<string, WacMode> = Object.fromEntries(
  Object.entries(MODE_IRI).map(([k, v]) => [v, k as WacMode]),
);

/** One authorization, projected for the UI. All reads tryRead-guarded. */
export interface AclEntry {
  /** The authorization node IRI inside the ACL document. */
  authIri: string;
  /** WebIDs granted by acl:agent. */
  agents: string[];
  /** Public access: acl:agentClass foaf:Agent. */
  isPublic: boolean;
  /** Any-authenticated access: acl:agentClass acl:AuthenticatedAgent. */
  isAuthenticated: boolean;
  modes: WacMode[];
  /** Resources this entry names via acl:accessTo. */
  accessTo: string[];
  /** Containers whose DESCENDANTS this entry governs via acl:default. */
  defaultFor: string[];
}

/** The ACL document that actually governs a resource. */
export interface EffectiveAcl {
  /** The resource the caller asked about. */
  resource: string;
  /** The ACL document URL. */
  aclUrl: string;
  /** The resource whose ACL document this is (== `resource` when owned). */
  governingResource: string;
  /** true = the resource's own ACL; false = inherited from an ancestor. */
  owned: boolean;
  etag: string | null;
  dataset: DatasetCore;
  /** Entries in the document that APPLY to `resource`. */
  entries: AclEntry[];
}

/** Refused edit: it would strip the owner's last Control. */
export class LockoutError extends Error {
  constructor(resource: string) {
    super(
      `Refusing edit: it would remove the owner's last acl:Control over ${resource} (self-lockout guard).`,
    );
    this.name = "LockoutError";
  }
}

/** No ACL document found anywhere up the ancestor chain (fail-closed surface). */
export class NoAclFoundError extends Error {
  constructor(resource: string) {
    super(`No ACL document found for ${resource} or any of its ancestors.`);
    this.name = "NoAclFoundError";
  }
}

/** A conditional ACL write kept failing after bounded re-read/re-apply retries. */
export class AclConflictError extends Error {
  constructor(aclUrl: string) {
    super(`The ACL at ${aclUrl} kept changing concurrently; giving up after retries.`);
    this.name = "AclConflictError";
  }
}

/**
 * Discover a resource's ACL document URL from the `Link: <...>; rel="acl"`
 * header (per WAC); falls back to the `.acl` suffix convention when the server
 * sends no header. Uses HEAD — no body needed.
 */
export async function discoverAclUrl(resourceUrl: string, fetchFn: SolidFetch): Promise<string> {
  try {
    const res = await fetchFn(resourceUrl, { method: "HEAD" });
    const link = res.headers.get("link");
    if (link) {
      const rel = parseAclLink(link, resourceUrl);
      if (rel) return rel;
    }
  } catch {
    // fall through to the convention
  }
  return `${resourceUrl}.acl`;
}

/** Parse the first rel="acl" target out of a Link header (resolved absolute). */
export function parseAclLink(linkHeader: string, base: string): string | undefined {
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]*)>\s*;\s*(?:.*;\s*)?rel="?acl"?/i);
    if (m?.[1] !== undefined) {
      try {
        return new URL(m[1], base).href;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** The parent container URL, or undefined at (or above) the root. */
export function parentContainer(resourceUrl: string, rootUrl: string): string | undefined {
  if (normalize(resourceUrl) === normalize(rootUrl)) return undefined;
  const u = new URL(resourceUrl);
  const path = u.pathname.endsWith("/") ? u.pathname.slice(0, -1) : u.pathname;
  const idx = path.lastIndexOf("/");
  if (idx < 0) return undefined;
  const parent = `${u.origin}${path.slice(0, idx + 1)}`;
  // Never walk above the storage root.
  if (!normalize(parent).startsWith(normalize(new URL(rootUrl).origin))) return undefined;
  return parent;
}

function normalize(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** Project every authorization in an ACL document (untrusted RDF — guarded). */
export function projectEntries(dataset: DatasetCore): AclEntry[] {
  const acl = new AclResource(dataset, DataFactory);
  const out: AclEntry[] = [];
  for (const auth of acl.authorizations) {
    const authIri = auth.value;
    const agents = tryRead(() => [...auth.agent]) ?? [];
    const agentClasses = tryRead(() => [...auth.agentClass]) ?? [];
    const modeIris = tryRead(() => [...auth.mode]) ?? [];
    const accessTo = tryRead(() => auth.accessTo);
    const dflt = tryRead(() => auth.default);
    // accessTo/default are single-valued in the wrapper; collect the full sets
    // from the dataset via extra wrappers is unnecessary — WAC docs in practice
    // use one value; multi-valued docs still project their first value each.
    out.push({
      authIri,
      agents,
      isPublic: agentClasses.includes(FOAF.Agent),
      isAuthenticated: agentClasses.includes(ACL.AuthenticatedAgent),
      modes: modeIris.map((m) => IRI_MODE[m]).filter((m): m is WacMode => m !== undefined),
      accessTo: accessTo !== undefined ? [accessTo] : [],
      defaultFor: dflt !== undefined ? [dflt] : [],
    });
  }
  return out;
}

/** The entries of a document that apply to `resource`, given the governing resource. */
export function applicableEntries(
  entries: AclEntry[],
  resource: string,
  governingResource: string,
  owned: boolean,
): AclEntry[] {
  if (owned) {
    return entries.filter((e) => e.accessTo.some((t) => sameResource(t, resource)));
  }
  // Inherited: only acl:default entries of the governing ANCESTOR apply.
  return entries.filter((e) => e.defaultFor.some((t) => sameResource(t, governingResource)));
}

function sameResource(a: string, b: string): boolean {
  return a === b || normalize(a) === normalize(b);
}

/**
 * Resolve the ACL document that GOVERNS a resource: its own .acl if present,
 * else walk ancestors (acl:default). Fail-closed: none found → NoAclFoundError.
 */
export async function readEffectiveAcl(
  resourceUrl: string,
  storageRoot: string,
  fetchFn: SolidFetch,
): Promise<EffectiveAcl> {
  let current: string | undefined = resourceUrl;
  while (current !== undefined) {
    const aclUrl = await discoverAclUrl(current, fetchFn);
    const read: ReadRdf | null = await readRdf(aclUrl, fetchFn);
    if (read !== null) {
      const owned = sameResource(current, resourceUrl);
      const all = projectEntries(read.dataset);
      return {
        resource: resourceUrl,
        aclUrl: read.url,
        governingResource: current,
        owned,
        etag: read.etag,
        dataset: read.dataset,
        entries: applicableEntries(all, resourceUrl, current, owned),
      };
    }
    current = parentContainer(current, storageRoot);
  }
  throw new NoAclFoundError(resourceUrl);
}

/** Whether the owner retains acl:Control via a DIRECT acl:agent entry. */
export function ownerHasControl(dataset: DatasetCore, ownerWebId: string): boolean {
  for (const entry of projectEntries(dataset)) {
    if (entry.agents.includes(ownerWebId) && entry.modes.includes("Control")) return true;
  }
  return false;
}

function authAt(dataset: DatasetCore, authIri: string): Authorization {
  return new Authorization(authIri, dataset, DataFactory);
}

/** Remove an authorization node entirely when it no longer names any subject. */
function dropIfSubjectless(dataset: DatasetCore, authIri: string): void {
  const auth = authAt(dataset, authIri);
  const hasSubjects =
    (tryRead(() => auth.agent.size) ?? 0) > 0 ||
    (tryRead(() => auth.agentClass.size) ?? 0) > 0 ||
    tryRead(() => auth.agentGroup) !== undefined;
  if (!hasSubjects) {
    // Delete the whole node description through the wrapper's live dataset.
    for (const q of [...dataset.match(DataFactory.namedNode(authIri), null, null)]) {
      dataset.delete(q);
    }
  }
}

/**
 * MUTATION: remove an agent from one authorization. Drops the node if it names
 * nobody afterwards. Lockout-guarded for the owner.
 */
export function removeAgentFromEntry(
  dataset: DatasetCore,
  authIri: string,
  agentWebId: string,
  ownerWebId: string,
): void {
  const auth = authAt(dataset, authIri);
  auth.agent.delete(agentWebId);
  dropIfSubjectless(dataset, authIri);
  if (agentWebId === ownerWebId && !ownerHasControl(dataset, ownerWebId)) {
    throw new LockoutError(authIri);
  }
}

/** MUTATION: remove public (foaf:Agent) access from ONE authorization. */
export function removePublicFromEntry(dataset: DatasetCore, authIri: string): void {
  const auth = authAt(dataset, authIri);
  auth.agentClass.delete(FOAF.Agent);
  dropIfSubjectless(dataset, authIri);
}

/** MUTATION: remove public (foaf:Agent) access from every authorization. */
export function removePublicAccess(dataset: DatasetCore): void {
  const acl = new AclResource(dataset, DataFactory);
  const authIris = [...acl.authorizations].map((a) => a.value);
  for (const authIri of authIris) {
    const auth = authAt(dataset, authIri);
    if (tryRead(() => auth.accessibleToAny) === true) {
      auth.agentClass.delete(FOAF.Agent);
      dropIfSubjectless(dataset, authIri);
    }
  }
}

/**
 * MUTATION: set THIS AGENT's modes. When the authorization names exactly this
 * one agent (and no agent class / group), modes change in place. When it is
 * SHARED (other agents / public), the agent is SPLIT OUT into its own new
 * authorization so nobody else's access changes. Lockout-guarded.
 */
export function setAgentModes(
  dataset: DatasetCore,
  aclUrl: string,
  authIri: string,
  agentWebId: string,
  modes: readonly WacMode[],
  ownerWebId: string,
): void {
  if (modes.length === 0) {
    removeAgentFromEntry(dataset, authIri, agentWebId, ownerWebId);
    return;
  }
  const auth = authAt(dataset, authIri);
  const agents = tryRead(() => [...auth.agent]) ?? [];
  const classes = tryRead(() => auth.agentClass.size) ?? 0;
  const group = tryRead(() => auth.agentGroup);
  const soleAgent = agents.length === 1 && agents[0] === agentWebId && classes === 0 && !group;

  if (soleAgent) {
    auth.mode.clear();
    for (const m of modes) auth.mode.add(MODE_IRI[m]);
  } else {
    // Split: remove from the shared node, re-grant alone with the new modes.
    const accessTo = tryRead(() => auth.accessTo);
    const dflt = tryRead(() => auth.default);
    auth.agent.delete(agentWebId);
    dropIfSubjectless(dataset, authIri);
    createAuthorization(dataset, aclUrl, {
      agents: [agentWebId],
      modes,
      ...(accessTo !== undefined ? { accessTo } : {}),
      ...(dflt !== undefined ? { defaultFor: dflt } : {}),
    });
  }
  if (agentWebId === ownerWebId && !ownerHasControl(dataset, ownerWebId)) {
    throw new LockoutError(authIri);
  }
}

export interface NewAuthorization {
  agents?: readonly string[];
  isPublic?: boolean;
  modes: readonly WacMode[];
  accessTo?: string;
  defaultFor?: string;
}

/**
 * MUTATION: add a new authorization node (fresh fragment) through the typed
 * wrapper. Used by the grant pipeline and by mode splits.
 */
export function createAuthorization(
  dataset: DatasetCore,
  aclUrl: string,
  spec: NewAuthorization,
): string {
  const base = aclUrl.split("#")[0] ?? aclUrl;
  let n = 0;
  let authIri = `${base}#grant-${n}`;
  while (dataset.match(DataFactory.namedNode(authIri), null, null).size > 0) {
    n += 1;
    authIri = `${base}#grant-${n}`;
  }
  const auth = authAt(dataset, authIri);
  auth.type.add(ACL.Authorization);
  for (const a of spec.agents ?? []) auth.agent.add(a);
  if (spec.isPublic === true) auth.accessibleToAny = true;
  for (const m of spec.modes) auth.mode.add(MODE_IRI[m]);
  if (spec.accessTo !== undefined) auth.accessTo = spec.accessTo;
  if (spec.defaultFor !== undefined) auth.default = spec.defaultFor;
  return authIri;
}

/**
 * MUTATION: grant `agentWebId` the given modes on `resourceUrl` inside its OWN
 * ACL document. Reuses an existing agent-only node with identical scope+modes
 * (idempotent re-grant), else creates a new node.
 */
export function addAgentGrant(
  dataset: DatasetCore,
  aclUrl: string,
  resourceUrl: string,
  agentWebId: string,
  modes: readonly WacMode[],
): string {
  const sortedWanted = [...modes].sort().join(",");
  for (const entry of projectEntries(dataset)) {
    const scopeMatches =
      entry.accessTo.some((t) => sameResource(t, resourceUrl)) &&
      !entry.isPublic &&
      !entry.isAuthenticated;
    if (scopeMatches && [...entry.modes].sort().join(",") === sortedWanted) {
      const auth = authAt(dataset, entry.authIri);
      auth.agent.add(agentWebId);
      return entry.authIri;
    }
  }
  return createAuthorization(dataset, aclUrl, {
    agents: [agentWebId],
    modes,
    accessTo: resourceUrl,
  });
}

/**
 * Build a resource's OWN ACL document from the effective (inherited) one —
 * needed before granting on a resource that has no .acl yet. Copies every
 * APPLICABLE inherited entry so existing access (above all the owner's
 * Control) is preserved, retargeted at the resource. For containers the
 * copied entries also carry acl:default so their descendants keep inheriting.
 */
export function materializeOwnAcl(effective: EffectiveAcl, resourceUrl: string): DatasetCore {
  const dataset: DatasetCore = new Store();
  const aclUrl = `${resourceUrl}.acl`;
  const isContainer = resourceUrl.endsWith("/");
  for (const entry of effective.entries) {
    createAuthorization(dataset, aclUrl, {
      agents: entry.agents,
      isPublic: entry.isPublic,
      modes: entry.modes,
      accessTo: resourceUrl,
      ...(isContainer ? { defaultFor: resourceUrl } : {}),
    });
  }
  return dataset;
}

/**
 * Read → mutate → conditional-write an ACL document, re-reading and re-applying
 * on 412 up to `attempts` times (the CAS retry loop). The mutation callback
 * must be PURE over the dataset (safe to re-apply on a fresh read).
 */
export async function updateAclWithRetry(
  aclUrl: string,
  fetchFn: SolidFetch,
  mutate: (dataset: DatasetCore) => void,
  attempts = 3,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const read = await readRdf(aclUrl, fetchFn);
    if (read === null) throw new NoAclFoundError(aclUrl);
    mutate(read.dataset);
    const turtle = await toTurtle(read.dataset, aclUrl);
    try {
      await putIfMatch(aclUrl, turtle, read.etag, fetchFn);
      return;
    } catch (e) {
      if (e instanceof PreconditionFailedError && attempt < attempts - 1) continue;
      if (e instanceof PreconditionFailedError) throw new AclConflictError(aclUrl);
      throw e;
    }
  }
}

/**
 * Grant modes on a resource, materialising an own ACL first when the resource
 * only has an inherited one (create-only, so two concurrent materialisations
 * cannot clobber each other — the loser falls through to the CAS update path).
 */
export async function grantOnResource(
  resourceUrl: string,
  storageRoot: string,
  ownerWebId: string,
  agentWebId: string,
  modes: readonly WacMode[],
  fetchFn: SolidFetch,
): Promise<void> {
  const effective = await readEffectiveAcl(resourceUrl, storageRoot, fetchFn);
  if (!effective.owned) {
    const materialized = materializeOwnAcl(effective, resourceUrl);
    const aclUrl = await discoverAclUrl(resourceUrl, fetchFn);
    // Belt-and-braces: a fresh own ACL must NEVER omit the owner's Control
    // (the inherited entries normally carry it; if they don't, add it).
    if (!ownerHasControl(materialized, ownerWebId)) {
      createAuthorization(materialized, aclUrl, {
        agents: [ownerWebId],
        modes: ALL_MODES,
        accessTo: resourceUrl,
        ...(resourceUrl.endsWith("/") ? { defaultFor: resourceUrl } : {}),
      });
    }
    addAgentGrant(materialized, aclUrl, resourceUrl, agentWebId, modes);
    try {
      await putIfNoneMatch(aclUrl, await toTurtle(materialized, aclUrl), fetchFn);
      return;
    } catch (e) {
      if (!(e instanceof PreconditionFailedError)) throw e;
      // Lost the create race — an own ACL now exists; fall through to update it.
    }
  }
  const aclUrl = effective.owned ? effective.aclUrl : await discoverAclUrl(resourceUrl, fetchFn);
  await updateAclWithRetry(aclUrl, fetchFn, (dataset) => {
    addAgentGrant(dataset, aclUrl, resourceUrl, agentWebId, modes);
  });
}

export { IRI_MODE, MODE_IRI };
