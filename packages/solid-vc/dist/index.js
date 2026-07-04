// src/canonicalize.ts
import { createHash } from "node:crypto";
import { canonize } from "rdf-canonize";
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

// src/credential.ts
import { randomUUID } from "node:crypto";

// node_modules/@jeswr/fetch-rdf/dist/parse.js
import contentType from "content-type";
import { Store, StreamParser } from "n3";
import { JsonLdParser } from "jsonld-streaming-parser";

// node_modules/@jeswr/fetch-rdf/dist/errors.js
var RdfFetchError = class extends Error {
  /** The original cause, if any (e.g. a network error or parser exception). */
  cause;
  /** HTTP status code from a non-2xx response, if applicable. */
  status;
  /** The final request URL (after redirects), if known. */
  url;
  /** Raw `Content-Type` header from the response, if known. */
  contentType;
  constructor(message, options = {}) {
    super(message);
    this.name = "RdfFetchError";
    if (options.cause !== void 0)
      this.cause = options.cause;
    if (options.status !== void 0)
      this.status = options.status;
    if (options.url !== void 0)
      this.url = options.url;
    if (options.contentType !== void 0)
      this.contentType = options.contentType;
  }
};

// node_modules/@jeswr/fetch-rdf/dist/parse.js
var SUPPORTED_RDF_MEDIA_TYPES = [
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "application/ld+json"
];
var N3_FAMILY = /* @__PURE__ */ new Set([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig"
]);
var JSON_LD_FAMILY = /* @__PURE__ */ new Set([
  "application/ld+json"
]);
async function parseRdf(body, contentTypeHeader, options = {}) {
  const rawHeader = contentTypeHeader ?? "text/turtle";
  let mediaType;
  try {
    mediaType = contentType.parse(rawHeader).type;
  } catch (cause) {
    throw new RdfFetchError(`Invalid Content-Type header: "${rawHeader}".`, { cause, contentType: rawHeader });
  }
  const baseIRI = options.baseIRI;
  let parser;
  if (N3_FAMILY.has(mediaType)) {
    parser = new StreamParser({
      format: mediaType,
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else if (JSON_LD_FAMILY.has(mediaType)) {
    parser = new JsonLdParser({
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else {
    throw new RdfFetchError(`Unsupported RDF media type: "${mediaType}". Supported: ${SUPPORTED_RDF_MEDIA_TYPES.join(", ")}.`, { contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
  const storePromise = collectIntoStore(parser);
  try {
    await pumpBody(parser, body);
    return await storePromise;
  } catch (cause) {
    if (cause instanceof RdfFetchError)
      throw cause;
    throw new RdfFetchError(`Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ""}.`, { cause, contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
}
function collectIntoStore(parser) {
  return new Promise((resolve, reject) => {
    const store = new Store();
    parser.on("data", (quad) => {
      store.addQuad(quad);
    });
    parser.on("error", reject);
    parser.on("end", () => {
      resolve(store);
    });
  });
}
async function pumpBody(parser, body) {
  if (typeof body === "string") {
    parser.end(body);
    return;
  }
  let parserError = null;
  const onParserError = (err) => {
    parserError = err;
  };
  parser.on("error", onParserError);
  const reader = body.getReader();
  try {
    const decoder = new TextDecoder();
    for (; ; ) {
      if (parserError)
        throw parserError;
      const { done, value } = await reader.read();
      if (done)
        break;
      if (value === void 0)
        continue;
      const text = decoder.decode(value, { stream: true });
      if (text.length === 0)
        continue;
      if (!parser.write(text))
        await waitForDrain(parser);
    }
    if (parserError)
      throw parserError;
    const tail = decoder.decode();
    if (tail.length > 0)
      parser.write(tail);
    parser.end();
  } catch (err) {
    parser.destroy(err instanceof Error ? err : new Error(String(err)));
    try {
      await reader.cancel();
    } catch {
    }
    throw err;
  } finally {
    parser.off("error", onParserError);
    reader.releaseLock();
  }
}
function waitForDrain(parser) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      parser.off("drain", onDrain);
      parser.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    parser.once("drain", onDrain);
    parser.once("error", onError);
  });
}

// src/digest.ts
import { createHash as createHash2 } from "node:crypto";

// src/multibase.ts
import { base58btc } from "multiformats/bases/base58";
function base58btcEncode(bytes) {
  return base58btc.encode(bytes);
}
function base58btcDecode(value) {
  return base58btc.decode(value);
}

// src/digest.ts
var MULTIHASH_SHA2_256_PREFIX = Uint8Array.from([18, 32]);
function sha256Multihash(digest) {
  const out = new Uint8Array(MULTIHASH_SHA2_256_PREFIX.length + digest.length);
  out.set(MULTIHASH_SHA2_256_PREFIX, 0);
  out.set(digest, MULTIHASH_SHA2_256_PREFIX.length);
  return base58btcEncode(out);
}
async function digestQuads(quads) {
  const canonical = await canonicalNQuads(quads);
  const digest = new Uint8Array(createHash2("sha256").update(canonical, "utf8").digest());
  return sha256Multihash(digest);
}
async function digestRdfContent(content, contentType2 = "text/turtle") {
  const dataset = await parseRdf(content, contentType2);
  const quads = [...dataset.match()];
  if (quads.length === 0) {
    throw new Error(
      "@jeswr/solid-vc: refusing to digest an EMPTY RDF graph \u2014 the content parsed to zero quads (wrong contentType, or an empty policy document). A digest over nothing binds nothing."
    );
  }
  return digestQuads(quads);
}

// src/iri.ts
var IRI_FORBIDDEN = /[\u0000-\u0020<>"{}|^`\\]/g;
function percentEncode(ch) {
  return `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
}
function escapeIri(value) {
  return value.replace(IRI_FORBIDDEN, percentEncode);
}
function safeHttpIri(value) {
  if (typeof value !== "string") return void 0;
  let u;
  try {
    u = new URL(value);
  } catch {
    return void 0;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return void 0;
  return u.href.replace(/\|/g, "%7C").replace(/\^/g, "%5E").replace(/`/g, "%60");
}
function isAbsoluteIri(value) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}
function safeObjectIri(value) {
  if (typeof value !== "string") return void 0;
  const http = safeHttpIri(value);
  if (http !== void 0) return http;
  return isAbsoluteIri(value) ? escapeIri(value) : void 0;
}
function requireObjectIri(value, field) {
  const iri = safeObjectIri(value);
  if (iri === void 0) {
    throw new Error(
      `@jeswr/solid-vc: ${field} must be an absolute http(s)/did:/urn: IRI, got ${JSON.stringify(
        value
      )} \u2014 refusing to build a credential with an invalid ${field}`
    );
  }
  return iri;
}

// node_modules/@jeswr/rdf-serialize/dist/serialize.js
import { Writer } from "n3";
var DEFAULT_FORMAT = "text/turtle";
function serialize(quads, options) {
  const format = options?.format ?? DEFAULT_FORMAT;
  const prefixes = options?.prefixes ?? {};
  const emptyAsEmptyString = options?.emptyAsEmptyString ?? true;
  if (emptyAsEmptyString && quads.length === 0) {
    return Promise.resolve("");
  }
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format, prefixes });
    writer.addQuads(quads);
    writer.end((error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}
function legacySerialize(quads, format = DEFAULT_FORMAT, prefixes = {}, emptyAsEmptyString = true) {
  return serialize(quads, { format, prefixes, emptyAsEmptyString });
}

// src/vocab.ts
var VC = "https://www.w3.org/2018/credentials#";
var VC_V2_CONTEXT = "https://www.w3.org/ns/credentials/v2";
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
var VC_RELATED_RESOURCE = `${VC}relatedResource`;
var SEC_DIGEST_MULTIBASE = `${SEC}digestMultibase`;
var SEC_MULTIBASE = `${SEC}multibase`;
var SCHEMA_ENCODING_FORMAT = `${SCHEMA}encodingFormat`;
var VC_VERIFIABLE_CREDENTIAL = `${VC}verifiableCredential`;
var VC_HOLDER = `${VC}holder`;
var SEC_PROOF = `${SEC}proof`;
var SEC_DATA_INTEGRITY_PROOF = `${SEC}DataIntegrityProof`;
var SEC_CRYPTOSUITE = `${SEC}cryptosuite`;
var SEC_PROOF_VALUE = `${SEC}proofValue`;
var SEC_VERIFICATION_METHOD = `${SEC}verificationMethod`;
var SEC_PROOF_PURPOSE = `${SEC}proofPurpose`;
var DC_CREATED = "http://purl.org/dc/terms/created";
var SEC_MULTIKEY = `${SEC}Multikey`;
var SEC_CONTROLLER = `${SEC}controller`;
var SEC_PUBLIC_KEY_MULTIBASE = `${SEC}publicKeyMultibase`;
var SEC_ASSERTION_METHOD = `${SEC}assertionMethod`;
var SVC_AGENT_AUTHORIZATION = `${SVC}AgentAuthorizationCredential`;
var SVC_AUTHORIZES = `${SVC}authorizes`;
var SVC_ACTION = `${SVC}action`;
var SVC_TARGET = `${SVC}target`;
var SVC_POLICY = `${SVC}policy`;
var SVC_TERMS = {
  svc: SVC,
  acl: ACL,
  odrl: ODRL,
  schema: SCHEMA,
  AgentAuthorizationCredential: SVC_AGENT_AUTHORIZATION,
  authorizes: { "@id": SVC_AUTHORIZES, "@type": "@id" },
  action: { "@id": SVC_ACTION, "@type": "@id" },
  target: { "@id": SVC_TARGET, "@type": "@id" },
  policy: { "@id": SVC_POLICY, "@type": "@id" }
};
var SVC_INLINE_CONTEXT = [
  VC_V2_CONTEXT,
  SVC_TERMS
];

// src/serialize.ts
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
function serialize2(quads, format = "text/turtle") {
  return legacySerialize(quads, format, PREFIXES);
}

// src/wrappers.ts
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
function objectTerms(node, predicate) {
  return SetFrom.subjectPredicate(node, predicate, TermAs.instance(TermWrapper), TermFrom.instance);
}
var ProofNode = class extends TermWrapper {
  get types() {
    return objectTerms(this, RDF_TYPE);
  }
  get cryptosuites() {
    return objectTerms(this, SEC_CRYPTOSUITE);
  }
  get verificationMethods() {
    return objectTerms(this, SEC_VERIFICATION_METHOD);
  }
  get proofPurposes() {
    return objectTerms(this, SEC_PROOF_PURPOSE);
  }
  get proofValues() {
    return objectTerms(this, SEC_PROOF_VALUE);
  }
  get createds() {
    return objectTerms(this, DC_CREATED);
  }
};
var CredentialNode = class extends TermWrapper {
  get types() {
    return objectTerms(this, RDF_TYPE);
  }
  get issuers() {
    return objectTerms(this, VC_ISSUER);
  }
  get subjects() {
    return objectTerms(this, VC_CREDENTIAL_SUBJECT);
  }
  get validFroms() {
    return objectTerms(this, VC_VALID_FROM);
  }
  get validUntils() {
    return objectTerms(this, VC_VALID_UNTIL);
  }
  get proofs() {
    return SetFrom.subjectPredicate(this, SEC_PROOF, TermAs.instance(ProofNode), TermFrom.instance);
  }
};
var PresentationNode = class extends TermWrapper {
  get types() {
    return objectTerms(this, RDF_TYPE);
  }
  get holders() {
    return objectTerms(this, VC_HOLDER);
  }
  get credentials() {
    return SetFrom.subjectPredicate(
      this,
      VC_VERIFIABLE_CREDENTIAL,
      TermAs.instance(CredentialNode),
      TermFrom.instance
    );
  }
  get proofs() {
    return SetFrom.subjectPredicate(this, SEC_PROOF, TermAs.instance(ProofNode), TermFrom.instance);
  }
};
var VcDataset = class extends DatasetWrapper {
  /** Every `cred:VerifiableCredential` subject in the dataset. */
  credentials() {
    return [...this.instancesOf(VC_CREDENTIAL, CredentialNode)];
  }
  /** Every `cred:VerifiablePresentation` subject in the dataset. */
  presentations() {
    return [...this.instancesOf(VC_PRESENTATION, PresentationNode)];
  }
};
function wrapVc(dataset) {
  return new VcDataset(dataset, DataFactory);
}
function firstIri(terms) {
  for (const term of terms) {
    if (term.termType === "NamedNode") {
      return term.value;
    }
  }
  return void 0;
}
function firstLiteral(terms) {
  for (const term of terms) {
    if (term.termType === "Literal") {
      return term.value;
    }
  }
  return void 0;
}
function iriRef(iri) {
  return { kind: "iri", value: iri };
}
function normalize(subject) {
  return typeof subject === "string" ? { kind: "iri", value: subject } : subject;
}
var GraphBuilder = class {
  store = new Store2();
  factory = DataFactory;
  /**
   * Materialise a {@link NodeRef} to its RDF/JS term. An IRI subject is passed
   * through {@link escapeIri} FIRST so an untrusted subject id cannot break out of
   * the `<…>` when the graph is serialised (n3.Writer does not escape IRIs). This
   * is scheme-agnostic, so a `urn:uuid:` / `did:` subject is preserved unchanged.
   */
  subjectTerm(ref) {
    return ref.kind === "iri" ? NamedNodeFrom.string(escapeIri(ref.value), this.factory) : BlankNodeFrom.string(ref.value, this.factory);
  }
  /** Add `(subject, rdf:type, classIri)`. */
  addType(subject, classIri) {
    this.addIri(subject, RDF_TYPE, classIri);
  }
  /**
   * Add `(subject, predicate, object-IRI)`. The predicate and object IRIs are
   * passed through {@link escapeIri} so neither an untrusted claim-key predicate
   * nor an untrusted object IRI can break out of the serialised `<…>` — the
   * low-level chokepoint that closes the injection for EVERY object-IRI write.
   */
  addIri(subject, predicate, objectIri) {
    const s = this.subjectTerm(normalize(subject));
    const p = NamedNodeFrom.string(escapeIri(predicate), this.factory);
    const o = NamedNodeFrom.string(escapeIri(objectIri), this.factory);
    this.store.add(this.factory.quad(s, p, o));
  }
  /** Add `(subject, predicate, literal)` with an optional datatype IRI. */
  addLiteral(subject, predicate, value, datatypeIri) {
    const s = this.subjectTerm(normalize(subject));
    const p = NamedNodeFrom.string(escapeIri(predicate), this.factory);
    const o = datatypeIri === void 0 ? LiteralFrom.string(value, this.factory) : this.factory.literal(
      value,
      NamedNodeFrom.string(escapeIri(datatypeIri), this.factory)
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
    const blank = BlankNodeFrom.string(void 0, this.factory);
    const p = NamedNodeFrom.string(escapeIri(predicate), this.factory);
    this.store.add(this.factory.quad(s, p, blank));
    return { kind: "blank", value: blank.value };
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

// src/credential.ts
function looksLikeIri(value) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}
function typeIri(type) {
  if (type === "VerifiableCredential") return VC_CREDENTIAL;
  if (type === "AgentAuthorizationCredential") return SVC_AGENT_AUTHORIZATION;
  if (looksLikeIri(type)) return type;
  return `https://w3id.org/jeswr/solid-vc#${type}`;
}
function normalizeSubjectId(id) {
  if (typeof id !== "string" || id.trim().length === 0) return void 0;
  if (!isAbsoluteIri(id)) {
    throw new Error(
      `@jeswr/solid-vc: credentialSubject.id must be an absolute IRI, got ${JSON.stringify(
        id
      )} \u2014 refusing to emit a credential subject with a relative/invalid id`
    );
  }
  return id;
}
function subjectWithNormalizedId(subject) {
  if (normalizeSubjectId(subject.id) !== void 0) return subject;
  if (!("id" in subject)) return subject;
  const { id: _blank, ...rest } = subject;
  return rest;
}
function normalizeCredentialSubjects(credential) {
  const cs = credential.credentialSubject;
  const credentialSubject = Array.isArray(cs) ? cs.map(subjectWithNormalizedId) : subjectWithNormalizedId(cs);
  return { ...credential, credentialSubject };
}
function writeSubject(b, credential, subject) {
  const idIri = normalizeSubjectId(subject.id);
  let node;
  if (idIri !== void 0) {
    node = iriRef(idIri);
    b.addIri(credential, VC_CREDENTIAL_SUBJECT, idIri);
  } else {
    node = b.linkBlankNode(credential, VC_CREDENTIAL_SUBJECT);
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
function writeRelatedResource(b, credential, related) {
  const idIri = requireObjectIri(related.id, "relatedResource.id");
  b.addIri(credential, VC_RELATED_RESOURCE, idIri);
  const node = iriRef(idIri);
  if (related.digestMultibase !== void 0) {
    b.addLiteral(node, SEC_DIGEST_MULTIBASE, related.digestMultibase, SEC_MULTIBASE);
  }
  if (related.mediaType !== void 0) {
    b.addLiteral(node, SCHEMA_ENCODING_FORMAT, related.mediaType);
  }
}
function credentialToRdf(credential) {
  const id = credential.id ?? `urn:uuid:${randomUUID()}`;
  const subject = iriRef(id);
  const b = new GraphBuilder();
  b.addType(subject, VC_CREDENTIAL);
  for (const t of credential.type ?? []) {
    const iri = typeIri(t);
    if (iri === VC_CREDENTIAL) continue;
    const safe = safeObjectIri(iri);
    if (safe !== void 0) b.addType(subject, safe);
  }
  const issuerIri = requireObjectIri(credential.issuer, "issuer");
  b.addIri(subject, VC_ISSUER, issuerIri);
  if (credential.validFrom !== void 0) {
    b.addLiteral(subject, VC_VALID_FROM, credential.validFrom, `${XSD}dateTime`);
  }
  if (credential.validUntil !== void 0) {
    b.addLiteral(subject, VC_VALID_UNTIL, credential.validUntil, `${XSD}dateTime`);
  }
  for (const related of credential.relatedResource ?? []) {
    writeRelatedResource(b, subject, related);
  }
  const subjects = Array.isArray(credential.credentialSubject) ? credential.credentialSubject : [credential.credentialSubject];
  for (const s of subjects) {
    writeSubject(b, subject, s);
  }
  return b.quads();
}
function credentialToTurtle(credential, format) {
  return serialize2(credentialToRdf(credential), format);
}
function credentialToJsonLd(credential) {
  requireObjectIri(credential.issuer, "issuer");
  const id = credential.id ?? `urn:uuid:${randomUUID()}`;
  const types = ["VerifiableCredential", ...credential.type ?? []];
  const doc = {
    "@context": SVC_INLINE_CONTEXT,
    id,
    type: [...new Set(types)],
    issuer: credential.issuer
  };
  if (credential.validFrom !== void 0) doc.validFrom = credential.validFrom;
  if (credential.validUntil !== void 0) doc.validUntil = credential.validUntil;
  if (credential.relatedResource !== void 0 && credential.relatedResource.length > 0) {
    for (const related of credential.relatedResource) {
      requireObjectIri(related.id, "relatedResource.id");
    }
    doc.relatedResource = credential.relatedResource.map((related) => ({
      id: related.id,
      ...related.digestMultibase !== void 0 ? { digestMultibase: related.digestMultibase } : {},
      ...related.mediaType !== void 0 ? { mediaType: related.mediaType } : {}
    }));
  }
  const subjects = Array.isArray(credential.credentialSubject) ? credential.credentialSubject : [credential.credentialSubject];
  const normalized = subjects.map(subjectWithNormalizedId);
  doc.credentialSubject = normalized.length === 1 ? normalized[0] : normalized;
  return doc;
}
function credentialMetaFromNode(node) {
  const types = [];
  for (const t of node.types) {
    if (t.termType === "NamedNode") types.push(t.value);
  }
  return {
    id: node.value,
    issuer: firstIri(node.issuers),
    // validFrom / validUntil are xsd:dateTime literals — read as the first literal.
    validFrom: firstLiteral(node.validFroms),
    validUntil: firstLiteral(node.validUntils),
    types
  };
}
async function parseCredentialRdf(body, contentType2 = "text/turtle") {
  return await parseRdf(body, contentType2);
}
function credentialFromRdf(dataset) {
  return wrapVc(dataset).credentials()[0];
}
function buildAgentAuthorizationCredential(auth) {
  if (auth.policyContent !== void 0) {
    throw new Error(
      "@jeswr/solid-vc: buildAgentAuthorizationCredential cannot bind policyContent (digest computation is async) \u2014 use buildBoundAgentAuthorizationCredential / issueAgentAuthorization, which emit the relatedResource digest binding"
    );
  }
  const actions = Array.isArray(auth.action) ? auth.action : [auth.action];
  const subject = {
    [SVC_AUTHORIZES]: auth.agent,
    [SVC_ACTION]: actions.length === 1 ? actions[0] : actions
  };
  if (auth.target !== void 0) subject[SVC_TARGET] = auth.target;
  if (auth.policy !== void 0) subject[SVC_POLICY] = auth.policy;
  const credentialSubject = { id: auth.principal, ...subject };
  const credential = {
    issuer: auth.principal,
    type: ["AgentAuthorizationCredential"],
    credentialSubject,
    ...auth.id !== void 0 ? { id: auth.id } : {},
    ...auth.validFrom !== void 0 ? { validFrom: auth.validFrom } : {},
    ...auth.validUntil !== void 0 ? { validUntil: auth.validUntil } : {}
  };
  return credential;
}
async function buildBoundAgentAuthorizationCredential(auth) {
  if (auth.policyContent === void 0) {
    return buildAgentAuthorizationCredential(auth);
  }
  if (auth.policy === void 0) {
    throw new Error(
      "@jeswr/solid-vc: policyContent requires a policy IRI \u2014 the content digest binds to the relatedResource id, so an anonymous policy cannot be content-bound"
    );
  }
  const contentType2 = auth.policyContentType ?? "text/turtle";
  const digestMultibase = await digestRdfContent(auth.policyContent, contentType2);
  const { policyContent: _c, policyContentType: _ct, ...bare } = auth;
  const credential = buildAgentAuthorizationCredential(bare);
  const related = {
    id: auth.policy,
    digestMultibase,
    mediaType: contentType2
  };
  return { ...credential, relatedResource: [related] };
}
function relatedResourcesFromNode(node) {
  const dataset = node.dataset;
  const out = [];
  for (const quad of dataset.match()) {
    if (quad.subject.termType !== "NamedNode" || quad.subject.value !== node.value) continue;
    if (quad.predicate.value !== VC_RELATED_RESOURCE) continue;
    if (quad.object.termType !== "NamedNode") continue;
    const id = quad.object.value;
    let digestMultibase;
    let mediaType;
    for (const q of dataset.match()) {
      if (q.subject.termType !== "NamedNode" || q.subject.value !== id) continue;
      if (q.object.termType !== "Literal") continue;
      if (q.predicate.value === SEC_DIGEST_MULTIBASE) digestMultibase = q.object.value;
      if (q.predicate.value === SCHEMA_ENCODING_FORMAT) mediaType = q.object.value;
    }
    out.push({
      id,
      ...digestMultibase !== void 0 ? { digestMultibase } : {},
      ...mediaType !== void 0 ? { mediaType } : {}
    });
  }
  return out;
}
function agentAuthorizationFromRdf(node) {
  const meta = credentialMetaFromNode(node);
  if (!meta.types.includes(SVC_AGENT_AUTHORIZATION)) return void 0;
  const subjectTerm = [...node.subjects].find((t) => t.termType === "NamedNode");
  if (subjectTerm === void 0) return void 0;
  const subjectIri = subjectTerm.value;
  const dataset = node.dataset;
  const reads = readSubjectClaims(dataset, subjectIri);
  if (reads.authorizes === void 0 || reads.action.length === 0) return void 0;
  return {
    principal: subjectIri,
    agent: reads.authorizes,
    action: reads.action.length === 1 ? reads.action[0] : reads.action,
    ...reads.target !== void 0 ? { target: reads.target } : {},
    ...reads.policy !== void 0 ? { policy: reads.policy } : {}
  };
}
function readSubjectClaims(dataset, subjectIri) {
  let authorizes;
  const action = [];
  let target;
  let policy;
  for (const quad of dataset.match()) {
    if (quad.subject.termType !== "NamedNode" || quad.subject.value !== subjectIri) continue;
    if (quad.object.termType !== "NamedNode") continue;
    switch (quad.predicate.value) {
      case SVC_AUTHORIZES:
        authorizes = quad.object.value;
        break;
      case SVC_ACTION:
        action.push(quad.object.value);
        break;
      case SVC_TARGET:
        target = quad.object.value;
        break;
      case SVC_POLICY:
        policy = quad.object.value;
        break;
      default:
        break;
    }
  }
  return {
    ...authorizes !== void 0 ? { authorizes } : {},
    action,
    ...target !== void 0 ? { target } : {},
    ...policy !== void 0 ? { policy } : {}
  };
}

// src/issue.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// src/proof.ts
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

// src/issue.ts
async function issue(input) {
  const suite = input.suite ?? new DataIntegritySuite("eddsa-rdfc-2022");
  const created = input.options?.created ?? /* @__PURE__ */ new Date();
  const proofPurpose = input.options?.proofPurpose ?? "assertionMethod";
  const credential = normalizeCredentialSubjects({
    ...input.credential,
    id: input.credential.id ?? `urn:uuid:${randomUUID2()}`,
    validFrom: input.credential.validFrom ?? created.toISOString()
  });
  const documentQuads = credentialToRdf(credential);
  const proof = await suite.sign(documentQuads, {
    key: input.key,
    proofPurpose,
    created
  });
  return { ...credential, proof };
}
async function issueAgentAuthorization(auth, key, opts) {
  const credential = auth.policyContent !== void 0 ? await buildBoundAgentAuthorizationCredential(auth) : buildAgentAuthorizationCredential(auth);
  return issue({
    credential,
    key,
    ...opts?.suite !== void 0 ? { suite: opts.suite } : {},
    ...opts?.options !== void 0 ? { options: opts.options } : {}
  });
}

// src/keys.ts
import { exportJWK, generateKeyPair, importJWK } from "jose";
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
async function exportPrivateJwk(key) {
  return exportJWK(key.privateKey);
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

// src/verify.ts
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
function normalizeRelatedResources(value) {
  if (value === void 0) return { entries: [] };
  if (!Array.isArray(value)) {
    return {
      error: { code: "MALFORMED", message: "relatedResource must be an array when present" }
    };
  }
  const entries = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return {
        error: { code: "MALFORMED", message: "relatedResource entry must be an object" }
      };
    }
    const entry = raw;
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      return {
        error: {
          code: "MALFORMED",
          message: "relatedResource entry must carry a non-empty string id"
        }
      };
    }
    entries.push({
      id: entry.id,
      ...typeof entry.digestMultibase === "string" ? { digestMultibase: entry.digestMultibase } : {},
      ...typeof entry.mediaType === "string" ? { mediaType: entry.mediaType } : {}
    });
  }
  return { entries };
}
async function checkPresentedResource(related, iri, presented) {
  const entries = related.filter((r) => r.id === iri);
  if (entries.length === 0) {
    return [
      {
        code: "RELATED_RESOURCE_MISSING",
        message: `credential carries no relatedResource digest binding for presented resource ${iri}`
      }
    ];
  }
  if (entries.some((r) => typeof r.digestMultibase !== "string" || r.digestMultibase.length === 0)) {
    return [
      {
        code: "RELATED_RESOURCE_MISSING",
        message: `relatedResource entry for ${iri} carries no digestMultibase \u2014 an undigested entry binds nothing`
      }
    ];
  }
  let recomputed;
  try {
    recomputed = await digestRdfContent(presented.content, presented.contentType ?? "text/turtle");
  } catch (e) {
    return [
      {
        code: "RELATED_RESOURCE_MISMATCH",
        message: `presented content for ${iri} could not be canonically digested: ${e.message}`
      }
    ];
  }
  const mismatched = entries.filter((r) => r.digestMultibase !== recomputed);
  if (mismatched.length > 0) {
    return [
      {
        code: "RELATED_RESOURCE_MISMATCH",
        message: `digest of presented content for ${iri} (${recomputed}) does not match the signed digestMultibase \u2014 the presented resource is not the content the issuer bound`
      }
    ];
  }
  return [];
}
async function verifyRelatedResources(credential, presentedResources) {
  const normalized = normalizeRelatedResources(credential.relatedResource);
  if ("error" in normalized) {
    return { verified: false, errors: [normalized.error], issuer: credential.issuer };
  }
  const errors = [];
  for (const [iri, presented] of Object.entries(presentedResources)) {
    errors.push(...await checkPresentedResource(normalized.entries, iri, presented));
  }
  return errors.length === 0 ? { verified: true, errors: [], issuer: credential.issuer } : { verified: false, errors, issuer: credential.issuer };
}
async function verifyCredential(vc, options) {
  const errors = [];
  const registry = options.registry ?? defaultSuiteRegistry();
  const now = options.now ?? /* @__PURE__ */ new Date();
  const expectedPurpose = options.expectedProofPurpose ?? "assertionMethod";
  const controlledBy = options.isControlledBy ?? defaultControlledBy;
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
  if (options.presentedResources !== void 0) {
    const normalized = normalizeRelatedResources(vc.relatedResource);
    if ("error" in normalized) {
      errors.push(normalized.error);
    } else {
      for (const [iri, presented] of Object.entries(options.presentedResources)) {
        errors.push(...await checkPresentedResource(normalized.entries, iri, presented));
      }
    }
  }
  let documentQuads;
  try {
    documentQuads = credentialToRdf(unsigned(vc));
  } catch (e) {
    errors.push({
      code: "MALFORMED",
      message: `credential could not be lowered to its signed RDF: ${e.message}`
    });
  }
  if (documentQuads !== void 0) {
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
      if (!await controlledByFailClosed(controlledBy, proof.verificationMethod, issuer)) {
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
  }
  return errors.length === 0 ? { verified: true, errors: [], issuer } : { verified: false, errors, issuer };
}
async function controlledByFailClosed(controlledBy, verificationMethod, issuer) {
  try {
    return await controlledBy(verificationMethod, issuer);
  } catch {
    return false;
  }
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

// src/webid.ts
import { SetFrom as SetFrom2, TermAs as TermAs2, TermFrom as TermFrom2, TermWrapper as TermWrapper2 } from "@rdfjs/wrapper";
import { base64url, exportJWK as exportJWK2 } from "jose";
import { DataFactory as DataFactory2 } from "n3";
var ED25519_PUB_PREFIX = Uint8Array.from([237, 1]);
var P256_PUB_PREFIX = Uint8Array.from([128, 36]);
async function encodeMultikey(publicKey) {
  return (await multikeyOf(publicKey)).publicKeyMultibase;
}
async function multikeyOf(publicKey) {
  const jwk = await exportJWK2(publicKey);
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519" && typeof jwk.x === "string") {
    const raw = base64url.decode(jwk.x);
    if (raw.length !== 32) {
      throw new Error(`@jeswr/solid-vc: Ed25519 public key must be 32 bytes, got ${raw.length}`);
    }
    return {
      publicKeyMultibase: base58btcEncode(concatBytes(ED25519_PUB_PREFIX, raw)),
      keyType: "Ed25519"
    };
  }
  if (jwk.kty === "EC" && jwk.crv === "P-256" && typeof jwk.x === "string" && typeof jwk.y === "string") {
    const x = base64url.decode(jwk.x);
    const y = base64url.decode(jwk.y);
    if (x.length !== 32 || y.length !== 32) {
      throw new Error(
        `@jeswr/solid-vc: P-256 coordinates must be 32 bytes each, got x=${x.length} y=${y.length}`
      );
    }
    const parity = Uint8Array.from([2 + (y[31] & 1)]);
    return {
      publicKeyMultibase: base58btcEncode(concatBytes(P256_PUB_PREFIX, parity, x)),
      keyType: "P-256"
    };
  }
  throw new Error(
    `@jeswr/solid-vc: unsupported public key for Multikey encoding (kty=${jwk.kty} crv=${jwk.crv ?? "?"}) \u2014 only Ed25519 and P-256 are supported`
  );
}
async function decodeMultikey(publicKeyMultibase) {
  let bytes;
  try {
    bytes = base58btcDecode(publicKeyMultibase);
  } catch {
    return void 0;
  }
  try {
    if (hasPrefix(bytes, ED25519_PUB_PREFIX)) {
      const raw = bytes.subarray(ED25519_PUB_PREFIX.length);
      if (raw.length !== 32) return void 0;
      const publicKey = await importPublicKey({
        kty: "OKP",
        crv: "Ed25519",
        x: base64url.encode(raw)
      });
      return { publicKey, keyType: "Ed25519" };
    }
    if (hasPrefix(bytes, P256_PUB_PREFIX)) {
      const point = bytes.subarray(P256_PUB_PREFIX.length);
      if (point.length !== 33 || point[0] !== 2 && point[0] !== 3) {
        return void 0;
      }
      const publicKey = await globalThis.crypto.subtle.importKey(
        "raw",
        point,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"]
      );
      return { publicKey, keyType: "P-256" };
    }
  } catch {
    return void 0;
  }
  return void 0;
}
function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
function hasPrefix(bytes, prefix) {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
}
function objectTerms2(node, predicate) {
  return SetFrom2.subjectPredicate(node, predicate, TermAs2.instance(TermWrapper2), TermFrom2.instance);
}
var ControllerNode = class extends TermWrapper2 {
  get assertionMethods() {
    return objectTerms2(this, SEC_ASSERTION_METHOD);
  }
};
var VerificationMethodNode = class extends TermWrapper2 {
  get types() {
    return objectTerms2(this, RDF_TYPE);
  }
  get controllers() {
    return objectTerms2(this, SEC_CONTROLLER);
  }
  get publicKeyMultibases() {
    return objectTerms2(this, SEC_PUBLIC_KEY_MULTIBASE);
  }
};
async function publishVerificationMethod(input) {
  const controller = safeHttpIri(input.controller);
  if (controller === void 0) {
    throw new Error(
      `@jeswr/solid-vc: publishVerificationMethod controller must be an absolute http(s) IRI, got ${JSON.stringify(input.controller)}`
    );
  }
  const isPair = isKeyPair(input.key);
  const vmInput = input.verificationMethod ?? (isPair ? input.key.verificationMethod : void 0);
  if (vmInput === void 0) {
    throw new Error(
      "@jeswr/solid-vc: publishVerificationMethod requires a verificationMethod IRI (explicit, or via a KeyPair)"
    );
  }
  const verificationMethod = safeHttpIri(vmInput);
  if (verificationMethod === void 0) {
    throw new Error(
      `@jeswr/solid-vc: publishVerificationMethod verificationMethod must be an absolute http(s) IRI, got ${JSON.stringify(vmInput)}`
    );
  }
  const publicKey = isPair ? input.key.publicKey : input.key;
  const { publicKeyMultibase, keyType } = await multikeyOf(publicKey);
  const g = new GraphBuilder();
  g.addIri(controller, SEC_VERIFICATION_METHOD, verificationMethod);
  g.addIri(controller, SEC_ASSERTION_METHOD, verificationMethod);
  g.addType(verificationMethod, SEC_MULTIKEY);
  g.addIri(verificationMethod, SEC_CONTROLLER, controller);
  g.addLiteral(verificationMethod, SEC_PUBLIC_KEY_MULTIBASE, publicKeyMultibase, SEC_MULTIBASE);
  const quads = g.quads();
  const turtle = await serialize2(quads);
  return { controller, verificationMethod, publicKeyMultibase, keyType, quads, turtle };
}
function isKeyPair(key) {
  return typeof key === "object" && key !== null && "publicKey" in key && "verificationMethod" in key && typeof key.verificationMethod === "string";
}
var defaultGuardedFetch;
function guardedFetchDefault() {
  defaultGuardedFetch ??= import("@jeswr/guarded-fetch/node").then(
    (m) => m.createNodeGuardedFetch({ maxRedirects: 0 })
  );
  return defaultGuardedFetch;
}
var RDF_ACCEPT = "text/turtle, application/ld+json;q=0.9, application/n-triples;q=0.8, application/n-quads;q=0.7";
function documentUrlOf(iri) {
  const u = new URL(iri);
  u.hash = "";
  return u.href;
}
async function fetchDocument(docUrl, fetchImpl, cache) {
  const cached = cache?.get(docUrl);
  if (cached !== void 0) return cached;
  const load = (async () => {
    try {
      const res = await fetchImpl(docUrl, {
        redirect: "manual",
        headers: { accept: RDF_ACCEPT }
      });
      if (!res.ok) return void 0;
      if (res.redirected === true) return void 0;
      if (typeof res.url === "string" && res.url.length > 0) {
        let finalUrl;
        try {
          finalUrl = new URL(res.url).href;
        } catch {
          return void 0;
        }
        if (finalUrl !== docUrl) return void 0;
      }
      const body = await res.text();
      const store = await parseRdf(body, res.headers.get("content-type"), { baseIRI: docUrl });
      return store;
    } catch {
      return void 0;
    }
  })();
  cache?.set(docUrl, load);
  return load;
}
var factory = DataFactory2;
function containsIri(terms, iri) {
  for (const term of terms) {
    if (term.termType === "NamedNode" && term.value === iri) return true;
  }
  return false;
}
function literalValues(terms) {
  const out = /* @__PURE__ */ new Set();
  for (const term of terms) {
    if (term.termType === "Literal") out.add(term.value);
  }
  return out;
}
async function resolveWebIdKeyInternal(webId, keyId, fetchImpl, cache) {
  const controller = safeHttpIri(webId);
  const verificationMethod = safeHttpIri(keyId);
  if (controller === void 0 || verificationMethod === void 0) return void 0;
  const controllerDocUrl = documentUrlOf(controller);
  const controllerDoc = await fetchDocument(controllerDocUrl, fetchImpl, cache);
  if (controllerDoc === void 0) return void 0;
  const controllerNode = new ControllerNode(controller, controllerDoc, factory);
  if (!containsIri(controllerNode.assertionMethods, verificationMethod)) return void 0;
  const keyDocUrl = documentUrlOf(verificationMethod);
  const keyDoc = keyDocUrl === controllerDocUrl ? controllerDoc : await fetchDocument(keyDocUrl, fetchImpl, cache);
  if (keyDoc === void 0) return void 0;
  const vmNode = new VerificationMethodNode(verificationMethod, keyDoc, factory);
  if (!containsIri(vmNode.types, SEC_MULTIKEY)) return void 0;
  const controllers = vmNode.controllers;
  if (controllers.size !== 1 || !containsIri(controllers, controller)) return void 0;
  const multibases = literalValues(vmNode.publicKeyMultibases);
  if (multibases.size !== 1) return void 0;
  const [publicKeyMultibase] = multibases;
  if (publicKeyMultibase === void 0) return void 0;
  const decoded = await decodeMultikey(publicKeyMultibase);
  if (decoded === void 0) return void 0;
  return {
    controller,
    verificationMethod,
    publicKeyMultibase,
    publicKey: decoded.publicKey,
    keyType: decoded.keyType
  };
}
async function resolveWebIdKey(webId, keyId, options = {}) {
  try {
    const fetchImpl = options.fetch ?? await guardedFetchDefault();
    return await resolveWebIdKeyInternal(webId, keyId, fetchImpl);
  } catch {
    return void 0;
  }
}
function createWebIdKeyResolver(options = {}) {
  const cache = /* @__PURE__ */ new Map();
  const fetchOf = async () => options.fetch ?? await guardedFetchDefault();
  const resolveKey = async (verificationMethod) => {
    try {
      const fetchImpl = await fetchOf();
      const vm = safeHttpIri(verificationMethod);
      if (vm === void 0) return void 0;
      const keyDoc = await fetchDocument(documentUrlOf(vm), fetchImpl, cache);
      if (keyDoc === void 0) return void 0;
      const vmNode = new VerificationMethodNode(vm, keyDoc, factory);
      const controllers = [...vmNode.controllers].filter((t) => t.termType === "NamedNode");
      if (controllers.length !== 1) return void 0;
      const controller = controllers[0].value;
      const resolved = await resolveWebIdKeyInternal(controller, vm, fetchImpl, cache);
      return resolved?.publicKey;
    } catch {
      return void 0;
    }
  };
  const isControlledBy = async (verificationMethod, issuer) => {
    try {
      const fetchImpl = await fetchOf();
      const resolved = await resolveWebIdKeyInternal(issuer, verificationMethod, fetchImpl, cache);
      return resolved !== void 0;
    } catch {
      return false;
    }
  };
  return { resolveKey, isControlledBy };
}
export {
  CredentialNode,
  DataIntegritySuite,
  PresentationNode,
  ProofNode,
  SEC_ASSERTION_METHOD,
  SEC_CONTROLLER,
  SEC_DIGEST_MULTIBASE,
  SEC_MULTIKEY,
  SEC_PUBLIC_KEY_MULTIBASE,
  SVC,
  SVC_AGENT_AUTHORIZATION,
  SuiteRegistry,
  VC,
  VC_RELATED_RESOURCE,
  VC_V2_CONTEXT,
  VcDataset,
  agentAuthorizationFromRdf,
  base58btcDecode,
  base58btcEncode,
  buildAgentAuthorizationCredential,
  buildBoundAgentAuthorizationCredential,
  canonicalNQuads,
  createWebIdKeyResolver,
  credentialFromRdf,
  credentialMetaFromNode,
  credentialToJsonLd,
  credentialToRdf,
  credentialToTurtle,
  cryptosuiteForKeyType,
  dataIntegrityHash,
  decodeMultikey,
  defaultSuiteRegistry,
  digestQuads,
  digestRdfContent,
  encodeMultikey,
  exportPrivateJwk,
  exportPublicJwk,
  generateKeyPairForSuite,
  importKeyPair,
  importPublicKey,
  issue,
  issueAgentAuthorization,
  parseCredentialRdf,
  proofOptionsQuads,
  publishVerificationMethod,
  relatedResourcesFromNode,
  resolveWebIdKey,
  serialize2 as serialize,
  verifyCredential,
  verifyRelatedResources,
  wrapVc
};
//# sourceMappingURL=index.js.map
