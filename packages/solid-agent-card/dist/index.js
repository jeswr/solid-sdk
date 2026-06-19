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
var SCHEMA = "https://schema.org/";
var SCHEMA_HTTP = "http://schema.org/";
var INTEROP = "http://www.w3.org/ns/solid/interop#";
var FOAF = "http://xmlns.com/foaf/0.1/";
var DCTERMS = "http://purl.org/dc/terms/";
var RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var RDFS = "http://www.w3.org/2000/01/rdf-schema#";
var ANP_AD = "https://w3id.org/agent-description#";
var ANP_CONTEXT_URL = "https://w3id.org/agent-description/v1";
var ANP_INLINE_CONTEXT = {
  ad: ANP_AD,
  AgentDescription: `${ANP_AD}AgentDescription`,
  Skill: `${ANP_AD}Skill`,
  SecurityScheme: `${ANP_AD}SecurityScheme`,
  name: `${ANP_AD}name`,
  description: `${ANP_AD}description`,
  url: { "@id": `${ANP_AD}url`, "@type": "@id" },
  did: `${ANP_AD}did`,
  owner: { "@id": `${ANP_AD}owner`, "@type": "@id" },
  protocolSource: { "@id": `${ANP_AD}protocolSource`, "@type": "@id" },
  skill: { "@id": `${ANP_AD}skill`, "@type": "@id" },
  securityScheme: { "@id": `${ANP_AD}securityScheme`, "@type": "@id" },
  skillId: `${ANP_AD}skillId`,
  schemeType: `${ANP_AD}schemeType`
};
var WELL_KNOWN_AGENT_DESCRIPTIONS = "/.well-known/agent-descriptions";
var WELL_KNOWN_AGENT_CARD = "/.well-known/agent-card.json";
var A2A_PROTOCOL_VERSION = "0.3.0";
var RDF_TYPE = `${RDF}type`;
var HAS_AUTHORIZATION_AGENT = `${INTEROP}hasAuthorizationAgent`;
var SCHEMA_AGENT = `${SCHEMA}agent`;
var SCHEMA_AGENT_HTTP = `${SCHEMA_HTTP}agent`;
var AGENT_POINTER_PREDICATES = [
  HAS_AUTHORIZATION_AGENT,
  SCHEMA_AGENT,
  SCHEMA_AGENT_HTTP
];
var AD_AGENT_DESCRIPTION = `${ANP_AD}AgentDescription`;
var AD_NAME = `${ANP_AD}name`;
var AD_DESCRIPTION = `${ANP_AD}description`;
var AD_URL = `${ANP_AD}url`;
var AD_DID = `${ANP_AD}did`;
var AD_OWNER = `${ANP_AD}owner`;
var AD_SECURITY_SCHEME = `${ANP_AD}securityScheme`;
var AD_PROTOCOL_SOURCE = `${ANP_AD}protocolSource`;
var AD_SKILL = `${ANP_AD}skill`;
var AD_SKILL_CLASS = `${ANP_AD}Skill`;
var AD_SKILL_ID = `${ANP_AD}skillId`;
var AD_SECURITY_SCHEME_CLASS = `${ANP_AD}SecurityScheme`;
var AD_SCHEME_TYPE = `${ANP_AD}schemeType`;
var SECURITY_SCHEME_TYPES = ["solid-oidc", "public", "bearer", "oauth2"];
var VALID_SECURITY_SCHEME_TYPES = new Set(SECURITY_SCHEME_TYPES);

// src/serialize.ts
var PREFIXES = {
  ad: ANP_AD,
  interop: INTEROP,
  schema: SCHEMA,
  foaf: FOAF,
  dcterms: DCTERMS,
  rdf: RDF,
  rdfs: RDFS
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
import { DataFactory, Store } from "n3";
function objectTerms(node, predicate) {
  return SetFrom.subjectPredicate(node, predicate, TermAs.instance(TermWrapper), TermFrom.instance);
}
var SkillNode = class extends TermWrapper {
  get skillId() {
    return objectTerms(this, AD_SKILL_ID);
  }
  get names() {
    return objectTerms(this, AD_NAME);
  }
  get descriptions() {
    return objectTerms(this, AD_DESCRIPTION);
  }
};
var SecuritySchemeNode = class extends TermWrapper {
  get schemeTypes() {
    return objectTerms(this, AD_SCHEME_TYPE);
  }
  get descriptions() {
    return objectTerms(this, AD_DESCRIPTION);
  }
  get urls() {
    return objectTerms(this, AD_URL);
  }
};
var AgentDescriptionNode = class extends TermWrapper {
  get names() {
    return objectTerms(this, AD_NAME);
  }
  get descriptions() {
    return objectTerms(this, AD_DESCRIPTION);
  }
  get urls() {
    return objectTerms(this, AD_URL);
  }
  get owners() {
    return objectTerms(this, AD_OWNER);
  }
  get dids() {
    return objectTerms(this, AD_DID);
  }
  get protocolSources() {
    return objectTerms(this, AD_PROTOCOL_SOURCE);
  }
  /** Linked `ad:Skill` nodes, projected to typed wrappers (term-type-preserving). */
  get skills() {
    return SetFrom.subjectPredicate(this, AD_SKILL, TermAs.instance(SkillNode), TermFrom.instance);
  }
  /** Linked `ad:SecurityScheme` nodes, projected to typed wrappers. */
  get securitySchemes() {
    return SetFrom.subjectPredicate(
      this,
      AD_SECURITY_SCHEME,
      TermAs.instance(SecuritySchemeNode),
      TermFrom.instance
    );
  }
};
var AgentDataset = class extends DatasetWrapper {
  /** Every `ad:AgentDescription` subject in the dataset. */
  agentDescriptions() {
    return [...this.instancesOf(AD_AGENT_DESCRIPTION, AgentDescriptionNode)];
  }
  /** A typed view of a single agent-description subject. */
  agentDescription(id) {
    return new AgentDescriptionNode(id, this, this.factory);
  }
};
var ProfileDataset = class extends DatasetWrapper {
  /**
   * Read every agent-pointer object for `webId` across the agent-pointer
   * predicates, in priority order. Returns `[predicate, agentTerm]` pairs so the
   * caller knows which predicate linked each, and can reject non-IRI objects.
   */
  agentPointers(webId) {
    const subject = new TermWrapper(webId, this, this.factory);
    const out = [];
    for (const predicate of AGENT_POINTER_PREDICATES) {
      for (const agent of objectTerms(subject, predicate)) {
        out.push({ predicate, agent });
      }
    }
    return out;
  }
};
function wrapAgent(dataset) {
  return new AgentDataset(dataset, DataFactory);
}
function wrapProfile(dataset) {
  return new ProfileDataset(dataset, DataFactory);
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
var WritableSkill = class extends TermWrapper {
  typeSkill() {
    addIri(this, RDF_TYPE, AD_SKILL_CLASS);
  }
  setId(id) {
    addLiteral(this, AD_SKILL_ID, id);
  }
  setName(name) {
    addLiteral(this, AD_NAME, name);
  }
  setDescription(d) {
    addLiteral(this, AD_DESCRIPTION, d);
  }
};
var WritableSecurityScheme = class extends TermWrapper {
  typeScheme() {
    addIri(this, RDF_TYPE, AD_SECURITY_SCHEME_CLASS);
  }
  setType(t) {
    addLiteral(this, AD_SCHEME_TYPE, t);
  }
  setDescription(d) {
    addLiteral(this, AD_DESCRIPTION, d);
  }
  setIssuer(iri) {
    addIri(this, AD_URL, iri);
  }
};
var WritableAgentDescription = class extends TermWrapper {
  typeAgentDescription() {
    addIri(this, RDF_TYPE, AD_AGENT_DESCRIPTION);
  }
  setName(name) {
    addLiteral(this, AD_NAME, name);
  }
  setDescription(d) {
    addLiteral(this, AD_DESCRIPTION, d);
  }
  setUrl(iri) {
    addIri(this, AD_URL, iri);
  }
  setOwner(iri) {
    addIri(this, AD_OWNER, iri);
  }
  setDid(did) {
    addLiteral(this, AD_DID, did);
  }
  addProtocolSource(iri) {
    addIri(this, AD_PROTOCOL_SOURCE, iri);
  }
  /** Link a fresh blank-node Skill node, typed `ad:Skill`. */
  linkSkill() {
    const node = new WritableSkill(this.linkBlank(AD_SKILL), this.dataset, this.factory);
    node.typeSkill();
    return node;
  }
  /** Link a fresh blank-node SecurityScheme node, typed `ad:SecurityScheme`. */
  linkSecurityScheme() {
    const node = new WritableSecurityScheme(
      this.linkBlank(AD_SECURITY_SCHEME),
      this.dataset,
      this.factory
    );
    node.typeScheme();
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
var AgentBuilder = class {
  store = new Store();
  factory = DataFactory;
  /** Open the agent-description subject (`id` is the agent IRI) for writing. */
  agent(id) {
    const node = new WritableAgentDescription(
      id,
      this.store,
      this.factory
    );
    node.typeAgentDescription();
    return node;
  }
  /** The accumulated quads. */
  quads() {
    return [...this.store];
  }
};
var PointerBuilder = class {
  store = new Store();
  factory = DataFactory;
  /**
   * Add the pointer `(<webId>, <predicate>, <agent>)`. `predicate` defaults to
   * `interop:hasAuthorizationAgent` (the SAI "agent that represents you").
   */
  link(webId, agent, predicate) {
    const node = new TermWrapper(webId, this.store, this.factory);
    addIri(node, predicate, agent);
  }
  /** The accumulated quads. */
  quads() {
    return [...this.store];
  }
};

// src/describe.ts
function describeAgent(descriptor) {
  if (!descriptor.id) {
    throw new TypeError("describeAgent: AgentDescriptor.id (the agent IRI) is required.");
  }
  if (!descriptor.name) {
    throw new TypeError("describeAgent: AgentDescriptor.name is required.");
  }
  return {
    agentCard: buildAgentCard(descriptor),
    agentDescription: buildAgentDescription(descriptor)
  };
}
function buildAgentCard(descriptor) {
  const url = descriptor.url ?? descriptor.id;
  const securitySchemes = {};
  for (const scheme of descriptor.securitySchemes ?? []) {
    const entry = {
      type: scheme.type,
      ...scheme.description !== void 0 && { description: scheme.description },
      ...scheme.issuer !== void 0 && { openIdConnectUrl: scheme.issuer }
    };
    securitySchemes[scheme.type] = entry;
  }
  const card = {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: descriptor.name,
    ...descriptor.description !== void 0 && { description: descriptor.description },
    url,
    preferredTransport: "JSONRPC",
    ...descriptor.skills && descriptor.skills.length > 0 ? {
      skills: descriptor.skills.map((s) => ({
        id: s.id,
        name: s.name,
        ...s.description !== void 0 && { description: s.description },
        ...s.tags && s.tags.length > 0 ? { tags: [...s.tags] } : {}
      }))
    } : {},
    ...Object.keys(securitySchemes).length > 0 ? { securitySchemes } : {},
    // The Solid/ANP extension block — plain A2A tooling ignores `x-solid`; a
    // Solid/ANP-aware peer reads the owner WebID, the RDF Agent Description and
    // the M2 protocol sources from here.
    "x-solid": buildSolidExtension(descriptor)
  };
  return card;
}
function buildSolidExtension(descriptor) {
  const ext = {};
  if (descriptor.owner !== void 0) {
    ext.owner = descriptor.owner;
  }
  ext.agentDescription = `${descriptor.id}#ad`;
  if (descriptor.protocolSources && descriptor.protocolSources.length > 0) {
    ext.protocolSources = [...descriptor.protocolSources];
  }
  return ext;
}
function buildAgentDescription(descriptor) {
  const builder = new AgentBuilder();
  const node = builder.agent(descriptor.id);
  writeScalarFields(node, descriptor);
  writeSkills(node, descriptor.skills);
  writeSecuritySchemes(node, descriptor.securitySchemes);
  const quads = builder.quads();
  return {
    quads,
    toTurtle: (format) => serialize2(quads, format),
    toJsonLd: () => Promise.resolve(buildJsonLd(descriptor))
  };
}
function writeScalarFields(node, descriptor) {
  node.setName(descriptor.name);
  if (descriptor.description !== void 0) {
    node.setDescription(descriptor.description);
  }
  node.setUrl(descriptor.url ?? descriptor.id);
  if (descriptor.owner !== void 0) {
    node.setOwner(descriptor.owner);
  }
  if (descriptor.did !== void 0) {
    node.setDid(descriptor.did);
  }
  for (const source of descriptor.protocolSources ?? []) {
    node.addProtocolSource(source);
  }
}
function writeSkills(node, skills) {
  for (const skill of skills ?? []) {
    const sk = node.linkSkill();
    sk.setId(skill.id);
    sk.setName(skill.name);
    if (skill.description !== void 0) {
      sk.setDescription(skill.description);
    }
  }
}
function writeSecuritySchemes(node, schemes) {
  for (const scheme of schemes ?? []) {
    const sc = node.linkSecurityScheme();
    sc.setType(scheme.type);
    if (scheme.description !== void 0) {
      sc.setDescription(scheme.description);
    }
    if (scheme.issuer !== void 0) {
      sc.setIssuer(scheme.issuer);
    }
  }
}
function buildJsonLd(descriptor) {
  const doc = {
    // A SELF-CONTAINED inline context (not a bare remote URL) so the document
    // parses offline + deterministically and carries no SSRF/availability
    // dependency on the CG-draft context endpoint. See ANP_INLINE_CONTEXT.
    "@context": ANP_INLINE_CONTEXT,
    "@id": descriptor.id,
    "@type": "AgentDescription",
    name: descriptor.name,
    url: descriptor.url ?? descriptor.id
  };
  if (descriptor.description !== void 0) {
    doc.description = descriptor.description;
  }
  if (descriptor.owner !== void 0) {
    doc.owner = { "@id": descriptor.owner };
  }
  if (descriptor.did !== void 0) {
    doc.did = descriptor.did;
  }
  if (descriptor.protocolSources && descriptor.protocolSources.length > 0) {
    doc.protocolSource = descriptor.protocolSources.map((s) => ({ "@id": s }));
  }
  if (descriptor.skills && descriptor.skills.length > 0) {
    doc.skill = descriptor.skills.map((s) => {
      const skill = {
        "@type": "Skill",
        skillId: s.id,
        name: s.name
      };
      if (s.description !== void 0) {
        skill.description = s.description;
      }
      return skill;
    });
  }
  if (descriptor.securitySchemes && descriptor.securitySchemes.length > 0) {
    doc.securityScheme = descriptor.securitySchemes.map((sc) => {
      const scheme = {
        "@type": "SecurityScheme",
        schemeType: sc.type
      };
      if (sc.description !== void 0) {
        scheme.description = sc.description;
      }
      if (sc.issuer !== void 0) {
        scheme.url = { "@id": sc.issuer };
      }
      return scheme;
    });
  }
  return doc;
}

// node_modules/@jeswr/fetch-rdf/dist/parse.js
import contentType from "content-type";
import { Store as Store2, StreamParser } from "n3";
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
    const store = new Store2();
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

// node_modules/@jeswr/fetch-rdf/dist/fetch.js
var ACCEPT = "text/turtle, application/ld+json;q=0.9";
async function fetchRdf(url, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const headers = new Headers(options.headers);
  headers.set("accept", ACCEPT);
  let response;
  try {
    response = await fetchImpl(url, {
      headers,
      ...options.signal !== void 0 && { signal: options.signal }
    });
  } catch (cause) {
    throw new RdfFetchError(`Network error fetching ${url}: ${errorMessage(cause)}`, { cause, url });
  }
  if (!response.ok) {
    throw new RdfFetchError(`HTTP ${response.status} ${response.statusText || ""} fetching ${url}.`.trim(), {
      status: response.status,
      url: response.url || url,
      contentType: response.headers.get("content-type") ?? void 0
    });
  }
  const dataset = await parseRdf(response.body ?? "", response.headers.get("content-type"), { baseIRI: response.url || url });
  return { dataset, headers: response.headers };
}
function errorMessage(cause) {
  if (cause instanceof Error)
    return cause.message;
  return String(cause);
}

// src/verify.ts
async function verifyDescriptor(input, options = {}) {
  const isBody = options.body !== void 0;
  let dataset;
  try {
    if (options.body !== void 0) {
      dataset = await parseRdf(options.body, options.bodyContentType ?? "text/turtle", {
        baseIRI: options.baseIRI ?? input
      });
    } else {
      const fetched = await fetchRdf(input, options.fetch ? { fetch: options.fetch } : {});
      dataset = fetched.dataset;
    }
  } catch (err) {
    return {
      valid: false,
      issues: [{ code: classifyFetchError(err), message: describeError(err), subject: input }]
    };
  }
  const expectedId = isBody ? options.expectedId : options.expectedId ?? input;
  const requireSubjectMatch = options.requireSubjectMatch ?? (!isBody || options.expectedId !== void 0);
  return verifyDataset(dataset, expectedId, { requireSubjectMatch });
}
function verifyDataset(dataset, expectedId, options = {}) {
  const agentDs = wrapAgent(dataset);
  const descriptions = agentDs.agentDescriptions();
  const issues = [];
  if (descriptions.length === 0) {
    issues.push({
      code: "no-agent-description",
      message: "No ad:AgentDescription subject found in the document.",
      subject: expectedId
    });
    return { valid: false, issues };
  }
  if (descriptions.length > 1) {
    issues.push({
      code: "multiple-agent-descriptions",
      message: `Expected exactly one ad:AgentDescription; found ${descriptions.length}.`,
      subject: expectedId
    });
  }
  const node = descriptions[0];
  if (options.requireSubjectMatch && expectedId !== void 0 && node.value !== expectedId) {
    issues.push({
      code: "subject-mismatch",
      message: `ad:AgentDescription subject (${node.value}) does not equal the expected agent IRI (${expectedId}).`,
      subject: node.value,
      value: expectedId
    });
  }
  const descriptor = projectDescriptor(node, issues);
  return { valid: issues.length === 0, descriptor, issues };
}
function projectDescriptor(node, issues) {
  const id = node.value;
  const name = firstLiteral(node.names);
  if (name === void 0) {
    issues.push({
      code: "missing-name",
      message: "ad:AgentDescription has no ad:name.",
      subject: id
    });
  }
  const urlIris = iriValues(node.urls, id, "ad:url", issues);
  const url = urlIris[0];
  if (url === void 0) {
    issues.push({
      code: "missing-url",
      message: "ad:AgentDescription has no ad:url.",
      subject: id
    });
  } else if (!isHttpUrl(url)) {
    issues.push({
      code: "invalid-url",
      message: `ad:url is not an http(s) URL: ${url}`,
      subject: id,
      value: url
    });
  }
  const owner = iriValues(node.owners, id, "ad:owner", issues)[0];
  const protocolSources = iriValues(node.protocolSources, id, "ad:protocolSource", issues);
  for (const ps of protocolSources) {
    if (!isHttpUrl(ps)) {
      issues.push({
        code: "invalid-protocol-source",
        message: `ad:protocolSource is not an http(s) URL: ${ps}`,
        subject: id,
        value: ps
      });
    }
  }
  const skills = projectSkills(node, issues);
  const securitySchemes = projectSchemes(node, issues);
  return {
    id,
    name: name ?? "",
    ...firstLiteral(node.descriptions) !== void 0 && {
      description: firstLiteral(node.descriptions)
    },
    ...url !== void 0 && { url },
    ...owner !== void 0 && { owner },
    ...firstLiteral(node.dids) !== void 0 && { did: firstLiteral(node.dids) },
    ...skills.length > 0 && { skills },
    ...securitySchemes.length > 0 && { securitySchemes },
    ...protocolSources.length > 0 && { protocolSources }
  };
}
function projectSkills(node, issues) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const sk of node.skills) {
    const skillId = firstLiteral(sk.skillId);
    const name = firstLiteral(sk.names);
    if (skillId === void 0) {
      issues.push({
        code: "skill-missing-id",
        message: "ad:Skill has no ad:skillId.",
        subject: sk.value
      });
      continue;
    }
    if (name === void 0) {
      issues.push({
        code: "skill-missing-name",
        message: "ad:Skill has no ad:name.",
        subject: sk.value,
        value: skillId
      });
    }
    if (seen.has(skillId)) {
      issues.push({
        code: "duplicate-skill-id",
        message: `Duplicate ad:skillId: ${skillId}`,
        subject: sk.value,
        value: skillId
      });
      continue;
    }
    seen.add(skillId);
    out.push({
      id: skillId,
      name: name ?? "",
      ...firstLiteral(sk.descriptions) !== void 0 && {
        description: firstLiteral(sk.descriptions)
      }
    });
  }
  return out;
}
function projectSchemes(node, issues) {
  const out = [];
  for (const sc of node.securitySchemes) {
    const type = firstLiteral(sc.schemeTypes);
    if (type === void 0 || !VALID_SECURITY_SCHEME_TYPES.has(type)) {
      issues.push({
        code: "invalid-security-scheme",
        message: `ad:SecurityScheme has an unknown or missing ad:schemeType: ${type ?? "(none)"}`,
        subject: sc.value,
        ...type !== void 0 && { value: type }
      });
      continue;
    }
    const issuer = [...sc.urls].find((t) => t.termType === "NamedNode")?.value;
    out.push({
      type,
      ...issuer !== void 0 && { issuer },
      ...firstLiteral(sc.descriptions) !== void 0 && {
        description: firstLiteral(sc.descriptions)
      }
    });
  }
  return out;
}
function firstLiteral(terms) {
  for (const term of terms) {
    if (term.termType === "Literal") {
      return term.value;
    }
  }
  return void 0;
}
function iriValues(terms, subject, label, issues) {
  const out = [];
  for (const term of terms) {
    if (term.termType !== "NamedNode") {
      issues.push({
        code: label === "ad:owner" ? "invalid-owner" : "invalid-url",
        message: `Expected an IRI (NamedNode) for ${label} but found a ${term.termType} ("${term.value}").`,
        subject,
        value: term.value
      });
      continue;
    }
    out.push(term.value);
  }
  return out;
}
function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function classifyFetchError(err) {
  if (err instanceof RdfFetchError) {
    if (err.status !== void 0) {
      return "fetch-failed";
    }
    return err.contentType !== void 0 ? "parse-failed" : "fetch-failed";
  }
  return "parse-failed";
}
function describeError(err) {
  if (err instanceof RdfFetchError) {
    if (err.status !== void 0) {
      return `Failed to fetch agent description (HTTP ${err.status}): ${err.message}`;
    }
    return classifyFetchError(err) === "parse-failed" ? `Failed to parse agent description: ${err.message}` : `Failed to fetch agent description: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// src/discover.ts
async function discoverAgent(webId, options = {}) {
  if (!webId) {
    throw new TypeError("discoverAgent: webId is required.");
  }
  const fetchOpts = options.fetch ? { fetch: options.fetch } : {};
  let profileDataset;
  try {
    const fetched = await fetchRdf(webId, fetchOpts);
    profileDataset = fetched.dataset;
  } catch (err) {
    return { webId, pointers: [] };
  }
  const profile = wrapProfile(profileDataset);
  const rawPointers = profile.agentPointers(webId);
  const pointers = [];
  for (const { predicate, agent } of rawPointers) {
    if (agent.termType !== "NamedNode") {
      continue;
    }
    pointers.push({ webId, agent: agent.value, predicate });
  }
  if (pointers.length === 0 || options.resolveDescriptor === false) {
    return { webId, pointers };
  }
  const agentIri = pointers[0]?.agent;
  let descriptorDataset;
  try {
    const fetched = await fetchRdf(agentIri, fetchOpts);
    descriptorDataset = fetched.dataset;
  } catch (err) {
    return {
      webId,
      pointers,
      verification: {
        valid: false,
        issues: [{ code: classifyFetchError(err), message: describeError2(err), subject: agentIri }]
      }
    };
  }
  const verification = verifyDataset(descriptorDataset, agentIri, { requireSubjectMatch: true });
  return {
    webId,
    pointers,
    ...verification.descriptor !== void 0 && { descriptor: verification.descriptor },
    verification
  };
}
function agentDescriptionsUrl(origin) {
  return new URL(WELL_KNOWN_AGENT_DESCRIPTIONS, originOf(origin)).toString();
}
function agentCardUrl(origin) {
  return new URL(WELL_KNOWN_AGENT_CARD, originOf(origin)).toString();
}
function originOf(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}/`;
}
function describeError2(err) {
  if (err instanceof RdfFetchError) {
    return err.status ? `Failed to fetch agent description (HTTP ${err.status}): ${err.message}` : `Failed to parse agent description: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// src/pointer.ts
var PREDICATE_IRI = {
  "interop:hasAuthorizationAgent": HAS_AUTHORIZATION_AGENT,
  "schema:agent": SCHEMA_AGENT
};
function buildAgentPointer(webId, agent, predicates = "interop:hasAuthorizationAgent") {
  if (!webId) {
    throw new TypeError("buildAgentPointer: webId is required.");
  }
  if (!agent) {
    throw new TypeError("buildAgentPointer: agent IRI is required.");
  }
  const list = Array.isArray(predicates) ? predicates : [predicates];
  if (list.length === 0) {
    throw new TypeError("buildAgentPointer: at least one predicate is required.");
  }
  const builder = new PointerBuilder();
  for (const predicate of new Set(list)) {
    builder.link(webId, agent, PREDICATE_IRI[predicate]);
  }
  const quads = builder.quads();
  return {
    quads,
    toString: (format) => serialize2(quads, format)
  };
}
export {
  A2A_PROTOCOL_VERSION,
  AGENT_POINTER_PREDICATES,
  ANP_AD,
  ANP_CONTEXT_URL,
  ANP_INLINE_CONTEXT,
  HAS_AUTHORIZATION_AGENT,
  SCHEMA_AGENT,
  SECURITY_SCHEME_TYPES,
  VALID_SECURITY_SCHEME_TYPES,
  WELL_KNOWN_AGENT_CARD,
  WELL_KNOWN_AGENT_DESCRIPTIONS,
  agentCardUrl,
  agentDescriptionsUrl,
  buildAgentPointer,
  describeAgent,
  discoverAgent,
  serialize2 as serialize,
  verifyDataset,
  verifyDescriptor
};
//# sourceMappingURL=index.js.map
