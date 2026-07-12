// AUTHORED-BY Claude Opus 4.8
/**
 * Typed accessor over a mail folder / mailbox (`schema:Collection`).
 *
 * A folder is pod-shaped: it corresponds to an LDP container in the pod, and the
 * folder document records which messages it holds (`schema:hasPart`) plus a
 * display title. The well-known mail folders (Inbox, Sent, Drafts, …) are
 * conventional names under the app's mail root container.
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

/** Conventional well-known mail folder slugs (relative to the mail root). */
export const WellKnownFolders = {
  inbox: "inbox",
  sent: "sent",
  drafts: "drafts",
  trash: "trash",
  archive: "archive",
} as const;

export type WellKnownFolder = (typeof WellKnownFolders)[keyof typeof WellKnownFolders];

/** A mail folder wrapped over its subject IRI in a dataset. */
export class Folder extends TermWrapper {
  /** Live set of `rdf:type` IRIs on this folder. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, `${RDF}type`, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Stamp this subject as a mail folder (call once when minting). */
  markFolder(): void {
    this.types.add(Classes.Folder);
  }

  /** Human-readable folder name (e.g. "Inbox"). */
  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, Predicates.title, LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, Predicates.title, value, LiteralFrom.string);
  }

  /** When the folder was last modified. */
  get modified(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, Predicates.modified, LiteralAs.date);
  }
  set modified(value: Date | undefined) {
    OptionalAs.object(this, Predicates.modified, value, LiteralFrom.dateTime);
  }

  /** Live set of message IRIs held in this folder (`schema:hasPart`). */
  get messageIris(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      Predicates.collectionItem,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /** Add a message IRI to the folder. */
  addMessage(messageIri: string): void {
    this.messageIris.add(messageIri);
  }

  /** Remove a message IRI from the folder. */
  removeMessage(messageIri: string): void {
    this.messageIris.delete(messageIri);
  }

  /** Whether the folder lists a given message IRI. */
  has(messageIri: string): boolean {
    return this.messageIris.has(messageIri);
  }

  /** Number of messages in the folder. */
  get size(): number {
    return this.messageIris.size;
  }
}
