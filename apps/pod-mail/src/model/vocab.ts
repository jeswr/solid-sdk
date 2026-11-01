// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6.1-Sol
/** Byte-identical shared IRIs; the standalone app retains its older predicate surface. */
export {
  Classes,
  DCT,
  Flags,
  FOAF,
  LDP,
  PIM,
  RDF,
  RDFS,
  SCHEMA,
  SIOC,
  SOLID,
  XSD,
} from "@jeswr/pod-connectors/mail/constants";

import { Predicates as shared } from "@jeswr/pod-connectors/mail/constants";

export const Predicates = {
  type: shared.type,
  subject: shared.subject,
  headline: shared.headline,
  text: shared.text,
  dateSent: shared.dateSent,
  dateReceived: shared.dateReceived,
  dateRead: shared.dateRead,
  sender: shared.sender,
  toRecipient: shared.toRecipient,
  ccRecipient: shared.ccRecipient,
  bccRecipient: shared.bccRecipient,
  messageAttachment: shared.messageAttachment,
  identifier: shared.identifier,
  partOf: shared.partOf,
  hasPart: shared.hasPart,
  replyTo: shared.replyTo,
  inReplyTo: shared.inReplyTo,
  collectionItem: shared.collectionItem,
  email: shared.email,
  name: shared.name,
  created: shared.created,
  modified: shared.modified,
  title: shared.title,
} as const;
