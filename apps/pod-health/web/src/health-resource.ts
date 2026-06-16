// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// health-resource.ts — discover WHICH health resource to show the logged-in user.
//
// Unlike Pod Docs (whose DocsStore owns container discovery internally), the
// pod-health data layer reads a SINGLE resource URL handed to it — it does no
// discovery. So the host shell derives that resource URL here, the Solid way:
//
//   1. TYPE-INDEX discovery (the interop convention). Read the profile's
//      `solid:publicTypeIndex` / `solid:privateTypeIndex`, fetch each index
//      document, and `locate(health:HealthRecord)`. A registration's
//      `solid:instance` IS a single resource → use it directly. A registration
//      with only a `solid:instanceContainer` points at a container; we surface
//      that container URL (the data layer GETs it; the view handles a non-record
//      response as an error rather than crashing).
//   2. FALLBACK to the conventional `${podRoot}health/` path when no usable
//      registration is found. Discovery is a HINT, not a grant — the data layer
//      still WAC-checks every GET.
//
// HOUSE-RULE CONTRACT: all RDF is read through @jeswr/fetch-rdf (fetch + parse)
// and typed accessors (@solid/object for the profile pointers; pod-health's own
// TypeIndexDataset for the registry). Never parse Turtle by hand, never build
// triples by string concatenation.
import { fetchRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { HealthClass, TypeIndexDataset } from "pod-health";

const SOLID = "http://www.w3.org/ns/solid/terms#";

/** The outcome of resource discovery: the URL to show + whether it is a fallback. */
export interface HealthResource {
  /** The health resource (or container) URL to pass to <HealthRecords resourceUrl>. */
  resourceUrl: string;
  /**
   * True when `resourceUrl` came from the conventional `${podRoot}health/`
   * fallback rather than a Type-Index registration — the host surfaces a banner.
   */
  isFallback: boolean;
}

/**
 * Read the `solid:publicTypeIndex` + `solid:privateTypeIndex` pointers off the
 * WebID subject of an already-fetched profile dataset, via a @rdfjs/wrapper
 * TermWrapper (no `@solid/object` accessor ships for the type index). Returns a
 * de-duplicated list of index-document URLs (0–2).
 */
function typeIndexUrls(webId: string, dataset: DatasetCore): string[] {
  const subject = new TermWrapper(webId, dataset, DataFactory);
  const out = new Set<string>();
  for (const pred of [`${SOLID}publicTypeIndex`, `${SOLID}privateTypeIndex`]) {
    for (const url of SetFrom.subjectPredicate(
      subject,
      pred,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    )) {
      out.add(url);
    }
  }
  return [...out];
}

/** Ensure a container URL ends in a single trailing slash. */
function asContainer(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * Discover the health resource URL to show. Re-reads the WebID profile (through
 * the auth-patched global fetch, so a private-index pointer behind WAC is
 * visible), then tries Type-Index discovery against every index the profile
 * advertises, preferring a `solid:instance` (a real single resource) over a
 * `solid:instanceContainer`. Falls back to the conventional `${podRoot}health/`
 * when the profile can't be read, nothing usable is registered, or an index
 * document can't be read (a private index may be WAC-gated, or absent — CSS does
 * not seed type indexes). Never throws: discovery failure degrades to the
 * convention, never an error screen.
 *
 * @param webId     the authenticated user's WebID.
 * @param podRoot   the derived pod root (always ends in "/").
 * @param fetchImpl optional fetch (the authenticated global in a real session).
 */
export async function discoverHealthResource(
  webId: string,
  podRoot: string,
  fetchImpl?: typeof fetch,
): Promise<HealthResource> {
  const conventional = `${asContainer(podRoot)}health/`;

  let profileDataset: DatasetCore;
  try {
    ({ dataset: profileDataset } = await fetchRdf(
      webId,
      fetchImpl ? { fetch: fetchImpl } : undefined,
    ));
  } catch {
    // The profile is unreadable here (it was readable at login, so this is a
    // transient/permission edge) — degrade to the convention.
    return { resourceUrl: conventional, isFallback: true };
  }

  let containerHit: string | undefined;

  for (const indexUrl of typeIndexUrls(webId, profileDataset)) {
    let indexDataset: DatasetCore;
    try {
      ({ dataset: indexDataset } = await fetchRdf(
        indexUrl,
        fetchImpl ? { fetch: fetchImpl } : undefined,
      ));
    } catch {
      // An unreadable index (403 on a private index, 404, network) is "may exist",
      // not authoritative — skip it and try the next / fall back.
      continue;
    }
    for (const loc of new TypeIndexDataset(indexDataset, DataFactory).locate(
      HealthClass.HealthRecord,
    )) {
      // A single resource is the ideal match — return it immediately.
      if (loc.instance) return { resourceUrl: loc.instance, isFallback: false };
      // Remember the first container as a weaker hit; keep scanning for an instance.
      if (loc.container && !containerHit) containerHit = loc.container;
    }
  }

  if (containerHit) return { resourceUrl: containerHit, isFallback: false };
  return { resourceUrl: conventional, isFallback: true };
}
