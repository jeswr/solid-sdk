import { type Store } from "n3";
import { AbstractFormElement } from "./form-base.js";
/**
 * An editable `book:Bookmark` form element.
 *
 * @solid-class https://w3id.org/jeswr/bookmark#Bookmark
 * @solid-mode edit
 * @solid-cardinality one
 *
 * @csspart form  - The inner editable <jeswr-shacl-form>.
 * @csspart empty - Placeholder when no `src` is set.
 */
export declare class JeswrBookmarkForm extends AbstractFormElement {
    protected shapeTurtle(): string;
    protected applyFormDeltaToExisting(formGraph: Store, existing: Store, resourceUrl: string): void;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-bookmark-form": JeswrBookmarkForm;
    }
}
