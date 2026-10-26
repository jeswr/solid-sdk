// AUTHORED-BY Codex GPT-6.1-Sol
import { vi } from "vitest";
import { parseResource } from "../../src/apps/home/lib/model/rdf";

export const STORAGE = "https://pod.example/alice/";
export const WEB_ID = `${STORAGE}profile/card#me`;
export const PREFIXES = `
@prefix schema: <https://schema.org/> .
@prefix old: <http://schema.org/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix health: <https://jeswr.org/ns/sectors/health#> .
@prefix id: <https://jeswr.org/ns/sectors/identity#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
`;

export function rdf(body: string, url = `${STORAGE}item.ttl`) {
  return parseResource(PREFIXES + body, "text/turtle", url);
}

export type Fixture = string | number | Error;

/** A real RDF-over-HTTP seam; unseeded resources are absent, never unexpected successes. */
export function fixtureFetch(fixtures: Record<string, Fixture>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const fixture = fixtures[url] ?? 404;
    if (fixture instanceof Error) throw fixture;
    if (typeof fixture === "number") return new Response(null, { status: fixture });
    return new Response(PREFIXES + fixture, {
      headers: { "content-type": "text/turtle", etag: `"${new URL(url).pathname}"` },
    });
  });
}
