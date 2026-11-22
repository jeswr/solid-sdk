// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import { LiteralAs, NamedNodeAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { type ChipRef, chipIri, chipKind, type ResolvedChip } from "./core.js";

type Metadata = Omit<ResolvedChip, "label" | "kind" | "icon"> &
  Partial<Pick<ResolvedChip, "label" | "kind" | "icon">>;
// Weakly scoped to the caller's session transport; no identity's metadata crosses sessions.
const caches = new WeakMap<
  typeof fetch,
  Map<string, { expires: number; value: Promise<Metadata> }>
>();
const DC = "http://purl.org/dc/terms/";
const SCHEMA = "https://schema.org/";

function first<T>(
  subject: TermWrapper,
  predicates: string[],
  read: (subject: TermWrapper, predicate: string) => T | undefined,
): T | undefined {
  for (const predicate of predicates) {
    try {
      const value = read(subject, predicate);
      if (value) return value;
    } catch {
      /* A malformed preferred predicate must not hide the next fallback. */
    }
  }
  return undefined;
}

/** Read display metadata, never binary bytes. Call with the active session's bounded fetch. */
export async function resolveChip(
  iri: string,
  options: { fetch: typeof fetch; label?: string; kind?: ChipRef["kind"] },
): Promise<ResolvedChip> {
  if (!chipIri(iri)) throw new TypeError("Invalid chip IRI");
  let cache = caches.get(options.fetch);
  if (!cache) {
    cache = new Map();
    caches.set(options.fetch, cache);
  }
  let entry = cache.get(iri);
  if (!entry || entry.expires <= Date.now()) {
    // Bound memory even when a long-running account opens many distinct resources.
    if (cache.size >= 256) cache.delete(cache.keys().next().value as string);
    const value = (async (): Promise<Metadata> => {
      try {
        const { dataset } = await fetchRdf(iri, {
          fetch: options.fetch,
          maxBytes: 256 * 1024,
          maxQuads: 5000,
        });
        const subject = new TermWrapper(iri, dataset, DataFactory);
        const label = first(
          subject,
          [
            `${DC}title`,
            `${SCHEMA}name`,
            "http://schema.org/name",
            "http://www.w3.org/2006/vcard/ns#fn",
            "http://xmlns.com/foaf/0.1/name",
            "http://www.w3.org/2000/01/rdf-schema#label",
            "http://www.w3.org/2002/12/cal/ical#summary",
          ],
          (s, p) =>
            OptionalFrom.subjectPredicate(s, p, (term) => {
              if (term.termType !== "Literal") throw new TypeError("Expected literal");
              return LiteralAs.string(term);
            }),
        );
        const type = first(subject, ["http://www.w3.org/1999/02/22-rdf-syntax-ns#type"], (s, p) =>
          OptionalFrom.subjectPredicate(s, p, NamedNodeAs.string),
        );
        const owner = first(
          subject,
          [`${DC}creator`, `${SCHEMA}creator`, "http://www.w3.org/ns/prov#wasAttributedTo"],
          (s, p) => OptionalFrom.subjectPredicate(s, p, NamedNodeAs.string),
        );
        return {
          iri,
          readable: true,
          label,
          kind: type ? chipKind(type) : undefined,
          owner: owner && chipIri(owner) ? owner : undefined,
        };
      } catch (error) {
        // A successful non-RDF response is a readable file; it has no RDF display metadata.
        if (
          error instanceof RdfFetchError &&
          error.status === undefined &&
          error.contentType &&
          !/^(text\/turtle|application\/(ld\+json|n-triples|n-quads|trig))(;|$)/i.test(
            error.contentType,
          )
        )
          return { iri, readable: true };
        return { iri, readable: false, icon: "lock" };
      }
    })();
    entry = { expires: Date.now() + 30_000, value };
    cache.set(iri, entry);
  }
  const metadata = await entry.value;
  const kind = metadata.kind ?? options.kind ?? "link";
  return {
    ...metadata,
    label: metadata.label ?? options.label ?? iri,
    kind,
    icon: metadata.icon ?? kind,
  };
}
