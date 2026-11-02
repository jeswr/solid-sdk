// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Store } from "n3";
import { DataFactory } from "n3";
import { ACL, ACP, RDF, safeIri } from "../rdf.js";
import type { EffectivePolicy } from "../types.js";
import { roleError } from "./errors.js";
import { readPolicy } from "./rdf.js";
import type { RolesOptions } from "./types.js";

export interface Document {
  url: string;
  resource: string;
  model: "wac" | "acp";
  dataset: Store;
  policy: EffectivePolicy;
  etag: string | null;
}
export interface Snapshot {
  resource: string;
  ownUrl: string;
  own: Document | undefined;
  model: "wac" | "acp";
  documents: Document[];
}
/**
 * Refuses (`scope`) a URL outside `root` or not in canonical form. `query` admits a query string,
 * which only read-only model detection allows on an access document (ESS addresses its ACRs as
 * `?ext=acr`); every path that writes keeps refusing it.
 */
export function scoped(url: string, root: string, query = false): string {
  safeIri(url);
  const parsed = new URL(url);
  const base = new URL(root);
  if (
    !/^https?:$/.test(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    (parsed.search && !query) ||
    parsed.hash ||
    /%(?:2f|5c|2e|25|00)/i.test(parsed.pathname) ||
    parsed.href !== url ||
    parsed.origin !== base.origin ||
    !base.pathname.endsWith("/") ||
    !parsed.pathname.startsWith(base.pathname)
  )
    throw roleError("scope", url, "Access URL is outside the selected root or is not canonical");
  return url;
}
function links(headers: Headers, base: string, rel: string): string[] {
  const result: string[] = [];
  for (const part of (headers.get("link") ?? "").split(/,(?=\s*<)/)) {
    const target = /^\s*<([^<>]*)>/.exec(part)?.[1];
    if (target === undefined) continue;
    const params = new Map<string, string>();
    for (const match of part.matchAll(/;\s*([\w-]+)\s*=\s*(?:"([^"]*)"|([^;,\s]+))/g))
      params.set((match[1] as string).toLowerCase(), match[2] ?? (match[3] as string));
    if (params.has("anchor"))
      throw roleError("invalid-response", base, "Anchored access links are ambiguous");
    if ((params.get("rel") ?? "").split(/\s+/).includes(rel))
      result.push(new URL(target, base).href);
  }
  return [...new Set(result)];
}
export async function request(
  url: string,
  options: Pick<RolesOptions, "fetch">,
  init: RequestInit,
): Promise<Response> {
  const response = await options.fetch(url, { ...init, redirect: "error", cache: "no-store" });
  if (response.redirected || (response.url && response.url !== url))
    throw roleError("scope", url, "Access fetch redirected");
  return response;
}
export function requireOk(response: Response, url: string): void {
  if (response.status === 412) throw roleError("conflict", url, "Access document changed (412)");
  if (!response.ok)
    throw roleError("invalid-response", url, `Access request failed (${response.status})`);
}
async function boundedBody(response: Response, url: string): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1_048_576) {
        await reader.cancel();
        throw roleError("invalid-response", url, "Access document exceeds 1 MiB");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
const mismatches = new WeakMap<object, "wac" | "acp">();
/** The model a resource really uses when `load` refused it for differing from a pinned model. */
export function mismatchedModel(error: unknown): "wac" | "acp" | undefined {
  // WeakMap lookups of non-objects are simply misses.
  return mismatches.get(error as object);
}
/**
 * Own ACL or nearest WAC ancestor; ACP collects member controls through the root. With a pinned
 * `options.model`, a resource that uses the other model is refused (`unsupported`), so nothing
 * planned from this snapshot can write that model's documents.
 */
export async function load(resource: string, options: RolesOptions): Promise<Snapshot> {
  const snapshot = await discover(resource, options, false);
  if (options.model !== undefined && snapshot.model !== options.model) {
    const error = roleError(
      "unsupported",
      resource,
      `Resource uses the ${snapshot.model} access model, not the required ${options.model} model`,
    );
    mismatches.set(error, snapshot.model);
    throw error;
  }
  return snapshot;
}
/**
 * Read-only model detection through the same discovery walk as `load`. It builds no policies (so
 * a policy this layer cannot map still reports its model) and admits a query on an access
 * document's URL, as ESS uses for its ACRs. Refuses `unsupported` when the resource advertises no
 * access document; every other failure is thrown.
 */
export async function detectModel(
  resource: string,
  options: Pick<RolesOptions, "fetch" | "root">,
): Promise<Pick<Snapshot, "model" | "ownUrl">> {
  const { model, ownUrl } = await discover(resource, options, true);
  return { model, ownUrl };
}
async function discover(
  resource: string,
  options: Pick<RolesOptions, "fetch" | "root" | "implementation">,
  detecting: boolean,
): Promise<Snapshot> {
  const root = options.root ?? `${new URL(resource).origin}/`;
  scoped(root, root);
  scoped(resource, root);
  const documents: Document[] = [];
  let ownUrl = "";
  let own: Document | undefined;
  let model: "wac" | "acp" | undefined;
  let current = resource;
  for (let depth = 0; ; depth++) {
    if (depth === 64)
      throw roleError("invalid-response", resource, "Ancestor walk exceeds 64 documents");
    const head = await request(current, options, { method: "HEAD" });
    requireOk(head, current);
    const endpoints = [
      ...new Set([
        ...links(head.headers, current, "acl"),
        ...links(head.headers, current, `${ACP}accessControl`),
      ]),
    ];
    if (endpoints.length > 1)
      throw roleError("invalid-response", current, "Multiple access endpoints");
    const endpoint = endpoints[0];
    if (current === resource && endpoint === undefined)
      throw roleError("unsupported", resource, "Resource advertises no access document");
    if (endpoint !== undefined) {
      scoped(endpoint, root, detecting);
      const response = await request(endpoint, options, {
        headers: { accept: "text/turtle, application/ld+json;q=0.9" },
      });
      const exists = response.status !== 404;
      if (exists) {
        requireOk(response, endpoint);
        if (response.status !== 200)
          throw roleError(
            "invalid-response",
            endpoint,
            "A complete access representation is required",
          );
      }
      const dataset = await parseRdf(
        exists ? await boundedBody(response, endpoint) : "",
        exists ? response.headers.get("content-type") : null,
        { baseIRI: endpoint },
      );
      if (dataset.size > 10_000)
        throw roleError("invalid-response", endpoint, "Access document exceeds 10000 quads");
      for (const q of dataset)
        for (const term of [q.subject, q.predicate, q.object, q.graph])
          if (term.termType === "NamedNode") safeIri(term.value);
      const acp =
        [...dataset].some(
          (q) =>
            q.predicate.value.startsWith(ACP) ||
            (q.object.termType === "NamedNode" && q.object.value.startsWith(ACP)),
        ) ||
        links(head.headers, current, "type").includes(`${ACP}AccessControlResource`) ||
        links(response.headers, endpoint, "type").includes(`${ACP}AccessControlResource`) ||
        links(head.headers, current, `${ACP}accessControl`).length > 0 ||
        (!exists && endpoint.endsWith(".acr"));
      const wac =
        dataset.match(
          null,
          DataFactory.namedNode(`${RDF}type`),
          DataFactory.namedNode(`${ACL}Authorization`),
        ).size > 0;
      if (acp && wac)
        throw roleError("invalid-response", endpoint, "Mixed access-control vocabularies");
      const detected = acp ? "acp" : "wac";
      if (model && exists && detected !== model)
        throw roleError("invalid-response", endpoint, "Mixed ancestor access models");
      model ??= detected;
      if (current === resource) ownUrl = endpoint;
      if (exists && !detecting) {
        const document: Document = {
          url: endpoint,
          resource: current,
          model,
          dataset,
          policy: readPolicy(
            dataset,
            current,
            endpoint,
            model,
            options.implementation ?? "css",
            resource,
          ),
          etag: response.headers.get("etag"),
        };
        documents.push(document);
        if (current === resource) own = document;
      }
      if (exists && model === "wac") break;
    }
    if (current === root) break;
    current = scoped(new URL(current.endsWith("/") ? ".." : ".", current).href, root);
  }
  return { resource, ownUrl, own, model: model as "wac" | "acp", documents };
}
