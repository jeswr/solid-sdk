// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { extractMediaType, fetchRdf, parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore, Term } from "@rdfjs/types";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { classAliases } from "./domains";

/** A forgiving read-only wrapper: foreign term kinds never hide valid sibling values. */
export class HomeSubject extends TermWrapper {
  objects(predicate: string): Term[] {
    return classAliases(predicate).flatMap((iri) => [
      ...SetFrom.subjectPredicate(this, iri, TermAs.term, TermFrom.itself),
    ]);
  }

  iris(predicate: string): string[] {
    return this.objects(predicate)
      .filter((term) => term.termType === "NamedNode")
      .map((term) => term.value);
  }

  texts(predicate: string): string[] {
    return this.objects(predicate)
      .filter((term) => term.termType === "Literal")
      .map((term) => term.value);
  }

  get types(): string[] {
    return this.iris(`${NS.RDF}type`);
  }
  get name(): string | undefined {
    return [
      `${NS.SCHEMA}name`,
      `${NS.DCT}title`,
      `${NS.VCARD}fn`,
      `${NS.FOAF}name`,
      `${NS.RDFS}label`,
      `${NS.CAL}summary`,
    ]
      .flatMap((predicate) => this.texts(predicate))
      .find((name) => name.trim().length > 0);
  }
  get sourceUrls(): string[] {
    return this.iris(`${NS.SCHEMA}url`);
  }
  get modified(): string | undefined {
    return this.texts(`${NS.DCT}modified`).find((date) => Number.isFinite(Date.parse(date)));
  }
  get contains(): string[] {
    return this.iris(`${NS.LDP}contains`);
  }
}

export function subjectOf(dataset: DatasetCore, subject: string | Term): HomeSubject {
  return new HomeSubject(
    typeof subject === "string" ? DataFactory.namedNode(subject) : subject,
    dataset,
    DataFactory,
  );
}

/** #it wins over #this, otherwise choose the subject with most statements (first on ties). */
export function primarySubject(dataset: DatasetCore, documentUrl: string): HomeSubject | undefined {
  const document = documentUrl.split("#")[0];
  for (const fragment of ["it", "this"]) {
    const term = DataFactory.namedNode(`${document}#${fragment}`);
    if (dataset.match(term).size > 0) return subjectOf(dataset, term);
  }
  const counts = new Map<string, { term: Term; count: number }>();
  for (const quad of dataset) {
    const key = `${quad.subject.termType}:${quad.subject.value}`;
    const previous = counts.get(key);
    counts.set(key, { term: quad.subject, count: (previous?.count ?? 0) + 1 });
  }
  let best: { term: Term; count: number } | undefined;
  for (const candidate of counts.values()) {
    if (!best || candidate.count > best.count) best = candidate;
  }
  return best ? subjectOf(dataset, best.term) : undefined;
}

/** Only HTTP(S) URLs without embedded credentials can be read or exposed as source links. */
export function httpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

/** Scope by origin and path segments, including encoded-path ambiguity checks. */
export function inStorage(value: string, storage: string): boolean {
  const url = httpUrl(value);
  const root = httpUrl(storage);
  if (!url || !root?.pathname.endsWith("/") || url.origin !== root.origin || url.search)
    return false;
  if (/%(?:2f|5c|2e)/i.test(value)) return false;
  return url.pathname.startsWith(root.pathname);
}

/** The shared parser has no loader option, so reject remote contexts before it can fetch. */
function localJsonLd(body: string): string {
  const document = JSON.parse(body, (key, value: unknown) => {
    if (
      key === "@import" ||
      (key === "@context" && [value].flat(Infinity).some((context) => typeof context === "string"))
    )
      throw new TypeError("Remote JSON-LD contexts are disabled");
    return value;
  });
  // Feed exactly the validated object to the streaming parser, including duplicate-key semantics.
  return JSON.stringify(document);
}

/** Port of PM freshRdf: explicit injection and cache revalidation, with redirects disabled. */
export function readResource(fetch: typeof globalThis.fetch, url: string, signal?: AbortSignal) {
  if (!httpUrl(url)) throw new TypeError("Expected an HTTP(S) resource URL");
  return fetchRdf(url, {
    fetch: async (input, init) => {
      const response = await fetch(input, { ...init, redirect: "error" });
      if (
        response.ok &&
        extractMediaType(response.headers.get("content-type")) === "application/ld+json"
      )
        return new Response(localJsonLd(await response.text()), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      return response;
    },
    headers: { "cache-control": "no-cache" },
    ...(signal ? { signal } : {}),
  });
}

export async function parseResource(body: string, contentType: string, url: string) {
  if (extractMediaType(contentType) === "application/ld+json") body = localJsonLd(body);
  return parseRdf(body, contentType, { baseIRI: url });
}

export function serializeTurtle(dataset: DatasetCore): Promise<string> {
  return serialize([...dataset]);
}
