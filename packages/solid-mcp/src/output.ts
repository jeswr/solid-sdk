// AUTHORED-BY Codex GPT-6
/** The sole projection from caller-authorized PodPort data to public pod output. */
import { parseRdf } from "@jeswr/fetch-rdf";
import { isContainerUrl } from "@jeswr/guarded-fetch";
import {
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  RequiredAs,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { ContainerDataset } from "@solid/object";
import { DataFactory, Store } from "n3";
import { podScopedUrlOrUndefined, requirePodScopedUrl } from "./auth.js";
import { serializeBoundedTurtle } from "./bounded-rdf.js";
import { MAX_CONTENT_BYTES, mediaType, RDF_MEDIA_TYPES, resourceTitle } from "./content.js";
import type { PodChild, SearchMatch } from "./pod.js";
import { podReadMode, withPodReadLimits, withPodReadMode } from "./pod-operation.js";
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
  set name(value: string) {
    RequiredAs.object(this, "http://purl.org/dc/terms/title", value, LiteralFrom.string);
  }
  set size(value: number) {
    RequiredAs.object(this, "http://www.w3.org/ns/posix/stat#size", value, LiteralFrom.integer);
  }
  set modified(value: Date) {
    RequiredAs.object(this, "http://purl.org/dc/terms/modified", value, LiteralFrom.dateTime);
  }
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
 * list entries and search hits are only candidates. Never retain this object
 * on a server or recover the port's underlying transport. In particular, a later
 * request must see decorators installed after server construction.
 */
export class PodOutput {
  private readonly authorized = new Set<string>();
  private readonly decisions = new Map<string, boolean>();

  constructor(private readonly pod: PodPort) {}

  async read(url: string, options?: PodReadOptions): Promise<PodReadResult> {
    return withPodReadLimits(async () => {
      const target = requirePodScopedUrl({ podRoot: this.pod.root }, url);
      const result = await this.pod.read(target, options);
      // Portable ports bound their own backend allocations. Fetch can cap their
      // already-authorized bytes at output; projection checks require a full,
      // bounded result. Native fetch prefixes may carry one overflow byte.
      const cap = MAX_CONTENT_BYTES + (podReadMode() === "fetch" ? 1 : 0);
      if (podReadMode() !== "fetch-complete" && result.body.byteLength > cap)
        throw new Error("Resource exceeds the bounded read limit.");
      const finalUrl = requirePodScopedUrl({ podRoot: this.pod.root }, result.url ?? target);
      // A redirect/alias is a separate resource, subject to the same purpose check.
      if (!isFetchPodRead(this.pod.read) && documentUrl(finalUrl) !== documentUrl(target)) {
        const final = await this.pod.read(finalUrl, options);
        if (podReadMode() !== "fetch-complete" && final.body.byteLength > cap)
          throw new Error("Resource exceeds the bounded read limit.");
        if (documentUrl(final.url ?? finalUrl) !== documentUrl(finalUrl))
          throw new Error("pod-scope violation: ambiguous resource alias");
      }
      this.authorized.add(documentUrl(target));
      this.authorized.add(documentUrl(finalUrl));
      return result;
    });
  }

  private async allows(url: string): Promise<boolean> {
    const scoped = podScopedUrlOrUndefined({ podRoot: this.pod.root }, url);
    if (!scoped) return false;
    const doc = documentUrl(scoped);
    if (this.authorized.has(doc)) return true;
    const previous = this.decisions.get(doc);
    if (previous !== undefined) return previous;
    try {
      await withPodReadMode(isFetchPodRead(this.pod.read) ? "authorization" : "complete", () =>
        this.read(doc),
      );
      this.decisions.set(doc, true);
      return true;
    } catch {
      this.decisions.set(doc, false);
      return false;
    }
  }

  /** Explicit resource envelopes only; document contents never enter this check. */
  async resource<T extends { url: string }>(resource: T): Promise<T | undefined> {
    return withPodReadLimits(async () =>
      (await this.allows(resource.url)) ? resource : undefined,
    );
  }

  async children(url: string): Promise<PodChild[]> {
    return withPodReadLimits(async () => {
      const target = requirePodScopedUrl({ podRoot: this.pod.root }, url);
      if (!this.authorized.has(documentUrl(target)))
        await this.read(target, { accept: RDF_ACCEPT });
      const children: PodChild[] = [];
      for (const entry of await this.pod.list(target)) {
        const scoped = podScopedUrlOrUndefined({ podRoot: this.pod.root }, entry.url);
        if (!scoped || !(await this.allows(scoped))) continue;
        children.push({
          url: scoped,
          name: entry.name ?? resourceTitle(scoped),
          isContainer: entry.isContainer,
          type: entry.type ?? [],
          ...(entry.mimeType === undefined ? {} : { mimeType: entry.mimeType }),
          ...(entry.size === undefined ? {} : { size: entry.size }),
          ...(entry.modified === undefined ? {} : { modified: entry.modified }),
        });
      }
      return children;
    });
  }

  /** A search name, snippet and URL are one authorized resource description. */
  async match(match: SearchMatch): Promise<SearchMatch> {
    const permitted = await this.resource(match);
    if (!permitted) throw new Error("purpose denied");
    return permitted;
  }

  /** Rebuild membership and server-managed descriptions for authorized children only. */
  private async container(url: string): Promise<Store> {
    const children = await this.children(url);
    const dataset = new Store();
    const container = new ListedResource(url, dataset, DataFactory);
    for (const type of ["Resource", "Container", "BasicContainer"]) container.types.add(LDP + type);
    for (const child of children) {
      container.contains.add(child.url);
      const resource = new ListedResource(child.url, dataset, DataFactory);
      resource.types.add(`${LDP}Resource`);
      for (const type of child.type) resource.types.add(type);
      resource.name = child.name;
      if (child.size !== undefined) resource.size = child.size;
      if (child.modified !== undefined) resource.modified = new Date(child.modified);
      if (child.isContainer) {
        resource.types.add(`${LDP}Container`);
        resource.types.add(`${LDP}BasicContainer`);
      }
    }
    return dataset;
  }

  async rdf(url: string, read: PodReadResult, dataset: Store): Promise<Store> {
    return withPodReadLimits(async () => {
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
      // An authorized document owns all of its links, literals and descriptions.
      return dataset;
    });
  }

  /** All byte/text resource paths use this before choosing an MCP representation. */
  async representation(url: string, read: PodReadResult): Promise<PodReadResult> {
    return withPodReadLimits(async () => {
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
      }
      return changed
        ? { body, contentType: projectedType, ...(read.url ? { url: read.url } : {}) }
        : read;
    });
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
