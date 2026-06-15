// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Vocabulary — the SINGLE home for every IRI Pod Money reads or writes.
//
// House rule: never hand-concatenate IRIs at a call site and never hand-build
// triples. Every term used by the typed accessors comes from here, so a
// namespace change (see FIN below) is a one-line edit, not a sweep.

/**
 * Finance sector ontology namespace.
 *
 * INTERIM: the fse finance sector ontology
 * (full-solid-ecosystem/federation/ontologies/sectors/finance/finance.ttl)
 * currently uses the PLACEHOLDER base `https://TBD.example/solid/finance#`,
 * pending fse "namespace decision #2". Pod Money builds against this interim
 * IRI verbatim so a single edit here re-points the whole data layer once the
 * namespace is frozen. See README + the tracked sector-vocab ADR follow-up.
 */
export const FIN = "https://TBD.example/solid/finance#" as const;

/** Solid Core ontology namespace (the gUFO Core the finance sector re-bases onto). */
export const CORE = "https://TBD.example/solid/core#" as const;

/** RDF, RDFS. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#" as const;

/** Solid terms (type index, storage discovery). */
export const SOLID = "http://www.w3.org/ns/solid/terms#" as const;

/** PIM space (pod storage discovery). */
export const PIM = "http://www.w3.org/ns/pim/space#" as const;

/** XSD datatypes. */
export const XSD = "http://www.w3.org/2001/XMLSchema#" as const;

/** Dublin Core terms. */
export const DCTERMS = "http://purl.org/dc/terms/" as const;

/** SKOS — used for human-readable category labels. */
export const SKOS = "http://www.w3.org/2004/02/skos/core#" as const;

/** `rdf:type`. */
export const RDF_TYPE = `${RDF}type` as const;

/** Finance sector classes (verbatim from finance.ttl). */
export const FinClass = {
  FinancialAccount: `${FIN}FinancialAccount`,
  CurrentAccount: `${FIN}CurrentAccount`,
  SavingsAccount: `${FIN}SavingsAccount`,
  CreditAccount: `${FIN}CreditAccount`,
  InvestmentAccount: `${FIN}InvestmentAccount`,
  ActiveFinancialAccount: `${FIN}ActiveFinancialAccount`,
  FrozenFinancialAccount: `${FIN}FrozenFinancialAccount`,
  ClosedFinancialAccount: `${FIN}ClosedFinancialAccount`,
  Balance: `${FIN}Balance`,
  Transaction: `${FIN}Transaction`,
  Payment: `${FIN}Payment`,
  CardPayment: `${FIN}CardPayment`,
  Transfer: `${FIN}Transfer`,
  MonetaryAmount: `${FIN}MonetaryAmount`,
  Holding: `${FIN}Holding`,
  FinancialInstrument: `${FIN}FinancialInstrument`,
} as const;

/** Finance sector properties (verbatim from finance.ttl). */
export const FinProp = {
  amount: `${FIN}amount`,
  currency: `${FIN}currency`,
  hasMonetaryAmount: `${FIN}hasMonetaryAmount`,
  postingTime: `${FIN}postingTime`,
  debitAccount: `${FIN}debitAccount`,
  creditAccount: `${FIN}creditAccount`,
  hasCounterparty: `${FIN}hasCounterparty`,
  ofInstrument: `${FIN}ofInstrument`,
  quantity: `${FIN}quantity`,
  heldInAccount: `${FIN}heldInAccount`,
} as const;

/**
 * Pod Money application-local terms — a thin app namespace for things the
 * finance sector ontology does not (yet) carry as first-class predicates: the
 * human label on an account, the owning account of a transaction, the
 * spending category of a transaction, and the as-of account of a balance.
 *
 * These are deliberately app-local (not asserted against the sector ontology)
 * so they never collide with sector terms. Once the finance sector adds
 * canonical predicates for these, migrate the accessors here.
 */
export const PM = "https://w3id.org/jeswr/pod-money#" as const;

export const PmClass = {
  Category: `${PM}Category`,
} as const;

export const PmProp = {
  /** Account: a human-readable label (e.g. "Joint Current Account"). */
  label: `${SKOS}prefLabel`,
  /** Transaction → the account it belongs to (the holder's own account). */
  account: `${PM}account`,
  /** Transaction → its spending category. */
  category: `${PM}category`,
  /** Balance → the account it states a balance for (a Core `about` shadow). */
  ofAccount: `${PM}ofAccount`,
  /** Balance: the as-of timestamp. */
  asOf: `${PM}asOf`,
  /** Category: a human-readable label. */
  categoryLabel: `${SKOS}prefLabel`,
} as const;

/** Solid type-index terms. */
export const SolidTerm = {
  publicTypeIndex: `${SOLID}publicTypeIndex`,
  privateTypeIndex: `${SOLID}privateTypeIndex`,
  TypeIndex: `${SOLID}TypeIndex`,
  ListedDocument: `${SOLID}ListedDocument`,
  UnlistedDocument: `${SOLID}UnlistedDocument`,
  TypeRegistration: `${SOLID}TypeRegistration`,
  forClass: `${SOLID}forClass`,
  instance: `${SOLID}instance`,
  instanceContainer: `${SOLID}instanceContainer`,
} as const;
