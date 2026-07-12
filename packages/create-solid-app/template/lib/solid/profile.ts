// profile.ts — the app's profile DATA LAYER.
//
// HOUSE-RULE CONTRACT (read before extending):
//  - All RDF is read through @jeswr/fetch-rdf (fetch + parse) and the
//    @solid/object / @rdfjs/wrapper typed accessors. Never parse Turtle by
//    hand, never construct triples by string concatenation.
//  - `fetch` is an OPTIONAL injected parameter. In the browser you omit it and
//    the call uses the global fetch patched by reactive-authentication (so
//    protected reads carry the DPoP token automatically). In tests you inject a
//    mock fetch and drive this function with zero network and no browser.
import { fetchRdf } from "@jeswr/fetch-rdf";
import { WebIdDataset } from "@solid/object";
import { DataFactory } from "n3";
import { ProfileAgent } from "./profile-agent";

/** The shape the UI renders. Plain data — no RDF terms leak out of this layer. */
export interface Profile {
  webId: string;
  name: string;
  avatarUrl?: string;
  bio?: string;
  /** Every advertised `pim:storage` — present them all; never pick one silently. */
  storages: string[];
  oidcIssuers: string[];
}

/**
 * Read a Solid WebID profile into a plain {@link Profile}.
 *
 * @param webId The WebID IRI (e.g. `https://you.solidcommunity.net/profile/card#me`).
 * @param fetchImpl Optional fetch. Omit in the browser to use the patched
 *   global fetch; inject a mock in tests.
 * @throws {import("@jeswr/fetch-rdf").RdfFetchError} on transport / non-2xx /
 *   parse failure.
 * @throws {Error} when the document has no Solid-OIDC subject (`mainSubject`
 *   is undefined — the WebID is not usable for Solid login).
 */
export async function readProfile(
  webId: string,
  fetchImpl?: typeof fetch,
): Promise<Profile> {
  const { dataset } = await fetchRdf(webId, fetchImpl ? { fetch: fetchImpl } : undefined);
  const me = new WebIdDataset(dataset, DataFactory).mainSubject;
  if (!me) {
    throw new Error(
      `No Solid-OIDC subject found in profile (${webId}). The WebID's profile ` +
        `has no solid:oidcIssuer — it cannot be used for Solid login.`,
    );
  }
  // Re-wrap the same subject IRI as a ProfileAgent for the richer render chains.
  const profile = new ProfileAgent(me.value, dataset, DataFactory);
  return {
    webId,
    name: profile.displayName,
    avatarUrl: profile.avatarUrl,
    bio: profile.bio,
    storages: [...profile.storageUrls],
    oidcIssuers: [...profile.oidcIssuer],
  };
}
