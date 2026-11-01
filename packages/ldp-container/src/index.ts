// AUTHORED-BY Codex GPT-6.1-Sol
import { type DatasetCore, parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, isContainerUrl, isWithinPodScope } from "@jeswr/guarded-fetch";
import { ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";

/** A checked, canonical member URL and its trailing-slash container classification. */
export interface ContainerMember {
  readonly url: string;
  readonly container: boolean;
}

/** Read membership through typed RDF accessors, skipping unsafe entries independently. */
export function parseContainerMembers(
  dataset: DatasetCore,
  containerUrl: string,
  options: { scope: string; allowRoot?: boolean },
): ContainerMember[] {
  const container = new ContainerDataset(dataset, DataFactory).container;
  if (!container) return [];
  const base = new URL(containerUrl);
  const seen = new Set<string>();
  const members: ContainerMember[] = [];
  for (const resource of container.contains) {
    try {
      const absolute = new URL(resource.id, containerUrl).href;
      if (!isWithinPodScope(options.scope, absolute, { allowRoot: true })) continue;
      // Use the guard's returned value, including when stricter root handling is requested.
      const url = assertWithinPodScope(options.scope, absolute, {
        allowRoot: options.allowRoot ?? true,
      });
      const member = new URL(url);
      if (member.origin === base.origin && member.pathname === base.pathname) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      members.push({ url, container: isContainerUrl(url) });
    } catch {
      // A malformed identifier must not abort other members of an untrusted listing.
    }
  }
  return members;
}

/**
 * GET and parse an LDP listing; missing containers return null.
 * Inject a fetch that enforces the caller's redirect and credential policy.
 */
export async function readContainerMembers(
  fetch: typeof globalThis.fetch,
  containerUrl: string,
  options: { scope: string; package?: string },
): Promise<ContainerMember[] | null> {
  const url = assertWithinPodScope(options.scope, containerUrl, { allowRoot: true });
  const res = await fetch(url, {
    method: "GET",
    headers: { accept: "text/turtle, application/ld+json;q=0.9" },
  });
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) {
    throw new Error(
      `[${options.package ?? "ldp-container"}] listing container ${url} failed: ${res.status} ${res.statusText}`,
    );
  }
  const dataset = await parseRdf(await res.text(), res.headers.get("content-type"), {
    baseIRI: url,
  });
  return parseContainerMembers(dataset, url, { scope: options.scope });
}
