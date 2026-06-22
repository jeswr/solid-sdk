// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Shared test fixtures: sample Turtle datasets for each data model + helpers to parse
// them into an n3 Store and to mount/await a Lit element. The fixtures use the EXACT
// predicates the data models read, so a render exercises the real typed accessors.
//
// The "hostile" fixtures carry XSS / SSRF payloads (a `javascript:` url, a `<script>`
// in a literal) so a test can assert the DOM-boundary filtering: an untrusted literal
// renders as escaped TEXT, never executable, and a non-http(s) IRI never reaches an
// href.

import { Parser, Store } from "n3";

/** Parse a Turtle string into an n3 Store (base IRI for relative refs). */
export function parseTurtle(text: string, baseIRI = "https://pod.example/doc"): Store {
  const parser = new Parser({ baseIRI });
  return new Store(parser.parse(text));
}

/** Mount an element by tag, append to the body, await its first render. */
export async function mount<T extends HTMLElement>(tag: string): Promise<T> {
  const el = document.createElement(tag) as T;
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}

/** Flush Lit updates until `predicate` is true, or throw after `tries` attempts. */
export async function waitFor(
  el: HTMLElement,
  predicate: (el: HTMLElement) => boolean,
  message = "condition never became true",
): Promise<void> {
  const updatable = el as unknown as { updateComplete: Promise<unknown> };
  for (let i = 0; i < 60; i++) {
    await updatable.updateComplete;
    await Promise.resolve();
    if (predicate(el)) return;
  }
  throw new Error(`${message} (visible: ${el.textContent?.slice(0, 200)})`);
}

// --- wf:Task fixtures -------------------------------------------------------

export const TASKS_TTL = `
@prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix schema: <http://schema.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<https://pod.example/tasks/1#it> a wf:Task ;
  dct:title "Write the spec" ;
  wf:description "Draft the Phase-1 design doc" ;
  a wf:Open ;
  wf:assignee <https://alice.example/profile/card#me> ;
  schema:priority "high" ;
  wf:dateDue "2026-07-01T00:00:00Z"^^xsd:dateTime .

<https://pod.example/tasks/2#it> a wf:Task ;
  dct:title "Ship it" ;
  a wf:Closed .
`;

// --- vcard:Individual fixtures ----------------------------------------------

export const CONTACTS_TTL = `
@prefix vcard: <http://www.w3.org/2006/vcard/ns#> .

<https://pod.example/contacts/alice#this> a vcard:Individual ;
  vcard:fn "Alice Smith" ;
  vcard:organization-name "ACME Corp" ;
  vcard:hasEmail [ a vcard:Home ; vcard:value <mailto:alice@example.com> ] ;
  vcard:hasTelephone [ a vcard:Cell ; vcard:value <tel:+15550001> ] ;
  vcard:url [ a vcard:WebId ; vcard:value <https://alice.example/profile/card#me> ] ;
  vcard:note "Met at the conf" .

<https://pod.example/contacts/bob#this> a vcard:Individual ;
  vcard:fn "Bob Jones" .
`;

// --- WebID profile fixtures (read via @solid/object Agent) -------------------

export const PROFILE_TTL = `
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
@prefix schema: <http://schema.org/> .

<https://alice.example/profile/card#me> a foaf:Person ;
  foaf:name "Alice Smith" ;
  vcard:organization-name "ACME Corp" ;
  vcard:role "Engineer" ;
  foaf:homepage <https://alice.example/> ;
  foaf:img <https://alice.example/photo.jpg> ;
  solid:oidcIssuer <https://idp.example/> .
`;

// --- book:Bookmark fixtures -------------------------------------------------

export const BOOKMARKS_TTL = `
@prefix book: <https://w3id.org/jeswr/bookmark#> .
@prefix schema: <http://schema.org/> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<https://pod.example/bookmarks/1#it> a book:Bookmark ;
  schema:url <https://example.com/article> ;
  dct:title "A great article" ;
  dct:description "Worth a read" ;
  schema:keywords "reading", "tech" ;
  book:archived false ;
  dct:created "2026-06-01T00:00:00Z"^^xsd:dateTime .

<https://pod.example/bookmarks/2#it> a book:Bookmark ;
  schema:url <https://example.com/other> ;
  dct:title "Archived one" ;
  book:archived true .
`;

// --- as:Note message fixtures (read via @jeswr/solid-chat-interop) ----------

export const MESSAGES_TTL = `
@prefix as: <https://www.w3.org/ns/activitystreams#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<https://pod.example/chat/1#it> a as:Note ;
  as:content "Hello, world" ;
  as:attributedTo <https://alice.example/profile/card#me> ;
  as:published "2026-06-01T09:00:00Z"^^xsd:dateTime ;
  as:context <https://pod.example/chat/room#it> .

<https://pod.example/chat/2#it> a as:Note ;
  as:content "Replying to you" ;
  as:attributedTo <https://bob.example/profile/card#me> ;
  as:published "2026-06-01T09:05:00Z"^^xsd:dateTime ;
  as:inReplyTo <https://pod.example/chat/1#it> .
`;

// --- LDP container fixtures -------------------------------------------------

export const CONTAINER_TTL = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .

<https://pod.example/data/> a ldp:Container, ldp:BasicContainer ;
  ldp:contains <https://pod.example/data/notes.ttl>, <https://pod.example/data/sub/> .

<https://pod.example/data/sub/> a ldp:Container .
`;

// --- HOSTILE fixtures (untrusted-input / XSS / SSRF assertions) -------------

/** A bookmark whose url is `javascript:` — must NOT render as an href. */
export const HOSTILE_BOOKMARK_TTL = `
@prefix book: <https://w3id.org/jeswr/bookmark#> .
@prefix schema: <http://schema.org/> .
@prefix dct: <http://purl.org/dc/terms/> .
<https://pod.example/bookmarks/evil#it> a book:Bookmark ;
  schema:url <javascript:alert(1)> ;
  dct:title "click me" .
`;

/** A task whose title carries a script-like literal — must render as escaped text. */
export const XSS_TASK_TTL = `
@prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
@prefix dct: <http://purl.org/dc/terms/> .
<https://pod.example/tasks/x#it> a wf:Task ;
  dct:title "<img src=x onerror=alert(1)>" ;
  a wf:Open .
`;

/**
 * A message whose body carries script-like markup AND a hostile (`javascript:`)
 * author IRI — the body must render as escaped TEXT (never live markup) and the
 * author must NOT become an href. (`parseAs2Message` already drops the non-http(s)
 * author; safeHref re-checks at the DOM boundary.)
 */
export const XSS_MESSAGE_TTL = `
@prefix as: <https://www.w3.org/ns/activitystreams#> .
<https://pod.example/chat/evil#it> a as:Note ;
  as:content "<img src=x onerror=alert(1)><script>alert(2)</script>" ;
  as:attributedTo <javascript:alert(3)> .
`;

/** A contact whose email/webId are hostile schemes — must not become links. */
export const HOSTILE_CONTACT_TTL = `
@prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
<https://pod.example/contacts/evil#this> a vcard:Individual ;
  vcard:fn "<script>alert(1)</script>" ;
  vcard:hasEmail [ a vcard:Home ; vcard:value <javascript:alert(1)> ] ;
  vcard:url [ a vcard:WebId ; vcard:value <javascript:alert(1)> ] .
`;
