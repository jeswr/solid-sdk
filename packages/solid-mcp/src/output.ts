// AUTHORED-BY Codex GPT-6
/** The sole projection from caller-authorized PodPort data to public pod output. */
import { parseRdf } from "@jeswr/fetch-rdf";
import { isContainerUrl } from "@jeswr/guarded-fetch";
import type { Term } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { ContainerDataset } from "@solid/object";
import { DataFactory, Store } from "n3";
import { podScopedUrlOrUndefined, requirePodScopedUrl } from "./auth.js";
import { serializeBoundedTurtle } from "./bounded-rdf.js";
import { mediaType, RDF_MEDIA_TYPES, resourceTitle } from "./content.js";
import type { PodChild, SearchMatch } from "./pod.js";
import {
  isFetchPodRead,
  type PodPort,
  type PodReadOptions,
  type PodReadResult,
} from "./pod-port.js";

const LDP = "http://www.w3.org/ns/ldp#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDF_ACCEPT = "text/turtle, application/ld+json;q=0.9";

class ListedResource extends TermWrapper {
  get types() {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get contains() {
    return SetFrom.subjectPredicate(
      this,
      `${LDP}contains`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}

function documentUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
}

/**
 * One operation, one caller/purpose-bound port. Successful reads authorize output;
 * list entries and RDF references are only candidates. Never retain this object
 * on a server or recover the port's underlying transport. In particular, a later
 * request must see decorators installed after server construction.
 */
export class PodOutput {
  private readonly authorized = new Set<string>();
  private readonly decisions = new Map<string, boolean>();
  private readonly deniedNames = new Set<string>();

  constructor(private readonly pod: PodPort) {}

  async read(url: string, options?: PodReadOptions): Promise<PodReadResult> {
    const target = requirePodScopedUrl({ podRoot: this.pod.root }, url);
    const result = await this.pod.read(target, options);
    const finalUrl = requirePodScopedUrl({ podRoot: this.pod.root }, result.url ?? target);
    // A redirect/alias is a separate resource, subject to the same purpose check.
    if (!isFetchPodRead(this.pod.read) && documentUrl(finalUrl) !== documentUrl(target)) {
      const final = await this.pod.read(finalUrl, options);
      if (documentUrl(final.url ?? finalUrl) !== documentUrl(finalUrl))
        throw new Error("pod-scope violation: ambiguous resource alias");
    }
    this.authorized.add(documentUrl(target));
    this.authorized.add(documentUrl(finalUrl));
    return result;
  }

  private async allows(url: string): Promise<boolean> {
    const scoped = podScopedUrlOrUndefined({ podRoot: this.pod.root }, url);
    if (!scoped) return false;
    const doc = documentUrl(scoped);
    if (this.authorized.has(doc)) return true;
    const previous = this.decisions.get(doc);
    if (previous !== undefined) return previous;
    try {
      await this.read(doc);
      this.decisions.set(doc, true);
      return true;
    } catch {
      this.decisions.set(doc, false);
      this.deniedNames.add(resourceTitle(doc));
      return false;
    }
  }

  /** Free-text/metadata references also need a read, even outside structured URL fields. */
  async text(value: string, base: string): Promise<string> {
    // This name was derived from the already-authorized resource identifier;
    // spaces in a decoded filename do not introduce separate resource names.
    if (this.authorized.has(documentUrl(base)) && value === resourceTitle(base)) return value;
    // Tokenize once. An unanchored filename regex can rescan every suffix of a
    // large plain-text word and turn the 1 MiB input allowance into quadratic work.
    const references = value.matchAll(/[^\s<>"'\\]+/g);
    let result = "";
    let offset = 0;
    for (const match of references) {
      const token = match[0];
      const urlStart = token.search(/https?:\/\//i);
      const prefix = urlStart > 0 ? token.slice(0, urlStart) : "";
      const reference = urlStart > 0 ? token.slice(urlStart) : token;
      if (
        !/^https?:\/\//i.test(reference) &&
        !/^[\w%./-]+\.(?:ttl|trig|nq|nt|n3|jsonld|txt|json|png|jpg|pdf)$/i.test(reference)
      )
        continue;
      const absolute = new URL(reference, base).href;
      // Foreign vocabulary IRIs are data, never fetch targets. In-pod references
      // and relative resource names must pass the same authorization as a URL field.
      const scoped = podScopedUrlOrUndefined({ podRoot: this.pod.root }, absolute);
      result += value.slice(offset, match.index) + prefix;
      result += scoped && !(await this.allows(scoped)) ? "[unavailable]" : reference;
      offset = match.index + token.length;
    }
    result += value.slice(offset);
    for (const name of this.deniedNames) result = result.replaceAll(name, "[unavailable]");
    return result;
  }

  /** Project structured metadata/results without passing through backend-owned objects. */
  async value<T>(value: T, base: string): Promise<T> {
    if (typeof value === "string") return (await this.text(value, base)) as T;
    if (Array.isArray(value)) {
      const result = [];
      for (const item of value) {
        const projected = await this.value(item, base);
        if (projected !== undefined) result.push(projected);
      }
      return result as T;
    }
    if (value && typeof value === "object") {
      // A structured resource description is indivisible. Redacting its URL
      // while retaining its title, message text or other attributes still leaks.
      const identities = new Set<string>();
      for (const key of ["url", "uri", "id"]) {
        const identity = (value as Record<string, unknown>)[key];
        if (typeof identity !== "string" || !/^https?:\/\//i.test(identity)) continue;
        const scoped = podScopedUrlOrUndefined({ podRoot: this.pod.root }, identity);
        if (!scoped || !(await this.allows(scoped))) return undefined as T;
        identities.add(key);
      }
      const result: Record<string, unknown> = Object.create(null);
      for (const [key, item] of Object.entries(value)) {
        if ((await this.text(key, base)) === key) {
          // An authorized identifier stays exact. Rewriting its path would
          // invent a new resource that the port has never authorized.
          const projected = identities.has(key) ? item : await this.value(item, base);
          if (projected !== undefined) result[key] = projected;
        }
      }
      return result as T;
    }
    return value;
  }

  async children(url: string): Promise<PodChild[]> {
    const target = requirePodScopedUrl({ podRoot: this.pod.root }, url);
    if (!this.authorized.has(documentUrl(target))) await this.read(target, { accept: RDF_ACCEPT });
    const children: PodChild[] = [];
    const permitted = [];
    for (const entry of await this.pod.list(target)) {
      const scoped = podScopedUrlOrUndefined({ podRoot: this.pod.root }, entry.url);
      if (!scoped || !(await this.allows(scoped))) continue;
      permitted.push({ entry, scoped });
    }
    // Authorize every child before projecting sibling metadata, which can refer
    // to a denied sibling by name rather than by absolute resource URL.
    for (const { entry, scoped } of permitted) {
      const child: PodChild = {
        url: scoped,
        name: entry.name ?? resourceTitle(scoped),
        isContainer: entry.isContainer,
        type: entry.type ?? [],
        ...(entry.mimeType === undefined ? {} : { mimeType: entry.mimeType }),
        ...(entry.size === undefined ? {} : { size: entry.size }),
        ...(entry.modified === undefined ? {} : { modified: entry.modified }),
      };
      children.push(await this.value(child, scoped));
    }
    return children;
  }

  /** A search name, snippet and URL are one authorized resource description. */
  async match(match: SearchMatch): Promise<SearchMatch> {
    if (!(await this.allows(match.url))) throw new Error("purpose denied");
    return this.value(match, match.url);
  }

  /** Build a fresh graph; no prefix, child description, count or literal from the source survives. */
  private async container(url: string): Promise<Store> {
    const children = await this.children(url);
    const dataset = new Store();
    const container = new ListedResource(url, dataset, DataFactory);
    for (const type of ["Resource", "Container", "BasicContainer"]) container.types.add(LDP + type);
    for (const child of children) {
      container.contains.add(child.url);
      const resource = new ListedResource(child.url, dataset, DataFactory);
      resource.types.add(`${LDP}Resource`);
      if (child.isContainer) {
        resource.types.add(`${LDP}Container`);
        resource.types.add(`${LDP}BasicContainer`);
      }
    }
    return dataset;
  }

  /** Project every term, including graph names, quoted triples and literal references. */
  private async term(term: Term, base: string, discover = false): Promise<boolean> {
    let permitted = true;
    if (term.termType === "Quad") {
      for (const part of [term.subject, term.predicate, term.object, term.graph]) {
        if (!(await this.term(part, base, discover))) {
          if (!discover) return false;
          permitted = false;
        }
      }
    } else if (term.termType === "NamedNode") {
      const scoped = podScopedUrlOrUndefined({ podRoot: this.pod.root }, term.value);
      if (scoped && !(await this.allows(scoped))) return false;
    } else if (term.termType === "Literal") {
      permitted = (await this.text(term.value, base)) === term.value;
      return (await this.term(term.datatype, base, discover)) && permitted;
    }
    return permitted;
  }

  async rdf(url: string, read: PodReadResult, dataset: Store): Promise<Store> {
    const finalUrl = read.url ?? url;
    const typedContainer = new ContainerDataset(dataset, DataFactory).container;
    const membershipSubject = dataset
      .getSubjects(DataFactory.namedNode(`${LDP}contains`), null, null)
      .find((subject) => subject.termType === "NamedNode");
    // Classify by representation as well as URL: slashless, query and redirect
    // aliases must not turn a container into an unfiltered ordinary RDF read.
    if (isContainerUrl(finalUrl) || typedContainer || membershipSubject) {
      const containerUrl = typedContainer
        ? requirePodScopedUrl({ podRoot: this.pod.root }, typedContainer.id)
        : membershipSubject
          ? requirePodScopedUrl({ podRoot: this.pod.root }, membershipSubject.value)
          : finalUrl;
      if (!(await this.allows(containerUrl))) throw new Error("purpose denied");
      return this.container(containerUrl);
    }
    const filtered = new Store();
    const tainted = new Set<string>();
    // Discover every reference first so an earlier literal/label cannot escape
    // just because its resource's denied URI occurs later in the RDF document.
    for (const quad of dataset) await this.term(quad, finalUrl, true);
    for (const quad of dataset) {
      if (await this.term(quad, finalUrl)) filtered.addQuad(quad);
      else {
        for (const part of [quad.subject, quad.object, quad.graph]) {
          if (part.termType === "BlankNode") tainted.add(part.value);
        }
      }
    }
    // Blank-node descriptions belong to the rejected resource too. Remove the
    // entire connected blank-node component rather than leave orphaned values.
    let changed = true;
    while (changed && tainted.size > 0) {
      changed = false;
      for (const quad of filtered) {
        const blanks = [quad.subject, quad.object, quad.graph].filter(
          (part) => part.termType === "BlankNode",
        );
        if (!blanks.some((part) => tainted.has(part.value))) continue;
        for (const part of blanks) tainted.add(part.value);
        filtered.removeQuad(quad);
        changed = true;
      }
    }
    // N3's entity index retains removed terms; keep that stale index out of the
    // programmatic dataset result and any later JSON projection.
    return filtered.size === dataset.size ? dataset : new Store([...filtered]);
  }

  /** All byte/text resource paths use this before choosing an MCP representation. */
  async representation(url: string, read: PodReadResult): Promise<PodReadResult> {
    const contentType = mediaType(read.contentType);
    let body = read.body;
    let projectedType = read.contentType;
    let changed = false;
    if (RDF_MEDIA_TYPES.has(contentType)) {
      const dataset = await parseRdf(new TextDecoder().decode(body), contentType, {
        baseIRI: read.url ?? url,
      });
      const filtered = await this.rdf(url, read, dataset);
      changed = filtered !== dataset;
      if (changed) {
        body = new TextEncoder().encode(serializeBoundedTurtle(filtered));
        projectedType = "text/turtle";
      }
    } else if (isContainerUrl(read.url ?? url)) {
      body = new TextEncoder().encode(
        serializeBoundedTurtle(await this.container(read.url ?? url)),
      );
      projectedType = "text/turtle";
      changed = true;
    } else if (contentType === "application/json" || contentType.endsWith("+json")) {
      const original: unknown = JSON.parse(new TextDecoder().decode(body));
      const projected = await this.value(original, read.url ?? url);
      if (JSON.stringify(projected) !== JSON.stringify(original)) {
        body = new TextEncoder().encode(JSON.stringify(projected ?? null));
        changed = true;
      }
    } else {
      const text = new TextDecoder().decode(body);
      const filtered = await this.text(text, read.url ?? url);
      if (filtered !== text) {
        body = new TextEncoder().encode(filtered);
        changed = true;
      }
    }
    const etag =
      read.etag && (await this.text(read.etag, url)) === read.etag ? read.etag : undefined;
    return {
      body,
      contentType: await this.text(projectedType, url),
      ...(read.url ? { url: read.url } : {}),
      ...(!changed && etag ? { etag } : {}),
    };
  }
}

/** Public diagnostics are fixed strings: backend errors may contain rejected values. */
export function podOutputError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/purpose denied/i.test(message)) return new Error("purpose denied");
  if (/grant denied/i.test(message)) return new Error("grant denied");
  if (/pod-scope/i.test(message)) return new Error("pod-scope violation");
  if (/read-only|write disabled/i.test(message))
    return new Error("write disabled: server is read-only");
  if (/redirect/i.test(message)) return new Error("Refusing a resource redirect");
  if (/unauthenticated|forbidden|HTTP (401|403)/i.test(message))
    return new Error("unauthenticated/forbidden — supply an authenticated fetch");
  if (["offline", "unreadable", "Non-finite JSON numbers are unsupported."].includes(message))
    return new Error(message);
  return new Error("Pod operation failed");
}
