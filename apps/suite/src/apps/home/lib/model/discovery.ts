// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Container orchestration ported from PM pod-data.ts; no app or SDK runtime imports.
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore, Term } from "@rdfjs/types";
import { TermAs } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { classificationForType, classifySubject, hasProfileContactDetails } from "./classify";
import { DiscoveryBudget, type DiscoveryBudgetOptions } from "./discovery-budget";
import { type Classification, type DataCategory, DOMAINS, UNCATEGORISED } from "./domains";
import { httpUrl, inStorage, primarySubject, subjectOf } from "./rdf";
import type { DiscoveryFailure, RegisteredLocation } from "./type-index";

export interface DomainItem extends Classification {
  /** Resource URL + subject + data type identify a card (profile details share one resource). */
  url: string;
  subject: Term;
  title: string;
  modified?: string;
  containerUrl: string;
  dataset: DatasetCore;
  etag: string | null;
}

/** Multiple records can share a document; profile views can also share a subject. */
export function domainItemKey(item: DomainItem): string {
  // Blank-node labels belong to one parse, so these cards keep document/type identity.
  // Binary listing subjects may also be URL aliases for the same file.
  const subject =
    item.subject.termType === "NamedNode" && item.dataType?.id !== "files"
      ? item.subject.value
      : undefined;
  return JSON.stringify([resourceUrl(item.url), subject, item.dataType?.id]);
}

export const MAX_RECORDS_PER_DOCUMENT = 200;
export const MAX_RECORDS_PER_REFRESH = 1_000;

interface ClassifiedDocument {
  dataset: DatasetCore;
  etag: string | null;
  items: DomainItem[];
  truncated: boolean;
}

export interface DiscoveryOptions extends DiscoveryBudgetOptions {
  fetch: typeof globalThis.fetch;
  storage: string;
  /** Materialised public + private registrations, e.g. from readTypeIndexes. */
  typeIndex?: readonly RegisteredLocation[];
  webId?: string;
  /** Allows a profile hosted outside storage without forwarding credentials there. */
  profile?: DatasetCore;
  /** Shared only within one refresh, so overlapping domain scans classify each document once. */
  documentCache?: Map<string, ClassifiedDocument>;
}

export interface DomainItems {
  items: DomainItem[];
  failures: DiscoveryFailure[];
  /** True when discovery reached its request, record or time budget. Failures also imply partial data. */
  truncated: boolean;
  etags: ReadonlyMap<string, string | null>;
  /** Listing membership is independent of whether child contents were visited. */
  listings: ReadonlyMap<string, ReadonlySet<string>>;
}

/** PM's friendly URL-tail fallback, tolerant of malformed percent escapes. */
export function nameFromUrl(value: string): string {
  try {
    const url = new URL(value);
    const tail = url.pathname.split("/").filter(Boolean).at(-1);
    return tail ? decodeURIComponent(tail) : url.hostname;
  } catch {
    return value;
  }
}

export function sortItems(items: readonly DomainItem[]): DomainItem[] {
  return [...items].sort(
    (a, b) =>
      (Date.parse(b.modified ?? "") || 0) - (Date.parse(a.modified ?? "") || 0) ||
      a.title.localeCompare(b.title),
  );
}

interface Visit {
  url: string;
  container: boolean;
  files: boolean;
  parent: string;
}

/** Normalize HTTP resource identities without rewriting RDF subject identifiers. */
export function resourceUrl(value: string): string {
  return (httpUrl(value)?.href ?? value).split("#")[0] as string;
}

/**
 * Merge Type Index hits and suite containers, classify records, dedupe document/subject/type.
 * Known folders may not exist (404); permission, network and parse failures are retained.
 * Integrations are walked recursively; ordinary folders contribute direct non-container children.
 * Results carry validators so the later SDK adapter can cache by container ETag.
 */
export async function discoverDomainItems(
  domain: string | DataCategory,
  options: DiscoveryOptions,
): Promise<DomainItems> {
  const category =
    typeof domain === "string"
      ? domain === "all"
        ? { ...UNCATEGORISED, id: "all" }
        : [...DOMAINS, UNCATEGORISED].find((item) => item.id === domain)
      : domain;
  if (!category) throw new TypeError("Unknown Home domain");
  const { storage, fetch, webId } = options;
  if (!inStorage(storage, storage) || new URL(storage).hash)
    throw new TypeError("Expected a storage root ending in /");
  const budget = options.budget ?? new DiscoveryBudget(options);
  const documents = options.documentCache ?? new Map<string, ClassifiedDocument>();
  const listings = new Map<string, ReadonlySet<string>>();
  const result: DomainItems = {
    items: [],
    failures: [],
    truncated: false,
    etags: new Map(),
    listings,
  };
  const etags = new Map<string, string | null>();
  result.etags = etags;
  const queue: Visit[] = [];
  const seen = new Set<string>();
  const listedModified = new Map<string, string>();

  const addDataset = (dataset: DatasetCore, url: string, parent: string, etag: string | null) => {
    let document = documents.get(url);
    if (!document) {
      const remaining =
        MAX_RECORDS_PER_REFRESH -
        [...documents.values()].reduce((count, entry) => count + entry.items.length, 0);
      const limit = Math.min(MAX_RECORDS_PER_DOCUMENT, remaining);
      const items: DomainItem[] = [];
      let truncated = false;
      const add = (node: ReturnType<typeof subjectOf>, classified: Classification) => {
        if (items.length >= limit) {
          truncated = true;
          return;
        }
        const modifiedAt = node.modified;
        const item: DomainItem = {
          ...classified,
          url,
          subject: TermAs.term(node),
          dataset,
          etag,
          containerUrl: parent,
          title: node.name ?? nameFromUrl(url),
          ...(modifiedAt ? { modified: modifiedAt } : {}),
        };
        items.push(item);
        if (hasProfileContactDetails(node, webId)) {
          if (items.length >= limit) truncated = true;
          else
            items.push({
              ...item,
              ...classificationForType("contact-details"),
              title: "Contact details",
            });
        }
      };
      // Connector collections stamp records with provenance. Only named local records
      // get individual cards; blank-node collections keep primary-subject discovery.
      const imported = new Set<string>();
      if (!webId || url !== resourceUrl(webId)) {
        for (const { subject } of dataset.match(
          null,
          DataFactory.namedNode(`${NS.PROV}wasGeneratedBy`),
        )) {
          if (
            subject.termType !== "NamedNode" ||
            subject.value === url ||
            resourceUrl(subject.value) !== url ||
            imported.has(subject.value)
          )
            continue;
          const node = subjectOf(dataset, subject);
          const classified = classifySubject(node, webId);
          if (!classified.dataType) continue;
          imported.add(subject.value);
          add(node, classified);
          if (truncated) break;
        }
      }
      if (!imported.size) {
        const node =
          webId && url === resourceUrl(webId)
            ? subjectOf(dataset, webId)
            : primarySubject(dataset, url);
        if (node && dataset.match(TermAs.term(node)).size > 0)
          add(node, classifySubject(node, webId));
      }
      document = { dataset, etag, items, truncated };
      documents.set(url, document);
    }
    result.truncated ||= document.truncated;
    // Listing dates and parents belong to the current scan, not the shared cache.
    result.items.push(...document.items.map((item) => ({ ...item, containerUrl: parent })));
  };

  for (const location of options.typeIndex ?? []) {
    if (!["all", "other"].includes(category.id) && !category.classes.includes(location.forClass))
      continue;
    const files =
      classificationForType("files").dataType?.classes.includes(location.forClass) === true;
    if (location.container)
      queue.push({ url: location.container, container: true, files, parent: location.container });
    if (location.instance)
      queue.push({
        url: location.instance,
        container: false,
        files,
        parent: inStorage(location.instance, storage)
          ? new URL(".", location.instance).href
          : storage,
      });
  }
  const known = ["all", "other"].includes(category.id)
    ? DOMAINS.flatMap((item) => item.dataTypes)
    : category.dataTypes;
  for (const type of known) {
    if (type.container)
      queue.push({
        url: new URL(type.container, storage).href,
        container: true,
        files: type.id === "files",
        parent: storage,
      });
  }
  queue.push({
    url: new URL("integrations/", storage).href,
    container: true,
    files: false,
    parent: storage,
  });
  if (["all", "personal"].includes(category.id) && webId) {
    const documentUrl = resourceUrl(webId);
    if (options.profile) {
      addDataset(options.profile, documentUrl, storage, null);
      seen.add(documentUrl);
    } else queue.push({ url: documentUrl, container: false, files: false, parent: storage });
  }

  for (let index = 0; index < queue.length; index++) {
    if (budget.truncated) break;
    const visit = queue[index] as Visit;
    const url = resourceUrl(visit.url);
    if (seen.has(url)) continue;
    seen.add(url);
    if (!inStorage(visit.url, storage)) {
      result.failures.push({
        url,
        error: new TypeError("Location is outside the selected storage"),
      });
      continue;
    }
    try {
      const cached = documents.get(url);
      if (cached && !visit.container && !visit.files) {
        etags.set(url, cached.etag);
        addDataset(cached.dataset, url, visit.parent, cached.etag);
        continue;
      }
      const resource = await budget.read(fetch, url);
      if (!resource) break;
      const { dataset, etag } = resource;
      etags.set(url, etag);
      const node = subjectOf(dataset, url);
      const files =
        visit.files ||
        node.types.some((type) => classificationForType("files").dataType?.classes.includes(type));
      const isContainer =
        visit.container ||
        files ||
        node.types.includes(`${NS.LDP}Container`) ||
        node.types.includes(`${NS.LDP}BasicContainer`) ||
        node.contains.length > 0;
      if (isContainer) {
        listings.set(url, new Set(node.contains.map(resourceUrl)));
        for (const childUrl of node.contains) {
          const child = subjectOf(dataset, childUrl);
          const childContainer =
            childUrl.endsWith("/") ||
            child.types.includes(`${NS.LDP}Container`) ||
            child.types.includes(`${NS.LDP}BasicContainer`);
          const recursive = new URL(url).pathname.includes("/integrations/");
          if (childContainer) {
            if (recursive)
              queue.push({ url: childUrl, container: true, files: false, parent: url });
            continue;
          }
          if (files) {
            // Binary files use the listing's metadata and are never parsed as RDF.
            const item: DomainItem = {
              ...classificationForType("files"),
              url: resourceUrl(childUrl),
              subject: TermAs.term(child),
              dataset,
              etag,
              containerUrl: url,
              title: child.name ?? nameFromUrl(childUrl),
              ...(child.modified ? { modified: child.modified } : {}),
            };
            if (inStorage(childUrl, storage)) result.items.push(item);
            else
              result.failures.push({
                url: childUrl,
                error: new TypeError("File is outside the selected storage"),
              });
          } else {
            if (child.modified) listedModified.set(resourceUrl(childUrl), child.modified);
            queue.push({
              url: childUrl,
              container: false,
              files: false,
              parent: url,
            });
          }
        }
      } else addDataset(dataset, url, visit.parent, etag);
    } catch (error) {
      budget.throwIfCancelled();
      if (!(error instanceof RdfFetchError && error.status === 404))
        result.failures.push({ url, error });
    }
  }
  result.truncated = budget.truncated || result.truncated;
  const unique = new Map<string, DomainItem>();
  for (const item of result.items) {
    // A direct registration may have been read before its container listing.
    const modified = item.modified ?? listedModified.get(item.url);
    if (modified) item.modified = modified;
    if (category.id === "all" || item.domain.id === category.id)
      unique.set(domainItemKey(item), item);
  }
  let fileCount = 0;
  result.items = sortItems([...unique.values()]).filter(
    (item) => item.dataType?.id !== "files" || fileCount++ < 6,
  );
  return result;
}
