// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-message-list> — a READ-ONLY list of `as:Note` chat messages, bound to
// `@jeswr/solid-chat-interop` (the suite's CANONICAL message shape). It reads a
// document / container through the Phase-1 DataController and renders every
// `as:Note` subject via the model's TYPED `parseAs2Message` accessor — content
// (text) / published (timestamp) / author (WebID) / inReplyTo (reply edge) —
// never a hand-built quad query for the fields.
//
// RDF DISCIPLINE: the only direct quad read is the `as:Note` subject scan (an
// existence query — no triple built), exactly mirroring the sibling
// <jeswr-task-list>/<jeswr-bookmark-list> subject discovery (PM's typed-views
// selection). Every FIELD is read through the model's `parseAs2Message`
// (`@rdfjs/wrapper`-backed typed accessors), so the field mapping is the single
// shared chat model, not a re-implementation. `parseAs2Message` itself is
// defensive (every typed read is THROW-guarded — a malformed foreign literal
// drops the field rather than aborting the parse) and filters every IRI-valued
// field (author / room / inReplyTo) http(s)-only on read.
//
// XSS: the message BODY (`content`) is the primary untrusted, stored-XSS surface —
// it is rendered via Lit text interpolation (`html\`${value}\``), which escapes, so
// a `<script>` / markup-bearing message body renders as inert TEXT, NEVER markup.
// No `unsafeHTML`. The author WebID is shown via the safeHref pattern (http(s)-only
// before it reaches an `<a href>`), matching <jeswr-contact-list>.

import { type CanonicalMessage, parseAs2Message } from "@jeswr/solid-chat-interop";
import { html, type TemplateResult } from "lit";
import { DataFactory, Store } from "n3";
import type { DataController } from "../data-controller.js";
import { AS_NOTE, RDF_TYPE } from "../vocab.js";
import { AbstractReadElement, safeHref } from "./shared.js";

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
    // A message list reads the document / container as a single graph (messages may
    // be inline in a thread document, or this may be one message resource). We read
    // the whole graph and enumerate `as:Note` subjects from it — no per-child fetch
    // in Phase-1 (a deep listing that fetches each child is a documented follow-up),
    // mirroring the sibling list elements.
    const result = await controller.read(src, publicRead ? { public: true } : {});
    return { graph: result.dataset ?? new Store(), baseUrl: result.url };
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
 * Collect every `as:Note`-typed subject in the graph as a typed
 * {@link CanonicalMessage} (via the model's `parseAs2Message` accessor). The
 * subject scan is the ONLY direct quad read (existence query — no triple built),
 * mirroring the sibling list elements. De-duplicated by subject IRI, first-seen
 * order.
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
  return out;
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
