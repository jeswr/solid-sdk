import { type Store } from "n3";
import { AbstractFormElement } from "./form-base.js";
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
export declare class JeswrContactForm extends AbstractFormElement {
    protected shapeTurtle(): string;
    protected applyFormDeltaToExisting(formGraph: Store, existing: Store, resourceUrl: string): void;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-contact-form": JeswrContactForm;
    }
}
