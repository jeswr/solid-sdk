// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-bookmark-list> — a READ-ONLY list of `book:Bookmark` items, bound to
// `@jeswr/solid-bookmark`. It reads a document/container through the Phase-1
// DataController and renders every `book:Bookmark` subject via the model's TYPED
// `Bookmark` accessor (url / title / description / tags / archived) — never a
// hand-built quad query for the fields.
//
// RDF DISCIPLINE: the only direct quad read is the `book:Bookmark` subject scan
// (existence query, no triple built). Every field is read through the model's
// `Bookmark` wrapper (`@rdfjs/wrapper`). The model already drops a non-http(s)
// `schema:url` on read (the bookmark's url is its clickable href + a security-
// sensitive surface), and this element re-filters at the DOM boundary (safeHref) so a
// hostile `javascript:`/`data:` url never reaches an `<a href>`.

import { Bookmark } from "@jeswr/solid-bookmark";
import { html, type TemplateResult } from "lit";
import { DataFactory, Store } from "n3";
import type { DataController } from "../data-controller.js";
import { BOOKMARK_CLASS, RDF_TYPE } from "../vocab.js";
import { AbstractReadElement, formatDate, safeHref } from "./shared.js";

/**
 * A read-only `book:Bookmark` list element.
 *
 * @solid-class https://w3id.org/jeswr/bookmark#Bookmark
 * @solid-mode view
 * @solid-cardinality container
 *
 * @csspart list     - The <ul> wrapping the bookmarks.
 * @csspart bookmark - One bookmark <li>.
 * @csspart title    - A bookmark's title (a link to its url).
 * @csspart tags     - A bookmark's tag list.
 * @csspart meta     - A bookmark's metadata (created / archived).
 * @csspart empty    - Placeholder when the graph holds no bookmarks.
 * @csspart error    - The error message when the read fails.
 * @csspart loading  - Placeholder shown while reading.
 */
export class JeswrBookmarkList extends AbstractReadElement {
  protected override async loadFrom(
    controller: DataController,
    src: string,
    publicRead: boolean,
  ): Promise<{ graph: Store; baseUrl: string }> {
    const result = await controller.read(src, publicRead ? { public: true } : {});
    return { graph: result.dataset ?? new Store(), baseUrl: result.url };
  }

  protected override renderReady(graph: Store): TemplateResult {
    const bookmarks = collectBookmarks(graph);
    if (bookmarks.length === 0) {
      return html`<slot name="empty"><p part="empty">No bookmarks.</p></slot>`;
    }
    return html`
      <ul part="list">
        ${bookmarks.map((b) => this.#renderBookmark(b))}
      </ul>
    `;
  }

  #renderBookmark(bookmark: Bookmark): TemplateResult {
    const href = safeHref(bookmark.url);
    const title = bookmark.title ?? bookmark.url ?? "(untitled bookmark)";
    const tags = [...bookmark.tags].sort();
    const meta: string[] = [];
    const created = formatDate(bookmark.created);
    if (created) meta.push(`Added: ${created}`);
    if (bookmark.archived) meta.push("Archived");
    return html`
      <li part="bookmark" data-archived=${bookmark.archived ? "true" : "false"}>
        ${
          href
            ? html`<a part="title" href=${href} rel="noopener noreferrer">${title}</a>`
            : html`<span part="title">${title}</span>`
        }
        ${bookmark.description ? html`<p>${bookmark.description}</p>` : null}
        ${
          tags.length > 0
            ? html`<ul part="tags">
              ${tags.map((t) => html`<li>${t}</li>`)}
            </ul>`
            : null
        }
        ${meta.length > 0 ? html`<small part="meta">${meta.join(" · ")}</small>` : null}
      </li>
    `;
  }
}

/**
 * Collect every `book:Bookmark`-typed subject in the graph as a typed {@link Bookmark}
 * wrapper. The subject scan is the ONLY direct quad read (existence query, no triple
 * built). De-duplicated by subject IRI, first-seen order.
 *
 * SECURITY: a bookmark whose `schema:url` is NOT an http(s) IRI is DROPPED — exactly
 * the model's `parseBookmark` stance ("a bookmark with no usable URL is not a usable
 * bookmark"). The url is the bookmark's clickable href + a stored-XSS surface, so a
 * hostile `javascript:`/`data:` url means the whole bookmark is omitted, not just
 * shown without a link. (safeHref re-checks at the DOM boundary as defence-in-depth.)
 */
function collectBookmarks(graph: Store): Bookmark[] {
  const seen = new Set<string>();
  const out: Bookmark[] = [];
  for (const quad of graph.getQuads(null, DataFactory.namedNode(RDF_TYPE), null, null)) {
    if (quad.object.value !== BOOKMARK_CLASS) continue;
    const subject = quad.subject.value;
    if (seen.has(subject)) continue;
    seen.add(subject);
    const bookmark = new Bookmark(subject, graph, DataFactory);
    // Match parseBookmark: reject a bookmark whose url is missing / not http(s).
    if (!safeHref(bookmark.url)) continue;
    out.push(bookmark);
  }
  return out;
}

if (!customElements.get("jeswr-bookmark-list")) {
  customElements.define("jeswr-bookmark-list", JeswrBookmarkList);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-bookmark-list": JeswrBookmarkList;
  }
}
