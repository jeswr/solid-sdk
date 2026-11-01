// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Typed accessors for the pod-mail model (apps MAI-00/MAI-01), which uses
 * `http://schema.org/` + SIOC + DCTERMS. Kept wire-compatible with
 * `apps/suite/src/apps/mail/lib/model` so the Mail app reads connector output unchanged.
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

import { MAIL_PREDICATES as P } from "./constants.js";

export { MAIL_CLASSES, MAIL_SCHEMA } from "./constants.js";

class Typed extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, P.type, NamedNodeAs.string, NamedNodeFrom.string);
  }
  protected iris(predicate: string): Set<string> {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
}

export class MailMessage extends Typed {
  get subjectLine(): string | undefined {
    return OptionalFrom.subjectPredicate(this, P.headline, LiteralAs.string);
  }
  set subjectLine(value: string | undefined) {
    OptionalAs.object(this, P.headline, value, LiteralFrom.string);
  }
  get body(): string | undefined {
    return OptionalFrom.subjectPredicate(this, P.text, LiteralAs.string);
  }
  set body(value: string | undefined) {
    OptionalAs.object(this, P.text, value, LiteralFrom.string);
  }
  /** Decoded HTML kept as inert data; readers sanitise before rendering. */
  get bodyHtml(): string | undefined {
    return OptionalFrom.subjectPredicate(this, P.articleBody, LiteralAs.string);
  }
  set bodyHtml(value: string | undefined) {
    OptionalAs.object(this, P.articleBody, value, LiteralFrom.string);
  }
  get sender(): string | undefined {
    return OptionalFrom.subjectPredicate(this, P.sender, NamedNodeAs.string);
  }
  set sender(value: string | undefined) {
    OptionalAs.object(this, P.sender, value, NamedNodeFrom.string);
  }
  get to(): Set<string> {
    return this.iris(P.toRecipient);
  }
  get cc(): Set<string> {
    return this.iris(P.ccRecipient);
  }
  get bcc(): Set<string> {
    return this.iris(P.bccRecipient);
  }
  get dateSent(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, P.dateSent, LiteralAs.date);
  }
  set dateSent(value: Date | undefined) {
    OptionalAs.object(this, P.dateSent, value, LiteralFrom.dateTime);
  }
  get dateReceived(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, P.dateReceived, LiteralAs.date);
  }
  set dateReceived(value: Date | undefined) {
    OptionalAs.object(this, P.dateReceived, value, LiteralFrom.dateTime);
  }
  /** Presence is the read flag (pod-mail convention). */
  get dateRead(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, P.dateRead, LiteralAs.date);
  }
  set dateRead(value: Date | undefined) {
    OptionalAs.object(this, P.dateRead, value, LiteralFrom.dateTime);
  }
  get partOfThread(): string | undefined {
    return OptionalFrom.subjectPredicate(this, P.partOf, NamedNodeAs.string);
  }
  set partOfThread(value: string | undefined) {
    OptionalAs.object(this, P.partOf, value, NamedNodeFrom.string);
  }
  get inReplyTo(): string | undefined {
    return OptionalFrom.subjectPredicate(this, P.inReplyTo, NamedNodeAs.string);
  }
  set inReplyTo(value: string | undefined) {
    OptionalAs.object(this, P.inReplyTo, value, NamedNodeFrom.string);
  }
  /** The original RFC 822 source stored beside the message document. */
  get encoding(): string | undefined {
    return OptionalFrom.subjectPredicate(this, P.encoding, NamedNodeAs.string);
  }
  set encoding(value: string | undefined) {
    OptionalAs.object(this, P.encoding, value, NamedNodeFrom.string);
  }
  get identifier(): string | undefined {
    return OptionalFrom.subjectPredicate(this, P.identifier, LiteralAs.string);
  }
  set identifier(value: string | undefined) {
    OptionalAs.object(this, P.identifier, value, LiteralFrom.string);
  }
  get folderIris(): Set<string> {
    return this.iris(P.container);
  }
  get attachments(): Set<string> {
    return this.iris(P.messageAttachment);
  }
}

/** Shared by threads (`schema:Conversation`) and folders (`schema:Collection`). */
export class MailCollection extends Typed {
  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, P.title, LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, P.title, value, LiteralFrom.string);
  }
  get members(): Set<string> {
    return this.iris(P.hasPart);
  }
}

export class MailAttachment extends Typed {
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, P.name, LiteralAs.string);
  }
  set name(value: string | undefined) {
    OptionalAs.object(this, P.name, value, LiteralFrom.string);
  }
  get contentType(): string | undefined {
    return OptionalFrom.subjectPredicate(this, P.encodingFormat, LiteralAs.string);
  }
  set contentType(value: string | undefined) {
    OptionalAs.object(this, P.encodingFormat, value, LiteralFrom.string);
  }
}
