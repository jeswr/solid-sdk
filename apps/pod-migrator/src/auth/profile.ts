// AUTHORED-BY GPT-6.1 Sol
import { normalizePodBase } from "@jeswr/guarded-fetch";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";
import { parse } from "../engine/rdf.js";
import type { PodHttp } from "../engine/types.js";

export function storageRoot(root: string): string {
  const url = new URL(root);
  if (url.protocol !== "https:" || url.search || url.hash) throw new Error("Unsafe storage URL");
  return normalizePodBase(root);
}

/** Preserve the migrator's complete-graph checks, scoped to the authenticated WebID document. */
export async function readStorageProfile(
  webId: string,
  publicFetch: typeof fetch,
  authenticatedFetch: typeof fetch,
  current: () => boolean,
): Promise<string[]> {
  const document = new URL(webId);
  document.hash = "";
  if (document.protocol !== "https:" || document.username || document.password)
    throw new Error("Unsafe WebID");
  const profileHttp = (transport: typeof fetch): Pick<PodHttp, "get"> => ({
    get: (url, init) => {
      if (!current()) throw new Error("Profile sign-in changed");
      if (url !== document.href) throw new Error("Request outside the WebID document");
      return transport(url, {
        headers: { accept: init?.accept ?? "text/turtle, application/ld+json;q=0.9" },
        signal: init?.signal,
        credentials: "omit",
        redirect: "manual",
      });
    },
  });
  let http = profileHttp(publicFetch);
  let response = await http.get(document.href);
  if (response.status === 401 || response.status === 403) {
    http = profileHttp(authenticatedFetch);
    response = await http.get(document.href);
  }
  const profile = await parse(response, document.href, http, undefined, true);
  if (!current()) throw new Error("Profile sign-in changed");
  return [...new Set([...new Agent(webId, profile, DataFactory).pimStorage].map(storageRoot))];
}
