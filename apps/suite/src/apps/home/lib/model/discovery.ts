// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// Container orchestration ported from PM pod-data.ts; no app or SDK runtime imports.
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore, Term } from "@rdfjs/types";
import { TermAs } from "@rdfjs/wrapper";
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

export interface DiscoveryOptions extends DiscoveryBudgetOptions {
  fetch: typeof globalThis.fetch;
  storage: string;
  /** Materialised public + private registrations, e.g. from readTypeIndexes. */
  typeIndex?: readonly RegisteredLocation[];
  webId?: string;
  /** Allows a profile hosted outside storage without forwarding credentials there. */
  profile?: DatasetCore;
}

export interface DomainItems {
  items: DomainItem[];
  failures: DiscoveryFailure[];
  /** True when discovery stopped at its request budget or deadline. Failures also imply partial data. */
  truncated: boolean;
  etags: ReadonlyMap<string, string | null>;
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
function resourceUrl(value: string): string {
  return (httpUrl(value)?.href ?? value).split("#")[0] as string;
}

/**
 * Merge Type Index hits and suite containers, classify actual primary subjects, dedupe URLs.
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
      ? [...DOMAINS, UNCATEGORISED].find((item) => item.id === domain)
      : domain;
  if (!category) throw new TypeError("Unknown Home domain");
  const { storage, fetch, webId } = options;
  if (!inStorage(storage, storage) || new URL(storage).hash)
    throw new TypeError("Expected a storage root ending in /");
  const budget = options.budget ?? new DiscoveryBudget(options);
  const result: DomainItems = { items: [], failures: [], truncated: false, etags: new Map() };
  const etags = new Map<string, string | null>();
  result.etags = etags;
  const queue: Visit[] = [];
  const seen = new Set<string>();
  const listedModified = new Map<string, string>();

  const addDataset = (dataset: DatasetCore, url: string, parent: string, etag: string | null) => {
    const node =
      webId && url === resourceUrl(webId)
        ? subjectOf(dataset, webId)
        : primarySubject(dataset, url);
    if (!node) return;
    const classified = classifySubject(node, webId);
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
    result.items.push(item);
    if (hasProfileContactDetails(node, webId)) {
      result.items.push({
        ...item,
        ...classificationForType("contact-details"),
        title: "Contact details",
      });
    }
  };

  for (const location of options.typeIndex ?? []) {
    if (category.id !== "other" && !category.classes.includes(location.forClass)) continue;
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
  const known =
    category.id === "other" ? DOMAINS.flatMap((item) => item.dataTypes) : category.dataTypes;
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
  if (category.id === "personal" && webId) {
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
  result.truncated = budget.truncated;
  const unique = new Map<string, DomainItem>();
  for (const item of result.items) {
    // A direct registration may have been read before its container listing.
    const modified = item.modified ?? listedModified.get(item.url);
    if (modified) item.modified = modified;
    if (item.domain.id === category.id) unique.set(`${item.url}|${item.dataType?.id}`, item);
  }
  let fileCount = 0;
  result.items = sortItems([...unique.values()]).filter(
    (item) => item.dataType?.id !== "files" || fileCount++ < 6,
  );
  return result;
}
