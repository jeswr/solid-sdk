// AUTHORED-BY Codex

import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { safeHttpIri, serialize } from "@jeswr/rdf-serialize";
import type { Term } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { AclResource, Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import { readSharing } from "../sharing/sharing";
import { commitHttp, type PolicyIdentity, type ResourceIdentity } from "./commit";
import { relocate, sameGraph } from "./rdf";

const ACL = "http://www.w3.org/ns/auth/acl#";
const ACP_NS = "http://www.w3.org/ns/solid/acp#";
export class DriveAccessError extends Error {
  readonly kind = "private-access-unavailable";
  constructor(
    override readonly cause?: unknown,
    detail?: string,
  ) {
    super(
      "Private access could not be established or verified. Drive can't confirm who can access the item and stopped the transfer. Retry once its access can be verified." +
        (detail ? ` ${detail}` : ""),
    );
  }
}
class WritableAuthorization extends Authorization {
  values(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
}
function rejectAcp(headers: Headers): void {
  if ([...headers].some(([name, value]) => /^(acp|acr)(-|$)/i.test(name) || value.includes(ACP_NS)))
    throw new DriveAccessError("ACP privacy cannot be verified by this adapter");
}
export function privateAcl(resource: string, webId: string): Store {
  const owner = safeHttpIri(webId);
  if (!owner) throw new DriveAccessError();
  const dataset = new Store();
  const rule = new WritableAuthorization(DataFactory.blankNode(), dataset, DataFactory);
  rule.type.add(`${ACL}Authorization`);
  rule.accessTo = resource;
  if (resource.endsWith("/")) rule.default = resource;
  rule.agent.add(owner);
  rule.canRead = true;
  rule.canWrite = true;
  rule.canReadWriteAcl = true;
  return dataset;
}
/** Recover only under a captured controller's private policy. */
export function policyOwner(policy: OwnAccess): string | undefined {
  for (const rule of new AclResource(policy.dataset, DataFactory).authorizations)
    if (rule.mode.has(`${ACL}Control`) && rule.canRead) {
      const [agent] = rule.agent;
      if (agent) return agent;
    }
  return undefined;
}

export interface OwnAccess {
  url: string;
  dataset: Store;
  etag: string;
}

/** ACL mutations protect the captured representation, including after local hydration. */
export interface AccessWriteGuard {
  readonly identity: ResourceIdentity;
  readonly policyGuards?: readonly PolicyIdentity[];
  /** Recovery may remove grants, but must never undo a concurrent revocation. */
  readonly restrict?: boolean;
  /** Previously verified own endpoint, usable to secure recovery if Link disappears. */
  readonly knownAcl?: string | undefined;
  /** Own ACL approved before the operation; null means conditional creation only. */
  readonly expectedAcl?: OwnAccess | null;
}

/** Captured own-ACL ownership, including absence, for the final HTTP commit boundary. */
export function ownAccessGuards(own: AccessState["own"]): readonly PolicyIdentity[] {
  return own ? [{ url: own.url, etag: own.policy?.etag ?? null }] : [];
}

/** None means a discovered own ACL's 404 (inheritance unresolved), or an explicit demo pod. */
export type AccessState = (
  | { readonly status: "known"; readonly policy: OwnAccess }
  | { readonly status: "none"; readonly demo: boolean }
  | { readonly status: "unknown"; readonly cause: unknown }
) & { readonly own?: { readonly url: string; readonly policy: OwnAccess | null } };

/** Require a governing policy before preserving or comparing access; demo needs no ACL. */
export function requireAccess(state: AccessState, resource: string): OwnAccess {
  if (state.status === "unknown") throw new DriveAccessError(state.cause);
  if (state.status === "none" && !state.demo)
    throw new DriveAccessError("Governing ACL unavailable");
  return state.status === "known"
    ? state.policy
    : { url: `${resource}.acl`, dataset: new Store(), etag: "" };
}

export function accessLabel(state: AccessState, resource: string, webId: string): string {
  if (state.status === "unknown") return "Access unknown";
  if (state.status === "none") return state.demo ? "Only you (demo pod)" : "Access unknown";
  try {
    const sharing = readSharing({
      access: {
        resource,
        documents: [
          {
            model: "wac",
            dataset: state.policy.dataset,
            source: state.policy.url,
            governingResource: resource,
            inherited: false,
          },
        ],
      },
    });
    if (sharing.link !== "none") return "Anyone with the link";
    const others = sharing.people.filter((person) => person.webId !== webId);
    if (others.length) return `People you've shared with: ${others.length}`;
    return sharing.people.length ? "Only you" : "No one";
  } catch {
    // Conditions, groups and other unrepresentable policies cannot imply exclusivity.
    return "Access unknown";
  }
}

export function accessControl(http: typeof globalThis.fetch, storageUrl: string) {
  function discover(resource: string, headers: Headers): string | undefined {
    rejectAcp(headers);
    // This explicit fixture capability never substitutes for discovery on a real pod.
    if (headers.get("x-solid-demo-access-control") === "none") return undefined;
    const links = headers.get("link") ?? "";
    let acl: string | undefined;
    for (const match of links.matchAll(/<([^>]*)>\s*((?:;\s*[^,]*)*)/g)) {
      const params = match[2] as string;
      if (/;\s*anchor\s*=/i.test(params)) continue;
      const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(params);
      const relations = (rel?.[1] ?? rel?.[2] ?? "").split(/\s+/);
      if (relations.includes("acl")) {
        if (acl) throw new DriveAccessError("Ambiguous ACL discovery");
        acl = assertWithinPodScope(storageUrl, new URL(match[1] as string, resource).href);
        if (/\.acr\/?$/i.test(new URL(acl).pathname))
          throw new DriveAccessError("ACP privacy cannot be verified by this adapter");
      }
    }
    return acl;
  }
  const read = async (url: string): Promise<AccessState> => {
    try {
      const result = await fetchRdf(url, {
        fetch: async (input, init) => {
          const response = await http(input, { ...init, cache: "no-store" });
          rejectAcp(response.headers);
          return response;
        },
      });
      if (!result.etag || result.etag.startsWith("W/"))
        throw new DriveAccessError("Missing policy validator");
      // Some ACP deployments advertise their ACR using the legacy rel="acl".
      // Never PUT a WAC document to an ACP endpoint just because it echoes RDF.
      if (
        [...result.dataset].some((quad) =>
          [quad.subject, quad.predicate, quad.object, quad.graph].some(
            (term) => term.termType === "NamedNode" && term.value.startsWith(ACP_NS),
          ),
        )
      )
        throw new DriveAccessError("ACP privacy cannot be verified by this adapter");
      // Validate the known authorization model through its typed reader.
      const rules = [...new AclResource(result.dataset, DataFactory).authorizations];
      if (!rules.length) throw new DriveAccessError("WAC model could not be identified");
      for (const rule of rules) {
        const typed = new WritableAuthorization(rule as Term, result.dataset, DataFactory);
        for (const predicate of [
          "accessTo",
          "default",
          "defaultForNew",
          "agent",
          "agentClass",
          "agentGroup",
          "mode",
          "origin",
        ])
          typed.values(`${ACL}${predicate}`);
      }
      return { status: "known", policy: { url, dataset: result.dataset, etag: result.etag } };
    } catch (error) {
      if (error instanceof RdfFetchError && error.status === 404)
        return { status: "none", demo: false };
      return { status: "unknown", cause: error };
    }
  };
  const store = async (
    url: string,
    dataset: Store,
    resource?: string,
    guard?: AccessWriteGuard,
  ): Promise<OwnAccess> => {
    const state = await read(url);
    if (state.status === "unknown") throw new DriveAccessError(state.cause);
    const current = state.status === "known" ? state.policy : undefined;
    const expected = guard?.expectedAcl;
    if (current && expected !== undefined && current.etag !== expected?.etag)
      throw new DriveAccessChangedError(["The item's own ACL changed"]);
    if (!current && expected) throw new DriveAccessChangedError(["The item's own ACL was removed"]);
    let effectivePolicy = current;
    if (!current) {
      if (!resource) throw new DriveAccessError("WAC model could not be identified");
      effectivePolicy = requireAccess(await effective(resource, !!guard?.knownAcl), resource);
    }
    if (guard?.restrict)
      dataset = intersectAccess(dataset, effectivePolicy as OwnAccess, guard.identity.url);
    const body = await serialize([...dataset]);
    const response = await commitHttp({
      http,
      url,
      resourceGuards: guard ? [guard.identity] : [],
      policyGuards: guard?.policyGuards ?? [],
      error: (status) => new DriveAccessError(status),
      init: {
        method: "PUT",
        headers: {
          "content-type": "text/turtle",
          ...(current ? { "if-match": expected?.etag ?? current.etag } : { "if-none-match": "*" }),
        },
        body,
      },
      response: async (response) => response,
    });
    if (!response.ok) throw new DriveAccessError(response.status);
    rejectAcp(response.headers);
    const receipt = response.headers.get("etag");
    if (!receipt || receipt.startsWith("W/"))
      throw new DriveAccessError("Missing policy PUT validator");
    const saved = await read(url);
    if (
      saved.status !== "known" ||
      saved.policy.etag !== receipt ||
      !sameGraph(dataset, saved.policy.dataset)
    )
      throw new DriveAccessError("Policy verification failed");
    return saved.policy;
  };
  const snapshot = async (resource: string, headers: Headers): Promise<AccessState> => {
    try {
      rejectAcp(headers);
      if (headers.get("x-solid-demo-access-control") === "none")
        return { status: "none", demo: true };
      const url = discover(resource, headers);
      if (!url) return { status: "unknown", cause: "ACL Link unavailable" };
      const state = await read(url);
      return { ...state, own: { url, policy: state.status === "known" ? state.policy : null } };
    } catch (cause) {
      return { status: "unknown", cause };
    }
  };
  const effective = async (
    resource: string,
    inherit = false,
    allowAbsent = false,
  ): Promise<AccessState> => {
    try {
      let current: string | undefined = inherit ? parent(resource) : resource;
      let endpoint: AccessState["own"];
      while (current?.startsWith(storageUrl)) {
        const response = await http(current, { method: "HEAD", cache: "no-store" });
        if (!response.ok && !(allowAbsent && response.status === 404))
          throw new DriveAccessError(response.status);
        if (
          response.status === 404 &&
          response.headers.get("x-solid-demo-access-control") !== "none" &&
          !discover(current, response.headers)
        ) {
          current = parent(current);
          inherit = true;
          continue;
        }
        const own = await snapshot(current, response.headers);
        if (current === resource) endpoint = own.own;
        if (own.status === "unknown" || (own.status === "none" && own.demo)) return own;
        if (own.status === "known") {
          const policy = projectAccess(own.policy, current, resource, inherit);
          if (!inherit || policy.dataset.size)
            return { status: "known", policy, ...(endpoint ? { own: endpoint } : {}) };
        }
        current = parent(current);
        inherit = true;
      }
      // Skipped discovery or an exhausted walk never proves a governing deny-all policy.
      return { status: "unknown", cause: "Governing ACL unavailable" };
    } catch (cause) {
      return { status: "unknown", cause };
    }
  };
  return {
    discover,
    async checkOwn(
      own: { readonly url: string; readonly policy: OwnAccess | null } | undefined,
    ): Promise<void> {
      if (!own) return;
      const state = await read(own.url);
      if (state.status === "unknown") throw new DriveAccessError(state.cause);
      if ((state.status === "known" ? state.policy.etag : undefined) !== own.policy?.etag)
        throw new DriveAccessChangedError(["The item's own ACL changed"]);
    },
    effective,
    forResource: (own: OwnAccess, resource: string): OwnAccess =>
      projectAccess(own, resource, resource, false),
    materialize: materializeAccess,
    retarget: retargetAccess,
    defaults: (own: OwnAccess, resource: string): OwnAccess =>
      projectAccess(own, resource, resource, true),
    hasDefaults: (own: OwnAccess, resource: string): boolean =>
      projectAccess(own, resource, resource, true).dataset.size > 0,
    read,
    store,
    snapshot,
    async install(
      source: OwnAccess,
      from: string,
      to: string,
      guard?: AccessWriteGuard,
    ): Promise<OwnAccess> {
      const response = await http(to, { method: "HEAD", cache: "no-store" });
      if (!response.ok) throw new DriveAccessError(response.status);
      const url = discover(to, response.headers) ?? guard?.knownAcl;
      if (!url) throw new DriveAccessError("Destination has no ACL support");
      const etag = guard?.identity.etag ?? response.headers.get("etag");
      if (!etag || etag.startsWith("W/")) throw new DriveAccessError("Missing resource validator");
      return store(url, retargetAccess(source, from, to, url).dataset, to, {
        expectedAcl: source.url === url && source.etag ? source : null,
        ...guard,
        knownAcl: url,
        identity: { url: to, etag },
      });
    },
    async privateFolder(url: string, webId?: string): Promise<void> {
      try {
        const response = await http(url, { method: "HEAD", cache: "no-store" });
        if (!response.ok) throw new DriveAccessError(response.status);
        rejectAcp(response.headers);
        if (response.headers.get("x-solid-demo-access-control") === "none") return;
        const acl = discover(url, response.headers);
        const etag = response.headers.get("etag");
        if (!acl || !webId || !etag || etag.startsWith("W/")) throw new DriveAccessError();
        await store(acl, privateAcl(url, webId), url, { identity: { url, etag } });
      } catch (error) {
        throw new DriveAccessError(error);
      }
    },
  };
}

/** A conservative intersection: retain only clauses covered by the current policy.
 * Uncertain origin/group relationships drop a grant instead of widening recovery.
 */
function intersectAccess(desired: Store, current: OwnAccess, resource: string): Store {
  const result = new Store();
  const deny = new WritableAuthorization(DataFactory.blankNode(), result, DataFactory);
  deny.type.add(`${ACL}Authorization`);
  deny.accessTo = resource;
  for (const authorization of new AclResource(desired, DataFactory).authorizations) {
    const rule = new WritableAuthorization(authorization as Term, desired, DataFactory);
    for (const target of ["accessTo", "default"] as const) {
      const targets = [
        ...rule.values(`${ACL}${target}`),
        ...(target === "default" ? rule.values(`${ACL}defaultForNew`) : []),
      ];
      if (!targets.includes(resource)) continue;
      const ceiling = projectAccess(current, resource, resource, target === "default");
      for (const selector of SELECTORS) {
        for (const agent of rule.values(`${ACL}${selector}`)) {
          for (const mode of rule.values(`${ACL}mode`)) {
            const candidate = new Store();
            const grant = new WritableAuthorization(
              DataFactory.blankNode(),
              candidate,
              DataFactory,
            );
            grant.type.add(`${ACL}Authorization`);
            grant.accessTo = resource;
            grant.values(`${ACL}${selector}`).add(agent);
            grant.values(`${ACL}mode`).add(mode);
            for (const origin of rule.values(`${ACL}origin`))
              grant.values(`${ACL}origin`).add(origin);
            if (accessGains(ceiling, { url: current.url, etag: "", dataset: candidate }).length)
              continue;
            // Compare resource and default grants independently: a public listing
            // must never imply public access to previously private descendants.
            grant.accessTo = undefined;
            grant.values(`${ACL}${target}`).add(resource);
            result.addQuads([...candidate]);
          }
        }
      }
    }
  }
  return result;
}

export class DriveAccessChangedError extends DriveAccessError {
  constructor(readonly gains: readonly string[]) {
    super(
      "Bound access changed",
      "The item's access policy changed during this operation. Refresh its sharing before retrying.",
    );
  }
}

/** A policy decision is bound to BOTH endpoints, never to a previously discovered ACL URL.
 * Every check starts discovery again, including own ACLs installed since preflight.
 * Only an explicitly selected, verified policy installation may change the destination baseline.
 */
export async function bindAccess(
  access: ReturnType<typeof accessControl>,
  from: string,
  to: string,
  destinationOnly = false,
) {
  const resolve = async (url: string) => {
    const state = await access.effective(url, false, true);
    return {
      resource: requireAccess(state, url),
      own: state.own,
      defaults: url.endsWith("/")
        ? requireAccess(await access.effective(`${url}.access-binding`, true, true), url)
        : undefined,
    };
  };
  let source = await resolve(from);
  let destination = from === to ? source : await resolve(to);
  let destinationOwn = destination.own;
  const retired = new Set<string>();
  const binding = {
    get identities(): readonly PolicyIdentity[] {
      return (
        [
          [from, source],
          [to, destination],
        ] as const
      ).flatMap(([resource, baseline]) => {
        if (retired.has(resource)) return [];
        return [
          ...ownAccessGuards(baseline.own),
          ...[baseline.resource, baseline.defaults].flatMap((policy) =>
            policy?.etag ? [{ url: policy.url, etag: policy.etag }] : [],
          ),
        ];
      });
    },
    get destinationOwn() {
      return destinationOwn;
    },
    source: source.resource,
    destination: destination.resource,
    retire: (url: string): void => {
      retired.add(url);
    },
    /** Re-resolve before removing our unchecked write, even if verification fails.
     * The caller must supply a conditional rollback of its captured PUT identity;
     * an access failure must not strand confidential bytes in a widened copy.
     */
    async rollback<T>(work: () => Promise<T>): Promise<T> {
      await binding.recheck().catch(() => undefined);
      return work();
    },
    installed(policy: OwnAccess, inherited = false) {
      if (!inherited) destinationOwn = { url: policy.url, policy };
      const defaults = access.defaults(policy, to);
      destination = {
        own: destinationOwn,
        resource: access.forResource(policy, to),
        defaults: to.endsWith("/") && defaults.dataset.size ? defaults : destination.defaults,
      };
      if (from === to) source = destination;
    },
    async recheck(): Promise<void> {
      const currentSource = retired.has(from) ? undefined : await resolve(from);
      const currentDestination = retired.has(to) ? undefined : await resolve(to);
      const gains = new Set<string>();
      let changed = false;
      for (const [before, current, isSource] of [
        [source, currentSource, !destinationOnly],
        [destination, currentDestination, false],
      ] as const) {
        if (!current) continue;
        if (before.own?.policy?.etag !== current.own?.policy?.etag) changed = true;
        for (const key of ["resource", "defaults"] as const) {
          const previous = before[key];
          const next = current[key];
          if (!previous || !next) continue;
          const wider = accessGains(previous, next);
          const narrower = accessGains(next, previous);
          if (previous.url !== next.url || wider.length || narrower.length) changed = true;
          for (const agent of wider) gains.add(agent);
          if (isSource) for (const agent of narrower) gains.add(agent);
          // Narrowing the source can make a previously safe destination wider.
          if (isSource && narrower.length && currentDestination)
            for (const agent of accessGains(next, currentDestination.resource)) gains.add(agent);
        }
      }
      if (changed) throw new DriveAccessChangedError([...gains]);
    },
  };
  return binding;
}

export type AccessBinding = Awaited<ReturnType<typeof bindAccess>>;

function parent(resource: string): string | undefined {
  if (new URL(resource).pathname === "/") return undefined;
  return new URL(resource.endsWith("/") ? ".." : ".", resource).href;
}

const SELECTORS = ["agent", "agentClass", "agentGroup"] as const;
/** Materialize only the effective grants, through typed ACL readers/writers. */
function projectAccess(
  own: OwnAccess,
  governed: string,
  resource: string,
  inherited: boolean,
): OwnAccess {
  const dataset = new Store();
  for (const authorization of new AclResource(own.dataset, DataFactory).authorizations) {
    const rule = new WritableAuthorization(authorization as Term, own.dataset, DataFactory);
    const targets = inherited
      ? [...rule.values(`${ACL}default`), ...rule.values(`${ACL}defaultForNew`)]
      : [...rule.values(`${ACL}accessTo`)];
    if (!targets.includes(governed)) continue;
    const target = new WritableAuthorization(DataFactory.blankNode(), dataset, DataFactory);
    target.type.add(`${ACL}Authorization`);
    target.accessTo = resource;
    if (resource.endsWith("/")) target.default = resource;
    for (const predicate of [...SELECTORS, "origin", "mode"])
      for (const value of rule.values(`${ACL}${predicate}`))
        target.values(`${ACL}${predicate}`).add(value);
  }
  return { ...own, dataset };
}

/** Install only grants applicable at the source; unrelated targets must never activate. */
function materializeAccess(own: OwnAccess, resource: string): OwnAccess {
  const dataset = new Store();
  for (const authorization of new AclResource(own.dataset, DataFactory).authorizations) {
    const rule = new WritableAuthorization(authorization as Term, own.dataset, DataFactory);
    const targets = [
      "accessTo",
      ...(resource.endsWith("/") ? ["default", "defaultForNew"] : []),
    ].filter((predicate) => rule.values(`${ACL}${predicate}`).has(resource));
    if (!targets.length) continue;
    // Rule names are local implementation details, not principals. Fresh subjects
    // make transplantation injective even if another rule already uses the name
    // a source subject would acquire at the destination.
    const target = new WritableAuthorization(DataFactory.blankNode(), dataset, DataFactory);
    target.type.add(`${ACL}Authorization`);
    for (const predicate of targets) target.values(`${ACL}${predicate}`).add(resource);
    for (const predicate of [...SELECTORS, "origin", "mode"])
      for (const value of rule.values(`${ACL}${predicate}`))
        target.values(`${ACL}${predicate}`).add(value);
  }
  return { ...own, dataset };
}

/** Rebase ACL targets with distinct rule identities, preserving principals and conditions. */
function retargetAccess(source: OwnAccess, from: string, to: string, url = source.url): OwnAccess {
  return {
    ...source,
    url,
    dataset: relocate(
      materializeAccess(source, from).dataset,
      [
        [source.url, url],
        [from, to],
      ],
      new Set([`${ACL}accessTo`, `${ACL}default`, `${ACL}defaultForNew`]),
    ),
  };
}

export type AccessChoice = "move" | "keep" | "cancel";
export interface AccessChange {
  readonly from: string;
  readonly to: string;
  readonly gains: readonly string[];
  readonly canKeep: boolean;
}
export type ConfirmAccess = (change: AccessChange) => Promise<AccessChoice>;

const PUBLIC = "http://xmlns.com/foaf/0.1/Agent";
const AUTHENTICATED = `${ACL}AuthenticatedAgent`;
/** Conservative clause comparison: uncertain group/class/origin relationships prompt. */
export function accessGains(source: OwnAccess, destination: OwnAccess): string[] {
  const clauses = (policy: OwnAccess) =>
    [...new AclResource(policy.dataset, DataFactory).authorizations].flatMap((authorization) => {
      const rule = new WritableAuthorization(authorization as Term, policy.dataset, DataFactory);
      const origins = [...rule.values(`${ACL}origin`)];
      const modes = [...rule.values(`${ACL}mode`)];
      if (modes.includes(`${ACL}Write`)) modes.push(`${ACL}Append`);
      return SELECTORS.flatMap((predicate) =>
        [...rule.values(`${ACL}${predicate}`)].map((agent) => ({
          predicate,
          agent,
          origins,
          modes,
        })),
      );
    });
  const before = clauses(source);
  const gains = new Set<string>();
  for (const grant of clauses(destination)) {
    if (!grant.modes.length) continue;
    const covered = grant.modes.every((mode) =>
      before.some(
        (existing) =>
          existing.modes.includes(mode) &&
          (!existing.origins.length ||
            (grant.origins.length > 0 &&
              grant.origins.every((origin) => existing.origins.includes(origin)))) &&
          ((existing.predicate === grant.predicate && existing.agent === grant.agent) ||
            (existing.predicate === "agentClass" &&
              (existing.agent === PUBLIC ||
                (existing.agent === AUTHENTICATED && grant.predicate === "agent")))),
      ),
    );
    if (covered) continue;
    const name =
      grant.agent === PUBLIC
        ? "Everyone (public)"
        : grant.agent === AUTHENTICATED
          ? "Authenticated agents"
          : grant.predicate === "agentGroup"
            ? `Group ${grant.agent}`
            : grant.agent;
    gains.add(grant.origins.length ? `${name} from ${grant.origins.join(", ")}` : name);
  }
  return [...gains];
}
