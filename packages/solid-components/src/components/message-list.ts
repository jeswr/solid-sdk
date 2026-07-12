// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-message-list> — a READ-ONLY list of `as:Note` chat messages, bound to
// `@jeswr/solid-chat-interop` (the suite's CANONICAL message shape). It renders
// every `as:Note` subject via the model's TYPED `parseAs2Message` accessor —
// content (text) / published (timestamp) / author (WebID) / inReplyTo (reply edge)
// — never a hand-built quad query for the fields.
//
// A MESSAGE LIST LISTS A CONTAINER (the @solid-cardinality the CEM advertises). A
// chat is normally an LDP container whose messages are SEPARATE resources linked by
// `ldp:contains` (one resource per message, the suite's pod-chat layout), so the
// element WALKS the container: it lists `ldp:contains` children (via the Phase-1
// DataController's `listContainer` — exactly how <jeswr-collection> walks a
// container), fetches each child through the SAME credential seam, parses each
// child's `as:Note` via `parseAs2Message`, and merges them into one graph. It STILL
// supports the inline single-document case (every `as:Note` in one doc — a thread
// document or a single message resource), so both layouts render. The child fetches
// are concurrency-bounded and a failed/denied child is DROPPED, never aborting the
// whole list.
//
// RDF DISCIPLINE: the container walk reads `ldp:contains` through the
// DataController's `listContainer` (a read query — no triple built), mirroring
// <jeswr-collection>. The `as:Note` subject scan is the only other direct quad read
// (an existence query — no triple built), mirroring <jeswr-task-list>/
// <jeswr-bookmark-list>. Every FIELD is read through the model's `parseAs2Message`
// (`@rdfjs/wrapper`-backed typed accessors), so the field mapping is the single
// shared chat model, not a re-implementation. `parseAs2Message` itself is defensive
// (every typed read is THROW-guarded — a malformed foreign literal drops the field
// rather than aborting the parse) and filters every IRI-valued field (author / room
// / inReplyTo) http(s)-only on read.
//
// XSS: the message BODY (`content`) is the primary untrusted, stored-XSS surface —
// it is rendered via Lit text interpolation (`html\`${value}\``), which escapes, so
// a `<script>` / markup-bearing message body renders as inert TEXT, NEVER markup.
// No `unsafeHTML`. The author WebID is shown via the safeHref pattern (http(s)-only
// before it reaches an `<a href>`), matching <jeswr-contact-list>.

import { type CanonicalMessage, parseAs2Message } from "@jeswr/solid-chat-interop";
import { html, type TemplateResult } from "lit";
import { DataFactory, Store } from "n3";
import type { ContainerChild, DataController } from "../data-controller.js";
import { AS_NOTE, RDF_TYPE } from "../vocab.js";
import { AbstractReadElement, safeHref } from "./shared.js";

/**
 * The maximum number of `ldp:contains` children fetched while walking a chat
 * container, and the number fetched at a time. A large room is bounded so a single
 * mount cannot fan out an unbounded number of concurrent requests (a self-inflicted
 * DoS / resource-exhaustion surface). A consumer needing a deeper window paginates
 * by pointing `src` at a sub-container (the pod-chat per-day/-month layout).
 */
const MAX_CHILDREN = 500;
const FETCH_CONCURRENCY = 6;

/**
 * A read-only `as:Note` chat-message list element.
 *
 * (No `@solid-shape`: the chat-interop SHACL shape is an anonymous `sh:NodeShape`
 * with `sh:targetClass as:Note`, so there is no canonical shape IRI to advertise.
 * The `@solid-class` target class is the binding key the resolver maps on.)
 *
 * @solid-class https://www.w3.org/ns/activitystreams#Note
 * @solid-mode view
 * @solid-cardinality container
 *
 * @csspart list     - The <ul> wrapping the messages.
 * @csspart message  - One message <li>.
 * @csspart content  - A message's body text (escaped — never markup).
 * @csspart author   - A message's author (a WebID link when http(s), else text).
 * @csspart time     - A message's published timestamp.
 * @csspart reply    - A message's "in reply to" indicator.
 * @csspart empty    - Placeholder when the graph holds no messages.
 * @csspart error    - The error message when the read fails.
 * @csspart loading  - Placeholder shown while reading.
 */
export class JeswrMessageList extends AbstractReadElement {
  protected override async loadFrom(
    controller: DataController,
    src: string,
    publicRead: boolean,
  ): Promise<{ graph: Store; baseUrl: string }> {
    // Read the target. If it is an LDP container with `ldp:contains` children, this
    // is the per-resource chat layout (one `as:Note` per child resource) — WALK it:
    // fetch each child and merge its messages. Either way we KEEP the target graph's
    // own quads too, so an inline thread document (every `as:Note` in one doc) and a
    // single message resource still render (`ldp:contains` is then empty).
    const listing = await controller.listContainer(src, publicRead ? { public: true } : {});
    const merged = new Store();
    addQuads(merged, listing.dataset);

    // Walk the (capped) child resources, fetching through the SAME credential seam
    // and dropping any that fail/deny — a broken child must never abort the list.
    const children = listing.children.slice(0, MAX_CHILDREN);
    if (children.length > 0) {
      const childGraphs = await fetchChildGraphs(controller, children, publicRead);
      for (const g of childGraphs) addQuads(merged, g);
    }
    return { graph: merged, baseUrl: listing.url };
  }

  protected override renderReady(graph: Store): TemplateResult {
    const messages = collectMessages(graph);
    if (messages.length === 0) {
      return html`<slot name="empty"><p part="empty">No messages.</p></slot>`;
    }
    return html`
      <ul part="list">
        ${messages.map((m) => this.#renderMessage(m))}
      </ul>
    `;
  }

  #renderMessage(message: CanonicalMessage): TemplateResult {
    // The author WebID is an http(s)-filtered IRI from the model; re-filter at the
    // DOM boundary (defence-in-depth) so a hostile value never reaches an `<a href>`.
    const authorHref = safeHref(message.author);
    const time = formatDateTime(message.published);
    return html`
      <li part="message">
        ${
          message.author
            ? authorHref
              ? html`<a part="author" href=${authorHref} rel="noopener noreferrer"
                  >${message.author}</a
                >`
              : html`<span part="author">${message.author}</span>`
            : null
        }
        ${time ? html`<time part="time" datetime=${message.published ?? ""}>${time}</time>` : null}
        <!-- The message body is untrusted: Lit text interpolation escapes it (no
             unsafeHTML), so script/markup in the body renders as inert TEXT. -->
        <p part="content">${message.content}</p>
        ${message.inReplyTo ? html`<small part="reply">In reply to a message</small>` : null}
      </li>
    `;
  }
}

/**
 * Fetch each child resource's graph through the controller (the SAME credential
 * boundary / 4-class error taxonomy as the parent read), bounded to
 * {@link FETCH_CONCURRENCY} in flight at a time. A child that fails to read (404 /
 * access-denied / network / unparseable) is DROPPED — its slot resolves to
 * `undefined` and is filtered out — so one broken message resource never aborts the
 * whole list. Order of the returned graphs is not significant: messages are sorted
 * by `published` at render time.
 */
async function fetchChildGraphs(
  controller: DataController,
  children: readonly ContainerChild[],
  publicRead: boolean,
): Promise<Store[]> {
  const graphs: Store[] = [];
  // A simple fixed-size worker pool over a shared cursor: at most FETCH_CONCURRENCY
  // reads are in flight, so a large room cannot fan out unbounded concurrency.
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < children.length) {
      const child = children[cursor++];
      // A nested container is not a message resource — skip it (don't recurse: a
      // deep multi-level walk is a documented follow-up, and recursing unbounded is
      // a resource-exhaustion surface). Its own `as:Note`s, if any, are not reached.
      if (child.isContainer) continue;
      const graph = await readChild(controller, child.url, publicRead);
      if (graph) graphs.push(graph);
    }
  };
  const pool = Math.min(FETCH_CONCURRENCY, children.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));
  return graphs;
}

/**
 * Read one child resource into a graph, returning `undefined` (DROP) on any failure
 * — the controller throws the 4-class taxonomy error, which we swallow here so a
 * single broken/denied child never aborts the list. A 304 cannot occur (no etag is
 * sent), but a dataset-less result is also dropped defensively.
 */
async function readChild(
  controller: DataController,
  url: string,
  publicRead: boolean,
): Promise<Store | undefined> {
  try {
    const result = await controller.read(url, publicRead ? { public: true } : {});
    return result.dataset;
  } catch {
    return undefined;
  }
}

/** Copy every quad of `from` into `into` (n3 de-duplicates identical quads). */
function addQuads(into: Store, from: Store): void {
  into.addQuads(from.getQuads(null, null, null, null));
}

/**
 * Collect every `as:Note`-typed subject across the (merged) graph as a typed
 * {@link CanonicalMessage} (via the model's `parseAs2Message` accessor), sorted by
 * `published` ascending (chronological — oldest first, the conventional chat order;
 * messages with no timestamp sort last, stable in first-seen order). The subject
 * scan is the ONLY direct quad read here (existence query — no triple built),
 * mirroring the sibling list elements. De-duplicated by subject IRI.
 *
 * Each subject is parsed through `parseAs2Message` (the shared chat model's typed
 * read), which: (a) is internally THROW-guarded so a malformed foreign literal
 * drops the field rather than aborting; and (b) filters every IRI-valued field
 * (author / room / inReplyTo) http(s)-only. A subject that the model does NOT parse
 * as an `as:Note` (returns `undefined`) is skipped — defensive, though the
 * subject-scan already restricted to `as:Note`-typed subjects.
 */
function collectMessages(graph: Store): CanonicalMessage[] {
  const seen = new Set<string>();
  const out: CanonicalMessage[] = [];
  for (const quad of graph.getQuads(null, DataFactory.namedNode(RDF_TYPE), null, null)) {
    if (quad.object.value !== AS_NOTE) continue;
    const subject = quad.subject.value;
    if (seen.has(subject)) continue;
    seen.add(subject);
    const message = parseAs2Message(subject, graph);
    if (message === undefined) continue;
    out.push(message);
  }
  return sortByPublished(out);
}

/**
 * Sort messages by `published` ascending (oldest first). A message with no/unparseable
 * timestamp sorts AFTER timestamped ones, keeping their relative first-seen order
 * (the sort is stable, and we map an absent/NaN time to `+Infinity`).
 */
function sortByPublished(messages: CanonicalMessage[]): CanonicalMessage[] {
  return messages
    .map((m, i) => ({ m, i, t: publishedMillis(m.published) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.m);
}

/** The epoch-millis of an ISO `published`, or `+Infinity` when absent/unparseable. */
function publishedMillis(iso: string | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

/**
 * Format an ISO-8601 timestamp string for display (date + time), or empty string
 * for an absent value. Locale-default; a malformed value renders as empty (never
 * throws). The canonical model carries `published` as an ISO string (see
 * {@link CanonicalMessage.published}).
 */
function formatDateTime(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleString();
  } catch {
    return "";
  }
}

if (!customElements.get("jeswr-message-list")) {
  customElements.define("jeswr-message-list", JeswrMessageList);
}

declare global {
  interface HTMLElementTagNameMap {
    "jeswr-message-list": JeswrMessageList;
  }
}
