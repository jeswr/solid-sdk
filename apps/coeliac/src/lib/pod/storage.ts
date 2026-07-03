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
import { DataFactory } from "n3";
import { asContainer, containerOf } from "./layout.js";

const PIM_STORAGE = "http://www.w3.org/ns/pim/space#storage";

/**
 * The pod-root fallback for a WebID when the profile advertises no `pim:storage`.
 *
 * Deriving the SERVER origin (`https://host/`) would be WRONG for a path-based
 * WebID (`https://host/alice/profile/card#me` lives in the pod `https://host/alice/`,
 * not the server root) — it would provision/write the diary under the wrong
 * container. Instead we derive from the profile document path, which conventionally
 * sits at `<podRoot>profile/card`: strip that suffix to get the pod root; otherwise
 * fall back to the container holding the profile document (conservative). The
 * PRIMARY path is always `pim:storage` discovery — this is only the last resort.
 */
export function podRootFallback(webId: string): string {
  const doc = docOf(webId);
  const u = new URL(doc);
  if (/\/profile\/card$/.test(u.pathname)) {
    u.pathname = u.pathname.replace(/profile\/card$/, "");
    return u.toString();
  }
  return containerOf(doc);
}

/**
 * Every `pim:storage` advertised on the WebID profile FOR THE AUTHENTICATED WEBID
 * SUBJECT (never an unrelated subject in the same document — that could target the
 * wrong storage), as container URLs (trailing-slash-normalised, http(s) only,
 * de-duplicated). Empty if none / the profile is unreadable.
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
  const subject = DataFactory.namedNode(webId);
  const predicate = DataFactory.namedNode(PIM_STORAGE);
  for (const q of dataset.match(subject, predicate, null)) {
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
 * The storage root to use for the diary: the first `pim:storage` the WebID
 * advertises, or the pod-root fallback derived from the profile document path when
 * the profile advertises none (never the bare server origin — see
 * {@link podRootFallback}).
 */
export async function resolveStorageRoot(
  webId: string,
  authedFetch: typeof globalThis.fetch,
): Promise<string> {
  const roots = await resolveStorageRoots(webId, authedFetch);
  return roots[0] ?? podRootFallback(webId);
}
