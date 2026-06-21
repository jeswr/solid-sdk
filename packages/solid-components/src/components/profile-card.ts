// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-profile-card> — a READ-ONLY WebID profile card, bound to `@solid/object`'s
// `Agent` (the suite's vetted WebID typed accessor). Point it at a WebID and it reads
// the profile document and renders name / photo / org / role / website / OIDC issuer
// via `@solid/object`'s fallback-chained accessors (FOAF ⇆ vcard) — never a hand-built
// quad query.
//
//   <jeswr-profile-card src="https://alice.example/profile/card#me"></jeswr-profile-card>
//
// CARDINALITY ONE — a single profile, not a container. The `src` IS the WebID
// subject; the DataController fetches its document (the fetch strips the fragment) and
// the `Agent` is constructed on the full WebID IRI within that graph.
//
// RDF DISCIPLINE: all field access goes through `@solid/object`'s `Agent` typed
// accessors. The photo + website + WebID + OIDC-issuer IRIs are http(s)-filtered at
// the DOM boundary (safeHref) before being bound to an `<img src>` / `<a href>`, so an
// untrusted `javascript:`/`data:` value in a foreign profile can never reach an
// executable sink — it renders as escaped text or is dropped.

import { Agent } from "@solid/object/webid";
import { html, type TemplateResult } from "lit";
import { DataFactory, Store } from "n3";
import type { DataController } from "../data-controller.js";
import { AbstractReadElement, safeHref } from "./shared.js";

// Fallback predicates read directly off the graph when `@solid/object`'s Agent
// accessor returns nothing for the form a particular pod used (the Agent accessors
// pin specific predicates + term types — e.g. `photoUrl` reads ONLY `vcard:hasPhoto`
// as a literal, `website` reads `foaf:homepage` as a LITERAL — so a pod that writes
// `foaf:img` or an IRI-typed homepage is invisible to them). The fallback reads
// EITHER a literal or a NamedNode value, mirroring the suite's tolerant-read rule.
const VCARD_ORG_NAME = "http://www.w3.org/2006/vcard/ns#organization-name";
const VCARD_ROLE = "http://www.w3.org/2006/vcard/ns#role";
const SCHEMA_NAME = "http://schema.org/name";
/** Image predicates, in fallback order. */
const IMG_PREDICATES = [
  "http://www.w3.org/2006/vcard/ns#hasPhoto",
  "http://xmlns.com/foaf/0.1/img",
  "http://xmlns.com/foaf/0.1/depiction",
  "http://schema.org/image",
];
/** Homepage / website predicates, in fallback order. */
const SITE_PREDICATES = [
  "http://www.w3.org/2006/vcard/ns#url",
  "http://xmlns.com/foaf/0.1/homepage",
  "http://schema.org/url",
];

/**
 * A read-only WebID profile card.
 *
 * (No `@solid-class`: a WebID profile has no single canonical `rdf:type` — it is
 * identified by being a `solid:oidcIssuer`-bearing / `foaf:Person` subject — so this
 * element is bound by IRI, not auto-resolved by `<solid-view>` on rdf:type. It is the
 * composition target a contact's WebID link or an explicit `src` points at.)
 *
 * @solid-mode view
 * @solid-cardinality one
 *
 * @csspart card    - The profile card wrapper.
 * @csspart photo   - The avatar image.
 * @csspart name    - The display name.
 * @csspart org     - The organisation / role line.
 * @csspart website - The homepage link.
 * @csspart webid   - The WebID link.
 * @csspart empty   - Placeholder when the profile holds no renderable fields.
 * @csspart error   - The error message when the read fails.
 * @csspart loading - Placeholder shown while reading.
 */
export class JeswrProfileCard extends AbstractReadElement {
  protected override async loadFrom(
    controller: DataController,
    src: string,
    publicRead: boolean,
  ): Promise<{ graph: Store; baseUrl: string }> {
    // The DataController fetches `src`'s DOCUMENT (the fetch impl drops the #fragment).
    // We keep the FULL WebID (`src`) as the subject base so the Agent reads the right
    // subject regardless of the post-redirect document URL.
    const result = await controller.read(src, publicRead ? { public: true } : {});
    // baseUrl = the WebID subject IRI (src), NOT the document URL: the profile's
    // subject is the WebID, and that is what the Agent must be constructed on.
    return { graph: result.dataset ?? new Store(), baseUrl: src };
  }

  protected override renderReady(graph: Store, baseUrl: string): TemplateResult {
    const fields = readProfileFields(graph, baseUrl);

    // The document holds NO triple about the WebID subject AND no renderable field →
    // there is no profile to show (the @solid/object-derived name + the bare WebID do
    // not, alone, constitute a profile — see readProfileFields).
    const hasProfileData =
      graph.getQuads(DataFactory.namedNode(baseUrl), null, null, null).length > 0;
    const { name, photo, website, org, role, issuer } = fields;
    if (!hasProfileData && !photo && !website && !org && !role && !issuer) {
      return html`<slot name="empty"><p part="empty">No profile to display.</p></slot>`;
    }

    const webId = safeHref(baseUrl);
    return html`
      <article part="card">
        ${
          photo
            ? html`<img part="photo" src=${photo} alt=${name ? `${name}'s avatar` : "avatar"} />`
            : null
        }
        <h2 part="name">${name ?? "(unnamed)"}</h2>
        ${org || role ? html`<p part="org">${[role, org].filter(Boolean).join(" · ")}</p>` : null}
        ${
          website
            ? html`<a part="website" href=${website} rel="noopener noreferrer">${website}</a>`
            : null
        }
        ${
          webId
            ? html`<a part="webid" href=${webId} rel="noopener noreferrer">${baseUrl}</a>`
            : null
        }
        ${issuer ? html`<small part="issuer">Issuer: ${issuer}</small>` : null}
      </article>
    `;
  }
}

/** The renderable fields of a profile (each already filtered/escaped at its source). */
interface ProfileFields {
  readonly name: string | undefined;
  readonly photo: string | undefined;
  readonly website: string | undefined;
  readonly org: string | undefined;
  readonly role: string | undefined;
  readonly issuer: string | undefined;
}

/**
 * Read the renderable profile fields off the WebID subject. Each goes through
 * `@solid/object`'s `Agent` typed accessor FIRST (the vetted FOAF/vcard fallback
 * chain) with a tolerant graph fallback for the form the Agent's pinned predicate /
 * term-type does not match — and through `tryRead` so a single malformed field never
 * aborts the render (untrusted-input discipline; the Agent accessors throw a
 * `TermTypeError` on an unexpected term type, e.g. an organisation stored as a
 * literal). The photo/website/issuer IRIs are http(s)-filtered (safeHref).
 *
 * NOTE: `Agent.name` deliberately falls back to the WebID's last path segment when no
 * `foaf:name`/`vcard:fn` is present (its always-show-something contract), so `name` is
 * non-undefined whenever there is a WebID — the caller uses `hasProfileData`, not
 * `name`, to decide the empty state.
 */
function readProfileFields(graph: Store, baseUrl: string): ProfileFields {
  const agent = new Agent(baseUrl, graph, DataFactory);
  return {
    name: tryRead(() => agent.name) ?? readValue(graph, baseUrl, [SCHEMA_NAME]) ?? undefined,
    photo: safeHref(tryRead(() => agent.photoUrl) ?? readValue(graph, baseUrl, IMG_PREDICATES)),
    website: safeHref(tryRead(() => agent.website) ?? readValue(graph, baseUrl, SITE_PREDICATES)),
    org: tryRead(() => agent.organization) ?? readValue(graph, baseUrl, [VCARD_ORG_NAME]),
    role:
      tryRead(() => agent.role) ??
      tryRead(() => agent.title) ??
      readValue(graph, baseUrl, [VCARD_ROLE]),
    issuer: safeHref(tryRead(() => [...agent.oidcIssuer][0])),
  };
}

/**
 * Read a typed accessor, returning `undefined` instead of throwing — the suite's
 * untrusted-input "drop the field, never abort the render" discipline. `@solid/object`
 * Agent accessors throw a `TermTypeError` when a pod stores a field with an unexpected
 * term type (e.g. an organisation as a literal where the accessor expects a NamedNode).
 */
function tryRead<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * Read the first `subject <predicate> ?o` value off the graph for the FIRST predicate
 * (in order) that has one — accepting EITHER a `Literal` or a `NamedNode` object (a
 * direct read query, no triple built). The tolerant fallback for a field whose term
 * type / predicate `@solid/object`'s pinned accessor does not match.
 */
function readValue(graph: Store, subject: string, predicates: string[]): string | undefined {
  const s = DataFactory.namedNode(subject);
  for (const predicate of predicates) {
    for (const quad of graph.getQuads(s, DataFactory.namedNode(predicate), null, null)) {
      if (quad.object.termType === "Literal" || quad.object.termType === "NamedNode") {
        return quad.object.value;
      }
    }
  }
  return undefined;
}

if (!customElements.get("jeswr-profile-card")) {
  customElements.define("jeswr-profile-card", JeswrProfileCard);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-profile-card": JeswrProfileCard;
  }
}
