// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
/** The sole projection from caller-authorized PodPort data to public pod output. */
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
import { podScopedUrlOrUndefined, requirePodScopedUrl, requirePodScopedWriteUrl } from "./auth.js";
import { parseBoundedRdf, serializeBoundedTurtle } from "./bounded-rdf.js";
import { MAX_CONTENT_BYTES, mediaType, RDF_MEDIA_TYPES, resourceTitle } from "./content.js";
import {
  governingAuxiliaries,
  PERSONAL_DATA_DENIED,
  requireAuxiliaryMutationAccess,
  requireGenericPodAccess,
} from "./personal-data.js";
import type { PodChild, SearchMatch } from "./pod.js";
import {
  podReadMode,
  withPodDataAccess,
  withPodReadLimits,
  withPodReadMode,
} from "./pod-operation.js";
import {
  isFetchPodRead,
  type PodConditions,
  type PodHeadResult,
  type PodPort,
  type PodReadOptions,
  type PodReadResult,
} from "./pod-port.js";

const LDP = "http://www.w3.org/ns/ldp#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const CONTAINER_ACCEPT = "text/turtle, application/ld+json;q=0.9, application/lws+json;q=0.8";

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

  constructor(
    private readonly pod: PodPort,
    private readonly personal = false,
  ) {}

  private target(url: string, mutation = false): string {
    if (!this.personal) requireGenericPodAccess(this.pod, url, mutation);
    return (mutation ? requirePodScopedWriteUrl : requirePodScopedUrl)(
      { podRoot: this.pod.root },
      url,
    );
  }

  private operation<T>(operation: () => T): T {
    return withPodDataAccess(this.pod, this.personal, operation);
  }

  /** Scope and personal-area filtering for listings and Type Index discovery. */
  candidate(url: string): string | undefined {
    const scoped = podScopedUrlOrUndefined({ podRoot: this.pod.root }, url);
    if (!scoped) return undefined;
    try {
      return this.target(scoped);
    } catch {
      return undefined;
    }
  }

  /** Metadata inspection never authorizes disclosure of resource contents. */
  async head(url: string): Promise<PodHeadResult> {
    return withPodReadLimits(async () => {
      const target = this.target(url);
      return (await this.operation(() => this.pod.head?.(target))) ?? {};
    });
  }

  async read(url: string, options?: PodReadOptions): Promise<PodReadResult> {
    return withPodReadLimits(async () => {
      const target = this.target(url);
      const result = await this.operation(() => this.pod.read(target, options));
      // Portable ports bound their own backend allocations. Fetch can cap their
      // already-authorized bytes at output; projection checks require a full,
      // bounded result. Native fetch prefixes may carry one overflow byte.
      const cap = MAX_CONTENT_BYTES + (podReadMode() === "fetch" ? 1 : 0);
      if (podReadMode() !== "fetch-complete" && result.body.byteLength > cap)
        throw new Error("Resource exceeds the bounded read limit.");
      const finalUrl = this.target(result.url ?? target);
      let output = result;
      // A redirect/alias is a separate resource, subject to the same purpose check.
      if (!isFetchPodRead(this.pod.read) && documentUrl(finalUrl) !== documentUrl(target)) {
        const final = await this.operation(() => this.pod.read(finalUrl, options));
        this.target(final.url ?? finalUrl);
        if (podReadMode() !== "fetch-complete" && final.body.byteLength > cap)
          throw new Error("Resource exceeds the bounded read limit.");
        if (documentUrl(final.url ?? finalUrl) !== documentUrl(finalUrl))
          throw new Error("pod-scope violation: ambiguous resource alias");
        // The canonical read is authoritative: a decorator may redact it differently.
        output = {
          ...final,
          url: finalUrl,
          ...(result.isContainer || final.isContainer ? { isContainer: true } : {}),
        };
      }
      // RDF can identify a slashless container alias even when the backend has
      // no URL/type metadata. Check that identity before authorizing descriptions
      // or filename-only search hits; ordinary document links remain untouched.
      if (!this.personal && RDF_MEDIA_TYPES.has(mediaType(output.contentType))) {
        try {
          const dataset = await parseBoundedRdf(
            new TextDecoder().decode(output.body),
            mediaType(output.contentType),
            finalUrl,
          );
          const identity = this.containerIdentity(dataset);
          if (identity) this.target(identity);
        } catch (error) {
          if (error instanceof Error && error.message === PERSONAL_DATA_DENIED) throw error;
          // Parsing/output paths own malformed/oversized RDF. A successful raw
          // read can still authorize a filename, as with other non-RDF data.
        }
      }
      this.authorized.add(documentUrl(target));
      this.authorized.add(documentUrl(finalUrl));
      return output;
    });
  }

  private async allows(url: string): Promise<boolean> {
    const scoped = this.candidate(url);
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
      const target = this.target(url);
      if (!this.authorized.has(documentUrl(target)))
        await this.read(target, { accept: CONTAINER_ACCEPT });
      const children: PodChild[] = [];
      for (const entry of await this.candidates(target)) {
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

  /** Discovery is untrusted: omit protected entries before any candidate read. */
  async candidates(url: string): Promise<PodChild[]> {
    const target = this.target(url);
    const children: PodChild[] = [];
    for (const entry of await this.operation(() => this.pod.list(target))) {
      const scoped = this.candidate(entry.url);
      if (!scoped) continue;
      children.push({
        ...entry,
        url: scoped,
        name: entry.name ?? resourceTitle(scoped),
        type: entry.type ?? [],
      });
    }
    return children;
  }

  async write(url: string, body: Uint8Array, contentType: string, cond: PodConditions) {
    return this.mutate(url, (target) => this.pod.write(target, body, contentType, cond));
  }

  async delete(url: string, cond?: PodConditions): Promise<void> {
    return this.mutate(url, (target) => this.pod.delete(target, cond));
  }

  private async mutate<T>(url: string, operation: (target: string) => Promise<T>): Promise<T> {
    const target = this.target(url, true);
    if (this.personal) return this.operation(() => operation(target));
    let auxiliaries: ReadonlySet<string>;
    try {
      // Discovery inspects protected metadata internally, without disclosing its contents.
      auxiliaries = await withPodReadLimits(() =>
        withPodDataAccess(this.pod, true, () => governingAuxiliaries(this.pod)),
      );
    } catch {
      throw new Error(PERSONAL_DATA_DENIED);
    }
    requireAuxiliaryMutationAccess(target, auxiliaries);
    return withPodDataAccess(this.pod, false, () => operation(target), auxiliaries);
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

  /** Recognize containers before interpreting or returning any server-rendered body. */
  private containerIdentity(dataset: Store): string | undefined {
    const typed = new ContainerDataset(dataset, DataFactory).container;
    const membership = dataset
      .getSubjects(DataFactory.namedNode(`${LDP}contains`), null, null)
      .find((subject) => subject.termType === "NamedNode");
    return typed?.id ?? membership?.value;
  }

  async containerRdf(
    url: string,
    read: PodReadResult,
    dataset?: Store,
  ): Promise<Store | undefined> {
    return withPodReadLimits(async () => {
      this.target(url);
      const finalUrl = this.target(read.url ?? url);
      const identity = dataset && this.containerIdentity(dataset);
      const containerAddress = (address: string) =>
        isContainerUrl(address) ||
        new URL(address).pathname === new URL(this.pod.root).pathname.slice(0, -1);
      // Either end of an alias, response type links, and RDF membership identify
      // a container. Never interpret a non-RDF listing as ordinary document data.
      if (containerAddress(url) || containerAddress(finalUrl) || read.isContainer || identity) {
        const containerUrl = identity ? this.target(identity) : finalUrl;
        if (!(await this.allows(containerUrl))) throw new Error("purpose denied");
        return this.container(containerUrl);
      }
      return undefined;
    });
  }

  async rdf(url: string, read: PodReadResult, dataset: Store): Promise<Store> {
    // An authorized document owns all of its links, literals and descriptions.
    return (await this.containerRdf(url, read, dataset)) ?? dataset;
  }

  /** All byte/text resource paths use this before choosing an MCP representation. */
  async representation(url: string, read: PodReadResult): Promise<PodReadResult> {
    return withPodReadLimits(async () => {
      const contentType = mediaType(read.contentType);
      let projected = await this.containerRdf(url, read);
      if (!projected && RDF_MEDIA_TYPES.has(contentType)) {
        const dataset = await parseBoundedRdf(
          new TextDecoder().decode(read.body),
          contentType,
          read.url ?? url,
        );
        projected = await this.containerRdf(url, read, dataset);
      }
      return projected
        ? {
            body: new TextEncoder().encode(serializeBoundedTurtle(projected)),
            contentType: "text/turtle",
            ...(read.url ? { url: read.url } : {}),
          }
        : read;
    });
  }
}

/** Public diagnostics are fixed strings: backend errors may contain rejected values. */
export function podOutputError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message === PERSONAL_DATA_DENIED) return new Error(message);
  if (message === "Audit protection unavailable") return new Error(message);
  if (message === "Memory protection unavailable") return new Error(message);
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
