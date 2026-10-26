// AUTHORED-BY Claude Opus 5.5
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

export const MAIL_SCHEMA = "http://schema.org/";
const SIOC = "http://rdfs.org/sioc/ns#";
const DCT = "http://purl.org/dc/terms/";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

export const MAIL_CLASSES = {
  EmailMessage: `${MAIL_SCHEMA}EmailMessage`,
  Conversation: `${MAIL_SCHEMA}Conversation`,
  SiocThread: `${SIOC}Thread`,
  Folder: `${MAIL_SCHEMA}Collection`,
  MediaObject: `${MAIL_SCHEMA}MediaObject`,
} as const;

class Typed extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  protected iris(predicate: string): Set<string> {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
}

export class MailMessage extends Typed {
  get subjectLine(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}headline`, LiteralAs.string);
  }
  set subjectLine(value: string | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}headline`, value, LiteralFrom.string);
  }
  get body(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}text`, LiteralAs.string);
  }
  set body(value: string | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}text`, value, LiteralFrom.string);
  }
  /** Decoded HTML kept as inert data; readers sanitise before rendering. */
  get bodyHtml(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}articleBody`, LiteralAs.string);
  }
  set bodyHtml(value: string | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}articleBody`, value, LiteralFrom.string);
  }
  get sender(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}sender`, NamedNodeAs.string);
  }
  set sender(value: string | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}sender`, value, NamedNodeFrom.string);
  }
  get to(): Set<string> {
    return this.iris(`${MAIL_SCHEMA}toRecipient`);
  }
  get cc(): Set<string> {
    return this.iris(`${MAIL_SCHEMA}ccRecipient`);
  }
  get bcc(): Set<string> {
    return this.iris(`${MAIL_SCHEMA}bccRecipient`);
  }
  get dateSent(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}dateSent`, LiteralAs.date);
  }
  set dateSent(value: Date | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}dateSent`, value, LiteralFrom.dateTime);
  }
  get dateReceived(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}dateReceived`, LiteralAs.date);
  }
  set dateReceived(value: Date | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}dateReceived`, value, LiteralFrom.dateTime);
  }
  /** Presence is the read flag (pod-mail convention). */
  get dateRead(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}dateRead`, LiteralAs.date);
  }
  set dateRead(value: Date | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}dateRead`, value, LiteralFrom.dateTime);
  }
  get partOfThread(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}isPartOf`, NamedNodeAs.string);
  }
  set partOfThread(value: string | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}isPartOf`, value, NamedNodeFrom.string);
  }
  get inReplyTo(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}replyToUrl`, NamedNodeAs.string);
  }
  set inReplyTo(value: string | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}replyToUrl`, value, NamedNodeFrom.string);
  }
  /** The original RFC 822 source stored beside the message document. */
  get encoding(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}encoding`, NamedNodeAs.string);
  }
  set encoding(value: string | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}encoding`, value, NamedNodeFrom.string);
  }
  get identifier(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}identifier`, LiteralAs.string);
  }
  set identifier(value: string | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}identifier`, value, LiteralFrom.string);
  }
  get folderIris(): Set<string> {
    return this.iris(`${SIOC}has_container`);
  }
  get attachments(): Set<string> {
    return this.iris(`${MAIL_SCHEMA}messageAttachment`);
  }
}

/** Shared by threads (`schema:Conversation`) and folders (`schema:Collection`). */
export class MailCollection extends Typed {
  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${DCT}title`, LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, `${DCT}title`, value, LiteralFrom.string);
  }
  get members(): Set<string> {
    return this.iris(`${MAIL_SCHEMA}hasPart`);
  }
}

/** A connector's source inventory: a collection whose status marks an unfinished run. */
export class MailSourceIndex extends MailCollection {
  get status(): string | undefined {
    return OptionalFrom.subjectPredicate(
      this,
      `${MAIL_SCHEMA}creativeWorkStatus`,
      LiteralAs.string,
    );
  }
  set status(value: string | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}creativeWorkStatus`, value, LiteralFrom.string);
  }
}

export class MailAttachment extends Typed {
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}name`, LiteralAs.string);
  }
  set name(value: string | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}name`, value, LiteralFrom.string);
  }
  get contentType(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${MAIL_SCHEMA}encodingFormat`, LiteralAs.string);
  }
  set contentType(value: string | undefined) {
    OptionalAs.object(this, `${MAIL_SCHEMA}encodingFormat`, value, LiteralFrom.string);
  }
}
