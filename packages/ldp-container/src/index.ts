// AUTHORED-BY Codex GPT-6.1-Sol
import { type DatasetCore, parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope, isContainerUrl } from "@jeswr/guarded-fetch";
import { ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";

/** A checked, canonical member URL and its trailing-slash container classification. */
export interface ContainerMember {
  readonly url: string;
  readonly container: boolean;
}

/**
 * Read one container dataset through typed RDF accessors, skipping unsafe entries independently.
 * The dataset's first container subject supplies membership; mixed-container datasets are unsupported.
 */
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
      if (resource.termType !== "NamedNode") continue;
      const absolute = new URL(resource.id, containerUrl).href;
      // Use the guard's returned value, including when stricter root handling is requested.
      const url = assertWithinPodScope(options.scope, absolute, {
        allowRoot: options.allowRoot ?? true,
      });
      assertWithinPodScope(containerUrl, url, { allowRoot: false });
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
  options: {
    scope: string;
    package?: string;
    signal?: AbortSignal;
    /** Maximum listing bytes; defaults to 16 MiB. */
    maxBytes?: number;
    /** Maximum parsed quads; defaults to fetch-rdf's limit (1,000,000). */
    maxQuads?: number;
  },
): Promise<ContainerMember[] | null> {
  const url = assertWithinPodScope(options.scope, containerUrl, { allowRoot: true });
  const res = await fetch(url, {
    method: "GET",
    headers: { accept: "text/turtle, application/ld+json;q=0.9" },
    ...(options.signal !== undefined && { signal: options.signal }),
  });
  if (res.status === 404 || res.status === 410) {
    cancelBody(res);
    return null;
  }
  if (!res.ok) {
    cancelBody(res);
    throw new Error(
      `[${options.package ?? "ldp-container"}] listing container ${url} failed: ${res.status} ${res.statusText}`,
    );
  }
  const dataset = await parseRdf(res.body ?? "", res.headers.get("content-type"), {
    baseIRI: url,
    maxBytes: options.maxBytes ?? 16 * 1024 * 1024,
    ...(options.maxQuads !== undefined && { maxQuads: options.maxQuads }),
    ...(options.signal !== undefined && { signal: options.signal }),
  });
  return parseContainerMembers(dataset, url, { scope: options.scope });
}

/** Best-effort cleanup must not delay a missing result or the original HTTP error. */
function cancelBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    // A locked or already-errored body must not replace the HTTP result.
  }
}
