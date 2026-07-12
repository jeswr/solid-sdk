// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-bookmark-form> — an EDITABLE `book:Bookmark` form, bound to
// `@jeswr/solid-bookmark`. Renders the editable <jeswr-shacl-form> against the
// bookmark SHACL shape + the resource at `src`, and SAVES via the §10 MERGE path:
// it reads the edited fields out of shacl-form's `toRDF()` via the model's typed
// `Bookmark` accessor and applies them to the LOADED existing graph via the model's
// typed `Bookmark` SETTERS — so only the shape-covered predicates change and every
// untouched triple is preserved. No quad is ever hand-built.
//
// SECURITY (filter-on-WRITE): the model's typed `url` SETTER does NOT filter — it
// writes whatever value it is given (only the model's `buildBookmark`/`parseBookmark`
// FUNCTIONS apply the http(s) filter). So this merge MUST filter the edited `url`
// itself before the setter: a non-http(s) value (a hostile `javascript:`/`data:` URL
// edited in) is dropped via `safeHref`, never coerced onto the stored `schema:url`.
// Client SHACL validation is advisory (UX, not authz), so the shape's `^https?://`
// pattern is NOT a sufficient guard — this code-level filter is the real one.
//
// @solid-class https://w3id.org/jeswr/bookmark#Bookmark
// @solid-mode edit
// @solid-cardinality one

import { Bookmark, bookmarkSubject } from "@jeswr/solid-bookmark";
import { DataFactory, type Store } from "n3";
import { AbstractFormElement, findEditedSubject } from "./form-base.js";
import { BOOKMARK_SHAPE_TTL } from "./shapes.js";
import { safeHref } from "./shared.js";

/** `book:Bookmark` — the class IRI the form binds + the merge subject scan keys on. */
const BOOKMARK_TYPE = "https://w3id.org/jeswr/bookmark#Bookmark";

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
export class JeswrBookmarkForm extends AbstractFormElement {
  protected override shapeTurtle(): string {
    return BOOKMARK_SHAPE_TTL;
  }

  protected override applyFormDeltaToExisting(
    formGraph: Store,
    existing: Store,
    resourceUrl: string,
  ): void {
    const writeSubject = bookmarkSubject(resourceUrl);
    const readSubject = findEditedSubject(
      formGraph,
      BOOKMARK_TYPE,
      writeSubject,
      DataFactory.namedNode,
    );
    const edited = new Bookmark(readSubject, formGraph, DataFactory);
    const target = new Bookmark(writeSubject, existing, DataFactory).mark();

    // The `url` is a security surface (the bookmark's clickable href + a stored-XSS
    // vector) and the model's setter does NOT filter, so we filter HERE: a non-http(s)
    // edited url is dropped (`safeHref` → undefined → the setter clears it), never
    // coerced onto `schema:url`. (`undefined` also lets a user clear a bad url.)
    target.url = safeHref(edited.url);
    target.title = edited.title;
    target.description = edited.description;
    target.notes = edited.notes;
    target.archived = edited.archived;

    // Tags are a live Set: clear the existing set, then add the edited ones (so a
    // removed tag is dropped + a new one added — only schema:keywords changes).
    for (const t of [...target.tags]) target.tags.delete(t);
    for (const t of edited.tags) target.tags.add(t);

    // Stamp a fresh modified time on each save (typed setter).
    target.modified = new Date();
  }
}

if (!customElements.get("jeswr-bookmark-form")) {
  customElements.define("jeswr-bookmark-form", JeswrBookmarkForm);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-bookmark-form": JeswrBookmarkForm;
  }
}
