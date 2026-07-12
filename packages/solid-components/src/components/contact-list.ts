// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-contact-list> — a READ-ONLY list of `vcard:Individual` contacts, bound to
// `@jeswr/solid-task-model/contacts`. It reads an address-book / people-index / any
// RDF document through the Phase-1 DataController and renders every `vcard:Individual`
// subject via the model's TYPED `Contact` accessor (name / emails / phones / WebID /
// org / note) — never a hand-built quad query for the fields.
//
// RDF DISCIPLINE: the only direct quad read is "which subjects are vcard:Individual"
// (an existence scan — no triple built), mirroring PM's typed-views selection. Every
// field is read through the model's `Contact` wrapper (`@rdfjs/wrapper`). The model's
// accessors already DROP non-`mailto:`/`tel:`/non-http(s) values (untrusted input),
// and this element re-filters at the DOM boundary (safeMailto/safeTel/safeHref) so a
// malformed value renders as escaped TEXT, never a clickable/executable href.

import { Contact } from "@jeswr/solid-task-model/contacts";
import { html, type TemplateResult } from "lit";
import { DataFactory, Store } from "n3";
import type { DataController } from "../data-controller.js";
import { RDF_TYPE, VCARD_INDIVIDUAL } from "../vocab.js";
import { AbstractReadElement, safeHref, safeMailto, safeTel, stripScheme } from "./shared.js";

/**
 * A read-only `vcard:Individual` contact-list element.
 *
 * @solid-class http://www.w3.org/2006/vcard/ns#Individual
 * @solid-mode view
 * @solid-cardinality container
 *
 * @csspart list    - The <ul> wrapping the contacts.
 * @csspart contact - One contact <li>.
 * @csspart name    - A contact's display name.
 * @csspart emails  - A contact's email list.
 * @csspart phones  - A contact's phone list.
 * @csspart webid   - A contact's WebID link.
 * @csspart empty   - Placeholder when the graph holds no contacts.
 * @csspart error   - The error message when the read fails.
 * @csspart loading - Placeholder shown while reading.
 */
export class JeswrContactList extends AbstractReadElement {
  protected override async loadFrom(
    controller: DataController,
    src: string,
    publicRead: boolean,
  ): Promise<{ graph: Store; baseUrl: string }> {
    const result = await controller.read(src, publicRead ? { public: true } : {});
    return { graph: result.dataset ?? new Store(), baseUrl: result.url };
  }

  protected override renderReady(graph: Store): TemplateResult {
    const contacts = collectContacts(graph);
    if (contacts.length === 0) {
      return html`<slot name="empty"><p part="empty">No contacts.</p></slot>`;
    }
    return html`
      <ul part="list">
        ${contacts.map((c) => this.#renderContact(c))}
      </ul>
    `;
  }

  #renderContact(contact: Contact): TemplateResult {
    const webIdHref = safeHref(contact.webId);
    return html`
      <li part="contact">
        <span part="name">${contact.name ?? "(unnamed contact)"}</span>
        ${contact.organization ? html`<small>${contact.organization}</small>` : null}
        ${this.#renderEmails(contact.emails)} ${this.#renderPhones(contact.phones)}
        ${
          webIdHref
            ? html`<a part="webid" href=${webIdHref} rel="noopener noreferrer">${contact.webId}</a>`
            : null
        }
        ${contact.note ? html`<p>${contact.note}</p>` : null}
      </li>
    `;
  }

  #renderEmails(emails: string[]): TemplateResult | null {
    if (emails.length === 0) return null;
    return html`<ul part="emails">
      ${emails.map((e) => {
        const href = safeMailto(e);
        const text = stripScheme(e);
        return html`<li>
          ${href ? html`<a href=${href}>${text}</a>` : html`<span>${text}</span>`}
        </li>`;
      })}
    </ul>`;
  }

  #renderPhones(phones: string[]): TemplateResult | null {
    if (phones.length === 0) return null;
    return html`<ul part="phones">
      ${phones.map((p) => {
        const href = safeTel(p);
        const text = stripScheme(p);
        return html`<li>
          ${href ? html`<a href=${href}>${text}</a>` : html`<span>${text}</span>`}
        </li>`;
      })}
    </ul>`;
  }
}

/**
 * Collect every `vcard:Individual`-typed subject in the graph as a typed
 * {@link Contact} wrapper. The subject scan is the ONLY direct quad read (existence
 * query, no triple built). De-duplicated by subject IRI, first-seen order.
 */
function collectContacts(graph: Store): Contact[] {
  const seen = new Set<string>();
  const out: Contact[] = [];
  for (const quad of graph.getQuads(null, DataFactory.namedNode(RDF_TYPE), null, null)) {
    if (quad.object.value !== VCARD_INDIVIDUAL) continue;
    const subject = quad.subject.value;
    if (seen.has(subject)) continue;
    seen.add(subject);
    out.push(new Contact(subject, graph, DataFactory));
  }
  return out;
}

if (!customElements.get("jeswr-contact-list")) {
  customElements.define("jeswr-contact-list", JeswrContactList);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-contact-list": JeswrContactList;
  }
}
