// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Resolve the pod storage root(s) for a WebID by reading `pim:storage` off the
 * profile (via `@jeswr/fetch-rdf`), with a safe fallback to the WebID's origin
 * root. A profile may advertise several storages (a valid Solid topology); we
 * return them all so the UI can offer a choice, and expose a single-root
 * convenience that takes the first (a documented follow-up: multi-storage
 * selection UI).
 */
import { fetchRdf } from "@jeswr/fetch-rdf";
import { docOf } from "@jeswr/solid-health-diary";
import { asContainer } from "./layout.js";

const PIM_STORAGE = "http://www.w3.org/ns/pim/space#storage";

/** The origin-root fallback (`https://alice.example/`) for a WebID. */
export function originRoot(webId: string): string {
  return new URL("/", webId).toString();
}

/**
 * Every `pim:storage` advertised on the WebID profile, as container URLs
 * (trailing-slash-normalised, http(s) only, de-duplicated). Empty if none / the
 * profile is unreadable.
 */
export async function resolveStorageRoots(
  webId: string,
  authedFetch: typeof globalThis.fetch,
): Promise<string[]> {
  let dataset: import("@rdfjs/types").DatasetCore;
  try {
    ({ dataset } = await fetchRdf(docOf(webId), { fetch: authedFetch }));
  } catch {
    return [];
  }
  const roots = new Set<string>();
  for (const q of dataset.match(null, null, null)) {
    if (q.predicate.value !== PIM_STORAGE) continue;
    if (q.object.termType !== "NamedNode") continue;
    try {
      const u = new URL(q.object.value);
      if (u.protocol === "https:" || u.protocol === "http:") {
        roots.add(asContainer(q.object.value));
      }
    } catch {
      // skip an unparseable storage IRI
    }
  }
  return [...roots];
}

/**
 * The storage root to use for the diary: the first advertised `pim:storage`, or
 * the WebID origin root when the profile advertises none (the common CSS default,
 * where the pod root is the WebID origin).
 */
export async function resolveStorageRoot(
  webId: string,
  authedFetch: typeof globalThis.fetch,
): Promise<string> {
  const roots = await resolveStorageRoots(webId, authedFetch);
  return roots[0] ?? originRoot(webId);
}
