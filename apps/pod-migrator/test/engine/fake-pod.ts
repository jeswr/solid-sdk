// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import {
  AccessControlResource,
  AclResource,
  Container,
  Group,
  type Matcher,
  Policy,
} from "@solid/object";
import { DataFactory, Store } from "n3";
import { createPodHttp } from "../../src/engine/pod-http.js";
import { ACL, ACP, FOAF, modeIri, RDF, RdfNode, serialize } from "../../src/engine/rdf.js";
import type { AccessSystem, Mode, PodSide } from "../../src/engine/types.js";
export interface Stored {
  bytes: Uint8Array;
  type: string;
  etag: string;
}
export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  init: RequestInit;
}
export interface Identity {
  agent?: string;
  client?: string;
  issuer?: string;
  origin?: string;
  groups?: string[];
  vc?: string[];
}
/** Independent server evaluation: deliberately does not call the engine's readers/prover. */
export class FakePod {
  readonly data = new Map<string, Stored>();
  readonly requests: RecordedRequest[] = [];
  readonly access = new Map<string, Stored>();
  readonly aclOverrides = new Map<string, string>();
  readonly denied = new Map<string, number>();
  readonly responses = new Map<string, () => Response>();
  readonly root: string;
  readonly owner: string;
  readonly system: "wac" | "acp";
  readonly implementation: "css" | "ess" | "nss";
  /** Offline routing for a destination ACL referencing a source-pod group. */
  groupSource?: FakePod;
  afterWrite?: (url: string) => void | Promise<void>;
  /** CSS PutOperationHandler returns 201/205 without representation ETags. */
  writeEtags = true;
  next = 0;
  constructor(
    root: string,
    system: "wac" | "acp",
    owner = `${root}profile/card#me`,
    implementation: "css" | "ess" | "nss" = "css",
  ) {
    this.root = root;
    this.system = system;
    this.owner = owner;
    this.implementation = implementation;
  }
  acl(url: string): string {
    return this.aclOverrides.get(url) ?? url + (this.system === "wac" ? ".acl" : ".acr");
  }
  store(url: string, body: string | Uint8Array, type = "text/plain"): void {
    this.data.set(url, {
      bytes: typeof body === "string" ? new TextEncoder().encode(body) : body,
      type,
      etag: `"v${++this.next}"`,
    });
  }
  setAcl(url: string, turtle: string): void {
    this.access.set(this.acl(url), {
      bytes: new TextEncoder().encode(turtle),
      type: "text/turtle",
      etag: `"v${++this.next}"`,
    });
  }
  async initialize(turtle: string): Promise<this> {
    this.store(this.root, "", "text/turtle");
    this.setAcl(this.root, turtle);
    return this;
  }
  side(): PodSide {
    return {
      root: this.root,
      ownerWebId: this.owner,
      http: createPodHttp({ root: this.root, fetch: this.fetch }),
      publicHttp: createPodHttp({ root: this.root, fetch: this.publicFetch }),
      implementation: this.implementation,
    };
  }
  async dataset(url: string): Promise<Store | undefined> {
    const stored = this.access.get(this.acl(url));
    return stored
      ? parseRdf(new TextDecoder().decode(stored.bytes), "text/turtle", { baseIRI: this.acl(url) })
      : undefined;
  }
  ancestors(url: string): string[] {
    const result = [url];
    let current = url;
    while (current !== this.root) {
      current = new URL(".", current.endsWith("/") ? current.slice(0, -1) : current).href;
      result.push(current);
    }
    return result;
  }
  async permissions(
    url: string,
    identity: Identity = {},
    resolving = new Set<string>(),
  ): Promise<Set<Mode>> {
    const allowed = new Set<string>();
    const denied = new Set<string>();
    for (const ancestor of this.ancestors(url)) {
      const dataset = await this.dataset(ancestor);
      if (!dataset) continue;
      if (this.system === "wac") {
        for (const auth of new AclResource(dataset, DataFactory).authorizations) {
          const node = new RdfNode(
            auth as unknown as import("@rdfjs/types").Term,
            dataset,
            DataFactory,
          );
          const scopes = node.iris(ACL + (url === ancestor ? "accessTo" : "default"));
          if (url !== ancestor && this.implementation === "nss")
            scopes.push(...node.iris(`${ACL}defaultForNew`));
          if (!scopes.includes(ancestor)) continue;
          const groupMatches = await Promise.all(
            node.iris(`${ACL}agentGroup`).map(async (group) => {
              if (!identity.agent) return false;
              const documentUrl = group.split("#")[0] as string;
              const pod = this.groupSource?.data.has(documentUrl) ? this.groupSource : this;
              if (resolving.has(documentUrl) || pod.denied.has(`GET ${documentUrl}`)) return false;
              const stored = pod.data.get(documentUrl);
              if (!stored) return false;
              // CSS dereferences vCard documents without the requester's credentials.
              const publicAccess = await pod.permissions(
                documentUrl,
                {},
                new Set([...resolving, documentUrl]),
              );
              if (!publicAccess.has("read")) return false;
              const dataset = await parseRdf(new TextDecoder().decode(stored.bytes), stored.type, {
                baseIRI: documentUrl,
              });
              return new Group(group, dataset, DataFactory).hasMember.has(identity.agent);
            }),
          );
          const matches =
            node.iris(`${ACL}agent`).includes(identity.agent ?? "") ||
            node.iris(`${ACL}agentClass`).includes(`${FOAF}Agent`) ||
            (!!identity.agent &&
              node.iris(`${ACL}agentClass`).includes(`${ACL}AuthenticatedAgent`)) ||
            groupMatches.some(Boolean);
          const origins = node.iris(`${ACL}origin`);
          if (
            matches &&
            (this.implementation === "css" ||
              !origins.length ||
              origins.includes(identity.origin ?? ""))
          )
            for (const mode of node.iris(`${ACL}mode`)) allowed.add(mode);
        }
        break; // nearest-ACL replacement, including an empty ACL
      }
      const matcherMatches = (matcher: Matcher): boolean => {
        const agents = [...matcher.agent];
        const clients = [...matcher.client];
        const issuers = [...matcher.issuer];
        const vcs = [...matcher.vc];
        return (
          (this.implementation !== "ess" || agents.length > 0) &&
          agents.length + clients.length + issuers.length + vcs.length > 0 &&
          (!agents.length ||
            agents.some(
              (agent) =>
                agent === `${ACP}PublicAgent` ||
                agent === identity.agent ||
                (!!identity.agent && agent === `${ACP}AuthenticatedAgent`) ||
                (this.implementation === "ess" &&
                  (agent === `${ACP}OwnerAgent` || agent === `${ACP}CreatorAgent`) &&
                  identity.agent === this.owner),
            )) &&
          (!clients.length ||
            clients.includes(`${ACP}PublicClient`) ||
            clients.includes(identity.client ?? "")) &&
          (!issuers.length || issuers.includes(identity.issuer ?? "")) &&
          (!vcs.length ||
            (this.implementation === "ess" && vcs.some((vc) => identity.vc?.includes(vc))))
        );
      };
      const apply = (policy: Policy, control = false) => {
        const all = [...policy.allOf];
        const any = [...policy.anyOf];
        const none = [...policy.noneOf];
        if (
          all.length + any.length > 0 &&
          all.every(matcherMatches) &&
          (!any.length || any.some(matcherMatches)) &&
          !none.some(matcherMatches)
        ) {
          const convert = (values: Iterable<string>) =>
            [...values].map((mode) =>
              this.implementation === "ess" ? mode.replace(ACP, ACL) : mode,
            );
          const grants = convert(policy.allow);
          const denials = convert(policy.deny);
          if (control) {
            if (grants.includes(`${ACL}Read`) && grants.includes(`${ACL}Write`))
              allowed.add(`${ACL}Control`);
            if (denials.includes(`${ACL}Read`) || denials.includes(`${ACL}Write`))
              denied.add(`${ACL}Control`);
          } else {
            for (const mode of grants)
              if (this.implementation !== "ess" || mode !== `${ACL}Control`) allowed.add(mode);
            for (const mode of denials) denied.add(mode);
          }
        }
      };
      for (const q of dataset.match(null, DataFactory.namedNode(`${ACP}resource`), null)) {
        const acr = new AccessControlResource(q.subject, dataset, DataFactory);
        for (const control of url === q.object.value ? acr.accessControl : acr.memberAccessControl)
          for (const policy of control.apply) apply(policy);
        if (this.implementation === "ess" && q.object.value === this.acl(url))
          for (const control of acr.accessControl)
            for (const policy of control.apply) apply(policy, true);
      }
      if (this.implementation === "ess") {
        const roots = new Set(
          [
            ...dataset.match(
              null,
              DataFactory.namedNode(`${ACP}resource`),
              DataFactory.namedNode(ancestor),
            ),
            ...dataset.match(
              null,
              DataFactory.namedNode(`${RDF}type`),
              DataFactory.namedNode(`${ACP}AccessControlResource`),
            ),
          ].map((q) => q.subject),
        );
        for (const term of roots) {
          const node = new RdfNode(term, dataset, DataFactory);
          if (!node.iris(`${ACP}resource`).length) {
            const acr = new AccessControlResource(term, dataset, DataFactory);
            for (const control of url === ancestor ? acr.accessControl : acr.memberAccessControl)
              for (const policy of control.apply) apply(policy);
          }
          for (const p of node.nodes(ACP + (url === ancestor ? "access" : "memberAccess")))
            apply(
              new Policy(p as unknown as import("@rdfjs/types").Term, dataset, DataFactory),
              true,
            );
        }
      }
    }
    for (const mode of denied) allowed.delete(mode);
    const result = new Set<Mode>();
    for (const mode of ["read", "append", "write", "control"] as const)
      if (allowed.has(modeIri(mode))) result.add(mode);
    if (result.has("write")) result.add("append");
    return result;
  }
  async request(
    url: string,
    init: RequestInit = {},
    identity: Identity = { agent: this.owner },
  ): Promise<Response> {
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    this.requests.push({ url, method, headers, init });
    const forced = this.responses.get(`${method} ${url}`);
    if (forced) return forced();
    const status = this.denied.get(`${method} ${url}`);
    if (status) return new Response(null, { status });
    const canonical =
      url.endsWith(this.system === "wac" ? ".acl" : ".acr") && this.data.has(url.slice(0, -4));
    const overridden = canonical
      ? url.slice(0, -4)
      : [...this.aclOverrides].find(([, acl]) => acl === url)?.[0];
    const auxiliary =
      overridden !== undefined || url.endsWith(this.system === "wac" ? ".acl" : ".acr");
    const resource = overridden ?? (auxiliary ? url.slice(0, -4) : url);
    const stored = auxiliary ? this.access.get(url) : this.data.get(url);
    const link = `<${this.acl(resource)}>; rel="acl"`;
    const responseHeaders = new Headers({ link, "content-type": stored?.type ?? "text/turtle" });
    if (stored) responseHeaders.set("etag", stored.etag);
    if (!stored && (method === "HEAD" || method === "GET"))
      return new Response(null, { status: 404, headers: responseHeaders });
    const permissions = await this.permissions(resource, identity);
    const needed = auxiliary ? "control" : method === "GET" || method === "HEAD" ? "read" : "write";
    if (!permissions.has(needed))
      return new Response(null, { status: identity.agent ? 403 : 401, headers: responseHeaders });
    if (method === "HEAD") {
      responseHeaders.set("content-length", String(stored?.bytes.length));
      return new Response(null, { headers: responseHeaders });
    }
    if (method === "GET") {
      if (!auxiliary && url.endsWith("/")) {
        const dataset = new Store();
        const container = new RdfNode(url, dataset, DataFactory);
        container.add(`${RDF}type`, "http://www.w3.org/ns/ldp#BasicContainer");
        for (const child of this.data.keys())
          if (child !== url && this.ancestors(child)[1] === url)
            container.add("http://www.w3.org/ns/ldp#contains", child);
        // Exercise the same real Container parser a server listing consumer uses.
        new Container(url, dataset, DataFactory);
        responseHeaders.set("content-type", "text/turtle");
        return new Response(await serialize(dataset), { headers: responseHeaders });
      }
      return new Response(stored?.bytes, { headers: responseHeaders });
    }
    if (
      (headers.get("if-none-match") === "*" && stored) ||
      (headers.has("if-match") && headers.get("if-match") !== stored?.etag)
    )
      return new Response(null, { status: 412 });
    if (method === "PUT") {
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer());
      const next: Stored = {
        bytes,
        type: headers.get("content-type") ?? "application/octet-stream",
        etag: `"v${++this.next}"`,
      };
      (auxiliary ? this.access : this.data).set(url, next);
      if (this.writeEtags) responseHeaders.set("etag", next.etag);
      else responseHeaders.delete("etag");
      await this.afterWrite?.(url);
      return new Response(null, { status: stored ? 205 : 201, headers: responseHeaders });
    }
    this.data.delete(url);
    await this.afterWrite?.(url);
    return new Response(null, { status: 204 });
  }
  readonly fetch: typeof fetch = async (input, init) => {
    if (typeof input !== "string") throw new TypeError("Fake transport requires strings");
    return this.request(input, init);
  };
  readonly publicFetch: typeof fetch = async (input, init) => {
    if (typeof input !== "string") throw new TypeError("Fake transport requires strings");
    return this.request(input, init, {});
  };
}
export function model(system: AccessSystem): "wac" | "acp" {
  if (system === "unknown") throw new TypeError("Unknown model");
  return system;
}
