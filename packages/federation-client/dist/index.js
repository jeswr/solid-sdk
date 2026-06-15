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

// src/list.ts
import { ContainerDataset } from "@solid/object";
import { DataFactory as DataFactory2 } from "n3";

// src/vocab.ts
var FEDAPP = "https://w3id.org/jeswr/fed#";
var ACL = "http://www.w3.org/ns/auth/acl#";
var SHACL = "http://www.w3.org/ns/shacl#";
var RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
var SECTOR_BASE = "https://w3id.org/jeswr/sectors/";
var FEDAPP_APP = `${FEDAPP}App`;
var FEDAPP_APP_VERSION = `${FEDAPP}AppVersion`;
var FEDAPP_SECTOR_USE_CLASS = `${FEDAPP}SectorUse`;
var FEDAPP_SECTOR_USE = `${FEDAPP}sectorUse`;
var FEDAPP_SECTOR = `${FEDAPP}sector`;
var FEDAPP_ACCESS = `${FEDAPP}access`;
var FEDAPP_CONSUMES = `${FEDAPP}consumes`;
var FEDAPP_PRODUCES = `${FEDAPP}produces`;
var FEDAPP_DECLARES_SHAPE = `${FEDAPP}declaresShape`;
var ACL_MODES = {
  Read: `${ACL}Read`,
  Write: `${ACL}Write`,
  Append: `${ACL}Append`,
  Control: `${ACL}Control`
};
var VALID_ACCESS_MODE_IRIS = new Set(Object.values(ACL_MODES));
var KNOWN_SECTOR_SLUGS = [
  "identity",
  "contacts",
  "media",
  "finance",
  "health",
  "scheduling",
  "core"
];
function sectorIri(slug) {
  return `${SECTOR_BASE}${slug}`;
}
function accessModeName(iri) {
  for (const [name, modeIri] of Object.entries(ACL_MODES)) {
    if (modeIri === iri) {
      return name;
    }
  }
  return void 0;
}

// src/wrappers.ts
import {
  BlankNodeFrom,
  DatasetWrapper,
  NamedNodeFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper
} from "@rdfjs/wrapper";
import { DataFactory, Store as Store2 } from "n3";
function iriTerms(node, predicate) {
  return SetFrom.subjectPredicate(node, predicate, TermAs.instance(TermWrapper), TermFrom.instance);
}
var SectorUseNode = class extends TermWrapper {
  get sectors() {
    return iriTerms(this, FEDAPP_SECTOR);
  }
  get access() {
    return iriTerms(this, FEDAPP_ACCESS);
  }
  get consumes() {
    return iriTerms(this, FEDAPP_CONSUMES);
  }
  get produces() {
    return iriTerms(this, FEDAPP_PRODUCES);
  }
};
var AppNode = class extends TermWrapper {
  get sectors() {
    return iriTerms(this, FEDAPP_SECTOR);
  }
  get access() {
    return iriTerms(this, FEDAPP_ACCESS);
  }
  get consumes() {
    return iriTerms(this, FEDAPP_CONSUMES);
  }
  get produces() {
    return iriTerms(this, FEDAPP_PRODUCES);
  }
  get declaresShape() {
    return iriTerms(this, FEDAPP_DECLARES_SHAPE);
  }
  /**
   * The `fedapp:SectorUse` nodes linked via `fedapp:sectorUse`, projected
   * directly to typed wrappers. Using `TermAs.instance` (rather than reading the
   * id as a string and re-wrapping) preserves the object's term type — the
   * SectorUse nodes are typically blank nodes, which a string round-trip through
   * `NamedNodeFrom.string` would silently mis-wrap as IRIs.
   */
  get sectorUses() {
    return SetFrom.subjectPredicate(
      this,
      FEDAPP_SECTOR_USE,
      TermAs.instance(SectorUseNode),
      TermFrom.instance
    );
  }
};
var FederationDataset = class extends DatasetWrapper {
  /** Every `fedapp:App` subject in the dataset. */
  apps() {
    return [...this.instancesOf(FEDAPP_APP, AppNode)];
  }
  /** A typed view of a single app subject. */
  app(id) {
    return new AppNode(id, this, this.factory);
  }
};
function wrap(dataset) {
  return new FederationDataset(dataset, DataFactory);
}
function addIriTriple(node, predicate, objectIri) {
  const factory = node.factory;
  const subject = node;
  const p = NamedNodeFrom.string(predicate, factory);
  const o = NamedNodeFrom.string(objectIri, factory);
  node.dataset.add(factory.quad(subject, p, o));
}
var WritableSectorUse = class extends TermWrapper {
  typeSectorUse() {
    addIriTriple(this, RDF_TYPE, FEDAPP_SECTOR_USE_CLASS);
  }
  addSector(iri) {
    addIriTriple(this, FEDAPP_SECTOR, iri);
  }
  addAccess(iri) {
    addIriTriple(this, FEDAPP_ACCESS, iri);
  }
  addConsumes(iri) {
    addIriTriple(this, FEDAPP_CONSUMES, iri);
  }
  addProduces(iri) {
    addIriTriple(this, FEDAPP_PRODUCES, iri);
  }
};
var WritableApp = class extends TermWrapper {
  typeApp() {
    addIriTriple(this, RDF_TYPE, FEDAPP_APP);
  }
  addSector(iri) {
    addIriTriple(this, FEDAPP_SECTOR, iri);
  }
  addAccess(iri) {
    addIriTriple(this, FEDAPP_ACCESS, iri);
  }
  addConsumes(iri) {
    addIriTriple(this, FEDAPP_CONSUMES, iri);
  }
  addProduces(iri) {
    addIriTriple(this, FEDAPP_PRODUCES, iri);
  }
  addDeclaresShape(iri) {
    addIriTriple(this, FEDAPP_DECLARES_SHAPE, iri);
  }
  /**
   * Link a fresh blank-node SectorUse node and return it, typed
   * `fedapp:SectorUse`. The blank node is minted on the factory so subject
   * identity is preserved across the link triple and the node's own triples.
   */
  linkSectorUse() {
    const factory = this.factory;
    const blank = BlankNodeFrom.string(void 0, factory);
    const subject = this;
    const p = NamedNodeFrom.string(FEDAPP_SECTOR_USE, factory);
    this.dataset.add(factory.quad(subject, p, blank));
    const node = new WritableSectorUse(blank, this.dataset, factory);
    node.typeSectorUse();
    return node;
  }
};
var FederationBuilder = class {
  store = new Store2();
  factory = DataFactory;
  /** Open the app subject (`id` is its client_id IRI) for writing. */
  app(id) {
    const node = new WritableApp(id, this.store, this.factory);
    node.typeApp();
    return node;
  }
  /** The accumulated quads. */
  quads() {
    return [...this.store];
  }
};

// src/verify.ts
async function verify(input, options = {}) {
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
    const code = err instanceof RdfFetchError && err.status ? "fetch-failed" : "parse-failed";
    return {
      valid: false,
      issues: [{ code, message: describeError(err), subject: input }]
    };
  }
  const requireSubjectMatch = options.requireSubjectMatch ?? !isBody;
  return verifyDataset(dataset, input, { requireSubjectMatch });
}
function verifyDataset(dataset, expectedId, options = {}) {
  const fed = wrap(dataset);
  const apps = fed.apps();
  const issues = [];
  if (apps.length === 0) {
    issues.push({
      code: "no-app",
      message: "No fedapp:App subject found in the registration document.",
      subject: expectedId
    });
    return { valid: false, issues };
  }
  if (apps.length > 1) {
    issues.push({
      code: "multiple-apps",
      message: `Expected exactly one fedapp:App; found ${apps.length}.`,
      subject: expectedId
    });
  }
  const appNode = apps[0];
  if (options.requireSubjectMatch && expectedId !== void 0 && appNode.value !== expectedId) {
    issues.push({
      code: "subject-mismatch",
      message: `fedapp:App subject (${appNode.value}) does not equal the expected client-id IRI (${expectedId}).`,
      subject: appNode.value,
      value: expectedId
    });
  }
  const result = verifyApp(appNode);
  issues.push(...result.issues);
  return {
    valid: issues.length === 0,
    registration: result.registration,
    issues
  };
}
function verifyApp(app) {
  const issues = [];
  const registration = appToRegistration(app, issues);
  if (isEmptyRegistration(registration)) {
    issues.push({
      code: "empty-registration",
      message: "fedapp:App declares no sectors, access modes, consumed/produced shapes, declared shapes or sector-use blocks.",
      subject: registration.id
    });
  }
  const hasAnyAccess = (registration.access?.length ?? 0) > 0 || (registration.sectorUse ?? []).some((su) => su.access.length > 0);
  if (!hasAnyAccess && !isEmptyRegistration(registration)) {
    issues.push({
      code: "missing-access",
      message: "fedapp:App requests no access modes (no fedapp:access flat or in any SectorUse).",
      subject: registration.id
    });
  }
  return { valid: issues.length === 0, registration, issues };
}
function appToRegistration(app, issues) {
  const access = mapAccessModes(app.access, app.value, FEDAPP_ACCESS, issues);
  const sectorUse = [...app.sectorUses].map((node) => sectorUseNodeToView(node, issues));
  return {
    id: app.value,
    sectors: validIris(app.sectors, app.value, FEDAPP_SECTOR, issues),
    access,
    consumes: validIris(app.consumes, app.value, FEDAPP_CONSUMES, issues),
    produces: validIris(app.produces, app.value, FEDAPP_PRODUCES, issues),
    declaresShape: validIris(app.declaresShape, app.value, FEDAPP_DECLARES_SHAPE, issues),
    sectorUse
  };
}
function sectorUseNodeToView(node, issues) {
  const id = node.value;
  const sectors = validIris(node.sectors, id, FEDAPP_SECTOR, issues);
  const access = mapAccessModes(node.access, id, FEDAPP_ACCESS, issues);
  if (sectors.length === 0) {
    issues.push({
      code: "sector-use-missing-sector",
      message: "fedapp:SectorUse node has no fedapp:sector.",
      subject: id
    });
  }
  if (access.length === 0) {
    issues.push({
      code: "sector-use-missing-access",
      message: "fedapp:SectorUse node requests no fedapp:access modes.",
      subject: id
    });
  }
  return {
    id,
    sector: sectors[0] ?? "",
    access,
    consumes: validIris(node.consumes, id, FEDAPP_CONSUMES, issues),
    produces: validIris(node.produces, id, FEDAPP_PRODUCES, issues)
  };
}
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
function mapAccessModes(modeTerms, subject, predicate, issues) {
  const out = [];
  for (const iri of validIris(modeTerms, subject, predicate, issues)) {
    if (!VALID_ACCESS_MODE_IRIS.has(iri)) {
      issues.push({
        code: "invalid-access-mode",
        message: `Unknown fedapp:access value (not an acl: mode): ${iri}`,
        subject,
        value: iri
      });
      continue;
    }
    const name = accessModeName(iri);
    if (name) {
      out.push(name);
    }
  }
  return out;
}
function isEmptyRegistration(r) {
  return (r.sectors?.length ?? 0) === 0 && (r.access?.length ?? 0) === 0 && (r.consumes?.length ?? 0) === 0 && (r.produces?.length ?? 0) === 0 && (r.declaresShape?.length ?? 0) === 0 && (r.sectorUse?.length ?? 0) === 0;
}
function describeError(err) {
  if (err instanceof RdfFetchError) {
    return err.status ? `Failed to fetch registration (HTTP ${err.status}): ${err.message}` : `Failed to parse registration: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// src/list.ts
async function list(source, options = {}) {
  const fetchOpts = options.fetch ? { fetch: options.fetch } : {};
  const { dataset } = await fetchRdf(source, fetchOpts);
  const inline = registrationsFromDataset(dataset, source);
  const mode = options.followContainer ?? "auto";
  const shouldFollow = mode === true || mode === "auto" && inline.length === 0;
  if (!shouldFollow) {
    return inline;
  }
  const memberUrls = containerMembers(dataset, source);
  const out = [...inline];
  for (const member of memberUrls) {
    try {
      const { dataset: memberDs } = await fetchRdf(member, fetchOpts);
      out.push(...registrationsFromDataset(memberDs, member));
    } catch {
    }
  }
  return out;
}
function registrationsFromDataset(dataset, source) {
  const fed = wrap(dataset);
  return fed.apps().map((app) => {
    const result = verifyApp(app);
    const registration = result.registration ?? { id: app.value };
    return {
      id: app.value,
      source,
      registration,
      valid: result.valid,
      issues: result.issues
    };
  });
}
function containerMembers(dataset, source) {
  const container = new ContainerDataset(dataset, DataFactory2).container;
  if (!container) {
    return [];
  }
  return [...container.contains].map((resource) => new URL(resource.id, source).toString());
}

// src/serialize.ts
import { Writer } from "n3";
var PREFIXES = {
  fedapp: FEDAPP,
  acl: ACL,
  sh: SHACL,
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

// src/selfDescribe.ts
function selfDescribe(app) {
  if (!app.id) {
    throw new TypeError("selfDescribe: AppRegistration.id (the client_id IRI) is required.");
  }
  const builder = new FederationBuilder();
  const node = builder.app(app.id);
  for (const sector of app.sectors ?? []) {
    node.addSector(sector);
  }
  for (const mode of app.access ?? []) {
    node.addAccess(ACL_MODES[mode]);
  }
  for (const shape of app.consumes ?? []) {
    node.addConsumes(shape);
  }
  for (const shape of app.produces ?? []) {
    node.addProduces(shape);
  }
  for (const shape of app.declaresShape ?? []) {
    node.addDeclaresShape(shape);
  }
  for (const su of app.sectorUse ?? []) {
    const suNode = node.linkSectorUse();
    suNode.addSector(su.sector);
    for (const mode of su.access) {
      suNode.addAccess(ACL_MODES[mode]);
    }
    for (const shape of su.consumes ?? []) {
      suNode.addConsumes(shape);
    }
    for (const shape of su.produces ?? []) {
      suNode.addProduces(shape);
    }
  }
  const quads = builder.quads();
  return {
    quads,
    toString: (format) => serialize(quads, format)
  };
}
export {
  ACL_MODES,
  FEDAPP,
  KNOWN_SECTOR_SLUGS,
  VALID_ACCESS_MODE_IRIS,
  accessModeName,
  list,
  sectorIri,
  selfDescribe,
  serialize,
  verify,
  verifyDataset
};
//# sourceMappingURL=index.js.map
