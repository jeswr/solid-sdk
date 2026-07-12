// AUTHORED-BY Claude Opus 4.8
/**
 * Typed accessor over a mail thread / conversation (`schema:Conversation`,
 * aligned with `sioc:Thread`). A thread groups related messages; membership is
 * recorded both on the thread (`schema:hasPart`) and on each message
 * (`schema:isPartOf`), so either direction resolves without a server query.
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

/** A conversation thread wrapped over its subject IRI in a dataset. */
export class Thread extends TermWrapper {
  /** Live set of `rdf:type` IRIs on this thread. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, `${RDF}type`, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /**
   * Stamp this subject as a conversation thread (call once when minting).
   * Adds both `schema:Conversation` and the `sioc:Thread` alignment class.
   */
  markThread(): void {
    const t = this.types;
    t.add(Classes.Conversation);
    t.add(Classes.SiocThread);
  }

  /** Human-readable thread title. */
  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, Predicates.title, LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, Predicates.title, value, LiteralFrom.string);
  }

  /** When the thread was created. */
  get created(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, Predicates.created, LiteralAs.date);
  }
  set created(value: Date | undefined) {
    OptionalAs.object(this, Predicates.created, value, LiteralFrom.dateTime);
  }

  /** When the thread was last modified. */
  get modified(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, Predicates.modified, LiteralAs.date);
  }
  set modified(value: Date | undefined) {
    OptionalAs.object(this, Predicates.modified, value, LiteralFrom.dateTime);
  }

  /** Live set of member message IRIs (`schema:hasPart`). */
  get messageIris(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      Predicates.hasPart,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /** Add a message IRI to the thread. */
  addMessage(messageIri: string): void {
    this.messageIris.add(messageIri);
  }

  /** Remove a message IRI from the thread. */
  removeMessage(messageIri: string): void {
    this.messageIris.delete(messageIri);
  }

  /** Number of messages in the thread. */
  get size(): number {
    return this.messageIris.size;
  }
}
