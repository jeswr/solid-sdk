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

// src/errors.ts
function classifyFetchError(err) {
  if (err instanceof RdfFetchError && !err.status && err.contentType !== void 0) {
    return "parse-failed";
  }
  return "fetch-failed";
}

// src/load.ts
async function loadDataset(input, options, noun) {
  if (options.body !== void 0) {
    try {
      const dataset = await parseRdf(options.body, options.bodyContentType ?? "text/turtle", {
        baseIRI: options.baseIRI ?? input
      });
      return { dataset };
    } catch (err) {
      return { issue: { code: "parse-failed", message: describeError(err, noun), subject: input } };
    }
  }
  try {
    const fetched = await fetchRdf(input, options.fetch ? { fetch: options.fetch } : {});
    return { dataset: fetched.dataset };
  } catch (err) {
    return {
      issue: { code: classifyFetchError(err), message: describeError(err, noun), subject: input }
    };
  }
}
function describeError(err, noun) {
  if (err instanceof RdfFetchError) {
    return err.status ? `Failed to fetch ${noun} (HTTP ${err.status}): ${err.message}` : `Failed to parse ${noun}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// src/serialize.ts
import { Writer } from "n3";

// src/vocab.ts
var FEDREG = "https://w3id.org/jeswr/fedreg#";
var FEDAPP = "https://w3id.org/jeswr/fed#";
var DCAT = "http://www.w3.org/ns/dcat#";
var RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
var SECTOR_BASE = "https://w3id.org/jeswr/sectors/";
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
  for (const [name, statusIri] of Object.entries(MEMBERSHIP_STATUS)) {
    if (statusIri === iri) {
      return name;
    }
  }
  return void 0;
}

// src/serialize.ts
var PREFIXES = {
  fedreg: FEDREG,
  fedapp: FEDAPP,
  dcat: DCAT,
  dct: "http://purl.org/dc/terms/",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
};
function serialize(quads, format = "text/turtle") {
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
function built(quads) {
  return { quads, toString: (format) => serialize(quads, format) };
}

// src/verify.ts
function validIris(terms, subject, predicate, issues) {
  const out = [];
  for (const term of terms) {
    if (term.termType !== "NamedNode") {
      issues.push({
        code: "invalid-term-type",
        message: `Expected an IRI (NamedNode) for <${predicate}> but found a ${term.termType} ("${term.value}").`,
        subject,
        value: term.value
      });
      continue;
    }
    out.push(term.value);
  }
  return out;
}
function validateAppCardinality(apps, id, issues) {
  if (apps.length === 0) {
    issues.push({
      code: "membership-missing-app",
      message: "fedreg:Membership names no fedreg:app (the app's client_id).",
      subject: id
    });
  } else if (apps.length > 1) {
    issues.push({
      code: "membership-multiple-apps",
      message: `fedreg:Membership names ${apps.length} apps via fedreg:app; expected exactly one.`,
      subject: id
    });
  }
}
function validateStatus(statusIris, id, issues) {
  if (statusIris.length === 0) {
    issues.push({
      code: "membership-missing-status",
      message: "fedreg:Membership has no fedreg:status.",
      subject: id
    });
  } else if (statusIris.length > 1) {
    issues.push({
      code: "membership-multiple-statuses",
      message: `fedreg:Membership has ${statusIris.length} fedreg:status values; expected exactly one. (${statusIris.join(", ")})`,
      subject: id
    });
  }
  for (const s of statusIris) {
    if (!VALID_STATUS_IRIS.has(s)) {
      issues.push({
        code: "unknown-status",
        message: `fedreg:status is not a known fedreg:MembershipStatus value: ${s}`,
        subject: id,
        value: s
      });
    }
  }
}
function validateAssertedBy(assertedBy, id, issues) {
  if (assertedBy.length === 0) {
    issues.push({
      code: "membership-missing-asserted-by",
      message: "fedreg:Membership has no fedreg:assertedBy \u2014 a registry assertion MUST name the authority that vouches for it (else it is indistinguishable from a self-asserted claim).",
      subject: id
    });
  }
}
function membershipNodeToView(node, issues) {
  const id = node.value;
  const apps = validIris(node.apps, id, FEDREG_APP, issues);
  const statusIris = validIris(node.statuses, id, FEDREG_STATUS, issues);
  const assertedBy = validIris(node.assertedBy, id, FEDREG_ASSERTED_BY, issues);
  validateAppCardinality(apps, id, issues);
  validateStatus(statusIris, id, issues);
  validateAssertedBy(assertedBy, id, issues);
  const statusIri = statusIris[0];
  return {
    id,
    app: apps[0] ?? "",
    ...statusIri !== void 0 ? { statusIri, status: statusName(statusIri) } : {},
    ...assertedBy.length > 0 ? { assertedBy } : {},
    ...node.asserted !== void 0 ? { asserted: node.asserted } : {}
  };
}
function verifyMembershipNode(node) {
  const issues = [];
  const membership = membershipNodeToView(node, issues);
  return { valid: issues.length === 0, membership, issues };
}
function storageNodeToView(node, issues) {
  const id = node.value;
  const acceptsSpec2 = validIris(node.acceptsSpec, id, FEDREG_ACCEPTS_SPEC, issues);
  const supportsSector = validIris(node.supportsSector, id, FEDREG_SUPPORTS_SECTOR, issues);
  const storageIris = validIris(node.storage, id, FEDREG_STORAGE, issues);
  if (acceptsSpec2.length === 0) {
    issues.push({
      code: "storage-missing-accepts-spec",
      message: "fedreg:StorageDescription advertises no fedreg:acceptsSpec \u2014 it carries no spec-version information for migration coordination.",
      subject: id
    });
  }
  return {
    id,
    storage: storageIris[0] ?? id,
    acceptsSpec: acceptsSpec2,
    supportsSector
  };
}
function verifyStorageNode(node) {
  const issues = [];
  const storage = storageNodeToView(node, issues);
  return { valid: issues.length === 0, storage, issues };
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
var XSD_DATETIME = "http://www.w3.org/2001/XMLSchema#dateTime";
function objectTerms(node, predicate) {
  return SetFrom.subjectPredicate(node, predicate, TermAs.instance(TermWrapper), TermFrom.instance);
}
var MembershipNode = class extends TermWrapper {
  get apps() {
    return objectTerms(this, FEDREG_APP);
  }
  get statuses() {
    return objectTerms(this, FEDREG_STATUS);
  }
  get assertedBy() {
    return objectTerms(this, FEDREG_ASSERTED_BY);
  }
  /** The `fedreg:asserted` lexical value (first one found), or undefined. */
  get asserted() {
    for (const term of objectTerms(this, FEDREG_ASSERTED)) {
      return term.value;
    }
    return void 0;
  }
};
var StorageNode = class extends TermWrapper {
  get acceptsSpec() {
    return objectTerms(this, FEDREG_ACCEPTS_SPEC);
  }
  get supportsSector() {
    return objectTerms(this, FEDREG_SUPPORTS_SECTOR);
  }
  get storage() {
    return objectTerms(this, FEDREG_STORAGE);
  }
};
var RegistryNode = class extends TermWrapper {
  /** The `fedreg:Membership` nodes linked via `fedreg:member`. */
  get members() {
    return SetFrom.subjectPredicate(
      this,
      FEDREG_MEMBER,
      TermAs.instance(MembershipNode),
      TermFrom.instance
    );
  }
};
var RegistryDataset = class extends DatasetWrapper {
  /** Every `fedreg:Registry` subject. */
  registries() {
    return [...this.instancesOf(FEDREG_REGISTRY, RegistryNode)];
  }
  /** Every `fedreg:Membership` subject (whether or not linked into a Registry). */
  memberships() {
    return [...this.instancesOf(FEDREG_MEMBERSHIP, MembershipNode)];
  }
  /** Every `fedreg:StorageDescription` subject. */
  storageDescriptions() {
    return [...this.instancesOf(FEDREG_STORAGE_DESCRIPTION, StorageNode)];
  }
  /** A typed view of a single membership subject. */
  membership(id) {
    return new MembershipNode(id, this, this.factory);
  }
};
function wrap(dataset) {
  return new RegistryDataset(dataset, DataFactory);
}
function addIriTriple(node, predicate, objectIri) {
  const factory = node.factory;
  const subject = node;
  const p = NamedNodeFrom.string(predicate, factory);
  const o = NamedNodeFrom.string(objectIri, factory);
  node.dataset.add(factory.quad(subject, p, o));
}
function addLiteralTriple(node, predicate, value, datatype) {
  const factory = node.factory;
  const subject = node;
  const p = NamedNodeFrom.string(predicate, factory);
  const o = LiteralFrom.datatypeTuple([datatype, value], factory);
  node.dataset.add(factory.quad(subject, p, o));
}
var WritableMembership = class extends TermWrapper {
  typeMembership() {
    addIriTriple(this, RDF_TYPE, FEDREG_MEMBERSHIP);
  }
  addApp(iri) {
    addIriTriple(this, FEDREG_APP, iri);
  }
  addStatus(iri) {
    addIriTriple(this, FEDREG_STATUS, iri);
  }
  addAssertedBy(iri) {
    addIriTriple(this, FEDREG_ASSERTED_BY, iri);
  }
  addAsserted(dateTime) {
    addLiteralTriple(this, FEDREG_ASSERTED, dateTime, XSD_DATETIME);
  }
};
var WritableRegistry = class extends TermWrapper {
  typeRegistry() {
    addIriTriple(this, RDF_TYPE, FEDREG_REGISTRY);
  }
  /**
   * Mint a Membership node (an IRI when `id` is supplied, else a blank node), type
   * it, link it via `fedreg:member`, and return it for writing.
   */
  linkMember(id) {
    const factory = this.factory;
    const subjectTerm = id ? NamedNodeFrom.string(id, factory) : BlankNodeFrom.string(void 0, factory);
    const self = this;
    const p = NamedNodeFrom.string(FEDREG_MEMBER, factory);
    this.dataset.add(factory.quad(self, p, subjectTerm));
    const node = new WritableMembership(subjectTerm, this.dataset, factory);
    node.typeMembership();
    return node;
  }
};
var WritableStorage = class extends TermWrapper {
  typeStorage() {
    addIriTriple(this, RDF_TYPE, FEDREG_STORAGE_DESCRIPTION);
  }
  addStorage(iri) {
    addIriTriple(this, FEDREG_STORAGE, iri);
  }
  addAcceptsSpec(iri) {
    addIriTriple(this, FEDREG_ACCEPTS_SPEC, iri);
  }
  addSupportsSector(iri) {
    addIriTriple(this, FEDREG_SUPPORTS_SECTOR, iri);
  }
};
var RegistryBuilder = class {
  store = new Store2();
  factory = DataFactory;
  /** Open a Registry subject (its IRI) for writing. */
  registry(id) {
    const node = new WritableRegistry(id, this.store, this.factory);
    node.typeRegistry();
    return node;
  }
  /** Open a standalone Membership subject (its IRI) for writing. */
  membership(id) {
    const node = new WritableMembership(id, this.store, this.factory);
    node.typeMembership();
    return node;
  }
  /** Open a StorageDescription subject (its IRI) for writing. */
  storage(id) {
    const node = new WritableStorage(id, this.store, this.factory);
    node.typeStorage();
    return node;
  }
  /** The accumulated quads. */
  quads() {
    return [...this.store];
  }
};

// src/registry.ts
function normaliseAssertedBy(v) {
  return typeof v === "string" ? [v] : [...v];
}
function buildRegistry(input) {
  if (!input.id) {
    throw new TypeError("buildRegistry: RegistryInput.id (the registry IRI) is required.");
  }
  const builder = new RegistryBuilder();
  const registry = builder.registry(input.id);
  for (const m of input.members) {
    writeMembership(registry.linkMember(m.id), m);
  }
  return built(builder.quads());
}
function buildMembership(input) {
  if (!input.id) {
    throw new TypeError(
      "buildMembership: a membership IRI (id) is required for a standalone record."
    );
  }
  const builder = new RegistryBuilder();
  writeMembership(builder.membership(input.id), input);
  return built(builder.quads());
}
function writeMembership(node, m) {
  node.addApp(m.app);
  node.addStatus(MEMBERSHIP_STATUS[m.status ?? "Active"]);
  for (const by of normaliseAssertedBy(m.assertedBy)) {
    node.addAssertedBy(by);
  }
  node.addAsserted(m.asserted ?? (/* @__PURE__ */ new Date()).toISOString());
}
var REGISTRY_NOUN = "registry document";
async function parseRegistry(input, options = {}) {
  const loaded = await loadDataset(input, options, REGISTRY_NOUN);
  if ("issue" in loaded) {
    return { members: [], valid: false, issues: [loaded.issue] };
  }
  return parseRegistryDataset(loaded.dataset, input);
}
function parseRegistryDataset(dataset, expectedId) {
  const fed = wrap(dataset);
  const registries = fed.registries();
  const issues = [];
  if (registries.length === 0) {
    issues.push({
      code: "no-registry",
      message: "No fedreg:Registry subject found in the document.",
      subject: expectedId
    });
    return { members: [], valid: false, issues };
  }
  if (registries.length > 1) {
    issues.push({
      code: "multiple-registries",
      message: `Expected exactly one fedreg:Registry; found ${registries.length}.`,
      subject: expectedId
    });
  }
  const registryNode = registries[0];
  const memberNodes = registryNode ? [...registryNode.members] : [];
  if (memberNodes.length === 0) {
    issues.push({
      code: "no-membership",
      message: "fedreg:Registry lists no fedreg:member records.",
      subject: registryNode?.value
    });
  }
  const members = memberNodes.map((node) => verifyMembershipNode(node));
  const registry = {
    id: registryNode?.value ?? expectedId ?? "",
    members: members.map((m) => m.membership).filter((m) => m !== void 0)
  };
  const valid = issues.length === 0 && members.every((m) => m.valid);
  return { registry, members, valid, issues };
}
async function listMembers(input, options = {}) {
  const loaded = await loadDataset(input, options, REGISTRY_NOUN);
  if ("issue" in loaded) {
    return [];
  }
  const parsed = parseRegistryDataset(loaded.dataset, input);
  if (parsed.members.length > 0 || parsed.issues.some((i) => i.code !== "no-registry")) {
    return [...parsed.members];
  }
  return wrap(loaded.dataset).memberships().map((node) => verifyMembershipNode(node));
}
async function verifyMembership(input, options = {}) {
  const loaded = await loadDataset(input, options, REGISTRY_NOUN);
  if ("issue" in loaded) {
    return { valid: false, issues: [loaded.issue] };
  }
  const fed = wrap(loaded.dataset);
  const memberships = fed.memberships();
  if (memberships.length === 0) {
    return {
      valid: false,
      issues: [
        {
          code: "no-membership",
          message: "No fedreg:Membership subject found in the document.",
          subject: input
        }
      ]
    };
  }
  const node = memberships[0];
  return verifyMembershipNode(node);
}
function verifyMembershipDataset(dataset) {
  const fed = wrap(dataset);
  const memberships = fed.memberships();
  if (memberships.length === 0) {
    return {
      valid: false,
      issues: [{ code: "no-membership", message: "No fedreg:Membership subject found." }]
    };
  }
  const issues = [];
  const membership = membershipNodeToView(memberships[0], issues);
  return { valid: issues.length === 0, membership, issues };
}

// src/storage.ts
function describeStorage(input) {
  if (!input.id) {
    throw new TypeError("describeStorage: StorageInput.id (the description IRI) is required.");
  }
  const builder = new RegistryBuilder();
  const node = builder.storage(input.id);
  if (input.storage && input.storage !== input.id) {
    node.addStorage(input.storage);
  }
  for (const spec of input.acceptsSpec) {
    node.addAcceptsSpec(spec);
  }
  for (const sector of input.supportsSector ?? []) {
    node.addSupportsSector(sector);
  }
  return built(builder.quads());
}
async function parseStorage(input, options = {}) {
  const loaded = await loadDataset(input, options, "storage description");
  if ("issue" in loaded) {
    return { valid: false, issues: [loaded.issue] };
  }
  return parseStorageDataset(loaded.dataset, input);
}
function parseStorageDataset(dataset, expectedId) {
  const fed = wrap(dataset);
  const descriptions = fed.storageDescriptions();
  if (descriptions.length === 0) {
    return {
      valid: false,
      issues: [
        {
          code: "no-storage-description",
          message: "No fedreg:StorageDescription subject found in the document.",
          subject: expectedId
        }
      ]
    };
  }
  return verifyStorageNode(descriptions[0]);
}
function acceptsSpec(storage, specVersionIri) {
  return storage.acceptsSpec.includes(specVersionIri);
}
function unsupportedSpecs(storage, wanted) {
  const accepted = new Set(storage.acceptsSpec);
  return wanted.filter((w) => !accepted.has(w));
}
export {
  DCAT,
  FEDAPP,
  FEDREG,
  MEMBERSHIP_STATUS,
  SECTOR_BASE,
  TRUSTED_STATUS,
  VALID_STATUS_IRIS,
  acceptsSpec,
  buildMembership,
  buildRegistry,
  describeStorage,
  listMembers,
  parseRegistry,
  parseRegistryDataset,
  parseStorage,
  parseStorageDataset,
  serialize,
  statusName,
  unsupportedSpecs,
  verifyMembership,
  verifyMembershipDataset
};
//# sourceMappingURL=index.js.map
