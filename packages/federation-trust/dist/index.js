// node_modules/@jeswr/federation-registry/dist/index.js
import contentType from "content-type";
import { Store, StreamParser } from "n3";
import { JsonLdParser } from "jsonld-streaming-parser";
import { Writer } from "n3";
import {
  BlankNodeFrom,
  DatasetWrapper,
  LiteralFrom,
  NamedNodeFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper
} from "@rdfjs/wrapper";
import { DataFactory, Store as Store2 } from "n3";
var FEDREG = "https://w3id.org/jeswr/fedreg#";
var DCAT = "http://www.w3.org/ns/dcat#";
var FEDREG_REGISTRY = `${FEDREG}Registry`;
var FEDREG_MEMBERSHIP = `${FEDREG}Membership`;
var FEDREG_MEMBERSHIP_STATUS = `${FEDREG}MembershipStatus`;
var FEDREG_STORAGE_DESCRIPTION = `${FEDREG}StorageDescription`;
var FEDREG_MEMBER = `${FEDREG}member`;
var FEDREG_APP = `${FEDREG}app`;
var FEDREG_STATUS = `${FEDREG}status`;
var FEDREG_ASSERTED_BY = `${FEDREG}assertedBy`;
var FEDREG_ASSERTED = `${FEDREG}asserted`;
var DCAT_RECORD = `${DCAT}record`;
var FEDREG_ACCEPTS_SPEC = `${FEDREG}acceptsSpec`;
var FEDREG_SUPPORTS_SECTOR = `${FEDREG}supportsSector`;
var FEDREG_STORAGE = `${FEDREG}storage`;
var MEMBERSHIP_STATUS = {
  Proposed: `${FEDREG}Proposed`,
  Active: `${FEDREG}Active`,
  Suspended: `${FEDREG}Suspended`,
  Revoked: `${FEDREG}Revoked`
};
var VALID_STATUS_IRIS = new Set(Object.values(MEMBERSHIP_STATUS));
var TRUSTED_STATUS = /* @__PURE__ */ new Set(["Active"]);
function statusName(iri) {
  for (const [name, statusIri2] of Object.entries(MEMBERSHIP_STATUS)) {
    if (statusIri2 === iri) {
      return name;
    }
  }
  return void 0;
}

// ../solid-vc/dist/index.js
import { createHash } from "node:crypto";
import { canonize } from "rdf-canonize";
import { randomUUID } from "node:crypto";
import contentType2 from "content-type";
import { Store as Store3, StreamParser as StreamParser2 } from "n3";
import { JsonLdParser as JsonLdParser2 } from "jsonld-streaming-parser";
import { Writer as Writer2 } from "n3";
import {
  BlankNodeFrom as BlankNodeFrom2,
  DatasetWrapper as DatasetWrapper2,
  LiteralFrom as LiteralFrom2,
  NamedNodeFrom as NamedNodeFrom2,
  SetFrom as SetFrom2,
  TermAs as TermAs2,
  TermFrom as TermFrom2,
  TermWrapper as TermWrapper2
} from "@rdfjs/wrapper";
import { DataFactory as DataFactory2, Store as Store22 } from "n3";
import { randomUUID as randomUUID2 } from "node:crypto";
import { base58btc } from "multiformats/bases/base58";
import { exportJWK, generateKeyPair, importJWK } from "jose";
async function canonicalNQuads(quads) {
  return await canonize(quads, {
    algorithm: "RDFC-1.0",
    format: "application/n-quads"
  });
}
function sha256(input) {
  return new Uint8Array(createHash("sha256").update(input, "utf8").digest());
}
async function dataIntegrityHash(documentQuads, proofOptionsQuads2) {
  const docCanon = await canonicalNQuads(documentQuads);
  const proofCanon = await canonicalNQuads(proofOptionsQuads2);
  const proofHash = sha256(proofCanon);
  const docHash = sha256(docCanon);
  const out = new Uint8Array(proofHash.length + docHash.length);
  out.set(proofHash, 0);
  out.set(docHash, proofHash.length);
  return out;
}
var VC = "https://www.w3.org/2018/credentials#";
var SEC = "https://w3id.org/security#";
var XSD = "http://www.w3.org/2001/XMLSchema#";
var RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var RDFS = "http://www.w3.org/2000/01/rdf-schema#";
var ACL = "http://www.w3.org/ns/auth/acl#";
var ODRL = "http://www.w3.org/ns/odrl/2/";
var SCHEMA = "https://schema.org/";
var SVC = "https://w3id.org/jeswr/solid-vc#";
var RDF_TYPE = `${RDF}type`;
var VC_CREDENTIAL = `${VC}VerifiableCredential`;
var VC_PRESENTATION = `${VC}VerifiablePresentation`;
var VC_ISSUER = `${VC}issuer`;
var VC_CREDENTIAL_SUBJECT = `${VC}credentialSubject`;
var VC_VALID_FROM = `${VC}validFrom`;
var VC_VALID_UNTIL = `${VC}validUntil`;
var VC_CREDENTIAL_STATUS = `${VC}credentialStatus`;
var VC_VERIFIABLE_CREDENTIAL = `${VC}verifiableCredential`;
var VC_HOLDER = `${VC}holder`;
var SEC_PROOF = `${SEC}proof`;
var SEC_DATA_INTEGRITY_PROOF = `${SEC}DataIntegrityProof`;
var SEC_CRYPTOSUITE = `${SEC}cryptosuite`;
var SEC_PROOF_VALUE = `${SEC}proofValue`;
var SEC_VERIFICATION_METHOD = `${SEC}verificationMethod`;
var SEC_PROOF_PURPOSE = `${SEC}proofPurpose`;
var DC_CREATED = "http://purl.org/dc/terms/created";
var SVC_AGENT_AUTHORIZATION = `${SVC}AgentAuthorizationCredential`;
var SVC_AUTHORIZES = `${SVC}authorizes`;
var SVC_ACTION = `${SVC}action`;
var SVC_TARGET = `${SVC}target`;
var SVC_POLICY = `${SVC}policy`;
var PREFIXES = {
  cred: VC,
  sec: SEC,
  svc: SVC,
  acl: ACL,
  odrl: ODRL,
  schema: SCHEMA,
  xsd: XSD,
  rdf: RDF,
  rdfs: RDFS,
  dcterms: DC_CREATED.replace("created", "")
};
function iriRef(iri) {
  return { kind: "iri", value: iri };
}
function normalize(subject) {
  return typeof subject === "string" ? { kind: "iri", value: subject } : subject;
}
var GraphBuilder = class {
  store = new Store22();
  factory = DataFactory2;
  /** Materialise a {@link NodeRef} to its RDF/JS term. */
  subjectTerm(ref) {
    return ref.kind === "iri" ? NamedNodeFrom2.string(ref.value, this.factory) : BlankNodeFrom2.string(ref.value, this.factory);
  }
  /** Add `(subject, rdf:type, classIri)`. */
  addType(subject, classIri) {
    this.addIri(subject, RDF_TYPE, classIri);
  }
  /** Add `(subject, predicate, object-IRI)`. */
  addIri(subject, predicate, objectIri) {
    const s = this.subjectTerm(normalize(subject));
    const p = NamedNodeFrom2.string(predicate, this.factory);
    const o = NamedNodeFrom2.string(objectIri, this.factory);
    this.store.add(this.factory.quad(s, p, o));
  }
  /** Add `(subject, predicate, literal)` with an optional datatype IRI. */
  addLiteral(subject, predicate, value, datatypeIri) {
    const s = this.subjectTerm(normalize(subject));
    const p = NamedNodeFrom2.string(predicate, this.factory);
    const o = datatypeIri === void 0 ? LiteralFrom2.string(value, this.factory) : this.factory.literal(
      value,
      NamedNodeFrom2.string(datatypeIri, this.factory)
    );
    this.store.add(this.factory.quad(s, p, o));
  }
  /**
   * Mint a fresh blank node, link it `(subject, predicate, _:b)`, and return a
   * {@link NodeRef} to the new blank node (so subsequent writes target it
   * unambiguously as a blank, never as an IRI).
   */
  linkBlankNode(subject, predicate) {
    const s = this.subjectTerm(normalize(subject));
    const blank = BlankNodeFrom2.string(void 0, this.factory);
    const p = NamedNodeFrom2.string(predicate, this.factory);
    this.store.add(this.factory.quad(s, p, blank));
    return { kind: "blank", value: blank.value };
  }
  /**
   * Link a CHILD node (a named IRI child if provided, else a fresh blank) from
   * `subject` via `predicate`, and return its {@link NodeRef}.
   */
  linkChild(subject, predicate, childIri) {
    if (childIri !== void 0) {
      this.addIri(subject, predicate, childIri);
      return iriRef(childIri);
    }
    return this.linkBlankNode(subject, predicate);
  }
  /** The underlying store (a DatasetCore). */
  dataset() {
    return this.store;
  }
  /** The accumulated quads. */
  quads() {
    return [...this.store];
  }
};
function looksLikeIri(value) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}
function typeIri(type) {
  if (type === "VerifiableCredential") return VC_CREDENTIAL;
  if (type === "AgentAuthorizationCredential") return SVC_AGENT_AUTHORIZATION;
  if (looksLikeIri(type)) return type;
  return `https://w3id.org/jeswr/solid-vc#${type}`;
}
function writeSubject(b, credential, subject) {
  const node = typeof subject.id === "string" && subject.id.length > 0 ? iriRef(subject.id) : b.linkBlankNode(credential, VC_CREDENTIAL_SUBJECT);
  if (node.kind === "iri") {
    b.addIri(credential, VC_CREDENTIAL_SUBJECT, node.value);
  }
  for (const [claim, value] of Object.entries(subject)) {
    if (claim === "id" || value === void 0) continue;
    writeClaim(b, node, claim, value);
  }
}
function claimPredicate(claim) {
  return looksLikeIri(claim) ? claim : `https://w3id.org/jeswr/solid-vc#${claim}`;
}
function writeClaim(b, subject, claim, value) {
  const predicate = claimPredicate(claim);
  if (Array.isArray(value)) {
    for (const item of value) {
      writeClaim(b, subject, claim, item);
    }
    return;
  }
  if (value === null) {
    return;
  }
  if (typeof value === "string") {
    if (looksLikeIri(value)) {
      b.addIri(subject, predicate, value);
    } else {
      b.addLiteral(subject, predicate, value);
    }
    return;
  }
  if (typeof value === "boolean") {
    b.addLiteral(subject, predicate, String(value), `${XSD}boolean`);
    return;
  }
  if (typeof value === "number") {
    const dt = Number.isInteger(value) ? `${XSD}integer` : `${XSD}double`;
    b.addLiteral(subject, predicate, String(value), dt);
    return;
  }
  const child = b.linkBlankNode(subject, predicate);
  for (const [k, v] of Object.entries(value)) {
    if (v === void 0) continue;
    writeClaim(b, child, k, v);
  }
}
function credentialToRdf(credential) {
  const id = credential.id ?? `urn:uuid:${randomUUID()}`;
  const subject = iriRef(id);
  const b = new GraphBuilder();
  b.addType(subject, VC_CREDENTIAL);
  for (const t of credential.type ?? []) {
    const iri = typeIri(t);
    if (iri !== VC_CREDENTIAL) b.addType(subject, iri);
  }
  b.addIri(subject, VC_ISSUER, credential.issuer);
  if (credential.validFrom !== void 0) {
    b.addLiteral(subject, VC_VALID_FROM, credential.validFrom, `${XSD}dateTime`);
  }
  if (credential.validUntil !== void 0) {
    b.addLiteral(subject, VC_VALID_UNTIL, credential.validUntil, `${XSD}dateTime`);
  }
  const subjects = Array.isArray(credential.credentialSubject) ? credential.credentialSubject : [credential.credentialSubject];
  for (const s of subjects) {
    writeSubject(b, subject, s);
  }
  return b.quads();
}
function base58btcEncode(bytes) {
  return base58btc.encode(bytes);
}
function base58btcDecode(value) {
  return base58btc.decode(value);
}
var SuiteRegistry = class {
  suites = /* @__PURE__ */ new Map();
  /** Register a suite (overwrites any prior suite with the same cryptosuite id). */
  register(suite) {
    this.suites.set(suite.cryptosuite, suite);
    return this;
  }
  /** The suite for a cryptosuite id, or `undefined` if none is registered. */
  get(cryptosuite) {
    return this.suites.get(cryptosuite);
  }
  /** Every registered cryptosuite id. */
  list() {
    return [...this.suites.keys()];
  }
};
function proofOptionsQuads(proof) {
  const b = new GraphBuilder();
  const node = { kind: "blank", value: "_:proof" };
  b.addType(node, "https://w3id.org/security#DataIntegrityProof");
  b.addLiteral(node, SEC_CRYPTOSUITE, proof.cryptosuite);
  b.addIri(node, SEC_VERIFICATION_METHOD, proof.verificationMethod);
  b.addIri(node, SEC_PROOF_PURPOSE, purposeIri(proof.proofPurpose));
  if (proof.created !== void 0) {
    b.addLiteral(node, DC_CREATED, proof.created, "http://www.w3.org/2001/XMLSchema#dateTime");
  }
  return b.quads();
}
function purposeIri(purpose) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(purpose) ? purpose : `https://w3id.org/security#${purpose}`;
}
function algorithmFor(cryptosuite) {
  switch (cryptosuite) {
    case "eddsa-rdfc-2022":
      return "Ed25519";
    case "ecdsa-rdfc-2019":
      return { name: "ECDSA", hash: "SHA-256" };
    default:
      throw new Error(`DataIntegritySuite: unsupported cryptosuite "${cryptosuite}"`);
  }
}
var DataIntegritySuite = class {
  cryptosuite;
  constructor(cryptosuite = "eddsa-rdfc-2022") {
    this.cryptosuite = cryptosuite;
    algorithmFor(cryptosuite);
  }
  async sign(documentQuads, options) {
    const key = options.key;
    if (key?.privateKey === void 0 || key.verificationMethod === void 0) {
      throw new Error("DataIntegritySuite.sign: options.key must be a KeyPair");
    }
    const created = options.created.toISOString();
    const optionsNoValue = {
      type: "DataIntegrityProof",
      cryptosuite: this.cryptosuite,
      verificationMethod: key.verificationMethod,
      proofPurpose: options.proofPurpose,
      created
    };
    const hash = await dataIntegrityHash(documentQuads, proofOptionsQuads(optionsNoValue));
    const algorithm = algorithmFor(this.cryptosuite);
    const signature = new Uint8Array(
      await crypto.subtle.sign(algorithm, key.privateKey, hash)
    );
    return { ...optionsNoValue, proofValue: base58btcEncode(signature) };
  }
  async verify(documentQuads, proof, options) {
    if (proof.type !== "DataIntegrityProof") return false;
    if (proof.cryptosuite !== this.cryptosuite) return false;
    const publicKey = await options.resolveKey(proof.verificationMethod);
    if (publicKey === void 0) return false;
    let signature;
    try {
      signature = base58btcDecode(proof.proofValue);
    } catch {
      return false;
    }
    const optionsNoValue = {
      type: "DataIntegrityProof",
      cryptosuite: proof.cryptosuite,
      verificationMethod: proof.verificationMethod,
      proofPurpose: proof.proofPurpose,
      ...proof.created !== void 0 ? { created: proof.created } : {}
    };
    const hash = await dataIntegrityHash(documentQuads, proofOptionsQuads(optionsNoValue));
    const algorithm = algorithmFor(this.cryptosuite);
    try {
      return await crypto.subtle.verify(
        algorithm,
        publicKey,
        signature,
        hash
      );
    } catch {
      return false;
    }
  }
};
function defaultSuiteRegistry() {
  return new SuiteRegistry().register(new DataIntegritySuite("eddsa-rdfc-2022")).register(new DataIntegritySuite("ecdsa-rdfc-2019"));
}
async function issue(input) {
  const suite = input.suite ?? new DataIntegritySuite("eddsa-rdfc-2022");
  const created = input.options?.created ?? /* @__PURE__ */ new Date();
  const proofPurpose = input.options?.proofPurpose ?? "assertionMethod";
  const credential = {
    ...input.credential,
    id: input.credential.id ?? `urn:uuid:${randomUUID2()}`,
    validFrom: input.credential.validFrom ?? created.toISOString()
  };
  const documentQuads = credentialToRdf(credential);
  const proof = await suite.sign(documentQuads, {
    key: input.key,
    proofPurpose,
    created
  });
  return { ...credential, proof };
}
function paramsFor(type) {
  if (type === "Ed25519") {
    return {
      alg: "EdDSA",
      cryptosuite: "eddsa-rdfc-2022",
      options: { crv: "Ed25519", extractable: true }
    };
  }
  return { alg: "ES256", cryptosuite: "ecdsa-rdfc-2019", options: { extractable: true } };
}
async function generateKeyPairForSuite(verificationMethod, type = "Ed25519") {
  const { alg, options } = paramsFor(type);
  const { privateKey, publicKey } = await generateKeyPair(alg, options);
  return {
    verificationMethod,
    privateKey,
    publicKey
  };
}
function cryptosuiteForKeyType(type) {
  return paramsFor(type).cryptosuite;
}
async function exportPublicJwk(key) {
  return exportJWK(key.publicKey);
}
async function importPublicKey(jwk) {
  const alg = algForJwk(jwk);
  return await importJWK(jwk, alg, { extractable: true });
}
async function importKeyPair(verificationMethod, privateJwk) {
  const alg = algForJwk(privateJwk);
  const privateKey = await importJWK(privateJwk, alg, { extractable: true });
  const { d: _d, ...pub } = privateJwk;
  const publicKey = await importJWK(pub, alg, { extractable: true });
  return { verificationMethod, privateKey, publicKey };
}
function algForJwk(jwk) {
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519") return "EdDSA";
  if (jwk.kty === "EC" && jwk.crv === "P-256") return "ES256";
  throw new Error(`unsupported JWK: kty=${jwk.kty} crv=${jwk.crv ?? "?"}`);
}
function defaultControlledBy(verificationMethod, issuer) {
  if (verificationMethod === issuer) return true;
  return verificationMethod.startsWith(`${issuer}#`) || verificationMethod.startsWith(`${issuer}/`);
}
function proofsOf(vc) {
  const proof = vc.proof;
  return Array.isArray(proof) ? [...proof] : [proof];
}
function unsigned(vc) {
  const { proof: _proof, ...rest } = vc;
  return rest;
}
async function verifyCredential(vc, options) {
  const errors = [];
  const registry = options.registry ?? defaultSuiteRegistry();
  const now = options.now ?? /* @__PURE__ */ new Date();
  const expectedPurpose = options.expectedProofPurpose ?? "assertionMethod";
  const controlledBy2 = options.isControlledBy ?? defaultControlledBy;
  if (vc === null || typeof vc !== "object" || typeof vc.issuer !== "string" || vc.issuer.length === 0 || vc.credentialSubject === void 0) {
    return {
      verified: false,
      errors: [{ code: "MALFORMED", message: "not a well-formed credential" }]
    };
  }
  const issuer = vc.issuer;
  const proofs = vc.proof === void 0 ? [] : proofsOf(vc);
  if (proofs.length === 0) {
    errors.push({ code: "NO_PROOF", message: "credential carries no proof" });
  }
  if (vc.validUntil !== void 0) {
    const until = Date.parse(vc.validUntil);
    if (!Number.isNaN(until) && now.getTime() > until) {
      errors.push({ code: "EXPIRED", message: `credential expired at ${vc.validUntil}` });
    }
  }
  if (vc.validFrom !== void 0) {
    const from = Date.parse(vc.validFrom);
    if (!Number.isNaN(from) && now.getTime() < from) {
      errors.push({
        code: "NOT_YET_VALID",
        message: `credential not valid before ${vc.validFrom}`
      });
    }
  }
  if (options.trustedIssuers !== void 0 && !options.trustedIssuers.includes(issuer)) {
    errors.push({ code: "UNTRUSTED_ISSUER", message: `issuer ${issuer} is not trusted` });
  }
  const documentQuads = credentialToRdf(unsigned(vc));
  for (const proof of proofs) {
    const suite = registry.get(proof.cryptosuite);
    if (suite === void 0) {
      errors.push({
        code: "UNKNOWN_CRYPTOSUITE",
        message: `no registered suite for cryptosuite "${proof.cryptosuite}"`
      });
      continue;
    }
    if (normalizePurpose(proof.proofPurpose) !== normalizePurpose(expectedPurpose)) {
      errors.push({
        code: "PROOF_PURPOSE_MISMATCH",
        message: `proofPurpose "${proof.proofPurpose}" != expected "${expectedPurpose}"`
      });
    }
    if (!controlledBy2(proof.verificationMethod, issuer)) {
      errors.push({
        code: "ISSUER_MISMATCH",
        message: `verificationMethod ${proof.verificationMethod} is not controlled by issuer ${issuer}`
      });
    }
    const ok = await verifyOneProof(suite, documentQuads, proof, options.resolveKey);
    if (!ok) {
      errors.push({
        code: "INVALID_SIGNATURE",
        message: `signature did not verify for proof (${proof.cryptosuite})`
      });
    }
  }
  return errors.length === 0 ? { verified: true, errors: [], issuer } : { verified: false, errors, issuer };
}
async function verifyOneProof(suite, documentQuads, proof, resolveKey) {
  try {
    return await suite.verify(documentQuads, proof, { resolveKey });
  } catch {
    return false;
  }
}
function normalizePurpose(purpose) {
  const hash = purpose.lastIndexOf("#");
  return hash === -1 ? purpose : purpose.slice(hash + 1);
}

// src/issue.ts
import { exportJWK as exportJWK2 } from "jose";

// src/vocab.ts
var FEDTRUST = "https://w3id.org/jeswr/fedtrust#";
var FEDTRUST_MEMBERSHIP_CREDENTIAL = `${FEDTRUST}MembershipCredential`;
var FEDTRUST_FEDERATION = `${FEDTRUST}federation`;
var FEDTRUST_DELEGATION_CREDENTIAL = `${FEDTRUST}DelegationCredential`;
var FEDTRUST_DELEGATE = `${FEDTRUST}delegate`;
var FEDTRUST_DELEGATE_KEY = `${FEDTRUST}delegateKey`;
var FEDREG_APP2 = `${FEDREG}app`;
var FEDREG_STATUS2 = `${FEDREG}status`;
var FEDREG_ASSERTED_BY2 = `${FEDREG}assertedBy`;
var FEDTRUST_CONTEXT_TERMS = {
  fedtrust: FEDTRUST,
  fedreg: FEDREG,
  MembershipCredential: FEDTRUST_MEMBERSHIP_CREDENTIAL,
  DelegationCredential: FEDTRUST_DELEGATION_CREDENTIAL,
  federation: { "@id": FEDTRUST_FEDERATION, "@type": "@id" },
  app: { "@id": FEDREG_APP2, "@type": "@id" },
  status: { "@id": FEDREG_STATUS2, "@type": "@id" },
  assertedBy: { "@id": FEDREG_ASSERTED_BY2, "@type": "@id" },
  delegate: { "@id": FEDTRUST_DELEGATE, "@type": "@id" },
  delegateKey: FEDTRUST_DELEGATE_KEY
};

// src/issue.ts
function suiteForKey(key) {
  const alg = key.privateKey?.algorithm;
  const name = typeof alg === "object" && alg !== null ? alg.name : void 0;
  if (name === "ECDSA") {
    return new DataIntegritySuite("ecdsa-rdfc-2019");
  }
  return new DataIntegritySuite("eddsa-rdfc-2022");
}
function statusIri(status) {
  const iri = MEMBERSHIP_STATUS[status];
  if (iri === void 0) {
    throw new Error(`issueMembershipCredential: unknown membership status "${status}"`);
  }
  return iri;
}
function buildMembershipCredential(input) {
  const { claim } = input;
  const subject = {
    id: claim.app,
    // the membership is ABOUT the app (its client_id)
    [FEDTRUST_FEDERATION]: claim.federation,
    [FEDREG_STATUS2]: statusIri(claim.status),
    [FEDREG_ASSERTED_BY2]: claim.assertedBy,
    // Echo the app as an explicit fedreg:app claim too, so the membership graph is
    // a bona fide fedreg:Membership-shaped subject (app is both the subject id and
    // an explicit fedreg:app value, matching the registry's record shape).
    [FEDREG_APP2]: claim.app
  };
  const credential = {
    issuer: claim.assertedBy,
    type: ["MembershipCredential"],
    credentialSubject: subject,
    ...claim.id !== void 0 ? { id: claim.id } : {},
    ...claim.validFrom !== void 0 ? { validFrom: claim.validFrom } : {},
    ...claim.validUntil !== void 0 ? { validUntil: claim.validUntil } : {}
  };
  return credential;
}
async function issueMembershipCredential(input) {
  const credential = buildMembershipCredential(input);
  const qualified = {
    ...credential,
    type: [FEDTRUST_MEMBERSHIP_CREDENTIAL]
  };
  return issue({
    credential: qualified,
    key: input.key,
    suite: suiteForKey(input.key),
    ...input.created !== void 0 ? { options: { created: input.created } } : {}
  });
}
async function issueDelegation(input) {
  const delegateJwk = JSON.stringify(await exportJWK2(input.delegateKey));
  const subject = {
    id: input.authority,
    [FEDTRUST_DELEGATE]: input.authority,
    [FEDTRUST_FEDERATION]: input.federation,
    // A plain string literal (not an IRI) so the parser reads it back as the JWK.
    [FEDTRUST_DELEGATE_KEY]: delegateJwk
  };
  const credential = {
    issuer: input.delegator,
    type: [FEDTRUST_DELEGATION_CREDENTIAL],
    credentialSubject: subject,
    ...input.id !== void 0 ? { id: input.id } : {},
    ...input.validFrom !== void 0 ? { validFrom: input.validFrom } : {},
    ...input.validUntil !== void 0 ? { validUntil: input.validUntil } : {}
  };
  return issue({
    credential,
    key: input.key,
    suite: suiteForKey(input.key),
    ...input.created !== void 0 ? { options: { created: input.created } } : {}
  });
}

// src/verify.ts
function relayErrorCode(code) {
  switch (code) {
    case "MALFORMED":
    case "NO_PROOF":
    case "UNKNOWN_CRYPTOSUITE":
    case "INVALID_SIGNATURE":
    case "EXPIRED":
    case "NOT_YET_VALID":
    case "ISSUER_MISMATCH":
    case "PROOF_PURPOSE_MISMATCH":
      return code;
    default:
      return "MALFORMED";
  }
}
function firstSubject(vc) {
  const s = vc.credentialSubject;
  const subj = Array.isArray(s) ? s[0] : s;
  return subj !== void 0 && subj !== null && typeof subj === "object" ? subj : void 0;
}
function strClaim(subject, key) {
  const v = subject[key];
  return typeof v === "string" && v.length > 0 ? v : void 0;
}
function hasType(vc, typeIri2) {
  return Array.isArray(vc.type) && vc.type.includes(typeIri2);
}
function proofVerificationMethod(vc) {
  const proof = Array.isArray(vc.proof) ? vc.proof[0] : vc.proof;
  if (proof === null || typeof proof !== "object") return void 0;
  const vm = proof.verificationMethod;
  return typeof vm === "string" && vm.length > 0 ? vm : void 0;
}
function fixedResolver(resolutions) {
  return (vm) => resolutions.get(vm);
}
function anchorMethod(anchor) {
  return anchor.verificationMethod ?? anchor.authority;
}
async function verifyVcAgainstKeys(vc, resolutions, now) {
  try {
    return await verifyCredential(vc, {
      resolveKey: fixedResolver(resolutions),
      now,
      expectedProofPurpose: "assertionMethod"
    });
  } catch {
    return { verified: false, errors: [{ code: "MALFORMED", message: "malformed proof" }] };
  }
}
async function importDelegateKey(jwkString) {
  let jwk;
  try {
    jwk = JSON.parse(jwkString);
  } catch {
    return void 0;
  }
  if (jwk === null || typeof jwk !== "object") return void 0;
  try {
    return await importPublicKey(jwk);
  } catch {
    return void 0;
  }
}
function brokenChain(message) {
  return { errors: [{ code: "BROKEN_CHAIN", message }] };
}
async function verifyChainLink(index, link, state, federation, now) {
  const vc = link.credential;
  if (!hasType(vc, FEDTRUST_DELEGATION_CREDENTIAL)) {
    return brokenChain(`chain link ${index} is not a fedtrust:DelegationCredential`);
  }
  if (vc.issuer !== state.expectedDelegator) {
    return brokenChain(
      `chain link ${index} issuer ${vc.issuer} != expected delegator ${state.expectedDelegator}`
    );
  }
  const linkMethod = proofVerificationMethod(vc);
  if (linkMethod === void 0 || !controlledBy(linkMethod, vc.issuer)) {
    return brokenChain(
      `chain link ${index} verificationMethod not controlled by delegator ${vc.issuer}`
    );
  }
  const res = await verifyVcAgainstKeys(vc, /* @__PURE__ */ new Map([[linkMethod, state.trustedKey]]), now);
  if (!res.verified) {
    return brokenChain(
      `chain link ${index} signature/validity invalid against the trusted delegator key (${state.trustedMethod}): ${res.errors.map((e) => e.code).join(",")}`
    );
  }
  const subject = firstSubject(vc);
  if (subject === void 0) {
    return brokenChain(`chain link ${index} has no credentialSubject`);
  }
  const delegate = strClaim(subject, FEDTRUST_DELEGATE);
  const linkFederation = strClaim(subject, FEDTRUST_FEDERATION);
  const delegateKeyJwk = strClaim(subject, FEDTRUST_DELEGATE_KEY);
  if (delegate === void 0) {
    return brokenChain(`chain link ${index} names no fedtrust:delegate`);
  }
  if (linkFederation !== federation) {
    return brokenChain(
      `chain link ${index} federation ${linkFederation ?? "(none)"} != ${federation}`
    );
  }
  if (delegateKeyJwk === void 0) {
    return brokenChain(
      `chain link ${index} carries no fedtrust:delegateKey (chain not self-certifying)`
    );
  }
  const delegateKey = await importDelegateKey(delegateKeyJwk);
  if (delegateKey === void 0) {
    return brokenChain(`chain link ${index} has an unparseable fedtrust:delegateKey`);
  }
  return {
    next: { expectedDelegator: delegate, trustedMethod: delegate, trustedKey: delegateKey }
  };
}
async function verifyChain(issuer, federation, chain, anchors, now) {
  if (chain.length === 0) {
    return brokenChain("delegation chain is empty");
  }
  const rootVc = chain[0]?.credential;
  if (rootVc === void 0 || typeof rootVc.issuer !== "string") {
    return brokenChain("first chain link is malformed");
  }
  const rootAnchor = anchors.find((a) => a.authority === rootVc.issuer);
  if (rootAnchor === void 0) {
    return brokenChain(`first chain link issuer ${rootVc.issuer} is not a trust anchor`);
  }
  let state = {
    expectedDelegator: rootAnchor.authority,
    trustedMethod: anchorMethod(rootAnchor),
    trustedKey: rootAnchor.publicKey
  };
  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    if (link === void 0) {
      return brokenChain(`chain link ${i} is missing`);
    }
    const step = await verifyChainLink(i, link, state, federation, now);
    if ("errors" in step) {
      return step;
    }
    state = step.next;
  }
  if (state.expectedDelegator !== issuer) {
    return brokenChain(
      `chain leaf delegates to ${state.expectedDelegator}, not the membership issuer ${issuer}`
    );
  }
  return {
    errors: [],
    issuerKey: { verificationMethod: state.trustedMethod, publicKey: state.trustedKey }
  };
}
function controlledBy(verificationMethod, issuer) {
  if (verificationMethod === issuer) return true;
  return verificationMethod.startsWith(`${issuer}#`) || verificationMethod.startsWith(`${issuer}/`);
}
function readMembershipClaim(vc) {
  const errors = [];
  const subject = firstSubject(vc);
  if (subject === void 0) {
    return { errors: [{ code: "MISSING_CLAIM", message: "credential has no credentialSubject" }] };
  }
  const federation = strClaim(subject, FEDTRUST_FEDERATION);
  const app = strClaim(subject, FEDREG_APP2) ?? strClaim(subject, "id");
  const assertedBy = strClaim(subject, FEDREG_ASSERTED_BY2);
  const statusIri2 = strClaim(subject, FEDREG_STATUS2);
  if (federation === void 0) {
    errors.push({ code: "MISSING_CLAIM", message: "membership names no fedtrust:federation" });
  }
  if (app === void 0) {
    errors.push({ code: "MISSING_CLAIM", message: "membership names no fedreg:app" });
  }
  if (assertedBy === void 0) {
    errors.push({ code: "MISSING_CLAIM", message: "membership names no fedreg:assertedBy" });
  }
  if (statusIri2 === void 0) {
    errors.push({ code: "MISSING_CLAIM", message: "membership names no fedreg:status" });
  }
  const status = statusIri2 !== void 0 ? statusName(statusIri2) : void 0;
  if (statusIri2 !== void 0 && status === void 0) {
    errors.push({
      code: "UNKNOWN_STATUS",
      message: `fedreg:status ${statusIri2} is not a known MembershipStatus`
    });
  }
  if (assertedBy !== void 0 && assertedBy !== vc.issuer) {
    errors.push({
      code: "ASSERTED_BY_MISMATCH",
      message: `signed assertedBy ${assertedBy} != credential issuer ${vc.issuer}`
    });
  }
  if (federation === void 0 || app === void 0 || assertedBy === void 0 || status === void 0) {
    return { errors };
  }
  return {
    claim: {
      federation,
      app,
      status,
      assertedBy,
      ...typeof vc.id === "string" ? { id: vc.id } : {},
      ...typeof vc.validFrom === "string" ? { validFrom: vc.validFrom } : {},
      ...typeof vc.validUntil === "string" ? { validUntil: vc.validUntil } : {}
    },
    errors
  };
}
async function establishTrust(vc, claim, anchors, chain, now) {
  const errors = [];
  const resolutions = /* @__PURE__ */ new Map();
  const directAnchor = anchors.find((a) => a.authority === vc.issuer);
  const membershipMethod = proofVerificationMethod(vc);
  if (directAnchor !== void 0) {
    resolutions.set(anchorMethod(directAnchor), directAnchor.publicKey);
    if (membershipMethod !== void 0 && controlledBy(membershipMethod, vc.issuer)) {
      resolutions.set(membershipMethod, directAnchor.publicKey);
    }
    return { resolutions, trustEstablished: true, errors };
  }
  if (chain !== void 0 && claim !== void 0) {
    const chainResult = await verifyChain(vc.issuer, claim.federation, chain, anchors, now);
    if (chainResult.errors.length > 0) {
      errors.push(...chainResult.errors);
    } else if (chainResult.issuerKey !== void 0) {
      if (membershipMethod !== void 0 && controlledBy(membershipMethod, vc.issuer)) {
        resolutions.set(membershipMethod, chainResult.issuerKey.publicKey);
        return { resolutions, trustEstablished: true, errors };
      }
      errors.push({
        code: "BROKEN_CHAIN",
        message: `membership proof verificationMethod ${membershipMethod ?? "(none)"} is not controlled by the chain-proven issuer ${vc.issuer}`
      });
    }
  }
  return { resolutions, trustEstablished: false, errors };
}
function checkClaimExpectations(claim, accept, options) {
  const errors = [];
  if (!accept.includes(claim.status)) {
    errors.push({
      code: "STATUS_NOT_TRUSTED",
      message: `membership status ${claim.status} is not in the accepted set [${accept.join(", ")}]`
    });
  }
  if (options.expectedFederation !== void 0 && claim.federation !== options.expectedFederation) {
    errors.push({
      code: "FEDERATION_MISMATCH",
      message: `membership is for federation ${claim.federation}, expected ${options.expectedFederation}`
    });
  }
  if (options.expectedApp !== void 0 && claim.app !== options.expectedApp) {
    errors.push({
      code: "APP_MISMATCH",
      message: `membership is for app ${claim.app}, expected ${options.expectedApp}`
    });
  }
  return errors;
}
async function verifyMembershipCredential(vc, options) {
  const errors = [];
  const now = options.now ?? /* @__PURE__ */ new Date();
  const accept = options.acceptStatuses ?? [...TRUSTED_STATUS];
  const anchors = options.trustAnchors ?? [];
  if (anchors.length === 0) {
    return {
      verified: false,
      errors: [{ code: "NO_TRUST_ANCHOR", message: "no trust anchors supplied" }]
    };
  }
  if (vc === null || typeof vc !== "object" || typeof vc.issuer !== "string") {
    return {
      verified: false,
      errors: [{ code: "MALFORMED", message: "not a well-formed credential" }]
    };
  }
  if (!hasType(vc, FEDTRUST_MEMBERSHIP_CREDENTIAL)) {
    errors.push({
      code: "MALFORMED",
      message: "credential is not a fedtrust:MembershipCredential"
    });
  }
  const { claim, errors: claimErrors } = readMembershipClaim(vc);
  errors.push(...claimErrors);
  const trust = await establishTrust(vc, claim, anchors, options.chain, now);
  errors.push(...trust.errors);
  if (!trust.trustEstablished) {
    errors.push({
      code: "UNTRUSTED_AUTHORITY",
      message: `issuer ${vc.issuer} is not a trust anchor and no valid delegation chain proves it`
    });
  }
  const vcResult = await verifyVcAgainstKeys(vc, trust.resolutions, now);
  for (const e of vcResult.errors) {
    if (!trust.trustEstablished && e.code === "INVALID_SIGNATURE") {
      continue;
    }
    errors.push({ code: relayErrorCode(e.code), message: e.message });
  }
  if (claim !== void 0) {
    errors.push(...checkClaimExpectations(claim, accept, options));
  }
  return errors.length === 0 ? { verified: true, errors: [], ...claim !== void 0 ? { claim } : {} } : { verified: false, errors, ...claim !== void 0 ? { claim } : {} };
}
export {
  FEDREG,
  FEDREG_APP2 as FEDREG_APP,
  FEDREG_ASSERTED_BY2 as FEDREG_ASSERTED_BY,
  FEDREG_STATUS2 as FEDREG_STATUS,
  FEDTRUST,
  FEDTRUST_CONTEXT_TERMS,
  FEDTRUST_DELEGATE,
  FEDTRUST_DELEGATE_KEY,
  FEDTRUST_DELEGATION_CREDENTIAL,
  FEDTRUST_FEDERATION,
  FEDTRUST_MEMBERSHIP_CREDENTIAL,
  MEMBERSHIP_STATUS,
  TRUSTED_STATUS,
  buildMembershipCredential,
  cryptosuiteForKeyType,
  exportPublicJwk,
  generateKeyPairForSuite,
  importKeyPair,
  importPublicKey,
  issueDelegation,
  issueMembershipCredential,
  statusName,
  verifyMembershipCredential
};
//# sourceMappingURL=index.js.map
