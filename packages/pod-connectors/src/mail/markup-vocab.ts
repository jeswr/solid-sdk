// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
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
import { RDF, SCHEMA } from "./constants.js";
import {
  MARKUP_NODE_TYPES,
  MARKUP_PROPERTIES,
  type MailMarkupTrust,
  type MarkupNodeType,
  type MarkupProperty,
} from "./markup-types.js";

export const MARKUP_CLASSES = Object.fromEntries(
  MARKUP_NODE_TYPES.map((type) => [type, `${SCHEMA}${type}`]),
) as Record<MarkupNodeType, string>;
export const MARKUP_PREDICATES = Object.fromEntries(
  MARKUP_PROPERTIES.map((prop) => [prop, `${SCHEMA}${prop}`]),
) as Record<MarkupProperty, string>;
export const MARKUP_TRUST = `${NS.FEDCON}emailMarkupTrust`;
export const MARKUP_SENDER_KEY = `${NS.FEDCON}emailMarkupSenderKey`;
export const MARKUP_SLUG = `${NS.FEDCON}emailMarkupSlug`;
export const MARKUP_PRUNE_CURSOR = `${NS.FEDCON}emailMarkupPruneCursor`;
export const MARKUP_STATE_CLASS = `${NS.FEDCON}EmailMarkupState`;
/** Closed vocabulary bridge for inert extracted markup; all RDF goes through typed accessors. */
export class MailMarkupResource extends TermWrapper {
  get senderKey(): string | undefined {
    return OptionalFrom.subjectPredicate(this, MARKUP_SENDER_KEY, LiteralAs.string);
  }
  set senderKey(value: string | undefined) {
    OptionalAs.object(this, MARKUP_SENDER_KEY, value, LiteralFrom.string);
  }
  /** Bounded cleanup inventory on the source EmailMessage, written before item PUTs. */
  get markupSlugs(): Set<string> {
    return SetFrom.subjectPredicate(this, MARKUP_SLUG, LiteralAs.string, LiteralFrom.string);
  }
  /** Re-scan prune continuation: the last `purchases|trips/<hash>.ttl` visited by a capped run. */
  get pruneCursor(): string | undefined {
    return OptionalFrom.subjectPredicate(this, MARKUP_PRUNE_CURSOR, LiteralAs.string);
  }
  set pruneCursor(value: string | undefined) {
    OptionalAs.object(this, MARKUP_PRUNE_CURSOR, value, LiteralFrom.string);
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, `${RDF}type`, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get derivedFrom(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${NS.PROV}wasDerivedFrom`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get trust(): string | undefined {
    return OptionalFrom.subjectPredicate(this, MARKUP_TRUST, LiteralAs.string);
  }
  set trust(value: MailMarkupTrust | undefined) {
    OptionalAs.object(this, MARKUP_TRUST, value, LiteralFrom.string);
  }
  get dateModified(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, MARKUP_PREDICATES.dateModified, LiteralAs.date);
  }
  set dateModified(value: Date | undefined) {
    OptionalAs.object(this, MARKUP_PREDICATES.dateModified, value, LiteralFrom.dateTime);
  }
  strings(prop: MarkupProperty): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      MARKUP_PREDICATES[prop],
      LiteralAs.string,
      LiteralFrom.string,
    );
  }
  links(prop: MarkupProperty): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      MARKUP_PREDICATES[prop],
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  addLiteral(prop: MarkupProperty, value: string | number | boolean): void {
    if (typeof value === "string") this.strings(prop).add(value);
    else if (typeof value === "number")
      SetFrom.subjectPredicate(
        this,
        MARKUP_PREDICATES[prop],
        LiteralAs.number,
        LiteralFrom.double,
      ).add(value);
    else
      SetFrom.subjectPredicate(
        this,
        MARKUP_PREDICATES[prop],
        LiteralAs.boolean,
        LiteralFrom.boolean,
      ).add(value);
  }
}
