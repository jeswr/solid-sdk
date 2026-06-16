// src/canonical.ts
import { createHash } from "node:crypto";
function canonicalNQuads(quads) {
  const labels = canonicalBlankLabels(quads);
  const lines = quads.map((q) => quadToLine(q, labels));
  lines.sort();
  return lines.join("\n");
}
function canonicalBlankLabels(quads) {
  const blanks = /* @__PURE__ */ new Set();
  for (const q of quads) {
    if (q.subject.termType === "BlankNode") {
      blanks.add(q.subject.value);
    }
    if (q.object.termType === "BlankNode") {
      blanks.add(q.object.value);
    }
    if (q.graph?.termType === "BlankNode") {
      blanks.add(q.graph.value);
    }
  }
  let colour = /* @__PURE__ */ new Map();
  for (const b of blanks) {
    colour.set(b, "_:b");
  }
  const rounds = Math.min(blanks.size + 2, 16);
  for (let r = 0; r < rounds; r++) {
    const next = /* @__PURE__ */ new Map();
    for (const b of blanks) {
      const signals = [];
      for (const q of quads) {
        const sub = q.subject.termType === "BlankNode" ? q.subject.value : void 0;
        const obj = q.object.termType === "BlankNode" ? q.object.value : void 0;
        const grp = q.graph?.termType === "BlankNode" ? q.graph.value : void 0;
        const graphSig = q.graph ? termColour(q.graph, colour) : "";
        if (sub === b) {
          signals.push(`s|${q.predicate.value}|${termColour(q.object, colour)}|${graphSig}`);
        }
        if (obj === b) {
          signals.push(`o|${q.predicate.value}|${termColour(q.subject, colour)}|${graphSig}`);
        }
        if (grp === b) {
          signals.push(
            `g|${q.predicate.value}|${termColour(q.subject, colour)}|${termColour(q.object, colour)}`
          );
        }
      }
      signals.sort();
      const h = createHash("sha256").update(`${colour.get(b)}
${signals.join("\n")}`, "utf8").digest("hex");
      next.set(b, h);
    }
    let stable = true;
    for (const b of blanks) {
      if (next.get(b) !== colour.get(b)) {
        stable = false;
        break;
      }
    }
    colour = next;
    if (stable) {
      break;
    }
  }
  const ordered = [...blanks].sort((a, b) => {
    const ca = colour.get(a) ?? "";
    const cb = colour.get(b) ?? "";
    return ca < cb ? -1 : ca > cb ? 1 : a < b ? -1 : a > b ? 1 : 0;
  });
  const labels = /* @__PURE__ */ new Map();
  for (let i = 0; i < ordered.length; i++) {
    labels.set(ordered[i], `c14n-${i}`);
  }
  return labels;
}
function termColour(term, colour) {
  if (term.termType === "BlankNode") {
    return colour.get(term.value) ?? "_:b";
  }
  return nquadsTerm(term, void 0);
}
function quadToLine(q, labels) {
  const s = nquadsTerm(q.subject, labels);
  const p = nquadsTerm(q.predicate, labels);
  const o = nquadsTerm(q.object, labels);
  const inDefaultGraph = q.graph === void 0 || q.graph.termType === "DefaultGraph" || q.graph.value === "";
  if (inDefaultGraph) {
    return `${s} ${p} ${o} .`;
  }
  return `${s} ${p} ${o} ${nquadsTerm(q.graph, labels)} .`;
}
function nquadsTerm(term, labels) {
  switch (term.termType) {
    case "NamedNode":
      return `<${term.value}>`;
    case "BlankNode": {
      const label = labels?.get(term.value);
      return `_:${label ?? term.value}`;
    }
    case "Literal": {
      const lit = term;
      const escaped = escapeLiteral(lit.value);
      if (lit.language) {
        return `"${escaped}"@${lit.language}`;
      }
      const dt = lit.datatype?.value;
      if (dt && dt !== "http://www.w3.org/2001/XMLSchema#string") {
        return `"${escaped}"^^<${dt}>`;
      }
      return `"${escaped}"`;
    }
    default:
      return `<${term.value}>`;
  }
}
function escapeLiteral(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

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

// src/serialize.ts
import { Writer } from "n3";

// src/vocab.ts
var SCHEMA = "https://schema.org/";
var LDP = "http://www.w3.org/ns/ldp#";
var ACL = "http://www.w3.org/ns/auth/acl#";
var SH = "http://www.w3.org/ns/shacl#";
var XSD = "http://www.w3.org/2001/XMLSchema#";
var RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var RDFS = "http://www.w3.org/2000/01/rdf-schema#";
var DCTERMS = "http://purl.org/dc/terms/";
var A2A = "https://w3id.org/jeswr/a2a#";
var RDF_TYPE = `${RDF}type`;
var SCHEMA_READ_ACTION = `${SCHEMA}ReadAction`;
var SCHEMA_CREATE_ACTION = `${SCHEMA}CreateAction`;
var SCHEMA_UPDATE_ACTION = `${SCHEMA}UpdateAction`;
var SCHEMA_DELETE_ACTION = `${SCHEMA}DeleteAction`;
var A2A_APPEND_ACTION = `${A2A}AppendAction`;
var A2A_LIST_ACTION = `${A2A}ListAction`;
var A2A_GRANT_ACTION = `${A2A}GrantAction`;
var A2A_SUBSCRIBE_ACTION = `${A2A}SubscribeAction`;
var A2A_QUERY_ACTION = `${A2A}QueryAction`;
var A2A_INTENT = `${A2A}Intent`;
var A2A_ACTION = `${A2A}action`;
var A2A_PARAMETER = `${A2A}parameter`;
var A2A_PARAMETER_CLASS = `${A2A}Parameter`;
var A2A_PARAM_KEY = `${A2A}paramKey`;
var A2A_PARAM_VALUE = `${A2A}paramValue`;
var A2A_MODE = `${A2A}mode`;
var SCHEMA_OBJECT = `${SCHEMA}object`;
var SCHEMA_TARGET = `${SCHEMA}target`;
var SCHEMA_AGENT = `${SCHEMA}agent`;
var SCHEMA_RECIPIENT = `${SCHEMA}recipient`;
var ACL_READ = `${ACL}Read`;
var ACL_WRITE = `${ACL}Write`;
var ACL_APPEND = `${ACL}Append`;
var ACL_CONTROL = `${ACL}Control`;
var ACL_MODES = ["Read", "Write", "Append", "Control"];
var ACL_MODE_IRI = {
  Read: ACL_READ,
  Write: ACL_WRITE,
  Append: ACL_APPEND,
  Control: ACL_CONTROL
};
var VALID_ACL_MODE_IRIS = new Set(Object.values(ACL_MODE_IRI));
var LDP_CONTAINER = `${LDP}Container`;
var LDP_RESOURCE = `${LDP}Resource`;
var INTENT_ACTIONS = [
  "read",
  "create",
  "update",
  "append",
  "delete",
  "list",
  "grant",
  "subscribe",
  "query"
];
var VALID_INTENT_ACTIONS = new Set(INTENT_ACTIONS);
var ACTION_TYPE_IRI = {
  read: SCHEMA_READ_ACTION,
  create: SCHEMA_CREATE_ACTION,
  update: SCHEMA_UPDATE_ACTION,
  append: A2A_APPEND_ACTION,
  delete: SCHEMA_DELETE_ACTION,
  list: A2A_LIST_ACTION,
  grant: A2A_GRANT_ACTION,
  subscribe: A2A_SUBSCRIBE_ACTION,
  query: A2A_QUERY_ACTION
};
var IRI_TO_ACTION = Object.fromEntries(
  Object.entries(ACTION_TYPE_IRI).map(([k, v]) => [v, k])
);
var A2A_INLINE_CONTEXT = {
  a2a: A2A,
  schema: SCHEMA,
  acl: ACL,
  ldp: LDP,
  Intent: A2A_INTENT,
  Parameter: A2A_PARAMETER_CLASS,
  action: { "@id": A2A_ACTION, "@type": "@id" },
  parameter: { "@id": A2A_PARAMETER, "@type": "@id" },
  paramKey: A2A_PARAM_KEY,
  paramValue: A2A_PARAM_VALUE,
  mode: { "@id": A2A_MODE, "@type": "@id" },
  object: { "@id": SCHEMA_OBJECT, "@type": "@id" },
  target: { "@id": SCHEMA_TARGET, "@type": "@id" },
  agent: { "@id": SCHEMA_AGENT, "@type": "@id" },
  recipient: { "@id": SCHEMA_RECIPIENT, "@type": "@id" }
};
var PROTOCOL_HASH_ALGORITHM = "sha256";
var PROTOCOL_HASH_PREFIX = "sha256:";

// src/serialize.ts
var PREFIXES = {
  a2a: A2A,
  schema: SCHEMA,
  acl: ACL,
  ldp: LDP,
  sh: SH,
  xsd: XSD,
  dcterms: DCTERMS,
  rdf: RDF,
  rdfs: RDFS
};
function serialize(quads, format = "text/turtle") {
  if (quads.length === 0) {
    return Promise.resolve("");
  }
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format, prefixes: PREFIXES });
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
var ParameterNode = class extends TermWrapper {
  get keys() {
    return objectTerms(this, A2A_PARAM_KEY);
  }
  get values() {
    return objectTerms(this, A2A_PARAM_VALUE);
  }
};
var ActionNode = class extends TermWrapper {
  /** The action's rdf:type term(s). */
  get types() {
    return objectTerms(this, RDF_TYPE);
  }
  get objects() {
    return objectTerms(this, SCHEMA_OBJECT);
  }
  get targets() {
    return objectTerms(this, SCHEMA_TARGET);
  }
  get recipients() {
    return objectTerms(this, SCHEMA_RECIPIENT);
  }
  get agents() {
    return objectTerms(this, SCHEMA_AGENT);
  }
  get modes() {
    return objectTerms(this, A2A_MODE);
  }
};
var IntentNode = class extends TermWrapper {
  /** Linked action node(s), projected to typed wrappers (term-type-preserving). */
  get actions() {
    return SetFrom.subjectPredicate(
      this,
      A2A_ACTION,
      TermAs.instance(ActionNode),
      TermFrom.instance
    );
  }
  /** Linked parameter node(s). */
  get parameters() {
    return SetFrom.subjectPredicate(
      this,
      A2A_PARAMETER,
      TermAs.instance(ParameterNode),
      TermFrom.instance
    );
  }
  /** The intent-node-level `schema:agent` (the requester), if present. */
  get agents() {
    return objectTerms(this, SCHEMA_AGENT);
  }
};
var IntentDataset = class extends DatasetWrapper {
  /** Every `a2a:Intent` subject in the dataset. */
  intents() {
    return [...this.instancesOf(A2A_INTENT, IntentNode)];
  }
};
function wrapIntent(dataset) {
  return new IntentDataset(dataset, DataFactory);
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
function actionKindOf(action) {
  for (const type of action.types) {
    if (type.termType === "NamedNode") {
      const kind = IRI_TO_ACTION[type.value];
      if (kind !== void 0) {
        return kind;
      }
    }
  }
  return void 0;
}
function addIri(node, predicate, objectIri) {
  const factory = node.factory;
  const subject = node;
  const p = NamedNodeFrom.string(predicate, factory);
  const o = NamedNodeFrom.string(objectIri, factory);
  node.dataset.add(factory.quad(subject, p, o));
}
function addLiteral(node, predicate, value) {
  const factory = node.factory;
  const subject = node;
  const p = NamedNodeFrom.string(predicate, factory);
  const o = LiteralFrom.string(value, factory);
  node.dataset.add(factory.quad(subject, p, o));
}
var WritableParameter = class extends TermWrapper {
  typeParameter() {
    addIri(this, RDF_TYPE, A2A_PARAMETER_CLASS);
  }
  setKey(key) {
    addLiteral(this, A2A_PARAM_KEY, key);
  }
  setValue(value) {
    addLiteral(this, A2A_PARAM_VALUE, value);
  }
};
var WritableAction = class extends TermWrapper {
  typeAction(actionTypeIri) {
    addIri(this, RDF_TYPE, actionTypeIri);
  }
  setObject(iri) {
    addIri(this, SCHEMA_OBJECT, iri);
  }
  setTarget(iri) {
    addIri(this, SCHEMA_TARGET, iri);
  }
  setRecipient(iri) {
    addIri(this, SCHEMA_RECIPIENT, iri);
  }
  setAgent(iri) {
    addIri(this, SCHEMA_AGENT, iri);
  }
  addMode(modeIri) {
    addIri(this, A2A_MODE, modeIri);
  }
};
var WritableIntent = class extends TermWrapper {
  typeIntent() {
    addIri(this, RDF_TYPE, A2A_INTENT);
  }
  setAgent(iri) {
    addIri(this, SCHEMA_AGENT, iri);
  }
  /** Link a fresh blank-node action node, typed with the action-type IRI. */
  linkAction(actionTypeIri) {
    const node = new WritableAction(this.linkBlank(A2A_ACTION), this.dataset, this.factory);
    node.typeAction(actionTypeIri);
    return node;
  }
  /** Link a fresh blank-node parameter node, typed `a2a:Parameter`. */
  linkParameter() {
    const node = new WritableParameter(this.linkBlank(A2A_PARAMETER), this.dataset, this.factory);
    node.typeParameter();
    return node;
  }
  /** Mint a blank node, link it from this subject via `predicate`, return the term. */
  linkBlank(predicate) {
    const factory = this.factory;
    const blank = BlankNodeFrom.string(void 0, factory);
    const subject = this;
    const p = NamedNodeFrom.string(predicate, factory);
    this.dataset.add(factory.quad(subject, p, blank));
    return blank;
  }
};
var IntentBuilder = class {
  store = new Store2();
  factory = DataFactory;
  /** Open the intent subject (`id` is the intent IRI) for writing. */
  intent(id) {
    const node = new WritableIntent(id, this.store, this.factory);
    node.typeIntent();
    return node;
  }
  /** Map an intent action kind to its RDF action-type IRI. */
  static actionTypeIri(action) {
    return ACTION_TYPE_IRI[action];
  }
  /** The accumulated quads. */
  quads() {
    return [...this.store];
  }
};
var GraphBuilder = class {
  store = new Store2();
  factory = DataFactory;
  /** Materialise a {@link NodeRef} to its RDF/JS term. */
  subjectTerm(ref) {
    return ref.kind === "iri" ? NamedNodeFrom.string(ref.value, this.factory) : BlankNodeFrom.string(ref.value, this.factory);
  }
  /** Add `(subject, predicate, object-IRI)`. */
  addIri(subject, predicate, objectIri) {
    const s = this.subjectTerm(normalize(subject));
    const p = NamedNodeFrom.string(predicate, this.factory);
    const o = NamedNodeFrom.string(objectIri, this.factory);
    this.store.add(this.factory.quad(s, p, o));
  }
  /** Add `(subject, predicate, literal)` with an optional datatype IRI. */
  addLiteral(subject, predicate, value, datatypeIri) {
    const s = this.subjectTerm(normalize(subject));
    const p = NamedNodeFrom.string(predicate, this.factory);
    const o = datatypeIri === void 0 ? LiteralFrom.string(value, this.factory) : this.factory.literal(
      value,
      NamedNodeFrom.string(datatypeIri, this.factory)
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
    const p = NamedNodeFrom.string(predicate, this.factory);
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
function normalize(subject) {
  return typeof subject === "string" ? { kind: "iri", value: subject } : subject;
}

// src/handshake.ts
var A2A_UPGRADE_OFFER = `${A2A}UpgradeOffer`;
var A2A_UPGRADE_RESPONSE = `${A2A}UpgradeResponse`;
var A2A_PROTOCOL_HASH = `${A2A}protocolHash`;
var A2A_PROTOCOL_SOURCE = `${A2A}protocolSource`;
var A2A_PROTOCOL_NAME = `${A2A}protocolName`;
var A2A_REQUIRED = `${A2A}required`;
var A2A_ACCEPT = `${A2A}accept`;
var A2A_REASON = `${A2A}reason`;
var XSD_BOOLEAN = `${XSD}boolean`;
var HANDSHAKE_SUBJECT = "urn:a2a:handshake";
function encodeUpgradeOffer(args) {
  if (!args.protocolHash) {
    throw new TypeError("encodeUpgradeOffer: protocolHash is required.");
  }
  if (!args.protocolSource) {
    throw new TypeError("encodeUpgradeOffer: protocolSource is required.");
  }
  return {
    kind: "upgrade-offer",
    protocolHash: args.protocolHash,
    protocolSource: args.protocolSource,
    // Default to a NON-required (capability-only) upgrade. A security-bearing
    // caller sets required:true explicitly so silent downgrade is never the
    // default for a step that needs the signed/SHACL path.
    required: args.required === true,
    ...args.protocolName !== void 0 && { protocolName: args.protocolName }
  };
}
function decodeUpgradeOffer(input) {
  if (typeof input !== "object" || input === null || input.kind !== "upgrade-offer") {
    throw new TypeError("decodeUpgradeOffer: input is not an upgrade-offer.");
  }
  const o = input;
  if (typeof o.protocolHash !== "string" || typeof o.protocolSource !== "string") {
    throw new TypeError(
      "decodeUpgradeOffer: protocolHash and protocolSource are required strings."
    );
  }
  if (o.required !== void 0 && typeof o.required !== "boolean") {
    throw new TypeError("decodeUpgradeOffer: required, when present, must be a boolean.");
  }
  return {
    kind: "upgrade-offer",
    protocolHash: o.protocolHash,
    protocolSource: o.protocolSource,
    required: o.required === true,
    ...typeof o.protocolName === "string" && { protocolName: o.protocolName }
  };
}
function encodeUpgradeResponse(args) {
  if (!args.protocolHash) {
    throw new TypeError("encodeUpgradeResponse: protocolHash is required.");
  }
  if (typeof args.accept !== "boolean") {
    throw new TypeError("encodeUpgradeResponse: accept must be a boolean.");
  }
  return {
    kind: "upgrade-response",
    protocolHash: args.protocolHash,
    accept: args.accept,
    ...args.reason !== void 0 && { reason: args.reason }
  };
}
function decodeUpgradeResponse(input) {
  if (typeof input !== "object" || input === null || input.kind !== "upgrade-response") {
    throw new TypeError("decodeUpgradeResponse: input is not an upgrade-response.");
  }
  const o = input;
  if (typeof o.protocolHash !== "string" || typeof o.accept !== "boolean") {
    throw new TypeError(
      "decodeUpgradeResponse: protocolHash (string) and accept (boolean) are required."
    );
  }
  return {
    kind: "upgrade-response",
    protocolHash: o.protocolHash,
    accept: o.accept,
    ...typeof o.reason === "string" && { reason: o.reason }
  };
}
function mayDowngradeToNl(offer, response) {
  if (response.protocolHash !== offer.protocolHash) {
    return false;
  }
  if (offer.required) {
    return false;
  }
  return response.accept === false;
}
function handshakeToRdf(message) {
  const b = new GraphBuilder();
  if (message.kind === "upgrade-offer") {
    b.addIri(HANDSHAKE_SUBJECT, RDF_TYPE, A2A_UPGRADE_OFFER);
    b.addLiteral(HANDSHAKE_SUBJECT, A2A_PROTOCOL_HASH, message.protocolHash);
    b.addIri(HANDSHAKE_SUBJECT, A2A_PROTOCOL_SOURCE, message.protocolSource);
    b.addLiteral(HANDSHAKE_SUBJECT, A2A_REQUIRED, message.required ? "true" : "false", XSD_BOOLEAN);
    if (message.protocolName !== void 0) {
      b.addLiteral(HANDSHAKE_SUBJECT, A2A_PROTOCOL_NAME, message.protocolName);
    }
  } else {
    b.addIri(HANDSHAKE_SUBJECT, RDF_TYPE, A2A_UPGRADE_RESPONSE);
    b.addLiteral(HANDSHAKE_SUBJECT, A2A_PROTOCOL_HASH, message.protocolHash);
    b.addLiteral(HANDSHAKE_SUBJECT, A2A_ACCEPT, message.accept ? "true" : "false", XSD_BOOLEAN);
    if (message.reason !== void 0) {
      b.addLiteral(HANDSHAKE_SUBJECT, A2A_REASON, message.reason);
    }
  }
  return b.quads();
}
function handshakeToTurtle(message, format) {
  return serialize(handshakeToRdf(message), format);
}
async function handshakeFromRdf(input, contentType2 = "text/turtle") {
  let quads;
  if (typeof input === "string") {
    const dataset = await parseRdf(input, contentType2, {});
    quads = [...dataset];
  } else if (Array.isArray(input)) {
    quads = [...input];
  } else {
    quads = [...input];
  }
  const offerSubjects = /* @__PURE__ */ new Set();
  const responseSubjects = /* @__PURE__ */ new Set();
  for (const q of quads) {
    if (q.predicate.value !== RDF_TYPE || q.object.termType !== "NamedNode") {
      continue;
    }
    if (q.object.value === A2A_UPGRADE_OFFER) {
      offerSubjects.add(q.subject.value);
    } else if (q.object.value === A2A_UPGRADE_RESPONSE) {
      responseSubjects.add(q.subject.value);
    }
  }
  const total = offerSubjects.size + responseSubjects.size;
  if (total !== 1) {
    return void 0;
  }
  const isOffer = offerSubjects.size === 1;
  const subject = isOffer ? [...offerSubjects][0] : [...responseSubjects][0];
  const single = (predicate, termType) => {
    const matches = quads.filter(
      (q) => q.subject.value === subject && q.predicate.value === predicate && q.object.termType === termType
    );
    if (matches.length !== 1) {
      return void 0;
    }
    return matches[0]?.object.value;
  };
  const lit = (predicate) => single(predicate, "Literal");
  const iri = (predicate) => single(predicate, "NamedNode");
  const strictBool = (predicate) => {
    const v = lit(predicate);
    if (v === "true") {
      return true;
    }
    if (v === "false") {
      return false;
    }
    return void 0;
  };
  if (isOffer) {
    const protocolHash2 = lit(A2A_PROTOCOL_HASH);
    const protocolSource = iri(A2A_PROTOCOL_SOURCE);
    const required = strictBool(A2A_REQUIRED);
    if (protocolHash2 === void 0 || protocolSource === void 0 || required === void 0) {
      return void 0;
    }
    const name = lit(A2A_PROTOCOL_NAME);
    return {
      kind: "upgrade-offer",
      protocolHash: protocolHash2,
      protocolSource,
      required,
      ...name !== void 0 && { protocolName: name }
    };
  }
  const protocolHash = lit(A2A_PROTOCOL_HASH);
  const accept = strictBool(A2A_ACCEPT);
  if (protocolHash === void 0 || accept === void 0) {
    return void 0;
  }
  const reason = lit(A2A_REASON);
  return {
    kind: "upgrade-response",
    protocolHash,
    accept,
    ...reason !== void 0 && { reason }
  };
}

// src/intent.ts
function intentToRdf(intent) {
  const builder = new IntentBuilder();
  const node = builder.intent(intent.id);
  if (intent.agent !== void 0) {
    node.setAgent(intent.agent);
  }
  const action = node.linkAction(IntentBuilder.actionTypeIri(intent.action));
  if (intent.target !== void 0) {
    if (intent.action === "list") {
      action.setTarget(intent.target);
    } else {
      action.setObject(intent.target);
    }
  }
  if (intent.recipient !== void 0) {
    action.setRecipient(intent.recipient);
  }
  if (intent.agent !== void 0) {
    action.setAgent(intent.agent);
  }
  for (const mode of intent.modes ?? []) {
    action.addMode(ACL_MODE_IRI[mode]);
  }
  for (const param of intent.parameters ?? []) {
    const p = node.linkParameter();
    p.setKey(param.key);
    p.setValue(param.value);
  }
  return builder.quads();
}
function intentToTurtle(intent, format) {
  return serialize(intentToRdf(intent), format);
}
function intentToJsonLd(intent) {
  const action = {
    "@type": actionTypeAlias(intent)
  };
  if (intent.target !== void 0) {
    if (intent.action === "list") {
      action.target = { "@id": intent.target };
    } else {
      action.object = { "@id": intent.target };
    }
  }
  if (intent.recipient !== void 0) {
    action.recipient = { "@id": intent.recipient };
  }
  if (intent.agent !== void 0) {
    action.agent = { "@id": intent.agent };
  }
  if (intent.modes && intent.modes.length > 0) {
    action.mode = intent.modes.map((m) => ({ "@id": ACL_MODE_IRI[m] }));
  }
  const doc = {
    "@context": A2A_INLINE_CONTEXT,
    "@id": intent.id,
    "@type": "Intent",
    action
  };
  if (intent.agent !== void 0) {
    doc.agent = { "@id": intent.agent };
  }
  if (intent.parameters && intent.parameters.length > 0) {
    doc.parameter = intent.parameters.map((p) => ({
      "@type": "Parameter",
      paramKey: p.key,
      paramValue: p.value
    }));
  }
  return doc;
}
function actionTypeAlias(intent) {
  return IntentBuilder.actionTypeIri(intent.action);
}
function intentFromRdf(dataset) {
  const intents = wrapIntent(dataset).intents();
  for (const node of intents) {
    const intent = projectIntent(node);
    if (intent !== void 0) {
      return intent;
    }
  }
  return void 0;
}
async function parseIntentGraph(input, contentType2 = "text/turtle", baseIRI) {
  const dataset = typeof input === "string" ? await parseRdf(input, contentType2, baseIRI ? { baseIRI } : {}) : input;
  return intentFromRdf(dataset);
}
function projectIntent(node) {
  const actions = [...node.actions];
  const action = actions[0];
  if (action === void 0) {
    return void 0;
  }
  const kind = actionKindOf(action);
  if (kind === void 0 || !VALID_INTENT_ACTIONS.has(kind)) {
    return void 0;
  }
  const target = kind === "list" ? firstIri(action.targets) : firstIri(action.objects);
  const recipient = firstIri(action.recipients);
  const agent = firstIri(action.agents) ?? firstIri(node.agents);
  const modes = [];
  for (const m of action.modes) {
    if (m.termType === "NamedNode" && VALID_ACL_MODE_IRIS.has(m.value)) {
      modes.push(aclModeFromIri(m.value));
    }
  }
  const parameters = [];
  for (const p of node.parameters) {
    const key = firstLiteral(p.keys);
    const value = firstLiteral(p.values);
    if (key !== void 0 && value !== void 0) {
      parameters.push({ key, value });
    }
  }
  return {
    id: node.value,
    action: kind,
    ...target !== void 0 && { target },
    ...agent !== void 0 && { agent },
    ...recipient !== void 0 && { recipient },
    ...modes.length > 0 && { modes },
    ...parameters.length > 0 && { parameters }
  };
}
function aclModeFromIri(iri) {
  for (const [name, modeIri] of Object.entries(ACL_MODE_IRI)) {
    if (modeIri === iri) {
      return name;
    }
  }
  return "Read";
}

// src/protocol.ts
import { createHash as createHash2 } from "node:crypto";
var A2A_PROTOCOL_DOCUMENT = `${A2A}ProtocolDocument`;
var A2A_REQUEST_SHAPE = `${A2A}requestShape`;
var A2A_RESPONSE_SHAPE = `${A2A}responseShape`;
var DCTERMS_TITLE = `${DCTERMS}title`;
var DCTERMS_DESCRIPTION = `${DCTERMS}description`;
var DCTERMS_HAS_VERSION = `${DCTERMS}hasVersion`;
var SH_NODE_SHAPE = `${SH}NodeShape`;
function buildProtocolDocument(input) {
  const { requestShape, responseShape, meta } = input;
  if (!meta?.id) {
    throw new TypeError("buildProtocolDocument: meta.id (the protocol IRI) is required.");
  }
  if (!requestShape || requestShape.length === 0) {
    throw new TypeError("buildProtocolDocument: a non-empty requestShape is required.");
  }
  const b = new GraphBuilder();
  b.addIri(meta.id, RDF_TYPE, A2A_PROTOCOL_DOCUMENT);
  if (meta.name !== void 0) {
    b.addLiteral(meta.id, DCTERMS_TITLE, meta.name);
  }
  if (meta.description !== void 0) {
    b.addLiteral(meta.id, DCTERMS_DESCRIPTION, meta.description);
  }
  if (meta.version !== void 0) {
    b.addLiteral(meta.id, DCTERMS_HAS_VERSION, meta.version);
  }
  for (const shapeId of nodeShapeSubjects(requestShape)) {
    b.addIri(meta.id, A2A_REQUEST_SHAPE, shapeId);
  }
  if (responseShape && responseShape.length > 0) {
    for (const shapeId of nodeShapeSubjects(responseShape)) {
      b.addIri(meta.id, A2A_RESPONSE_SHAPE, shapeId);
    }
  }
  const quads = [
    ...b.quads(),
    ...requestShape,
    ...responseShape ?? []
  ];
  const hash = hashQuads(quads);
  const frozenMeta = { ...meta };
  const requestShapeQuads = [...requestShape];
  return {
    meta: frozenMeta,
    quads,
    requestShapeQuads,
    hash,
    toTurtle: (format) => serialize(quads, format),
    toJsonLd: () => Promise.resolve(buildPdJsonLd(quads, frozenMeta))
  };
}
function hashQuads(quads) {
  const canonical = canonicalNQuads(quads);
  const digest = createHash2(PROTOCOL_HASH_ALGORITHM).update(canonical, "utf8").digest("hex");
  return `${PROTOCOL_HASH_PREFIX}${digest}`;
}
async function verifyProtocolDocument(body, expectedHash, contentType2 = "text/turtle") {
  let quads;
  try {
    if (typeof body === "string") {
      const dataset = await parseRdf(body, contentType2, {});
      quads = [...dataset];
    } else if (Array.isArray(body)) {
      quads = body;
    } else {
      quads = [...body];
    }
  } catch {
    return false;
  }
  return constantTimeEquals(hashQuads(quads), expectedHash);
}
function nodeShapeSubjects(shape) {
  const out = /* @__PURE__ */ new Set();
  for (const q of shape) {
    if (q.predicate.value === RDF_TYPE && q.object.termType === "NamedNode" && q.object.value === SH_NODE_SHAPE && q.subject.termType === "NamedNode") {
      out.add(q.subject.value);
    }
  }
  return [...out];
}
function buildPdJsonLd(quads, meta) {
  const requestShapes = linkedShapeIds(quads, meta.id, A2A_REQUEST_SHAPE);
  const responseShapes = linkedShapeIds(quads, meta.id, A2A_RESPONSE_SHAPE);
  const doc = {
    "@context": {
      ...A2A_INLINE_CONTEXT,
      dcterms: DCTERMS,
      sh: SH,
      ProtocolDocument: A2A_PROTOCOL_DOCUMENT,
      requestShape: { "@id": A2A_REQUEST_SHAPE, "@type": "@id" },
      responseShape: { "@id": A2A_RESPONSE_SHAPE, "@type": "@id" },
      title: DCTERMS_TITLE,
      // Map `description` to dcterms:description so the emitted metadata parses
      // back to the same predicate the Turtle body uses (no silent loss).
      description: DCTERMS_DESCRIPTION,
      version: DCTERMS_HAS_VERSION
    },
    "@id": meta.id,
    "@type": "ProtocolDocument"
  };
  if (meta.name !== void 0) {
    doc.title = meta.name;
  }
  if (meta.description !== void 0) {
    doc.description = meta.description;
  }
  if (meta.version !== void 0) {
    doc.version = meta.version;
  }
  if (requestShapes.length > 0) {
    doc.requestShape = requestShapes.map((id) => ({ "@id": id }));
  }
  if (responseShapes.length > 0) {
    doc.responseShape = responseShapes.map((id) => ({ "@id": id }));
  }
  return doc;
}
function linkedShapeIds(quads, subject, predicate) {
  const out = /* @__PURE__ */ new Set();
  for (const q of quads) {
    if (q.subject.value === subject && q.predicate.value === predicate && q.object.termType === "NamedNode") {
      out.add(q.object.value);
    }
  }
  return [...out];
}
function constantTimeEquals(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// src/shape.ts
var SH_NODE_SHAPE2 = `${SH}NodeShape`;
var SH_PROPERTY_SHAPE = `${SH}PropertyShape`;
var SH_TARGET_CLASS = `${SH}targetClass`;
var SH_PROPERTY = `${SH}property`;
var SH_PATH = `${SH}path`;
var SH_MIN_COUNT = `${SH}minCount`;
var SH_MAX_COUNT = `${SH}maxCount`;
var SH_NODE_KIND = `${SH}nodeKind`;
var SH_IRI = `${SH}IRI`;
var SH_CLASS = `${SH}class`;
var SH_HAS_VALUE = `${SH}hasValue`;
var SH_IN = `${SH}in`;
var SH_NODE = `${SH}node`;
var SH_NAME = `${SH}name`;
var XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";
function buildShapeForIntent(action, options = {}) {
  const b = new GraphBuilder();
  const shapeId = options.shapeId ?? defaultShapeId(action);
  b.addIri(shapeId, RDF_TYPE, SH_NODE_SHAPE2);
  b.addIri(shapeId, SH_TARGET_CLASS, A2A_INTENT);
  const actionProp = b.linkBlankNode(shapeId, SH_PROPERTY);
  b.addIri(actionProp, RDF_TYPE, SH_PROPERTY_SHAPE);
  b.addIri(actionProp, SH_PATH, A2A_ACTION);
  b.addLiteral(actionProp, SH_MIN_COUNT, "1", XSD_INTEGER);
  b.addLiteral(actionProp, SH_MAX_COUNT, "1", XSD_INTEGER);
  b.addLiteral(actionProp, SH_NAME, "action");
  const actionNodeShape = b.linkBlankNode(actionProp, SH_NODE);
  b.addIri(actionNodeShape, RDF_TYPE, SH_NODE_SHAPE2);
  const typeProp = b.linkBlankNode(actionNodeShape, SH_PROPERTY);
  b.addIri(typeProp, RDF_TYPE, SH_PROPERTY_SHAPE);
  b.addIri(typeProp, SH_PATH, RDF_TYPE);
  b.addIri(typeProp, SH_HAS_VALUE, ACTION_TYPE_IRI[action]);
  b.addLiteral(typeProp, SH_MIN_COUNT, "1", XSD_INTEGER);
  if (action !== "subscribe" && action !== "query") {
    const targetPredicate = action === "list" ? SCHEMA_TARGET : SCHEMA_OBJECT;
    const targetProp = b.linkBlankNode(actionNodeShape, SH_PROPERTY);
    b.addIri(targetProp, RDF_TYPE, SH_PROPERTY_SHAPE);
    b.addIri(targetProp, SH_PATH, targetPredicate);
    b.addIri(targetProp, SH_NODE_KIND, SH_IRI);
    b.addLiteral(targetProp, SH_MIN_COUNT, "1", XSD_INTEGER);
    b.addLiteral(targetProp, SH_NAME, "target");
  }
  if (action === "grant") {
    const recipientProp = b.linkBlankNode(actionNodeShape, SH_PROPERTY);
    b.addIri(recipientProp, RDF_TYPE, SH_PROPERTY_SHAPE);
    b.addIri(recipientProp, SH_PATH, SCHEMA_RECIPIENT);
    b.addIri(recipientProp, SH_NODE_KIND, SH_IRI);
    b.addLiteral(recipientProp, SH_MIN_COUNT, "1", XSD_INTEGER);
    b.addLiteral(recipientProp, SH_NAME, "recipient");
    const modeProp = b.linkBlankNode(actionNodeShape, SH_PROPERTY);
    b.addIri(modeProp, RDF_TYPE, SH_PROPERTY_SHAPE);
    b.addIri(modeProp, SH_PATH, A2A_MODE);
    b.addIri(modeProp, SH_NODE_KIND, SH_IRI);
    b.addLiteral(modeProp, SH_MIN_COUNT, "1", XSD_INTEGER);
    b.addLiteral(modeProp, SH_NAME, "mode");
  }
  return b.quads();
}
function defaultShapeId(action) {
  const titled = action.charAt(0).toUpperCase() + action.slice(1);
  return `${A2A}${titled}IntentShape`;
}
function shapeToTurtle(quads, format) {
  return serialize(quads, format);
}
function buildResponseShape(responseClassIri, shapeId) {
  const b = new GraphBuilder();
  const id = shapeId ?? `${A2A}ResponseShape`;
  b.addIri(id, RDF_TYPE, SH_NODE_SHAPE2);
  b.addIri(id, SH_TARGET_CLASS, responseClassIri);
  const typeProp = b.linkBlankNode(id, SH_PROPERTY);
  b.addIri(typeProp, RDF_TYPE, SH_PROPERTY_SHAPE);
  b.addIri(typeProp, SH_PATH, RDF_TYPE);
  b.addIri(typeProp, SH_HAS_VALUE, responseClassIri);
  b.addLiteral(typeProp, SH_MIN_COUNT, "1", XSD_INTEGER);
  return b.quads();
}

// src/translate.ts
var DEFAULT_BASE = "urn:a2a:intent:";
async function parseIntent(nl, options = {}) {
  if (typeof nl !== "string") {
    throw new TypeError("parseIntent: nl must be a string.");
  }
  const base = options.baseIRI ?? DEFAULT_BASE;
  const draft = classifyDeterministic(nl);
  if (draft !== void 0) {
    const intent = lowerDraft(draft, base, nl);
    return {
      resolved: true,
      source: "deterministic",
      intent,
      quads: intentToRdf(intent),
      nl
    };
  }
  if (options.translate) {
    const translated = await options.translate({
      nl,
      ...options.vocabularyHint !== void 0 && { vocabularyHint: options.vocabularyHint },
      ...options.shape !== void 0 && { shape: options.shape }
    });
    if (translated && isValidDraft(translated)) {
      const intent = lowerDraft(translated, base, nl);
      return {
        resolved: true,
        source: "translated",
        intent,
        quads: intentToRdf(intent),
        nl
      };
    }
    return {
      resolved: false,
      quads: [],
      nl,
      reason: translated ? "the injected translate function returned an invalid draft (unknown action or malformed fields)." : "the injected translate function could not resolve the input."
    };
  }
  return {
    resolved: false,
    quads: [],
    nl,
    reason: "no deterministic verb matched and no translate function was supplied."
  };
}
function classifyDeterministic(nl) {
  const text = nl.trim();
  if (text.length === 0) {
    return void 0;
  }
  const action = matchVerb(text);
  if (action === void 0) {
    return void 0;
  }
  const target = extractIri(text);
  const parameters = extractParameters(text);
  const draft = { action };
  if (target !== void 0) {
    draft.target = target;
  }
  if (parameters.length > 0) {
    draft.parameters = parameters;
  }
  if (action === "grant") {
    const recipient = extractRecipient(text, target);
    if (recipient !== void 0) {
      draft.recipient = recipient;
    }
    const modes = extractModes(text);
    if (modes.length > 0) {
      draft.modes = modes;
    }
  }
  return draft;
}
var VERB_SYNONYMS = {
  // `grant`/`share`/`list`/`subscribe`/`query` are checked BEFORE the generic
  // read/write verbs by the ordering in matchVerb (a "share read access" phrase
  // is a grant, not a read).
  grant: [
    "grant",
    "share",
    "give access",
    "give-access",
    "give access to",
    "authorize",
    "authorise"
  ],
  subscribe: ["subscribe", "watch", "notify me", "notify", "listen for"],
  list: ["list", "enumerate", "show all", "show contents", "browse"],
  query: ["query", "search", "find", "look up", "lookup"],
  append: ["append", "add to", "log", "post to"],
  update: ["update", "modify", "change", "edit", "patch", "replace"],
  delete: ["delete", "remove", "erase", "destroy"],
  create: ["create", "write", "put", "add", "upload", "store", "save"],
  read: ["read", "get", "fetch", "retrieve", "view", "open", "download"]
};
var VERB_ORDER = [
  "grant",
  "subscribe",
  "list",
  "query",
  "append",
  "update",
  "delete",
  "create",
  "read"
];
function matchVerb(text) {
  const lower = ` ${text.toLowerCase()} `;
  for (const action of VERB_ORDER) {
    for (const syn of VERB_SYNONYMS[action]) {
      const needle = ` ${syn} `;
      if (lower.includes(needle)) {
        return action;
      }
      if (lower.startsWith(` ${syn} `) || boundaryHit(lower, syn)) {
        return action;
      }
    }
  }
  return void 0;
}
function boundaryHit(lower, syn) {
  let from = 0;
  while (true) {
    const idx = lower.indexOf(syn, from);
    if (idx === -1) {
      return false;
    }
    const before = lower[idx - 1];
    const after = lower[idx + syn.length];
    const beforeOk = before === void 0 || !/[a-z]/.test(before);
    const afterOk = after === void 0 || !/[a-z]/.test(after);
    if (beforeOk && afterOk) {
      return true;
    }
    from = idx + 1;
  }
}
function extractIri(text) {
  const match = text.match(/https?:\/\/[^\s<>"'`]+/);
  if (!match) {
    return void 0;
  }
  return match[0].replace(/[.,;:!?)]+$/, "");
}
function allIris(text) {
  const out = [];
  const re = /https?:\/\/[^\s<>"'`]+/g;
  let m = re.exec(text);
  while (m !== null) {
    out.push(m[0].replace(/[.,;:!?)]+$/, ""));
    m = re.exec(text);
  }
  return out;
}
function extractRecipient(text, target) {
  const withMarker = text.match(/\b(?:with|recipient[:=])\s*(https?:\/\/[^\s<>"'`]+)/i);
  if (withMarker?.[1]) {
    const iri = withMarker[1].replace(/[.,;:!?)]+$/, "");
    if (iri !== target) {
      return iri;
    }
  }
  const toMarker = text.match(/\bto\s*(https?:\/\/[^\s<>"'`]+)/i);
  if (toMarker?.[1]) {
    const iri = toMarker[1].replace(/[.,;:!?)]+$/, "");
    if (iri !== target) {
      return iri;
    }
  }
  return allIris(text).find((i) => i !== target);
}
function extractModes(text) {
  const lower = text.toLowerCase();
  const out = [];
  const tests = [
    ["Read", /\bread\b/],
    ["Write", /\bwrite\b/],
    ["Append", /\bappend\b/],
    ["Control", /\bcontrol\b/]
  ];
  for (const [mode, re] of tests) {
    if (re.test(lower) && VALID_ACL_MODE_IRIS.has(ACL_MODE_IRI[mode])) {
      out.push(mode);
    }
  }
  return out;
}
function extractParameters(text) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const re = /\b([a-zA-Z][\w-]*)\s*[:=]\s*("[^"]*"|[^\s,]+)/g;
  let m = re.exec(text);
  while (m !== null) {
    const key = m[1];
    let value = m[2] ?? "";
    const isScheme = value.startsWith("//");
    if (key !== void 0 && !isScheme && !seen.has(key)) {
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      seen.add(key);
      out.push({ key, value });
    }
    m = re.exec(text);
  }
  return out;
}
function lowerDraft(draft, base, nl) {
  return {
    id: mintIntentId(base, nl),
    action: draft.action,
    ...draft.target !== void 0 && { target: draft.target },
    ...draft.parameters && draft.parameters.length > 0 && { parameters: [...draft.parameters] },
    ...draft.recipient !== void 0 && { recipient: draft.recipient },
    ...draft.modes && draft.modes.length > 0 && { modes: [...draft.modes] },
    ...draft.agent !== void 0 && { agent: draft.agent }
  };
}
function mintIntentId(base, nl) {
  const digest = shortHash(nl);
  if (base.startsWith("urn:")) {
    return `${base}${digest}`;
  }
  if (base.includes("#")) {
    return `${base}${digest}`;
  }
  return `${base}#intent-${digest}`;
}
function shortHash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function optionalStringOk(value) {
  return value === void 0 || typeof value === "string" && value.trim().length > 0;
}
function isValidDraft(draft) {
  if (typeof draft !== "object" || draft === null) {
    return false;
  }
  if (typeof draft.action !== "string" || !VALID_INTENT_ACTIONS.has(draft.action)) {
    return false;
  }
  if (!optionalStringOk(draft.target)) {
    return false;
  }
  if (!optionalStringOk(draft.recipient)) {
    return false;
  }
  if (!optionalStringOk(draft.agent)) {
    return false;
  }
  if (draft.parameters !== void 0) {
    if (!Array.isArray(draft.parameters)) {
      return false;
    }
    for (const p of draft.parameters) {
      if (typeof p?.key !== "string" || typeof p?.value !== "string") {
        return false;
      }
    }
  }
  if (draft.modes !== void 0) {
    if (!Array.isArray(draft.modes)) {
      return false;
    }
    for (const m of draft.modes) {
      if (typeof m !== "string" || !Object.hasOwn(ACL_MODE_IRI, m)) {
        return false;
      }
    }
  }
  return true;
}

// src/validate.ts
import { Store as Store3 } from "n3";
import SHACLValidator from "rdf-validate-shacl";
async function validateIntent(intent, shape) {
  const dataGraph = toDataset(intentQuads(intent));
  const shapeGraph = toDataset(shapeQuads(shape));
  const validator = new SHACLValidator(shapeGraph);
  const report = await validator.validate(dataGraph);
  return {
    conforms: report.conforms,
    results: report.results.map(projectResult)
  };
}
function intentQuads(intent) {
  if (isIntent(intent)) {
    return intentToRdf(intent);
  }
  if (Array.isArray(intent)) {
    return intent;
  }
  return [...intent];
}
function shapeQuads(shape) {
  if (isProtocolDocument(shape)) {
    return shape.requestShapeQuads;
  }
  if (Array.isArray(shape)) {
    return shape;
  }
  return [...shape];
}
function toDataset(quads) {
  const store = new Store3();
  store.addQuads(quads);
  return store;
}
function projectResult(result) {
  const message = result.message.map((m) => m.value).join("; ");
  return {
    message: message.length > 0 ? message : "SHACL constraint violation",
    ...result.sourceConstraintComponent?.value !== void 0 && {
      sourceConstraintComponent: result.sourceConstraintComponent.value
    },
    ...result.focusNode?.value !== void 0 && { focusNode: result.focusNode.value },
    ...result.path?.value !== void 0 && { path: result.path.value },
    ...result.value?.value !== void 0 && { value: result.value.value },
    ...result.severity?.value !== void 0 && { severity: result.severity.value }
  };
}
function isIntent(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x) && typeof x.action === "string" && typeof x.id === "string";
}
function isProtocolDocument(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x) && typeof x.hash === "string" && Array.isArray(x.quads);
}
export {
  A2A,
  A2A_INLINE_CONTEXT,
  ACL,
  ACL_MODES,
  ACL_MODE_IRI,
  ACTION_TYPE_IRI,
  INTENT_ACTIONS,
  IRI_TO_ACTION,
  LDP,
  PROTOCOL_HASH_ALGORITHM,
  PROTOCOL_HASH_PREFIX,
  SCHEMA,
  SH,
  VALID_ACL_MODE_IRIS,
  VALID_INTENT_ACTIONS,
  buildProtocolDocument,
  buildResponseShape,
  buildShapeForIntent,
  canonicalNQuads,
  classifyDeterministic,
  decodeUpgradeOffer,
  decodeUpgradeResponse,
  defaultShapeId,
  encodeUpgradeOffer,
  encodeUpgradeResponse,
  handshakeFromRdf,
  handshakeToRdf,
  handshakeToTurtle,
  hashQuads,
  intentFromRdf,
  intentToJsonLd,
  intentToRdf,
  intentToTurtle,
  mayDowngradeToNl,
  parseIntent,
  parseIntentGraph,
  serialize,
  shapeToTurtle,
  validateIntent,
  verifyProtocolDocument
};
//# sourceMappingURL=index.js.map
