import { type Store } from "n3";
import { AbstractFormElement } from "./form-base.js";
/**
 * An editable `wf:Task` form element.
 *
 * @solid-class http://www.w3.org/2005/01/wf/flow#Task
 * @solid-mode edit
 * @solid-cardinality one
 *
 * @csspart form   - The inner editable <jeswr-shacl-form>.
 * @csspart empty  - Placeholder when no `src` is set.
 */
export declare class JeswrTaskForm extends AbstractFormElement {
    protected shapeTurtle(): string;
    /**
     * Apply the edited task fields from the form graph onto the existing graph, via the
     * model's typed `Task` accessor on each. Reads through `new Task(readSubject,
     * formGraph)` (the form's edited node, which shacl-form may have minted) and writes
     * through `new Task(writeSubject, existing)` (the resource's conventional `#it`) —
     * so the saved triples land on `${url}#it` regardless of shacl-form's minted IRI.
     * Only the shape's predicates change; the `description` setter writes BOTH
     * wf:description + dct:description (the dual-predicate contract); every untouched
     * triple on `existing` (and on OTHER subjects) is preserved.
     */
    protected applyFormDeltaToExisting(formGraph: Store, existing: Store, resourceUrl: string): void;
}
declare global {
    interface HTMLElementTagNameMap {
        "jeswr-task-form": JeswrTaskForm;
    }
}
