// AUTHORED-BY Codex GPT-6.1-Sol
// Ported from apps/pod-drive (original author: Claude Opus 4.8).
import { NS } from "@jeswr/suite-vocab";

/** RDF / RDFS core. */
export const RDF = {
  type: `${NS.RDF}type`,
} as const;

/** W3C LDP — container membership + resource typing. */
export const LDP = {
  ns: NS.LDP,
  contains: `${NS.LDP}contains`,
  Container: `${NS.LDP}Container`,
  BasicContainer: `${NS.LDP}BasicContainer`,
  Resource: `${NS.LDP}Resource`,
  RDFSource: `${NS.LDP}RDFSource`,
  NonRDFSource: `${NS.LDP}NonRDFSource`,
} as const;

/** POSIX stat vocabulary — the byte size + mtime servers expose on resources. */
export const POSIX = {
  ns: NS.POSIX,
  size: `${NS.POSIX}size`,
  mtime: `${NS.POSIX}mtime`,
} as const;

/** Dublin Core terms — modified timestamp + content type. */
export const DCTERMS = {
  ns: NS.DCT,
  modified: `${NS.DCT}modified`,
  format: `${NS.DCT}format`,
} as const;

/** Solid type-index vocabulary. */
export const SOLID = {
  ns: NS.SOLID,
  TypeIndex: `${NS.SOLID}TypeIndex`,
  ListedDocument: `${NS.SOLID}ListedDocument`,
  UnlistedDocument: `${NS.SOLID}UnlistedDocument`,
  TypeRegistration: `${NS.SOLID}TypeRegistration`,
  forClass: `${NS.SOLID}forClass`,
  instance: `${NS.SOLID}instance`,
  instanceContainer: `${NS.SOLID}instanceContainer`,
  publicTypeIndex: `${NS.SOLID}publicTypeIndex`,
  privateTypeIndex: `${NS.SOLID}privateTypeIndex`,
} as const;

/** PIM space — storage discovery from a WebID profile. */
export const PIM = {
  storage: `${NS.PIM}storage`,
} as const;

/**
 * Pod Drive's primary class — the IRI registered in the user's type index so
 * peers can discover where this app keeps its drive roots. A drive root is just
 * an LDP container; this is the marker class the app vouches for.
 */
export const PODDRIVE = {
  ns: NS.POD_DRIVE,
  DriveRoot: `${NS.POD_DRIVE}DriveRoot`,
} as const;

/** XSD datatypes referenced when serialising literals. */
export const XSD = {
  dateTime: `${NS.XSD}dateTime`,
  integer: `${NS.XSD}integer`,
} as const;
