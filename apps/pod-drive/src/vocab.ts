// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Namespace + term constants for the Pod Drive data layer.
//
// House rule (suite-wide): NEVER hand-build RDF triples by string concat. These
// are *IRI constants* only — every quad is produced through @rdfjs/wrapper
// typed accessors / n3 DataFactory, and every read goes through the typed
// model classes in `src/model.ts`. The constants here are the single home for
// the predicate IRIs those accessors reference, so a vocabulary change touches
// exactly one place.

/** RDF / RDFS core. */
export const RDF = {
  type: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
} as const;

/** W3C LDP — container membership + resource typing. */
export const LDP = {
  ns: "http://www.w3.org/ns/ldp#",
  contains: "http://www.w3.org/ns/ldp#contains",
  Container: "http://www.w3.org/ns/ldp#Container",
  BasicContainer: "http://www.w3.org/ns/ldp#BasicContainer",
  Resource: "http://www.w3.org/ns/ldp#Resource",
  RDFSource: "http://www.w3.org/ns/ldp#RDFSource",
  NonRDFSource: "http://www.w3.org/ns/ldp#NonRDFSource",
} as const;

/** POSIX stat vocabulary — the byte size + mtime servers expose on resources. */
export const POSIX = {
  ns: "http://www.w3.org/ns/posix/stat#",
  size: "http://www.w3.org/ns/posix/stat#size",
  mtime: "http://www.w3.org/ns/posix/stat#mtime",
} as const;

/** Dublin Core terms — modified timestamp + content type. */
export const DCTERMS = {
  ns: "http://purl.org/dc/terms/",
  modified: "http://purl.org/dc/terms/modified",
  format: "http://purl.org/dc/terms/format",
} as const;

/** Solid type-index vocabulary. */
export const SOLID = {
  ns: "http://www.w3.org/ns/solid/terms#",
  TypeIndex: "http://www.w3.org/ns/solid/terms#TypeIndex",
  ListedDocument: "http://www.w3.org/ns/solid/terms#ListedDocument",
  UnlistedDocument: "http://www.w3.org/ns/solid/terms#UnlistedDocument",
  TypeRegistration: "http://www.w3.org/ns/solid/terms#TypeRegistration",
  forClass: "http://www.w3.org/ns/solid/terms#forClass",
  instance: "http://www.w3.org/ns/solid/terms#instance",
  instanceContainer: "http://www.w3.org/ns/solid/terms#instanceContainer",
  publicTypeIndex: "http://www.w3.org/ns/solid/terms#publicTypeIndex",
  privateTypeIndex: "http://www.w3.org/ns/solid/terms#privateTypeIndex",
} as const;

/** PIM space — storage discovery from a WebID profile. */
export const PIM = {
  storage: "http://www.w3.org/ns/pim/space#storage",
} as const;

/**
 * Pod Drive's primary class — the IRI registered in the user's type index so
 * peers can discover where this app keeps its drive roots. A drive root is just
 * an LDP container; this is the marker class the app vouches for.
 */
export const PODDRIVE = {
  ns: "https://w3id.org/jeswr/pod-drive#",
  DriveRoot: "https://w3id.org/jeswr/pod-drive#DriveRoot",
} as const;

/** XSD datatypes referenced when serialising literals. */
export const XSD = {
  dateTime: "http://www.w3.org/2001/XMLSchema#dateTime",
  integer: "http://www.w3.org/2001/XMLSchema#integer",
} as const;
