// AUTHORED-BY Codex

import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { safeHttpIri, serialize } from "@jeswr/rdf-serialize";
import type { Term } from "@rdfjs/types";
import { DatasetWrapper, NamedNodeAs, NamedNodeFrom, SetFrom } from "@rdfjs/wrapper";
import { AccessControlResource, AclResource, Authorization } from "@solid/object";
import { DataFactory, Store } from "n3";
import { readSharing } from "../sharing/sharing";
import { relocate, sameGraph } from "./rdf";

const ACL = "http://www.w3.org/ns/auth/acl#";
const ACP_NS = "http://www.w3.org/ns/solid/acp#";
const ACP = `${ACP_NS}accessControl`;
export class DriveAccessError extends Error {
  readonly kind = "private-access-unavailable";
  constructor(override readonly cause?: unknown) {
    super(
      "Private access could not be established or verified. Drive can't confirm who can access the item and stopped the transfer. You can choose Delete forever instead.",
    );
  }
}
class WritableAuthorization extends Authorization {
  values(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
}
class PolicyDocument extends DatasetWrapper {
  get isAcp(): boolean {
    return (
      [
        ...this.instancesOf(`${ACP_NS}AccessControlResource`, AccessControlResource),
        ...this.subjectsOf(`${ACP_NS}accessControl`, AccessControlResource),
        ...this.subjectsOf(`${ACP_NS}memberAccessControl`, AccessControlResource),
      ].length > 0
    );
  }
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
export interface OwnAccess {
  url: string;
  dataset: Store;
  etag: string;
}

/** None means a discovered own ACL's 404 (inheritance unresolved), or an explicit demo pod. */
export type AccessState =
  | { readonly status: "known"; readonly policy: OwnAccess }
  | { readonly status: "none"; readonly demo: boolean }
  | { readonly status: "unknown"; readonly cause: unknown };

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
    // This explicit fixture capability never substitutes for discovery on a real pod.
    if (headers.get("x-solid-demo-access-control") === "none") return undefined;
    const links = headers.get("link") ?? "";
    let acl: string | undefined;
    for (const match of links.matchAll(/<([^>]*)>\s*((?:;\s*[^,]*)*)/g)) {
      const params = match[2] as string;
      if (/;\s*anchor\s*=/i.test(params)) continue;
      const rel = /;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(params);
      const relations = (rel?.[1] ?? rel?.[2] ?? "").split(/\s+/);
      if (relations.includes(ACP))
        throw new DriveAccessError("ACP privacy cannot be verified by this adapter");
      if (relations.includes("acl"))
        acl = assertWithinPodScope(storageUrl, new URL(match[1] as string, resource).href);
    }
    return acl;
  }
  const read = async (url: string): Promise<AccessState> => {
    try {
      const result = await fetchRdf(url, { fetch: http });
      if (!result.etag || result.etag.startsWith("W/"))
        throw new DriveAccessError("Missing policy validator");
      // Some ACP deployments advertise their ACR using the legacy rel="acl".
      // Never PUT a WAC document to an ACP endpoint just because it echoes RDF.
      if (new PolicyDocument(result.dataset, DataFactory).isAcp)
        throw new DriveAccessError("ACP privacy cannot be verified by this adapter");
      // Validate the known authorization model through its typed reader.
      for (const rule of new AclResource(result.dataset, DataFactory).authorizations) {
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
  const store = async (url: string, dataset: Store): Promise<OwnAccess> => {
    const state = await read(url);
    if (state.status === "unknown") throw new DriveAccessError(state.cause);
    const current = state.status === "known" ? state.policy : undefined;
    const response = await http(url, {
      method: "PUT",
      headers: {
        "content-type": "text/turtle",
        ...(current ? { "if-match": current.etag } : { "if-none-match": "*" }),
      },
      body: await serialize([...dataset]),
    });
    if (!response.ok) throw new DriveAccessError(response.status);
    const saved = await read(url);
    if (saved.status !== "known" || !sameGraph(dataset, saved.policy.dataset))
      throw new DriveAccessError("Policy verification failed");
    return saved.policy;
  };
  const snapshot = async (resource: string, headers: Headers): Promise<AccessState> => {
    try {
      if (headers.get("x-solid-demo-access-control") === "none")
        return { status: "none", demo: true };
      const url = discover(resource, headers);
      return url ? await read(url) : { status: "unknown", cause: "ACL Link unavailable" };
    } catch (cause) {
      return { status: "unknown", cause };
    }
  };
  const effective = async (resource: string, inherit = false): Promise<AccessState> => {
    try {
      let current: string | undefined = inherit ? parent(resource) : resource;
      while (current?.startsWith(storageUrl)) {
        const response = await http(current, { method: "HEAD" });
        if (!response.ok) throw new DriveAccessError(response.status);
        const own = await snapshot(current, response.headers);
        if (own.status === "unknown" || (own.status === "none" && own.demo)) return own;
        if (own.status === "known") {
          const policy = projectAccess(own.policy, current, resource, inherit);
          if (!inherit || policy.dataset.size) return { status: "known", policy };
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
    effective,
    forResource: (own: OwnAccess, resource: string): OwnAccess =>
      projectAccess(own, resource, resource, false),
    hasDefaults: (own: OwnAccess, resource: string): boolean =>
      projectAccess(own, resource, resource, true).dataset.size > 0,
    read,
    store,
    snapshot,
    async install(source: OwnAccess, from: string, to: string): Promise<OwnAccess> {
      const response = await http(to, { method: "HEAD" });
      const url = discover(to, response.headers);
      if (!url) throw new DriveAccessError("Destination has no ACL support");
      return store(
        url,
        relocate(source.dataset, [
          [source.url, url],
          [from, to],
        ]),
      );
    },
    async privateFolder(url: string, webId?: string): Promise<void> {
      try {
        const response = await http(url, { method: "HEAD" });
        if (!response.ok) throw new DriveAccessError(response.status);
        if (response.headers.get("x-solid-demo-access-control") === "none") return;
        const acl = discover(url, response.headers);
        if (!acl || !webId) throw new DriveAccessError();
        await store(acl, privateAcl(url, webId));
      } catch (error) {
        throw new DriveAccessError(error);
      }
    },
  };
}

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
