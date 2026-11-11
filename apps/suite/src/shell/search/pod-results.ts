// AUTHORED-BY Codex GPT-6.1-Sol
import type { SearchResult as SdkResult, SearchPage } from "@jeswr/suite-sdk/search";
import type { AppSlug } from "@jeswr/suite-ui";
import { canonicalize, NS } from "@jeswr/suite-vocab";
import { encodeContactRef } from "../../apps/contacts/state/data";
import { encodeRef } from "../../lib/refs";
import type { SearchResponse, SearchResult } from "../lib/search-results";

/** RDF subjects retain their identity; document editors receive the containing document. */
export function podSearchResult(result: SdkResult): SearchResult {
  const type = canonicalize(result.type ?? "");
  const document = new URL(result.url);
  document.hash = "";
  const ref = encodeRef(document.href);
  let app: AppSlug = "drive";
  let group: SearchResult["type"] = "data";
  let href = `/drive/p/${ref}`;
  if (type === `${NS.WF}Task`) {
    app = "tasks";
    group = "task";
    href = `/tasks/inbox?task=${encodeRef(result.url)}`;
  } else if (
    type === `${NS.SCHEMA}TextDigitalDocument` ||
    (type === `${NS.POD_DOCS}Document` && /\/notes\//u.test(document.pathname))
  ) {
    app = "notes";
    group = "document";
    href = `/notes/n/${ref}`;
  } else if (type === `${NS.POD_DOCS}Document` || type === `${NS.SCHEMA}DigitalDocument`) {
    app = "docs";
    group = "document";
    href = `/docs/d/${ref}`;
  } else if ([`${NS.VCARD}Individual`, `${NS.FOAF}Person`, `${NS.SCHEMA}Person`].includes(type)) {
    app = "contacts";
    group = "person";
    // A standard address-book layout supplies the relative reference Contacts expects.
    // A general WebID/Person row does not identify an address book.
    href = "/contacts";
    if (/\/contacts\/(?:people\/)?[^/]+$/u.test(document.pathname)) {
      try {
        const book = new URL(document.pathname.includes("/people/") ? "../" : "./", result.parent);
        href = `/contacts/c/${encodeContactRef(book.href, document.href)}`;
      } catch {
        // Keep the app link if the Contacts router cannot represent this document.
      }
    }
  } else if (type === `${NS.CAL}Vevent` || type === `${NS.SCHEMA}Event`) {
    app = "calendar";
    href = `/calendar/e/${ref}`;
  } else if (
    [`${NS.LDP}Container`, `${NS.LDP}BasicContainer`].includes(type) ||
    document.pathname.endsWith("/")
  ) {
    group = "file";
    href = `/drive/f/${ref}`;
  } else if (
    !type ||
    type === `${NS.LDP}Resource` ||
    type === `${NS.LDP}NonRDFSource` ||
    type.startsWith("http://www.w3.org/ns/iana/media-types/")
  ) {
    group = /(?:turtle|ld\+json|n-triples|n-quads|trig|rdf\+xml)/iu.test(result.contentType ?? "")
      ? "data"
      : "file";
  }
  return {
    id: result.url,
    title: result.title,
    href,
    type: group,
    app,
    parent: result.parent,
    ...(result.modified ? { modified: result.modified } : {}),
  };
}

export function podSearchResponse(page: SearchPage, scope?: AppSlug): SearchResponse {
  return {
    results: page.results.map(podSearchResult).filter((result) => !scope || result.app === scope),
    source: page.source,
    serverSearch: page.source === "server",
  };
}
