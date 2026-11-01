// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Scoped WAC removal, owner lockout guard and CAS retry ported from
// apps/access-manager/src/lib/acl.ts: detachResourceScope, removeAgentFromEntry,
// removePublicFromEntry, removeAuthenticatedFromEntry, ownerRetainsAnyControl,
// LockoutError and updateAclWithRetry. Inherited revocations edit the parent ACL,
// so materializeOwnAcl is intentionally unnecessary here.
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import type { Grant, Subject } from "@jeswr/pod-access";
import type { DatasetCore, Term } from "@rdfjs/types";
import { SetFrom, TermAs, TermFrom } from "@rdfjs/wrapper";
import { AclResource } from "@solid/object";
import { DataFactory, Store } from "n3";
import { isomorphic } from "rdf-isomorphic";
import { parseResource, readResource, serializeTurtle } from "../model/rdf";
import type { AgentRow, ModeId, PermissionLine, PermissionsSnapshot } from "./types";
import {
  ACL,
  AccessNode,
  AUTHENTICATED,
  authorizationQuads,
  grantSignature,
  PUBLIC,
  SCOPES,
  SELECTORS,
  UnsupportedAccessError,
} from "./vocab";
import { accessSystem, readWacPolicy } from "./walk";

export class LockoutError extends Error {
  override name = "LockoutError";
  constructor() {
    super("The owner must retain control of every affected scope");
  }
}
export class AclConflictError extends Error {
  override name = "AclConflictError";
  constructor() {
    super("The access policy changed; refresh before trying again");
  }
}
export interface RevokeChange {
  source: string;
  system: "wac" | "acp" | "unknown";
  node: string;
  subject: Subject;
  resource: string;
  scope: "resource" | "members";
  modes: ModeId[];
  /** Full principal expression and modes, independent of parser-local node labels. */
  signature?: string;
  /** Original authorization graph, compared independently of blank-node labels. */
  authorization?: string;
}
export interface RevokePlan {
  changes: RevokeChange[];
  /** Exact inverse; conditional restoration refuses any intervening graph change. */
  restore?: { source: string; before: string; after: string }[];
}
export function planRevoke(
  target: AgentRow | PermissionLine | PermissionsSnapshot,
  scope: "line" | "all" | "make-private",
): RevokePlan {
  const rows = "rows" in target ? target.rows : "lines" in target ? [target] : [];
  const lines =
    "resources" in target
      ? [target]
      : rows
          .filter(
            (row) => scope !== "make-private" || ["public", "authenticated"].includes(row.kind),
          )
          .flatMap((row) => row.lines);
  const changes = new Map<string, RevokeChange>();
  for (const line of lines)
    for (const r of line.resources) {
      const row = rows.find((row) => row.lines.includes(line));
      const subject =
        r.subject ??
        (row?.kind === "person"
          ? { kind: "agent" as const, webId: row.id }
          : row?.kind === "public" || row?.kind === "authenticated"
            ? { kind: row.kind }
            : undefined);
      if (!subject) throw new UnsupportedAccessError();
      const change: RevokeChange = {
        source: r.source,
        system: r.system ?? "unknown",
        node: r.node,
        subject,
        resource: r.inheritedFrom ?? r.url,
        scope: r.scope ?? (r.inherited ? "members" : "resource"),
        modes: [...r.modes],
        ...(r.signature ? { signature: r.signature } : {}),
        ...(r.authorization ? { authorization: r.authorization } : {}),
      };
      changes.set(
        JSON.stringify([change.source, change.node, change.subject, change.resource, change.scope]),
        change,
      );
    }
  return { changes: [...changes.values()] };
}
function selector(subject: Subject): [string, string] {
  switch (subject.kind) {
    case "agent":
      return ["agent", subject.webId];
    case "origin":
      return ["origin", subject.origin];
    case "public":
      return ["agentClass", PUBLIC];
    case "authenticated":
      return ["agentClass", AUTHENTICATED];
    default:
      throw new UnsupportedAccessError();
  }
}
function authorizations(dataset: DatasetCore): AccessNode[] {
  return [...new AclResource(dataset, DataFactory).authorizations].map(
    (auth) => new AccessNode(auth as Term, dataset, DataFactory),
  );
}
function ownerRetainsAnyControl(
  dataset: DatasetCore,
  owner: string,
  resource: string,
  members: boolean,
): boolean {
  return authorizations(dataset).some(
    (node) =>
      node.iris(`${ACL}mode`).includes(`${ACL}Control`) &&
      (members ? ["default", "defaultForNew"] : ["accessTo"]).some((scope) =>
        node.iris(ACL + scope).includes(resource),
      ) &&
      (node.iris(`${ACL}agent`).includes(owner) ||
        node.iris(`${ACL}agentClass`).some((id) => [PUBLIC, AUTHENTICATED].includes(id))) &&
      !node.iris(`${ACL}origin`).length,
  );
}
function dropDescription(node: AccessNode): void {
  for (const q of [...node.dataset.match(TermAs.term(node))]) node.dataset.delete(q);
}
function detachResourceScope(
  node: AccessNode,
  resource: string,
  scope: RevokeChange["scope"],
): AccessNode {
  const chosen = scope === "members" ? ["default", "defaultForNew"] : ["accessTo"];
  const retained = SCOPES.some((name) =>
    node.iris(ACL + name).some((value) => value !== resource || !chosen.includes(name)),
  );
  if (!retained) return node;
  const copy = new AccessNode(DataFactory.blankNode(), node.dataset, DataFactory);
  for (const q of [...node.dataset.match(TermAs.term(node))]) {
    if (
      SCOPES.some((name) => q.predicate.value === ACL + name) &&
      !(chosen.some((name) => q.predicate.value === ACL + name) && q.object.value === resource)
    )
      continue;
    SetFrom.subjectPredicate(copy, q.predicate.value, TermAs.term, TermFrom.itself).add(q.object);
  }
  for (const name of chosen) node.values(ACL + name).delete(resource);
  return copy;
}
function matchesScope(node: AccessNode, change: RevokeChange): boolean {
  const [predicate, id] = selector(change.subject);
  const scopes = change.scope === "resource" ? ["accessTo"] : ["default", "defaultForNew"];
  return (
    node.iris(ACL + predicate).includes(id) &&
    scopes.some((scope) => node.iris(ACL + scope).includes(change.resource))
  );
}
/** Resolve the whole document before any selector or scope edits alter signatures. */
async function resolveChanges(
  dataset: DatasetCore,
  changes: RevokeChange[],
): Promise<RevokeChange[]> {
  const nodes = authorizations(dataset);
  const descriptions = new Map<string, DatasetCore>();
  for (const change of changes)
    if (change.authorization && !descriptions.has(change.authorization))
      descriptions.set(
        change.authorization,
        await parseResource(change.authorization, "text/turtle", change.source),
      );
  const originals = new Map<string, RevokeChange[]>();
  for (const change of changes) {
    const group = originals.get(change.node) ?? [];
    group.push(change);
    originals.set(change.node, group);
  }
  const policies = new Map<string, ReturnType<typeof readWacPolicy>>();
  const matches = (node: AccessNode, change: RevokeChange) => {
    if (!matchesScope(node, change)) return false;
    if (
      change.authorization &&
      !isomorphic(
        [...(descriptions.get(change.authorization) as DatasetCore)],
        authorizationQuads(dataset, TermAs.term(node)),
      )
    )
      return false;
    if (!change.signature) {
      // Older caller-built plans have no full signature. Blank-node fallback still
      // requires exact modes, rather than a subset that can select a broader rule.
      if (change.node.includes(":")) return true;
      const modeIris = node.iris(`${ACL}mode`);
      const modes: ModeId[] = ["read", "append", "write", "control"];
      const actual = modes.filter((mode) =>
        modeIris.includes(ACL + mode.charAt(0).toUpperCase() + mode.slice(1)),
      );
      return (
        grantSignature({ who: [], except: [], modes: new Set(actual) }) ===
        grantSignature({ who: [], except: [], modes: new Set(change.modes) })
      );
    }
    let policy = policies.get(change.resource);
    if (!policy) {
      policy = readWacPolicy(dataset, change.resource, change.source);
      policies.set(change.resource, policy);
    }
    const grant = policy.grants.find((grant) => grant.source.node === node.value) as Grant;
    return grantSignature(grant) === change.signature;
  };
  const buckets = new Map<string, { candidates: AccessNode[]; originals: string[] }>();
  for (const [original, group] of originals) {
    const candidates = nodes.filter(
      (node) =>
        (original.includes(":") ? node.value === original : node.termType === "BlankNode") &&
        group.every((change) => matches(node, change)),
    );
    if (!candidates.length) throw new AclConflictError();
    const key = JSON.stringify(candidates.map((node) => node.value).sort());
    const bucket = buckets.get(key) ?? { candidates, originals: [] };
    bucket.originals.push(original);
    buckets.set(key, bucket);
  }
  const resolved = new Map<string, string>();
  const used = new Set<string>();
  for (const { candidates, originals } of buckets.values()) {
    // Equivalent blank rules are interchangeable only when all of them are selected.
    if (candidates.length !== originals.length) throw new AclConflictError();
    for (const [index, candidate] of candidates.entries()) {
      if (used.has(candidate.value)) throw new AclConflictError();
      used.add(candidate.value);
      resolved.set(originals[index] as string, candidate.value);
    }
  }
  return changes.map((change) => ({ ...change, node: resolved.get(change.node) as string }));
}
function removeSubject(
  dataset: DatasetCore,
  change: RevokeChange,
  detached: Map<string, string>,
): void {
  const [predicate, id] = selector(change.subject);
  const key = JSON.stringify([change.node, change.resource, change.scope]);
  const handle = detached.get(key) ?? change.node;
  const node = authorizations(dataset).find((node) => node.value === handle);
  // A previous change can remove the entire resolved rule (e.g. its last origin).
  if (!node) return;
  const target = detachResourceScope(node, change.resource, change.scope);
  detached.set(key, target.value);
  target.values(ACL + predicate).delete(id);
  // An origin is a condition on principals; removing the final origin must NEVER
  // turn a constrained principal grant into an unconstrained grant.
  const noOrigins = predicate === "origin" && !target.iris(`${ACL}origin`).length;
  const noPrincipals =
    predicate !== "origin" &&
    !SELECTORS.some((name) => name !== "origin" && target.iris(ACL + name).length);
  if (noOrigins || noPrincipals) dropDescription(target);
}
export class PartialRevokeError extends Error {
  override name = "PartialRevokeError";
  constructor(
    readonly undo: RevokePlan,
    override readonly cause: unknown,
  ) {
    super("Some access changes completed; undo is available for those changes");
  }
}
export async function applyRevoke(
  plan: RevokePlan,
  options: { fetch: typeof globalThis.fetch; storage: string; webId: string },
): Promise<{ undo: RevokePlan }> {
  const http: typeof globalThis.fetch = (input, init) =>
    options.fetch(assertWithinPodScope(options.storage, String(input)), {
      ...init,
      redirect: "error",
    });
  const documents = new Map<string, RevokeChange[]>();
  for (const change of plan.changes) {
    if (change.system === "acp") throw new UnsupportedAccessError();
    assertWithinPodScope(options.storage, change.source);
    assertWithinPodScope(options.storage, change.resource);
    const group = documents.get(change.source) ?? [];
    group.push(change);
    documents.set(change.source, group);
  }
  for (const restore of plan.restore ?? []) {
    assertWithinPodScope(options.storage, restore.source);
    documents.set(restore.source, []);
  }
  const undo: RevokePlan = { changes: [], restore: [] };
  try {
    for (const [url, changes] of documents) {
      for (let attempt = 0; ; attempt++) {
        const current = await readResource(http, url);
        if (accessSystem(current.dataset, url, current.headers) !== "wac")
          throw new UnsupportedAccessError();
        if (!current.etag || current.etag.startsWith("W/")) throw new AclConflictError();
        const before = await serializeTurtle(current.dataset);
        const inverse = plan.restore?.find((r) => r.source === url);
        let dataset: DatasetCore = new Store([...current.dataset]);
        if (inverse) {
          const expected = await parseResource(inverse.after, "text/turtle", url);
          if (!isomorphic([...expected], [...current.dataset])) throw new AclConflictError();
          dataset = await parseResource(inverse.before, "text/turtle", url);
          // Inverse plans obey the same no-lockout rule, including every original
          // resource/default scope, even if a caller constructs a plan themselves.
          for (const node of authorizations(current.dataset))
            for (const name of SCOPES) {
              for (const resource of node.iris(ACL + name)) {
                const members = name !== "accessTo";
                if (
                  ownerRetainsAnyControl(current.dataset, options.webId, resource, members) &&
                  !ownerRetainsAnyControl(dataset, options.webId, resource, members)
                )
                  throw new LockoutError();
              }
            }
        } else {
          const detached = new Map<string, string>();
          for (const change of await resolveChanges(dataset, changes))
            removeSubject(dataset, change, detached);
          for (const change of changes)
            if (
              !ownerRetainsAnyControl(
                dataset,
                options.webId,
                change.resource,
                change.scope === "members",
              )
            )
              throw new LockoutError();
        }
        const after = await serializeTurtle(dataset);
        // Every authenticated write passes the scope guard immediately before dispatch.
        const response = await http(assertWithinPodScope(options.storage, url), {
          method: "PUT",
          headers: { "content-type": "text/turtle", "if-match": current.etag },
          body: after,
        });
        if (response.status === 412) {
          if (attempt < 2) continue;
          throw new AclConflictError();
        }
        if (!response.ok) throw new Error(`Access update failed (${response.status})`);
        undo.restore?.push({ source: url, before, after });
        break;
      }
    }
  } catch (error) {
    if (undo.restore?.length) throw new PartialRevokeError(undo, error);
    throw error;
  }
  return { undo };
}
