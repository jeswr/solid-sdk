// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-collection> — a generic, READ-ONLY LDP container listing. Point it at a
// container and it lists the `ldp:contains` children (name + is-it-a-container)
// through the Phase-1 DataController's `listContainer` — the typed-class-agnostic
// fallback `<solid-view>` mounts for an untyped container.
//
//   <jeswr-collection src="https://alice.example/"></jeswr-collection>
//
// THE TYPE-INDEX SEAM: where a pod publishes a Solid Type Index, a consumer can pass
// `typeIndex` entries (`{ class, instanceContainer }`) so a child container can be
// LABELLED by the class it holds. Phase-1 ships the seam (the `typeIndex` property +
// the label lookup) but does NOT itself fetch the type index — discovering it is the
// `solid-type-index` skill's job and a documented follow-up; a consumer that already
// has the registrations injects them. With no entries the listing is a plain child
// list, which is always correct.
//
// RDF DISCIPLINE: the listing is read entirely through `DataController.listContainer`
// (which reads `ldp:contains` off the parsed graph — no triple built). The child URL
// is http(s)-filtered (safeHref) before binding to an `<a href>`.

import { html, type TemplateResult } from "lit";
import type { Store } from "n3";
import type { ContainerChild, DataController } from "../data-controller.js";
import { AbstractReadElement, BASE_INPUT_PROPS, safeHref } from "./shared.js";

/** A Solid Type Index registration (the seam a consumer injects). */
export interface TypeIndexEntry {
  /** The registered RDF class IRI (`solid:forClass`). */
  readonly class: string;
  /** The container that holds instances of that class (`solid:instanceContainer`). */
  readonly instanceContainer: string;
}

/**
 * A generic LDP container listing element.
 *
 * (No `@solid-class` for a NAMED model class: it binds the generic `ldp:Container` /
 * `ldp:BasicContainer` — declared in the resolver map as the lowest-priority fallback
 * — rather than a domain class. Advertised here so the CEM still records the binding.)
 *
 * @solid-class http://www.w3.org/ns/ldp#Container
 * @solid-mode view
 * @solid-cardinality container
 *
 * @csspart list    - The <ul> of children.
 * @csspart child   - One child <li>.
 * @csspart link    - A child's link.
 * @csspart type    - A child's container/type badge.
 * @csspart empty   - Placeholder when the container is empty.
 * @csspart error   - The error message when the read fails.
 * @csspart loading - Placeholder shown while reading.
 */
export class JeswrCollection extends AbstractReadElement {
  /**
   * Optional injected Solid Type Index registrations, so a child container that is a
   * registered `solid:instanceContainer` is labelled by its class. Phase-1 does not
   * fetch the index itself (a documented follow-up); a consumer with the registrations
   * passes them here.
   */
  declare typeIndex: TypeIndexEntry[] | undefined;

  /** The children of the last listing (kept so render uses the listing, not a re-scan). */
  #children: ContainerChild[] = [];

  static override get properties() {
    return {
      ...AbstractReadElement.properties,
      typeIndex: { attribute: false },
    };
  }

  constructor() {
    super();
    this.typeIndex = undefined;
  }

  protected override inputProps(): readonly string[] {
    // EXTEND the base set (spread it) so this element inherits every base input —
    // incl. `publicRead` — and cannot drift from it; add only `typeIndex` here.
    return [...BASE_INPUT_PROPS, "typeIndex"];
  }

  protected override async loadFrom(
    controller: DataController,
    src: string,
    publicRead: boolean,
  ): Promise<{ graph: Store; baseUrl: string }> {
    // listContainer reads the container graph + collects ldp:contains children.
    const listing = await controller.listContainer(src, publicRead ? { public: true } : {});
    this.#children = listing.children;
    return { graph: listing.dataset, baseUrl: listing.url };
  }

  protected override renderReady(): TemplateResult {
    const children = this.#children;
    if (children.length === 0) {
      return html`<slot name="empty"><p part="empty">Empty container.</p></slot>`;
    }
    const labels = typeIndexLabels(this.typeIndex);
    return html`
      <ul part="list">
        ${children.map((child) => this.#renderChild(child, labels))}
      </ul>
    `;
  }

  #renderChild(child: ContainerChild, labels: ReadonlyMap<string, string>): TemplateResult {
    const href = safeHref(child.url);
    const label = labels.get(child.url);
    const text = displayName(child.url);
    return html`
      <li part="child" data-container=${child.isContainer ? "true" : "false"}>
        ${
          href
            ? html`<a part="link" href=${href} rel="noopener noreferrer">${text}</a>`
            : html`<span part="link">${text}</span>`
        }
        ${child.isContainer ? html`<span part="type">container</span>` : null}
        ${label ? html`<span part="type">${label}</span>` : null}
      </li>
    `;
  }
}

/** Build a `containerUrl -> "holds <ClassLocalName>"` label map from type-index entries. */
function typeIndexLabels(entries: TypeIndexEntry[] | undefined): ReadonlyMap<string, string> {
  const m = new Map<string, string>();
  for (const e of entries ?? []) {
    // Only http(s) container IRIs are honoured (untrusted-injection discipline), and
    // only the class local-name is shown as a label (not the full IRI, for brevity).
    if (!safeHref(e.instanceContainer)) continue;
    m.set(e.instanceContainer, `holds ${localName(e.class)}`);
  }
  return m;
}

/** A friendly display name for a child URL: the last path segment (decoded). */
function displayName(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.replace(/\/$/, "").split("/");
    const last = segments[segments.length - 1] || u.pathname || url;
    return decodeURIComponent(last);
  } catch {
    return url;
  }
}

/** The local name of a class IRI (after the last `#` or `/`), for a compact label. */
function localName(iri: string): string {
  const hash = iri.lastIndexOf("#");
  const slash = iri.lastIndexOf("/");
  const cut = Math.max(hash, slash);
  return cut >= 0 && cut < iri.length - 1 ? iri.slice(cut + 1) : iri;
}

if (!customElements.get("jeswr-collection")) {
  customElements.define("jeswr-collection", JeswrCollection);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-collection": JeswrCollection;
  }
}
