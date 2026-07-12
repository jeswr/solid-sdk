// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-contact-form> — an EDITABLE `vcard:Individual` form, bound to
// `@jeswr/solid-task-model/contacts`. Renders the editable <jeswr-shacl-form>
// against the contact SHACL shape + the resource at `src`, and SAVES via the §10
// MERGE path: it reads the edited FLAT fields (name / organisation / note) out of
// shacl-form's `toRDF()` via the model's typed `Contact` accessor and applies them
// to the LOADED existing graph via the model's typed `Contact` SETTERS.
//
// WHY ONLY THE FLAT FIELDS: a contact's emails/phones/WebID are stored by the model
// as STRUCTURED blank nodes (`vcard:hasEmail [ a vcard:Home; vcard:value <mailto:…> ]`),
// which a generated form cannot edit cleanly. So this Phase-2 form edits the flat
// string fields and the §10 merge PRESERVES the structured email/phone/WebID triples
// untouched (the merge only ever changes the shape-covered predicates — name / org /
// note — so a contact's emails survive an edit of their name). A richer email/phone
// editor is a documented follow-up. No quad is ever hand-built.
//
// XSS: `vcard:fn` etc. are plain string literals; they reach the DOM only through
// shacl-form's text rendering (escaped), never an executable sink.
//
// @solid-class http://www.w3.org/2006/vcard/ns#Individual
// @solid-mode edit
// @solid-cardinality one

import { Contact, personSubject } from "@jeswr/solid-task-model/contacts";
import { DataFactory, type Store } from "n3";
import { AbstractFormElement, findEditedSubject } from "./form-base.js";
import { CONTACT_SHAPE_TTL } from "./shapes.js";

/** `vcard:Individual` — the class IRI the form binds + the merge subject scan keys on. */
const CONTACT_TYPE = "http://www.w3.org/2006/vcard/ns#Individual";

/**
 * An editable `vcard:Individual` contact form element.
 *
 * @solid-class http://www.w3.org/2006/vcard/ns#Individual
 * @solid-mode edit
 * @solid-cardinality one
 *
 * @csspart form  - The inner editable <jeswr-shacl-form>.
 * @csspart empty - Placeholder when no `src` is set.
 */
export class JeswrContactForm extends AbstractFormElement {
  protected override shapeTurtle(): string {
    return CONTACT_SHAPE_TTL;
  }

  protected override applyFormDeltaToExisting(
    formGraph: Store,
    existing: Store,
    resourceUrl: string,
  ): void {
    const writeSubject = personSubject(resourceUrl);
    const readSubject = findEditedSubject(
      formGraph,
      CONTACT_TYPE,
      writeSubject,
      DataFactory.namedNode,
    );
    const edited = new Contact(readSubject, formGraph, DataFactory);
    const target = new Contact(writeSubject, existing, DataFactory).mark();

    // The FLAT fields the form edits, each through the typed setter (undefined
    // clears). The contact's structured emails/phones/WebID are NOT in this form's
    // shape, so they are NOT in `formGraph` and are LEFT UNTOUCHED on `existing` —
    // the §10 merge-not-replace guarantee (an edit of the name preserves the emails).
    target.name = edited.name;
    target.organization = edited.organization;
    target.note = edited.note;
  }
}

if (!customElements.get("jeswr-contact-form")) {
  customElements.define("jeswr-contact-form", JeswrContactForm);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-contact-form": JeswrContactForm;
  }
}
