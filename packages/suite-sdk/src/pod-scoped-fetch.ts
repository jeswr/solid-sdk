// AUTHORED-BY Codex GPT-6.1-Sol
import { isWithinPodScope } from "@jeswr/guarded-fetch";
import { chipIri } from "./chips/core.js";

/** Credential authority is the user's storage path, not every account on its origin. */
export function isOwnPodIri(iri: string, storageUrl: string): boolean {
  return chipIri(iri) && chipIri(storageUrl) && isWithinPodScope(storageUrl, iri);
}

/** Foreign reads bypass session caches and carry neither credentials nor referrer. */
export function podScopedFetch(fetchImpl: typeof fetch, storageUrl: string): typeof fetch {
  return (input, init) => {
    const iri = input instanceof Request ? input.url : String(input);
    if (!chipIri(iri)) return Promise.reject(new TypeError("Invalid resource IRI"));
    if (isOwnPodIri(iri, storageUrl)) return fetchImpl(input, { ...init, redirect: "error" });
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
      redirect: "error",
    });
  };
}
