// AUTHORED-BY Claude Opus 4.8
/**
 * Typed accessor over a single mail message (`schema:EmailMessage`).
 *
 * Read + write are done exclusively through `@rdfjs/wrapper` mapping helpers —
 * never by hand-building triples. Persistence (serialise with `n3.Writer` +
 * conditional PUT) lives in the store layer; this class only mutates the
 * in-memory dataset.
 */
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { Classes, Predicates, RDF } from "./vocab.js";

/** A single mail message wrapped over its subject IRI in a dataset. */
export class Message extends TermWrapper {
  /** Live set of `rdf:type` IRIs on this message. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, `${RDF}type`, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Stamp this subject as a `schema:EmailMessage` (call once when minting). */
  markMessage(): void {
    this.types.add(Classes.EmailMessage);
  }

  /**
   * Subject line of the message. Named `subjectLine` (not `subject`) because
   * `TermWrapper` already exposes a `subject` getter from the RDF/JS Quad-like
   * interface.
   */
  get subjectLine(): string | undefined {
    return OptionalFrom.subjectPredicate(this, Predicates.headline, LiteralAs.string);
  }
  set subjectLine(value: string | undefined) {
    OptionalAs.object(this, Predicates.headline, value, LiteralFrom.string);
  }

  /** Plain-text body of the message. */
  get body(): string | undefined {
    return OptionalFrom.subjectPredicate(this, Predicates.text, LiteralAs.string);
  }
  set body(value: string | undefined) {
    OptionalAs.object(this, Predicates.text, value, LiteralFrom.string);
  }

  /** Sender — a contact/WebID IRI. */
  get sender(): string | undefined {
    return OptionalFrom.subjectPredicate(this, Predicates.sender, NamedNodeAs.string);
  }
  set sender(value: string | undefined) {
    OptionalAs.object(this, Predicates.sender, value, NamedNodeFrom.string);
  }

  /** Primary (To) recipients — contact/WebID IRIs. */
  get to(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      Predicates.toRecipient,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /** Carbon-copy (Cc) recipients. */
  get cc(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      Predicates.ccRecipient,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /** Blind-carbon-copy (Bcc) recipients. */
  get bcc(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      Predicates.bccRecipient,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /** When the message was sent. */
  get dateSent(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, Predicates.dateSent, LiteralAs.date);
  }
  set dateSent(value: Date | undefined) {
    OptionalAs.object(this, Predicates.dateSent, value, LiteralFrom.dateTime);
  }

  /** When the message was received into this pod. */
  get dateReceived(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, Predicates.dateReceived, LiteralAs.date);
  }
  set dateReceived(value: Date | undefined) {
    OptionalAs.object(this, Predicates.dateReceived, value, LiteralFrom.dateTime);
  }

  /**
   * When the owner read the message. Presence is the read-flag: a message with
   * no `dateRead` is unread.
   */
  get dateRead(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, Predicates.dateRead, LiteralAs.date);
  }
  set dateRead(value: Date | undefined) {
    OptionalAs.object(this, Predicates.dateRead, value, LiteralFrom.dateTime);
  }

  /** Whether the owner has read the message (derived from `dateRead`). */
  get isRead(): boolean {
    return this.dateRead !== undefined;
  }

  /**
   * Mark read/unread. Marking read stamps `dateRead` with `at` (defaults to
   * now); marking unread clears it.
   */
  setRead(read: boolean, at: Date = new Date()): void {
    this.dateRead = read ? at : undefined;
  }

  /** The thread/conversation this message belongs to, if any. */
  get partOfThread(): string | undefined {
    return OptionalFrom.subjectPredicate(this, Predicates.partOf, NamedNodeAs.string);
  }
  set partOfThread(value: string | undefined) {
    OptionalAs.object(this, Predicates.partOf, value, NamedNodeFrom.string);
  }

  /** The message this is a reply to (an IRI), if any. */
  get inReplyTo(): string | undefined {
    return OptionalFrom.subjectPredicate(this, Predicates.inReplyTo, NamedNodeAs.string);
  }
  set inReplyTo(value: string | undefined) {
    OptionalAs.object(this, Predicates.inReplyTo, value, NamedNodeFrom.string);
  }
}
