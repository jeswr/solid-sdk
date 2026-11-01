// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Bounded BFS ported from apps/access-manager/src/lib/storage-walk.ts; ACL resolution
// ported from apps/access-manager/src/lib/acl.ts (readEffectiveAcl).
import { RdfFetchError, SUPPORTED_RDF_MEDIA_TYPES } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { type EffectivePolicy, readAcp, readWac } from "@jeswr/pod-access";
import type { DatasetCore, Term } from "@rdfjs/types";
import { AclResource, ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";
import { classifySubject } from "../model/classify";
import { type Classification, classificationForClass } from "../model/domains";
import { primarySubject, readResource, subjectOf } from "../model/rdf";
import type { RegisteredLocation } from "../model/type-index";
import { aggregateHoldings, classifyAgent } from "./aggregate";
import { readGrantRecords, recordsFrom } from "./records";
import type { GrantRecordIndex, PermissionsSnapshot, WalkedAccess } from "./types";
import { ACL, ACP, AccessNode, UnsupportedAccessError } from "./vocab";

/** Only HTTP Link syntax is parsed here; RDF always goes through typed readers. */
export function aclLink(headers: Headers, resource: string): string | undefined {
  for (const part of (headers.get("link") ?? "").split(/,(?=\s*<)/)) {
    const target = part.match(/^\s*<([^>]+)>/);
    const rel = part.match(/;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/i);
    if (target?.[1] && (rel?.[1] ?? rel?.[2] ?? "").split(/\s+/).includes("acl"))
      return new URL(target[1], resource).href;
  }
  return undefined;
}
export function acpHeaders(headers: Headers): boolean {
  return [...headers].some(([name, value]) => /^(acp|acr)(-|$)/i.test(name) || value.includes(ACP));
}
export function accessSystem(dataset: DatasetCore, url: string, headers: Headers): "wac" | "acp" {
  const knownWac = new Set(
    [
      "accessTo",
      "default",
      "defaultForNew",
      "mode",
      "agent",
      "agentClass",
      "agentGroup",
      "origin",
    ].map((name) => ACL + name),
  );
  if (
    [...dataset].some((q) => q.predicate.value.startsWith(ACL) && !knownWac.has(q.predicate.value))
  )
    throw new UnsupportedAccessError();
  const wac = [...new AclResource(dataset, DataFactory).authorizations].length > 0;
  const acp = [...dataset].some(
    (q) =>
      q.predicate.value.startsWith(ACP) ||
      (q.object.termType === "NamedNode" && q.object.value === `${ACP}AccessControlResource`),
  );
  if (wac && (acp || acpHeaders(headers) || new URL(url).pathname.endsWith(".acr")))
    throw new UnsupportedAccessError();
  if (acp) return "acp";
  if (wac && !acpHeaders(headers)) return "wac";
  throw new UnsupportedAccessError();
}
function parent(url: string, storage: string): string | undefined {
  return url === storage ? undefined : new URL(url.endsWith("/") ? ".." : ".", url).href;
}
class BudgetError extends Error {}
export interface LoadPermissionsOptions {
  fetch: typeof globalThis.fetch;
  storage: string;
  webId: string;
  typeIndex?: readonly RegisteredLocation[];
  signal?: AbortSignal;
  maxDepth?: number;
  maxRequests?: number;
}
function failureReason(error: unknown): PermissionsSnapshot["failures"][number]["reason"] {
  if (error instanceof UnsupportedAccessError) return "unsupported";
  if (error instanceof RdfFetchError) {
    if (error.status === 401 || error.status === 403) return "forbidden";
    if (error.status === 404) return "not-found";
  }
  return "unreadable";
}
export async function loadPermissions(
  options: LoadPermissionsOptions,
): Promise<PermissionsSnapshot> {
  const { storage, signal } = options;
  assertWithinPodScope(storage, storage);
  if (!storage.endsWith("/")) throw new TypeError("Storage must end with /");
  const maxDepth = options.maxDepth ?? 4;
  const maxRequests = options.maxRequests ?? 1024;
  if (
    !Number.isSafeInteger(maxDepth) ||
    maxDepth < 0 ||
    !Number.isSafeInteger(maxRequests) ||
    maxRequests < 0
  )
    throw new TypeError("Expected non-negative integer walk limits");
  let requests = 0;
  let truncated = false;
  let exhausted = false;
  const failures: PermissionsSnapshot["failures"] = [];
  const memo = new Map<string, Promise<Response>>();
  const scoped: typeof globalThis.fetch = async (input, init) => {
    signal?.throwIfAborted();
    const url = assertWithinPodScope(storage, String(input));
    const key = `${init?.method ?? "GET"} ${url}`;
    let pending = memo.get(key);
    if (!pending) {
      if (requests >= maxRequests) {
        truncated = true;
        exhausted = true;
        throw new BudgetError();
      }
      requests++;
      pending = options.fetch(url, { ...init, redirect: "error", ...(signal ? { signal } : {}) });
      memo.set(key, pending);
    }
    return (await pending).clone();
  };
  const fail = (url: string, error: unknown) => {
    signal?.throwIfAborted();
    // fetch-rdf preserves the request error as its cause.
    if (
      error instanceof BudgetError ||
      (error instanceof RdfFetchError && error.cause instanceof BudgetError)
    )
      return;
    failures.push({ url, reason: failureReason(error) });
  };
  const classes = new Map<string, Classification>();
  for (const location of options.typeIndex ?? []) {
    const url = location.container ?? location.instance;
    if (url) classes.set(url, classificationForClass(location.forClass));
  }
  const nodes: WalkedAccess[] = [];
  const aclDatasets = new Map<WalkedAccess, DatasetCore>();
  const seen = new Set<string>();
  const queue = [{ url: storage, depth: 0, isContainer: true }];
  for (const visit of queue) {
    if (exhausted) break;
    if (seen.has(visit.url)) continue;
    seen.add(visit.url);
    let headers: Headers;
    try {
      const head = await scoped(visit.url, { method: "HEAD" });
      if (!head.ok)
        throw new RdfFetchError("Resource could not be read", {
          url: visit.url,
          status: head.status,
        });
      headers = head.headers;
      const rdf = SUPPORTED_RDF_MEDIA_TYPES.some(
        (type) => type === headers.get("content-type")?.split(";")[0],
      );
      if (visit.isContainer || rdf) {
        const resource = await readResource(scoped, visit.url, signal);
        const primary = primarySubject(resource.dataset, visit.url);
        if (!classes.get(visit.url)?.dataType && primary)
          classes.set(visit.url, classifySubject(primary, options.webId));
        if (visit.isContainer) {
          const container = new ContainerDataset(resource.dataset, DataFactory).container;
          for (const member of container?.contains ?? []) {
            const url = member.id;
            if (typeof url !== "string" || /\.(?:acl|acr)\/?$/i.test(new URL(url).pathname))
              continue;
            const isContainer = url.endsWith("/") || member.isContainer;
            const primary = subjectOf(resource.dataset, url);
            if (!classes.has(url) && primary.types.length)
              classes.set(url, classifySubject(primary, options.webId));
            if (visit.depth >= maxDepth) truncated = true;
            else queue.push({ url, depth: visit.depth + 1, isContainer });
          }
        }
      }
    } catch (error) {
      fail(visit.url, error);
      continue;
    }
    let current: string | undefined = visit.url;
    let endpoint = visit.url;
    try {
      let found = false;
      while (current) {
        if (current !== visit.url) {
          const head = await scoped(current, { method: "HEAD" });
          if (!head.ok)
            throw new RdfFetchError("Parent could not be read", {
              url: current,
              status: head.status,
            });
          headers = head.headers;
        }
        endpoint = aclLink(headers, current) ?? `${current}.acl`;
        if (acpHeaders(headers) && !aclLink(headers, current)) throw new UnsupportedAccessError();
        let document: Awaited<ReturnType<typeof readResource>>;
        try {
          document = await readResource(scoped, endpoint, signal);
        } catch (error) {
          if (error instanceof RdfFetchError && error.status === 404) {
            current = parent(current, storage);
            continue;
          }
          throw error;
        }
        const system = accessSystem(document.dataset, endpoint, headers);
        const inherited = current !== visit.url;
        if (inherited && system === "acp") throw new UnsupportedAccessError();
        let policy: EffectivePolicy;
        let inactive = false;
        try {
          policy =
            system === "acp"
              ? readAcp(document.dataset, current, endpoint, undefined, false, () => {
                  inactive = true;
                })
              : readWac(document.dataset, current, endpoint);
          if (system === "wac") {
            // pod-access represents origin conditions on principals. Preserve an origin-only
            // authorization as an app holding as well, using the same typed WAC mode reader.
            for (const grant of policy.grants)
              if (!grant.who.length) {
                const authorization = [
                  ...new AclResource(document.dataset, DataFactory).authorizations,
                ].find((auth) => auth.value === grant.source.node);
                // The neutral reader's source node comes from this same authorization set.
                const auth = new AccessNode(authorization as Term, document.dataset, DataFactory);
                grant.who = auth.iris(`${ACL}origin`).map((origin) => [{ kind: "origin", origin }]);
              }
          }
        } catch {
          throw new UnsupportedAccessError();
        }
        if (inherited)
          policy = {
            ...policy,
            grants: policy.grants
              .filter((g) => g.appliesTo !== "resource")
              .map((g) => ({ ...g, appliesTo: "members" })),
          };
        if (
          inactive ||
          policy.denials.length ||
          policy.grants.some(
            (g) => g.except.length || g.who.some((clause) => clause.some((s) => !classifyAgent(s))),
          )
        )
          failures.push({ url: visit.url, reason: "unsupported" });
        const walked: WalkedAccess = {
          url: visit.url,
          isContainer: visit.isContainer,
          policy,
          system,
          inherited,
          ...(inherited ? { inheritedFrom: current } : {}),
          records: recordsFrom(document.dataset),
        };
        nodes.push(walked);
        aclDatasets.set(walked, document.dataset);
        found = true;
        break;
      }
      if (!found) failures.push({ url: endpoint, reason: "not-found" });
    } catch (error) {
      fail(endpoint, error);
    }
  }
  // First already-known child class supplies an otherwise unclassified folder's data type.
  for (const node of [...nodes].reverse()) {
    if (node.isContainer && !classes.get(node.url)?.dataType) {
      const child = [...classes].find(
        ([url, cls]) => url !== node.url && parent(url, storage) === node.url && cls.dataType,
      );
      if (child) classes.set(node.url, child[1]);
    }
  }
  let records: GrantRecordIndex | undefined;
  try {
    records = await readGrantRecords(scoped, storage);
  } catch (error) {
    fail(new URL("settings/access-records/", storage).href, error);
  }
  if (records)
    for (const [node, dataset] of aclDatasets) node.records = recordsFrom(dataset, records);
  return {
    ...aggregateHoldings(nodes, {
      webId: options.webId,
      classify: (url) => classes.get(url),
      ...(records ? { records } : {}),
    }),
    failures,
    truncated,
  };
}
