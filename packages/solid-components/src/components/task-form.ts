// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-task-form> — an EDITABLE `wf:Task` form, bound to `@jeswr/solid-task-model`.
// It renders the editable <jeswr-shacl-form> against the task SHACL shape + the
// resource at `src`, and SAVES through the §10 MERGE-NOT-REPLACE path: it reads the
// edited values out of shacl-form's `toRDF()` via the model's typed `Task` accessor,
// and applies them to the LOADED existing graph via the model's typed `Task` SETTERS
// — so only the shape-covered predicates change, the DUAL-PREDICATE contract holds
// (the setter writes BOTH wf:description + dct:description), and every untouched
// triple in the resource is preserved. No quad is ever hand-built.
//
// SECURITY (filter-on-WRITE): the `assignee` is a WebID (an IRI), and the model's
// typed setter does NOT filter, so the merge filters it via `safeHref` — a non-http(s)
// edited assignee is dropped, never coerced onto `wf:assignee`. Client SHACL is
// advisory, so the shape's `^https?://` pattern is not the guard; this code is.
//
// @solid-class http://www.w3.org/2005/01/wf/flow#Task
// @solid-mode edit
// @solid-cardinality one

import { Task, taskSubject } from "@jeswr/solid-task-model/task";
import { DataFactory, type Store } from "n3";
import { AbstractFormElement, findEditedSubject } from "./form-base.js";
import { TASK_SHAPE_TTL } from "./shapes.js";
import { safeHref } from "./shared.js";

/** `wf:Task` — the class IRI the form binds + the merge subject scan keys on. */
const TASK_TYPE = "http://www.w3.org/2005/01/wf/flow#Task";

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
export class JeswrTaskForm extends AbstractFormElement {
  protected override shapeTurtle(): string {
    return TASK_SHAPE_TTL;
  }

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
  protected override applyFormDeltaToExisting(
    formGraph: Store,
    existing: Store,
    resourceUrl: string,
  ): void {
    const writeSubject = taskSubject(resourceUrl);
    const readSubject = findEditedSubject(
      formGraph,
      TASK_TYPE,
      writeSubject,
      DataFactory.namedNode,
    );
    const edited = new Task(readSubject, formGraph, DataFactory);
    const target = new Task(writeSubject, existing, DataFactory).mark();

    // Only the SHAPE-COVERED fields are applied, each through the typed setter
    // (undefined clears it). `description`'s setter writes BOTH wf:description +
    // dct:description (the dual-predicate contract). Fields NOT in the editable shape
    // (state, project, rank, blockedBy, …) are DELIBERATELY left untouched on the
    // existing graph — the §10 merge-not-replace guarantee: editing the title must
    // never flip a closed task open or drop its tracker link. (A wider task editor is
    // a documented follow-up.)
    target.title = edited.title;
    target.description = edited.description;
    // assignee is a WebID (IRI security surface); the model setter does NOT filter,
    // so drop a non-http(s) value here (filter-on-write) rather than coerce it.
    target.assignee = safeHref(edited.assignee);
    target.dueDate = edited.dueDate;
    target.priority = edited.priority;
    // Stamp a fresh modified time on each save (the model has a typed setter).
    target.modified = new Date();
  }
}

if (!customElements.get("jeswr-task-form")) {
  customElements.define("jeswr-task-form", JeswrTaskForm);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-task-form": JeswrTaskForm;
  }
}
