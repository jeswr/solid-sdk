// AUTHORED-BY GPT-6.1 Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// profile.ts — the host shell's profile DATA LAYER.
//
// HOUSE-RULE CONTRACT: all RDF is read through @jeswr/fetch-rdf (fetch + parse)
// and the @solid/object typed accessors. Never parse Turtle by hand, never build
// triples by string concatenation.
//
// Public profile reads always use an explicitly injected pristine transport.
import { fetchRdf } from "@jeswr/fetch-rdf";
import { Agent } from "@solid/object";
import { DataFactory } from "n3";

/** The shape the host UI renders. Plain data — no RDF terms leak out. */
export interface Profile {
  webId: string;
  name: string;
  avatarUrl?: string;
  /** Every advertised `pim:storage` — present all; never pick one silently. */
  storages: string[];
  oidcIssuers: string[];
}

/**
 * Read a Solid WebID profile into a plain {@link Profile}.
 *
 * @throws {import("@jeswr/fetch-rdf").RdfFetchError} on transport / non-2xx / parse failure.
 * Authentication has already been verified by pod-auth; this reads display metadata only.
 */
export async function readProfile(webId: string, fetchImpl: typeof fetch): Promise<Profile> {
  const { dataset } = await fetchRdf(webId, { fetch: fetchImpl });
  const agent = new Agent(webId, dataset, DataFactory);
  return {
    webId,
    name: agent.name ?? webId,
    avatarUrl: agent.photoUrl ?? undefined,
    storages: [...agent.pimStorage],
    oidcIssuers: [...agent.oidcIssuer],
  };
}
