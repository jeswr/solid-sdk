// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import { chipIri } from "./chips/core.js";

/**
 * Container roots that may receive credentials: usually the user's storage, optionally plus the
 * containers an opened resource owns (for example a shared document's own folder).
 */
export type CredentialRoots = string | readonly string[];

/**
 * Credential authority is a set of storage paths, not every account on their origins. Each root
 * applies guarded-fetch's strict path-prefix check: same origin, a real segment boundary, no
 * userinfo and no encoded path delimiters. Invalid roots are ignored (fail closed).
 */
export function isOwnPodIri(iri: string, roots: CredentialRoots): boolean {
  if (!chipIri(iri)) return false;
  const list: readonly string[] = typeof roots === "string" ? [roots] : roots;
  return list.some((root) => chipIri(root) && isWithinPodScope(root, iri));
}

/**
 * In-scope requests use the session transport and refuse redirects, so credentials never follow
 * a 3xx. Foreign reads bypass session caches and carry neither credentials nor referrer; they may
 * follow redirects (WebIDs commonly 303 or move behind w3id.org) because nothing secret travels.
 */
export function podScopedFetch(fetchImpl: typeof fetch, roots: CredentialRoots): typeof fetch {
  return (input, init) => {
    const iri = input instanceof Request ? input.url : String(input);
    if (!chipIri(iri)) return Promise.reject(new TypeError("Invalid resource IRI"));
    if (isOwnPodIri(iri, roots)) return fetchImpl(input, { ...init, redirect: "error" });
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => {
      headers.set(key, value);
    });
    for (const key of ["authorization", "dpop", "cookie", "proxy-authorization"])
      headers.delete(key);
    return fetch(input, {
      ...init,
      headers,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      referrer: "",
      cache: "no-store",
      redirect: "follow",
    });
  };
}
