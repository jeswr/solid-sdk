// AUTHORED-BY Claude Opus 4.8
/**
 * Vocabulary constants for the Pod Mail data layer.
 *
 * The mail domain is modelled primarily on `schema:EmailMessage` (a widely
 * deployed, JSON-LD-friendly vocabulary) with SIOC for thread/forum structure
 * and DCTERMS for generic metadata. We never hand-build triples: these IRIs are
 * consumed only through `@rdfjs/wrapper` typed accessors (see message.ts /
 * thread.ts / folder.ts) and serialised with `n3.Writer`.
 */

export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const SCHEMA = "http://schema.org/";
export const SIOC = "http://rdfs.org/sioc/ns#";
export const DCT = "http://purl.org/dc/terms/";
export const FOAF = "http://xmlns.com/foaf/0.1/";
export const SOLID = "http://www.w3.org/ns/solid/terms#";
export const LDP = "http://www.w3.org/ns/ldp#";
export const PIM = "http://www.w3.org/ns/pim/space#";

/** RDF classes used by the mail data layer. */
export const Classes = {
  /** A single mail message — the app's primary class. */
  EmailMessage: `${SCHEMA}EmailMessage`,
  /** A conversation/thread grouping related messages. */
  Conversation: `${SCHEMA}Conversation`,
  /** A SIOC thread (alignment class for interop). */
  SiocThread: `${SIOC}Thread`,
  /** A folder/mailbox container of messages. */
  Folder: `${SCHEMA}Collection`,
  /** A contact (sender/recipient). */
  ContactPoint: `${SCHEMA}ContactPoint`,
  /** A LDP container (pod-shaped folders). */
  LdpContainer: `${LDP}Container`,
} as const;

/** Predicates used by the mail data layer. */
export const Predicates = {
  type: `${RDF}type`,

  // schema:EmailMessage core fields
  subject: `${SCHEMA}about`,
  headline: `${SCHEMA}headline`,
  text: `${SCHEMA}text`,
  dateSent: `${SCHEMA}dateSent`,
  dateReceived: `${SCHEMA}dateReceived`,
  dateRead: `${SCHEMA}dateRead`,
  sender: `${SCHEMA}sender`,
  toRecipient: `${SCHEMA}toRecipient`,
  ccRecipient: `${SCHEMA}ccRecipient`,
  bccRecipient: `${SCHEMA}bccRecipient`,
  messageAttachment: `${SCHEMA}messageAttachment`,
  identifier: `${SCHEMA}identifier`,

  // thread / conversation structure (SIOC + schema)
  partOf: `${SCHEMA}isPartOf`,
  hasPart: `${SCHEMA}hasPart`,
  replyTo: `${SIOC}reply_of`,
  inReplyTo: `${SCHEMA}replyToUrl`,

  // folder / collection
  collectionItem: `${SCHEMA}hasPart`,

  // contact fields
  email: `${SCHEMA}email`,
  name: `${SCHEMA}name`,

  // generic metadata
  created: `${DCT}created`,
  modified: `${DCT}modified`,
  title: `${DCT}title`,
} as const;

/**
 * Boolean / status flags. We keep these as a small, explicit predicate set
 * rather than overloading schema fields, so the read flag is unambiguous.
 */
export const Flags = {
  /** Whether the owner has read the message. Backed by presence of dateRead. */
  isRead: `${SCHEMA}dateRead`,
} as const;
