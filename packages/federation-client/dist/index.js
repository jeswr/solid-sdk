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
  constructor(message2, options = {}) {
    super(message2);
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

// node_modules/@jeswr/federation-registry/dist/index.js
import contentType2 from "content-type";
import { Store as Store3, StreamParser as StreamParser2 } from "n3";
import { JsonLdParser as JsonLdParser2 } from "jsonld-streaming-parser";
import { Writer } from "n3";
import {
  BlankNodeFrom as BlankNodeFrom2,
  DatasetWrapper as DatasetWrapper2,
  LiteralFrom,
  NamedNodeFrom as NamedNodeFrom2,
  SetFrom as SetFrom2,
  TermAs as TermAs2,
  TermFrom as TermFrom2,
  TermWrapper as TermWrapper2
} from "@rdfjs/wrapper";
import { DataFactory as DataFactory3, Store as Store22 } from "n3";
var RdfFetchError2 = class extends Error {
  /** The original cause, if any (e.g. a network error or parser exception). */
  cause;
  /** HTTP status code from a non-2xx response, if applicable. */
  status;
  /** The final request URL (after redirects), if known. */
  url;
  /** Raw `Content-Type` header from the response, if known. */
  contentType;
  constructor(message2, options = {}) {
    super(message2);
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
var SUPPORTED_RDF_MEDIA_TYPES2 = [
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig",
  "application/ld+json"
];
var N3_FAMILY2 = /* @__PURE__ */ new Set([
  "text/turtle",
  "application/n-triples",
  "application/n-quads",
  "application/trig"
]);
var JSON_LD_FAMILY2 = /* @__PURE__ */ new Set([
  "application/ld+json"
]);
async function parseRdf2(body, contentTypeHeader, options = {}) {
  const rawHeader = contentTypeHeader ?? "text/turtle";
  let mediaType;
  try {
    mediaType = contentType2.parse(rawHeader).type;
  } catch (cause) {
    throw new RdfFetchError2(`Invalid Content-Type header: "${rawHeader}".`, { cause, contentType: rawHeader });
  }
  const baseIRI = options.baseIRI;
  let parser;
  if (N3_FAMILY2.has(mediaType)) {
    parser = new StreamParser2({
      format: mediaType,
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else if (JSON_LD_FAMILY2.has(mediaType)) {
    parser = new JsonLdParser2({
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else {
    throw new RdfFetchError2(`Unsupported RDF media type: "${mediaType}". Supported: ${SUPPORTED_RDF_MEDIA_TYPES2.join(", ")}.`, { contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
  const storePromise = collectIntoStore2(parser);
  try {
    await pumpBody2(parser, body);
    return await storePromise;
  } catch (cause) {
    if (cause instanceof RdfFetchError2)
      throw cause;
    throw new RdfFetchError2(`Failed to parse ${mediaType} body${baseIRI ? ` at ${baseIRI}` : ""}.`, { cause, contentType: rawHeader, ...baseIRI !== void 0 && { url: baseIRI } });
  }
}
function collectIntoStore2(parser) {
  return new Promise((resolve, reject) => {
    const store = new Store3();
    parser.on("data", (quad) => {
      store.addQuad(quad);
    });
    parser.on("error", reject);
    parser.on("end", () => {
      resolve(store);
    });
  });
}
async function pumpBody2(parser, body) {
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
        await waitForDrain2(parser);
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
function waitForDrain2(parser) {
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
var ACCEPT2 = "text/turtle, application/ld+json;q=0.9";
async function fetchRdf2(url, options = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const headers = new Headers(options.headers);
  headers.set("accept", ACCEPT2);
  let response;
  try {
    response = await fetchImpl(url, {
      headers,
      ...options.signal !== void 0 && { signal: options.signal }
    });
  } catch (cause) {
    throw new RdfFetchError2(`Network error fetching ${url}: ${errorMessage2(cause)}`, { cause, url });
  }
  if (!response.ok) {
    throw new RdfFetchError2(`HTTP ${response.status} ${response.statusText || ""} fetching ${url}.`.trim(), {
      status: response.status,
      url: response.url || url,
      contentType: response.headers.get("content-type") ?? void 0
    });
  }
  const dataset = await parseRdf2(response.body ?? "", response.headers.get("content-type"), { baseIRI: response.url || url });
  return { dataset, headers: response.headers };
}
function errorMessage2(cause) {
  if (cause instanceof Error)
    return cause.message;
  return String(cause);
}
function classifyFetchError(err) {
  if (err instanceof RdfFetchError2 && !err.status && err.contentType !== void 0) {
    return "parse-failed";
  }
  return "fetch-failed";
}
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
  for (const [name, statusIri] of Object.entries(MEMBERSHIP_STATUS)) {
    if (statusIri === iri) {
      return name;
    }
  }
  return void 0;
}
function validIris2(terms, subject, predicate, issues) {
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
function membershipNodeToView(node, issues) {
  const id = node.value;
  const apps = validIris2(node.apps, id, FEDREG_APP, issues);
  const statusIris = validIris2(node.statuses, id, FEDREG_STATUS, issues);
  const assertedBy = validIris2(node.assertedBy, id, FEDREG_ASSERTED_BY, issues);
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
  const statusIri = statusIris[0];
  if (assertedBy.length === 0) {
    issues.push({
      code: "membership-missing-asserted-by",
      message: "fedreg:Membership has no fedreg:assertedBy \u2014 a registry assertion MUST name the authority that vouches for it (else it is indistinguishable from a self-asserted claim).",
      subject: id
    });
  }
  const membership = {
    id,
    app: apps[0] ?? "",
    ...statusIri !== void 0 ? { statusIri, status: statusName(statusIri) } : {},
    ...assertedBy.length > 0 ? { assertedBy } : {},
    ...node.asserted !== void 0 ? { asserted: node.asserted } : {}
  };
  return membership;
}
function verifyMembershipNode(node) {
  const issues = [];
  const membership = membershipNodeToView(node, issues);
  return { valid: issues.length === 0, membership, issues };
}
function storageNodeToView(node, issues) {
  const id = node.value;
  const acceptsSpec2 = validIris2(node.acceptsSpec, id, FEDREG_ACCEPTS_SPEC, issues);
  const supportsSector = validIris2(node.supportsSector, id, FEDREG_SUPPORTS_SECTOR, issues);
  const storageIris = validIris2(node.storage, id, FEDREG_STORAGE, issues);
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
function objectTerms(node, predicate) {
  return SetFrom2.subjectPredicate(node, predicate, TermAs2.instance(TermWrapper2), TermFrom2.instance);
}
var MembershipNode = class extends TermWrapper2 {
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
var StorageNode = class extends TermWrapper2 {
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
var RegistryNode = class extends TermWrapper2 {
  /** The `fedreg:Membership` nodes linked via `fedreg:member`. */
  get members() {
    return SetFrom2.subjectPredicate(
      this,
      FEDREG_MEMBER,
      TermAs2.instance(MembershipNode),
      TermFrom2.instance
    );
  }
};
var RegistryDataset = class extends DatasetWrapper2 {
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
function wrap2(dataset) {
  return new RegistryDataset(dataset, DataFactory3);
}
async function loadDataset(input, options) {
  if (options.body !== void 0) {
    try {
      const dataset = await parseRdf2(options.body, options.bodyContentType ?? "text/turtle", {
        baseIRI: options.baseIRI ?? input
      });
      return { dataset };
    } catch (err) {
      return { issue: { code: "parse-failed", message: describeError2(err), subject: input } };
    }
  }
  try {
    const fetched = await fetchRdf2(input, options.fetch ? { fetch: options.fetch } : {});
    return { dataset: fetched.dataset };
  } catch (err) {
    return {
      issue: { code: classifyFetchError(err), message: describeError2(err), subject: input }
    };
  }
}
async function parseRegistry(input, options = {}) {
  const loaded = await loadDataset(input, options);
  if ("issue" in loaded) {
    return { members: [], valid: false, issues: [loaded.issue] };
  }
  return parseRegistryDataset(loaded.dataset, input);
}
function parseRegistryDataset(dataset, expectedId) {
  const fed = wrap2(dataset);
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
function describeError2(err) {
  if (err instanceof RdfFetchError2) {
    return err.status ? `Failed to fetch registry document (HTTP ${err.status}): ${err.message}` : `Failed to parse registry document: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
async function parseStorage(input, options = {}) {
  let dataset;
  if (options.body !== void 0) {
    try {
      dataset = await parseRdf2(options.body, options.bodyContentType ?? "text/turtle", {
        baseIRI: options.baseIRI ?? input
      });
    } catch (err) {
      return {
        valid: false,
        issues: [{ code: "parse-failed", message: describeError22(err), subject: input }]
      };
    }
  } else {
    try {
      const fetched = await fetchRdf2(input, options.fetch ? { fetch: options.fetch } : {});
      dataset = fetched.dataset;
    } catch (err) {
      return {
        valid: false,
        issues: [{ code: classifyFetchError(err), message: describeError22(err), subject: input }]
      };
    }
  }
  return parseStorageDataset(dataset, input);
}
function parseStorageDataset(dataset, expectedId) {
  const fed = wrap2(dataset);
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
function describeError22(err) {
  if (err instanceof RdfFetchError2) {
    return err.status ? `Failed to fetch storage description (HTTP ${err.status}): ${err.message}` : `Failed to parse storage description: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

// node_modules/@jeswr/guarded-fetch/dist/index.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var require_ipaddr = __commonJS({
  "node_modules/ipaddr.js/lib/ipaddr.js"(exports, module) {
    (function(root) {
      "use strict";
      const ipv4Part = "(0?\\d+|0x[a-f0-9]+)";
      const ipv4Regexes = {
        fourOctet: new RegExp(`^${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}$`, "i"),
        threeOctet: new RegExp(`^${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}$`, "i"),
        twoOctet: new RegExp(`^${ipv4Part}\\.${ipv4Part}$`, "i"),
        longValue: new RegExp(`^${ipv4Part}$`, "i")
      };
      const octalRegex = new RegExp(`^0[0-7]+$`, "i");
      const hexRegex = new RegExp(`^0x[a-f0-9]+$`, "i");
      const zoneIndex = "%[0-9a-z]{1,}";
      const ipv6Part = "(?:[0-9a-f]+::?)+";
      const ipv6Regexes = {
        zoneIndex: new RegExp(zoneIndex, "i"),
        "native": new RegExp(`^(::)?(${ipv6Part})?([0-9a-f]+)?(::)?(${zoneIndex})?$`, "i"),
        deprecatedTransitional: new RegExp(`^(?:::)(${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}(${zoneIndex})?)$`, "i"),
        transitional: new RegExp(`^((?:${ipv6Part})|(?:::)(?:${ipv6Part})?)${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}(${zoneIndex})?$`, "i")
      };
      function expandIPv6(string, parts) {
        if (string.indexOf("::") !== string.lastIndexOf("::")) {
          return null;
        }
        let colonCount = 0;
        let lastColon = -1;
        let zoneId = (string.match(ipv6Regexes.zoneIndex) || [])[0];
        let replacement, replacementCount;
        if (zoneId) {
          zoneId = zoneId.substring(1);
          string = string.replace(/%.+$/, "");
        }
        while ((lastColon = string.indexOf(":", lastColon + 1)) >= 0) {
          colonCount++;
        }
        if (string.substr(0, 2) === "::") {
          colonCount--;
        }
        if (string.substr(-2, 2) === "::") {
          colonCount--;
        }
        if (colonCount > parts) {
          return null;
        }
        replacementCount = parts - colonCount;
        replacement = ":";
        while (replacementCount--) {
          replacement += "0:";
        }
        string = string.replace("::", replacement);
        if (string[0] === ":") {
          string = string.slice(1);
        }
        if (string[string.length - 1] === ":") {
          string = string.slice(0, -1);
        }
        parts = function() {
          const ref = string.split(":");
          const results = [];
          for (let i = 0; i < ref.length; i++) {
            results.push(parseInt(ref[i], 16));
          }
          return results;
        }();
        return {
          parts,
          zoneId
        };
      }
      function matchCIDR(first, second, partSize, cidrBits) {
        if (first.length !== second.length) {
          throw new Error("ipaddr: cannot match CIDR for objects with different lengths");
        }
        let part = 0;
        let shift;
        while (cidrBits > 0) {
          shift = partSize - cidrBits;
          if (shift < 0) {
            shift = 0;
          }
          if (first[part] >> shift !== second[part] >> shift) {
            return false;
          }
          cidrBits -= partSize;
          part += 1;
        }
        return true;
      }
      function parseIntAuto(string) {
        if (hexRegex.test(string)) {
          return parseInt(string, 16);
        }
        if (string[0] === "0" && !isNaN(parseInt(string[1], 10))) {
          if (octalRegex.test(string)) {
            return parseInt(string, 8);
          }
          throw new Error(`ipaddr: cannot parse ${string} as octal`);
        }
        return parseInt(string, 10);
      }
      function padPart(part, length) {
        while (part.length < length) {
          part = `0${part}`;
        }
        return part;
      }
      const ipaddr2 = {};
      ipaddr2.IPv4 = function() {
        function IPv4(octets) {
          if (octets.length !== 4) {
            throw new Error("ipaddr: ipv4 octet count should be 4");
          }
          let i, octet;
          for (i = 0; i < octets.length; i++) {
            octet = octets[i];
            if (!(0 <= octet && octet <= 255)) {
              throw new Error("ipaddr: ipv4 octet should fit in 8 bits");
            }
          }
          this.octets = octets;
        }
        IPv4.prototype.SpecialRanges = {
          unspecified: [[new IPv4([0, 0, 0, 0]), 8]],
          broadcast: [[new IPv4([255, 255, 255, 255]), 32]],
          // RFC3171
          multicast: [[new IPv4([224, 0, 0, 0]), 4]],
          // RFC3927
          linkLocal: [[new IPv4([169, 254, 0, 0]), 16]],
          // RFC5735
          loopback: [[new IPv4([127, 0, 0, 0]), 8]],
          // RFC6598
          carrierGradeNat: [[new IPv4([100, 64, 0, 0]), 10]],
          // RFC1918
          "private": [
            [new IPv4([10, 0, 0, 0]), 8],
            [new IPv4([172, 16, 0, 0]), 12],
            [new IPv4([192, 168, 0, 0]), 16]
          ],
          // Reserved and testing-only ranges; RFCs 5735, 5737, 2544, 1700
          reserved: [
            [new IPv4([192, 0, 0, 0]), 24],
            [new IPv4([192, 0, 2, 0]), 24],
            [new IPv4([192, 88, 99, 0]), 24],
            [new IPv4([198, 18, 0, 0]), 15],
            [new IPv4([198, 51, 100, 0]), 24],
            [new IPv4([203, 0, 113, 0]), 24],
            [new IPv4([240, 0, 0, 0]), 4]
          ],
          // RFC7534, RFC7535
          as112: [
            [new IPv4([192, 175, 48, 0]), 24],
            [new IPv4([192, 31, 196, 0]), 24]
          ],
          // RFC7450
          amt: [
            [new IPv4([192, 52, 193, 0]), 24]
          ]
        };
        IPv4.prototype.kind = function() {
          return "ipv4";
        };
        IPv4.prototype.match = function(other, cidrRange) {
          let ref;
          if (cidrRange === void 0) {
            ref = other;
            other = ref[0];
            cidrRange = ref[1];
          }
          if (other.kind() !== "ipv4") {
            throw new Error("ipaddr: cannot match ipv4 address with non-ipv4 one");
          }
          return matchCIDR(this.octets, other.octets, 8, cidrRange);
        };
        IPv4.prototype.prefixLengthFromSubnetMask = function() {
          let cidr = 0;
          let stop = false;
          const zerotable = {
            0: 8,
            128: 7,
            192: 6,
            224: 5,
            240: 4,
            248: 3,
            252: 2,
            254: 1,
            255: 0
          };
          let i, octet, zeros;
          for (i = 3; i >= 0; i -= 1) {
            octet = this.octets[i];
            if (octet in zerotable) {
              zeros = zerotable[octet];
              if (stop && zeros !== 0) {
                return null;
              }
              if (zeros !== 8) {
                stop = true;
              }
              cidr += zeros;
            } else {
              return null;
            }
          }
          return 32 - cidr;
        };
        IPv4.prototype.range = function() {
          return ipaddr2.subnetMatch(this, this.SpecialRanges);
        };
        IPv4.prototype.toByteArray = function() {
          return this.octets.slice(0);
        };
        IPv4.prototype.toIPv4MappedAddress = function() {
          return ipaddr2.IPv6.parse(`::ffff:${this.toString()}`);
        };
        IPv4.prototype.toNormalizedString = function() {
          return this.toString();
        };
        IPv4.prototype.toString = function() {
          return this.octets.join(".");
        };
        return IPv4;
      }();
      ipaddr2.IPv4.broadcastAddressFromCIDR = function(string) {
        try {
          const cidr = this.parseCIDR(string);
          const ipInterfaceOctets = cidr[0].toByteArray();
          const subnetMaskOctets = this.subnetMaskFromPrefixLength(cidr[1]).toByteArray();
          const octets = [];
          let i = 0;
          while (i < 4) {
            octets.push(parseInt(ipInterfaceOctets[i], 10) | parseInt(subnetMaskOctets[i], 10) ^ 255);
            i++;
          }
          return new this(octets);
        } catch (e) {
          throw new Error("ipaddr: the address does not have IPv4 CIDR format");
        }
      };
      ipaddr2.IPv4.isIPv4 = function(string) {
        return this.parser(string) !== null;
      };
      ipaddr2.IPv4.isValid = function(string) {
        try {
          new this(this.parser(string));
          return true;
        } catch (e) {
          return false;
        }
      };
      ipaddr2.IPv4.isValidCIDR = function(string) {
        try {
          this.parseCIDR(string);
          return true;
        } catch (e) {
          return false;
        }
      };
      ipaddr2.IPv4.isValidFourPartDecimal = function(string) {
        if (ipaddr2.IPv4.isValid(string) && string.match(/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){3}$/)) {
          return true;
        } else {
          return false;
        }
      };
      ipaddr2.IPv4.isValidCIDRFourPartDecimal = function(string) {
        const match = string.match(/^(.+)\/(\d+)$/);
        if (!ipaddr2.IPv4.isValidCIDR(string) || !match) {
          return false;
        }
        return ipaddr2.IPv4.isValidFourPartDecimal(match[1]);
      };
      ipaddr2.IPv4.networkAddressFromCIDR = function(string) {
        let cidr, i, ipInterfaceOctets, octets, subnetMaskOctets;
        try {
          cidr = this.parseCIDR(string);
          ipInterfaceOctets = cidr[0].toByteArray();
          subnetMaskOctets = this.subnetMaskFromPrefixLength(cidr[1]).toByteArray();
          octets = [];
          i = 0;
          while (i < 4) {
            octets.push(parseInt(ipInterfaceOctets[i], 10) & parseInt(subnetMaskOctets[i], 10));
            i++;
          }
          return new this(octets);
        } catch (e) {
          throw new Error("ipaddr: the address does not have IPv4 CIDR format");
        }
      };
      ipaddr2.IPv4.parse = function(string) {
        const parts = this.parser(string);
        if (parts === null) {
          throw new Error("ipaddr: string is not formatted like an IPv4 Address");
        }
        return new this(parts);
      };
      ipaddr2.IPv4.parseCIDR = function(string) {
        let match;
        if (match = string.match(/^(.+)\/(\d+)$/)) {
          const maskLength = parseInt(match[2]);
          if (maskLength >= 0 && maskLength <= 32) {
            const parsed = [this.parse(match[1]), maskLength];
            Object.defineProperty(parsed, "toString", {
              value: function() {
                return this.join("/");
              }
            });
            return parsed;
          }
        }
        throw new Error("ipaddr: string is not formatted like an IPv4 CIDR range");
      };
      ipaddr2.IPv4.parser = function(string) {
        let match, part, value;
        if (match = string.match(ipv4Regexes.fourOctet)) {
          return function() {
            const ref = match.slice(1, 6);
            const results = [];
            for (let i = 0; i < ref.length; i++) {
              part = ref[i];
              results.push(parseIntAuto(part));
            }
            return results;
          }();
        } else if (match = string.match(ipv4Regexes.longValue)) {
          value = parseIntAuto(match[1]);
          if (value > 4294967295 || value < 0) {
            throw new Error("ipaddr: address outside defined range");
          }
          return function() {
            const results = [];
            let shift;
            for (shift = 0; shift <= 24; shift += 8) {
              results.push(value >> shift & 255);
            }
            return results;
          }().reverse();
        } else if (match = string.match(ipv4Regexes.twoOctet)) {
          return function() {
            const ref = match.slice(1, 4);
            const results = [];
            value = parseIntAuto(ref[1]);
            if (value > 16777215 || value < 0) {
              throw new Error("ipaddr: address outside defined range");
            }
            results.push(parseIntAuto(ref[0]));
            results.push(value >> 16 & 255);
            results.push(value >> 8 & 255);
            results.push(value & 255);
            return results;
          }();
        } else if (match = string.match(ipv4Regexes.threeOctet)) {
          return function() {
            const ref = match.slice(1, 5);
            const results = [];
            value = parseIntAuto(ref[2]);
            if (value > 65535 || value < 0) {
              throw new Error("ipaddr: address outside defined range");
            }
            results.push(parseIntAuto(ref[0]));
            results.push(parseIntAuto(ref[1]));
            results.push(value >> 8 & 255);
            results.push(value & 255);
            return results;
          }();
        } else {
          return null;
        }
      };
      ipaddr2.IPv4.subnetMaskFromPrefixLength = function(prefix) {
        prefix = parseInt(prefix);
        if (prefix < 0 || prefix > 32) {
          throw new Error("ipaddr: invalid IPv4 prefix length");
        }
        const octets = [0, 0, 0, 0];
        let j = 0;
        const filledOctetCount = Math.floor(prefix / 8);
        while (j < filledOctetCount) {
          octets[j] = 255;
          j++;
        }
        if (filledOctetCount < 4) {
          octets[filledOctetCount] = Math.pow(2, prefix % 8) - 1 << 8 - prefix % 8;
        }
        return new this(octets);
      };
      ipaddr2.IPv6 = function() {
        function IPv6(parts, zoneId) {
          let i, part;
          if (parts.length === 16) {
            this.parts = [];
            for (i = 0; i <= 14; i += 2) {
              this.parts.push(parts[i] << 8 | parts[i + 1]);
            }
          } else if (parts.length === 8) {
            this.parts = parts;
          } else {
            throw new Error("ipaddr: ipv6 part count should be 8 or 16");
          }
          for (i = 0; i < this.parts.length; i++) {
            part = this.parts[i];
            if (!(0 <= part && part <= 65535)) {
              throw new Error("ipaddr: ipv6 part should fit in 16 bits");
            }
          }
          if (zoneId) {
            this.zoneId = zoneId;
          }
        }
        IPv6.prototype.SpecialRanges = {
          // RFC4291, here and after
          unspecified: [new IPv6([0, 0, 0, 0, 0, 0, 0, 0]), 128],
          linkLocal: [new IPv6([65152, 0, 0, 0, 0, 0, 0, 0]), 10],
          multicast: [new IPv6([65280, 0, 0, 0, 0, 0, 0, 0]), 8],
          loopback: [new IPv6([0, 0, 0, 0, 0, 0, 0, 1]), 128],
          uniqueLocal: [new IPv6([64512, 0, 0, 0, 0, 0, 0, 0]), 7],
          ipv4Mapped: [new IPv6([0, 0, 0, 0, 0, 65535, 0, 0]), 96],
          // RFC3879
          deprecatedSiteLocal: [new IPv6([65216, 0, 0, 0, 0, 0, 0, 0]), 10],
          // RFC6666
          discard: [new IPv6([256, 0, 0, 0, 0, 0, 0, 0]), 64],
          // RFC6145
          rfc6145: [new IPv6([0, 0, 0, 0, 65535, 0, 0, 0]), 96],
          rfc6052: [
            // RFC6052
            [new IPv6([100, 65435, 0, 0, 0, 0, 0, 0]), 96],
            // RFC8215
            [new IPv6([100, 65435, 1, 0, 0, 0, 0, 0]), 48]
          ],
          // RFC3056
          "6to4": [new IPv6([8194, 0, 0, 0, 0, 0, 0, 0]), 16],
          // RFC6052, RFC6146
          teredo: [new IPv6([8193, 0, 0, 0, 0, 0, 0, 0]), 32],
          // RFC5180
          benchmarking: [new IPv6([8193, 2, 0, 0, 0, 0, 0, 0]), 48],
          // RFC7450
          amt: [new IPv6([8193, 3, 0, 0, 0, 0, 0, 0]), 32],
          as112v6: [
            // RFC7535
            [new IPv6([8193, 4, 274, 0, 0, 0, 0, 0]), 48],
            // RFC7534
            [new IPv6([9760, 79, 32768, 0, 0, 0, 0, 0]), 48]
          ],
          // RFC4843
          deprecatedOrchid: [new IPv6([8193, 16, 0, 0, 0, 0, 0, 0]), 28],
          // RFC7343
          orchid2: [new IPv6([8193, 32, 0, 0, 0, 0, 0, 0]), 28],
          // RFC9374
          droneRemoteIdProtocolEntityTags: [new IPv6([8193, 48, 0, 0, 0, 0, 0, 0]), 28],
          // RFC9602
          segmentRouting: [new IPv6([24320, 0, 0, 0, 0, 0, 0, 0]), 16],
          reserved: [
            // RFC3849
            [new IPv6([8193, 0, 0, 0, 0, 0, 0, 0]), 23],
            // RFC2928
            [new IPv6([8193, 3512, 0, 0, 0, 0, 0, 0]), 32],
            // RFC9637
            [new IPv6([16383, 0, 0, 0, 0, 0, 0, 0]), 20]
          ]
        };
        IPv6.prototype.isIPv4MappedAddress = function() {
          return this.range() === "ipv4Mapped";
        };
        IPv6.prototype.kind = function() {
          return "ipv6";
        };
        IPv6.prototype.match = function(other, cidrRange) {
          let ref;
          if (cidrRange === void 0) {
            ref = other;
            other = ref[0];
            cidrRange = ref[1];
          }
          if (other.kind() !== "ipv6") {
            throw new Error("ipaddr: cannot match ipv6 address with non-ipv6 one");
          }
          return matchCIDR(this.parts, other.parts, 16, cidrRange);
        };
        IPv6.prototype.prefixLengthFromSubnetMask = function() {
          let cidr = 0;
          let stop = false;
          const zerotable = {
            0: 16,
            32768: 15,
            49152: 14,
            57344: 13,
            61440: 12,
            63488: 11,
            64512: 10,
            65024: 9,
            65280: 8,
            65408: 7,
            65472: 6,
            65504: 5,
            65520: 4,
            65528: 3,
            65532: 2,
            65534: 1,
            65535: 0
          };
          let part, zeros;
          for (let i = 7; i >= 0; i -= 1) {
            part = this.parts[i];
            if (part in zerotable) {
              zeros = zerotable[part];
              if (stop && zeros !== 0) {
                return null;
              }
              if (zeros !== 16) {
                stop = true;
              }
              cidr += zeros;
            } else {
              return null;
            }
          }
          return 128 - cidr;
        };
        IPv6.prototype.range = function() {
          return ipaddr2.subnetMatch(this, this.SpecialRanges);
        };
        IPv6.prototype.toByteArray = function() {
          let part;
          const bytes = [];
          const ref = this.parts;
          for (let i = 0; i < ref.length; i++) {
            part = ref[i];
            bytes.push(part >> 8);
            bytes.push(part & 255);
          }
          return bytes;
        };
        IPv6.prototype.toFixedLengthString = function() {
          const addr = function() {
            const results = [];
            for (let i = 0; i < this.parts.length; i++) {
              results.push(padPart(this.parts[i].toString(16), 4));
            }
            return results;
          }.call(this).join(":");
          let suffix = "";
          if (this.zoneId) {
            suffix = `%${this.zoneId}`;
          }
          return addr + suffix;
        };
        IPv6.prototype.toIPv4Address = function() {
          if (!this.isIPv4MappedAddress()) {
            throw new Error("ipaddr: trying to convert a generic ipv6 address to ipv4");
          }
          const ref = this.parts.slice(-2);
          const high = ref[0];
          const low = ref[1];
          return new ipaddr2.IPv4([high >> 8, high & 255, low >> 8, low & 255]);
        };
        IPv6.prototype.toNormalizedString = function() {
          const addr = function() {
            const results = [];
            for (let i = 0; i < this.parts.length; i++) {
              results.push(this.parts[i].toString(16));
            }
            return results;
          }.call(this).join(":");
          let suffix = "";
          if (this.zoneId) {
            suffix = `%${this.zoneId}`;
          }
          return addr + suffix;
        };
        IPv6.prototype.toRFC5952String = function() {
          const regex = /((^|:)(0(:|$)){2,})/g;
          const string = this.toNormalizedString();
          let bestMatchIndex = 0;
          let bestMatchLength = -1;
          let match;
          while (match = regex.exec(string)) {
            if (match[0].length > bestMatchLength) {
              bestMatchIndex = match.index;
              bestMatchLength = match[0].length;
            }
          }
          if (bestMatchLength < 0) {
            return string;
          }
          return `${string.substring(0, bestMatchIndex)}::${string.substring(bestMatchIndex + bestMatchLength)}`;
        };
        IPv6.prototype.toString = function() {
          return this.toRFC5952String();
        };
        return IPv6;
      }();
      ipaddr2.IPv6.broadcastAddressFromCIDR = function(string) {
        try {
          const cidr = this.parseCIDR(string);
          const ipInterfaceOctets = cidr[0].toByteArray();
          const subnetMaskOctets = this.subnetMaskFromPrefixLength(cidr[1]).toByteArray();
          const octets = [];
          let i = 0;
          while (i < 16) {
            octets.push(parseInt(ipInterfaceOctets[i], 10) | parseInt(subnetMaskOctets[i], 10) ^ 255);
            i++;
          }
          return new this(octets);
        } catch (e) {
          throw new Error(`ipaddr: the address does not have IPv6 CIDR format (${e})`);
        }
      };
      ipaddr2.IPv6.isIPv6 = function(string) {
        return this.parser(string) !== null;
      };
      ipaddr2.IPv6.isValid = function(string) {
        if (typeof string === "string" && string.indexOf(":") === -1) {
          return false;
        }
        try {
          const addr = this.parser(string);
          new this(addr.parts, addr.zoneId);
          return true;
        } catch (e) {
          return false;
        }
      };
      ipaddr2.IPv6.isValidCIDR = function(string) {
        if (typeof string === "string" && string.indexOf(":") === -1) {
          return false;
        }
        try {
          this.parseCIDR(string);
          return true;
        } catch (e) {
          return false;
        }
      };
      ipaddr2.IPv6.networkAddressFromCIDR = function(string) {
        let cidr, i, ipInterfaceOctets, octets, subnetMaskOctets;
        try {
          cidr = this.parseCIDR(string);
          ipInterfaceOctets = cidr[0].toByteArray();
          subnetMaskOctets = this.subnetMaskFromPrefixLength(cidr[1]).toByteArray();
          octets = [];
          i = 0;
          while (i < 16) {
            octets.push(parseInt(ipInterfaceOctets[i], 10) & parseInt(subnetMaskOctets[i], 10));
            i++;
          }
          return new this(octets);
        } catch (e) {
          throw new Error(`ipaddr: the address does not have IPv6 CIDR format (${e})`);
        }
      };
      ipaddr2.IPv6.parse = function(string) {
        const addr = this.parser(string);
        if (addr.parts === null) {
          throw new Error("ipaddr: string is not formatted like an IPv6 Address");
        }
        return new this(addr.parts, addr.zoneId);
      };
      ipaddr2.IPv6.parseCIDR = function(string) {
        let maskLength, match, parsed;
        if (match = string.match(/^(.+)\/(\d+)$/)) {
          maskLength = parseInt(match[2]);
          if (maskLength >= 0 && maskLength <= 128) {
            parsed = [this.parse(match[1]), maskLength];
            Object.defineProperty(parsed, "toString", {
              value: function() {
                return this.join("/");
              }
            });
            return parsed;
          }
        }
        throw new Error("ipaddr: string is not formatted like an IPv6 CIDR range");
      };
      ipaddr2.IPv6.parser = function(string) {
        let addr, i, match, octet, octets, zoneId;
        if (match = string.match(ipv6Regexes.deprecatedTransitional)) {
          return this.parser(`::ffff:${match[1]}`);
        }
        if (ipv6Regexes.native.test(string)) {
          return expandIPv6(string, 8);
        }
        if (match = string.match(ipv6Regexes.transitional)) {
          zoneId = match[6] || "";
          addr = match[1];
          if (!match[1].endsWith("::")) {
            addr = addr.slice(0, -1);
          }
          addr = expandIPv6(addr + zoneId, 6);
          if (addr.parts) {
            octets = [
              parseInt(match[2]),
              parseInt(match[3]),
              parseInt(match[4]),
              parseInt(match[5])
            ];
            for (i = 0; i < octets.length; i++) {
              octet = octets[i];
              if (!(0 <= octet && octet <= 255)) {
                return null;
              }
            }
            addr.parts.push(octets[0] << 8 | octets[1]);
            addr.parts.push(octets[2] << 8 | octets[3]);
            return {
              parts: addr.parts,
              zoneId: addr.zoneId
            };
          }
        }
        return null;
      };
      ipaddr2.IPv6.subnetMaskFromPrefixLength = function(prefix) {
        prefix = parseInt(prefix);
        if (prefix < 0 || prefix > 128) {
          throw new Error("ipaddr: invalid IPv6 prefix length");
        }
        const octets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        let j = 0;
        const filledOctetCount = Math.floor(prefix / 8);
        while (j < filledOctetCount) {
          octets[j] = 255;
          j++;
        }
        if (filledOctetCount < 16) {
          octets[filledOctetCount] = Math.pow(2, prefix % 8) - 1 << 8 - prefix % 8;
        }
        return new this(octets);
      };
      ipaddr2.fromByteArray = function(bytes) {
        const length = bytes.length;
        if (length === 4) {
          return new ipaddr2.IPv4(bytes);
        } else if (length === 16) {
          return new ipaddr2.IPv6(bytes);
        } else {
          throw new Error("ipaddr: the binary input is neither an IPv6 nor IPv4 address");
        }
      };
      ipaddr2.isValid = function(string) {
        return ipaddr2.IPv6.isValid(string) || ipaddr2.IPv4.isValid(string);
      };
      ipaddr2.isValidCIDR = function(string) {
        return ipaddr2.IPv6.isValidCIDR(string) || ipaddr2.IPv4.isValidCIDR(string);
      };
      ipaddr2.parse = function(string) {
        if (ipaddr2.IPv6.isValid(string)) {
          return ipaddr2.IPv6.parse(string);
        } else if (ipaddr2.IPv4.isValid(string)) {
          return ipaddr2.IPv4.parse(string);
        } else {
          throw new Error("ipaddr: the address has neither IPv6 nor IPv4 format");
        }
      };
      ipaddr2.parseCIDR = function(string) {
        try {
          return ipaddr2.IPv6.parseCIDR(string);
        } catch (e) {
          try {
            return ipaddr2.IPv4.parseCIDR(string);
          } catch (e2) {
            throw new Error("ipaddr: the address has neither IPv6 nor IPv4 CIDR format");
          }
        }
      };
      ipaddr2.process = function(string) {
        const addr = this.parse(string);
        if (addr.kind() === "ipv6" && addr.isIPv4MappedAddress()) {
          return addr.toIPv4Address();
        } else {
          return addr;
        }
      };
      ipaddr2.subnetMatch = function(address, rangeList, defaultName) {
        let i, rangeName, rangeSubnets, subnet;
        if (defaultName === void 0 || defaultName === null) {
          defaultName = "unicast";
        }
        for (rangeName in rangeList) {
          if (Object.prototype.hasOwnProperty.call(rangeList, rangeName)) {
            rangeSubnets = rangeList[rangeName];
            if (rangeSubnets[0] && !(rangeSubnets[0] instanceof Array)) {
              rangeSubnets = [rangeSubnets];
            }
            for (i = 0; i < rangeSubnets.length; i++) {
              subnet = rangeSubnets[i];
              if (address.kind() === subnet[0].kind() && address.match.apply(address, subnet)) {
                return rangeName;
              }
            }
          }
        }
        return defaultName;
      };
      if (typeof module !== "undefined" && module.exports) {
        module.exports = ipaddr2;
      } else {
        root.ipaddr = ipaddr2;
      }
    })(exports);
  }
});
var import_ipaddr = __toESM(require_ipaddr(), 1);
var IPV4_OCTET = /^(?:0|[1-9]\d{0,2})$/;
function classifyIpLiteral(value) {
  if (isIpv4Literal(value)) {
    return 4;
  }
  if (isIpv6Literal(value)) {
    return 6;
  }
  return 0;
}
function isIpv4Literal(value) {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }
  for (const part of parts) {
    if (!IPV4_OCTET.test(part)) {
      return false;
    }
    if (Number.parseInt(part, 10) > 255) {
      return false;
    }
  }
  return true;
}
function isIpv6Literal(value) {
  const pct = value.indexOf("%");
  if (pct !== -1) {
    const zone = value.slice(pct + 1);
    if (zone.length === 0 || zone.includes("%")) {
      return false;
    }
    return isIpv6Literal(value.slice(0, pct));
  }
  if (value.length === 0 || /[^0-9a-fA-F:.]/.test(value)) {
    return false;
  }
  const compressionMatches = value.match(/::/g);
  if (compressionMatches && compressionMatches.length > 1) {
    return false;
  }
  const hasCompression = value.includes("::");
  let core = value;
  let embeddedV4Groups = 0;
  const lastColon = value.lastIndexOf(":");
  const dot = value.indexOf(".");
  if (dot !== -1) {
    if (lastColon === -1 || lastColon > dot) {
      return false;
    }
    const v4 = value.slice(lastColon + 1);
    if (!isIpv4Literal(v4)) {
      return false;
    }
    core = value.slice(0, lastColon + 1);
    embeddedV4Groups = 2;
  }
  const requiredGroups = 8 - embeddedV4Groups;
  if (hasCompression) {
    const idx = core.indexOf("::");
    const headStr = core.slice(0, idx);
    let tailStr = core.slice(idx + 2);
    if (embeddedV4Groups > 0 && tailStr.endsWith(":")) {
      tailStr = tailStr.slice(0, -1);
    }
    const head = headStr === "" ? [] : headStr.split(":");
    const tail = tailStr === "" ? [] : tailStr.split(":");
    if (!head.every(isHextet) || !tail.every(isHextet)) {
      return false;
    }
    if (head.length + tail.length >= requiredGroups) {
      return false;
    }
    return true;
  }
  let groupsStr = core;
  if (embeddedV4Groups > 0 && groupsStr.endsWith(":")) {
    groupsStr = groupsStr.slice(0, -1);
  }
  const groups = groupsStr === "" ? [] : groupsStr.split(":");
  if (groups.length !== requiredGroups) {
    return false;
  }
  return groups.every(isHextet);
}
function isHextet(group) {
  return /^[0-9a-fA-F]{1,4}$/.test(group);
}
var PUBLIC_IPV4_RANGE = "unicast";
var PUBLIC_IPV6_RANGES = /* @__PURE__ */ new Set(["unicast", "reserved"]);
function isPublicAddress(address, allowLoopback) {
  let addr;
  try {
    addr = import_ipaddr.default.parse(address);
  } catch {
    return false;
  }
  if (addr.kind() === "ipv4") {
    return isPublicIpv4(addr, allowLoopback);
  }
  return isPublicIpv6(addr, allowLoopback);
}
function isPublicIpv4(addr, allowLoopback) {
  const range = addr.range();
  if (range === "loopback") {
    return allowLoopback;
  }
  return range === PUBLIC_IPV4_RANGE;
}
function isPublicIpv6(addr, allowLoopback) {
  const range = addr.range();
  if (range === "loopback") {
    return allowLoopback;
  }
  if (range === "ipv4Mapped") {
    return isPublicIpv4(addr.toIPv4Address(), allowLoopback);
  }
  if (range === "6to4") {
    const v4 = embeddedV4(addr, 2);
    return v4 !== void 0 && isPublicIpv4FromBytes(v4, allowLoopback);
  }
  if (range === "rfc6052") {
    const v4 = embeddedV4(addr, 12);
    return v4 !== void 0 && isPublicIpv4FromBytes(v4, allowLoopback);
  }
  return PUBLIC_IPV6_RANGES.has(range);
}
function embeddedV4(addr, startByte) {
  const bytes = addr.toByteArray();
  if (bytes.length !== 16) {
    return void 0;
  }
  const v4Bytes = bytes.slice(startByte, startByte + 4);
  if (v4Bytes.length !== 4) {
    return void 0;
  }
  try {
    return new import_ipaddr.default.IPv4(v4Bytes);
  } catch {
    return void 0;
  }
}
function isPublicIpv4FromBytes(addr, allowLoopback) {
  const range = addr.range();
  if (range === "loopback") {
    return allowLoopback;
  }
  return range === PUBLIC_IPV4_RANGE;
}
function isLoopbackAddress(address) {
  let addr;
  try {
    addr = import_ipaddr.default.parse(address);
  } catch {
    return false;
  }
  if (addr.kind() === "ipv4") {
    return addr.range() === "loopback";
  }
  const v6 = addr;
  if (v6.range() === "loopback") {
    return true;
  }
  if (v6.range() === "ipv4Mapped") {
    return v6.toIPv4Address().range() === "loopback";
  }
  return false;
}
var SsrfError = class extends Error {
  constructor(message2, options) {
    super(message2, options);
    this.name = "SsrfError";
  }
};
var GuardError = class extends Error {
  constructor(message2, options) {
    super(message2, options);
    this.name = "GuardError";
  }
};
var DEFAULT_HOSTNAME_DENYLIST = Object.freeze([
  "metadata.google.internal",
  "metadata.goog",
  ".internal",
  ".svc.cluster.local",
  ".cluster.local",
  ".vercel-internal.com"
]);
var DEFAULT_MAX_BYTES = 1024 * 1024;
var DEFAULT_TIMEOUT_MS = 1e4;
var DEFAULT_MAX_REDIRECTS = 5;
var NODE_DNS_SPECIFIER = ["node:dns", "promises"].join("/");
var NodeDnsUnavailableError = class extends Error {
};
async function loadNodeDnsLookup() {
  let mod;
  try {
    mod = await import(
      /* @vite-ignore */
      NODE_DNS_SPECIFIER
    );
  } catch (cause) {
    throw new NodeDnsUnavailableError(`node:dns/promises is not importable: ${message(cause)}`, {
      cause
    });
  }
  return (host) => mod.lookup(host, { all: true });
}
function createGuardedFetch(options = {}) {
  const guard = new SsrfGuard(options);
  return (input, init) => guard.fetch(input, init);
}
function guardedFetch(input, init) {
  return new SsrfGuard(init ?? {}).fetch(input, init);
}
function isDeniedHostname(hostname, denylist) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  for (const raw of denylist) {
    const entry = raw.toLowerCase();
    if (entry.startsWith(".")) {
      if (host === entry.slice(1) || host.endsWith(entry)) {
        return true;
      }
    } else if (host === entry || host.endsWith(`.${entry}`)) {
      return true;
    }
  }
  return false;
}
function normalizeHostForClassification(hostname) {
  const stripped = hostname.replace(/^\[|\]$/g, "");
  if (classifyIpLiteral(stripped) !== 0) {
    return stripped;
  }
  try {
    const reparsed = new URL(`http://${stripped}/`).hostname.replace(/^\[|\]$/g, "");
    return reparsed.toLowerCase();
  } catch {
    return stripped.toLowerCase();
  }
}
var SsrfGuard = class {
  fetcher;
  injectedLookup;
  maxBytes;
  timeoutMs;
  maxRedirects;
  allowLoopback;
  allowUnresolvedHosts;
  requireDnsPinning;
  havePinningFetch;
  isBrowser;
  usingDefaultNodeLookup;
  hostnameDenylist;
  allowedContentTypes;
  enforcePortGate;
  defaultLookup;
  constructor(options) {
    this.havePinningFetch = options.pinningFetch !== void 0;
    this.isBrowser = isBrowserContext();
    this.fetcher = options.pinningFetch ?? options.fetch ?? globalThis.fetch;
    this.injectedLookup = options.dnsLookup === null ? void 0 : options.dnsLookup ?? void 0;
    this.usingDefaultNodeLookup = options.dnsLookup === void 0 && hasNodeDns();
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.allowLoopback = options.allowLoopback ?? false;
    this.allowUnresolvedHosts = options.allowUnresolvedHosts ?? false;
    this.requireDnsPinning = options.requireDnsPinning ?? false;
    this.hostnameDenylist = options.hostnameDenylist ?? DEFAULT_HOSTNAME_DENYLIST;
    this.allowedContentTypes = options.allowedContentTypes ? options.allowedContentTypes.map((t) => t.toLowerCase()) : void 0;
    this.enforcePortGate = options.enforcePortGate ?? true;
  }
  async fetch(input, init) {
    const { url: startUrl, init: effectiveInit } = normalizeRequest(input, init);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const callerSignal = effectiveInit?.signal ?? void 0;
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }
    try {
      return await this.fetchGuarded(startUrl, effectiveInit, controller);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }
  async fetchGuarded(startUrl, init, controller) {
    let currentUrl = startUrl;
    let currentInit = { ...init ?? {} };
    let prevWasHttps = false;
    const seen = /* @__PURE__ */ new Set();
    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      if (seen.has(currentUrl)) {
        throw new SsrfError(`Redirect loop detected at ${currentUrl}.`);
      }
      seen.add(currentUrl);
      await this.assertAllowed(currentUrl, prevWasHttps);
      let res;
      try {
        res = await this.fetcher(currentUrl, {
          ...currentInit,
          // We re-validate every hop ourselves, so the underlying fetch must NOT auto-follow.
          redirect: "manual",
          signal: controller.signal
        });
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new SsrfError(`Fetch timed out for ${currentUrl} (${this.timeoutMs}ms).`, {
            cause
          });
        }
        throw new SsrfError(`Fetch failed for ${currentUrl}: ${message(cause)}`, { cause });
      }
      if (!isRedirect(res.status)) {
        return await this.finalize(res, currentUrl, controller);
      }
      const location = res.headers.get("location");
      if (!location) {
        return await this.finalize(res, currentUrl, controller);
      }
      let nextUrl;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        throw new SsrfError(`Redirect to a malformed Location (${location}) from ${currentUrl}.`);
      }
      currentInit = rewriteInitForRedirect(
        currentInit,
        res.status,
        !sameOrigin(currentUrl, nextUrl)
      );
      try {
        await res.body?.cancel();
      } catch {
      }
      prevWasHttps = safeProtocol(currentUrl) === "https:";
      currentUrl = nextUrl;
    }
    throw new SsrfError(`Too many redirects (> ${this.maxRedirects}) starting from ${startUrl}.`);
  }
  /** Enforce the content-type allowlist (when configured) then cap the body. */
  async finalize(res, url, controller) {
    if (this.allowedContentTypes && isBodyBearingStatus(res.status)) {
      const contentType3 = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
      if (!contentType3 || !this.allowedContentTypes.includes(contentType3)) {
        try {
          await res.body?.cancel();
        } catch {
        }
        throw new GuardError(
          `Disallowed content-type "${contentType3 || "(none)"}" for ${url}; expected one of ${this.allowedContentTypes.join(", ")}.`
        );
      }
    }
    return await this.capBody(res, url, controller);
  }
  async capBody(res, url, controller) {
    const declared = Number(res.headers.get("content-length") ?? Number.NaN);
    if (!Number.isNaN(declared) && declared > this.maxBytes) {
      controller.abort();
      throw new SsrfError(
        `Response body for ${url} exceeds cap (Content-Length ${declared} > ${this.maxBytes}).`
      );
    }
    const bytes = await this.readCapped(res, url, controller);
    const body = isNullBodyStatus(res.status) ? null : bytes.buffer;
    const out = new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers
    });
    const finalUrl = res.url || url;
    try {
      Object.defineProperty(out, "url", { value: finalUrl, configurable: true });
    } catch {
    }
    return out;
  }
  async readCapped(res, url, controller) {
    const body = res.body;
    if (!body) {
      return new Uint8Array(new ArrayBuffer(0));
    }
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          total += value.byteLength;
          if (total > this.maxBytes) {
            controller.abort();
            throw new SsrfError(
              `Response body for ${url} exceeds cap (${total} bytes > ${this.maxBytes}).`
            );
          }
          chunks.push(value);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
      }
    }
    const out = new Uint8Array(new ArrayBuffer(total));
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
  /**
   * Refuse `rawUrl` unless it is an https (or, under `allowLoopback`, http-to-loopback) URL
   * with no userinfo, an allowed port, a non-denied host, and a host allowed by the active
   * branch. `prevWasHttps` rejects a scheme-downgrade redirect (https → http).
   */
  async assertAllowed(rawUrl, prevWasHttps = false) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new SsrfError(`URL is malformed: ${rawUrl}.`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new SsrfError(
        `URL must be https: (got ${url.protocol} for ${rawUrl}). Only http(s) is fetched.`
      );
    }
    if (url.protocol === "http:" && !this.allowLoopback) {
      throw new SsrfError(
        `URL must be https: (got http: ${url.host}). http: is permitted only under allowLoopback (dev).`
      );
    }
    if (prevWasHttps && url.protocol === "http:") {
      throw new SsrfError(`Refusing redirect scheme downgrade (https \u2192 http): ${url.host}.`);
    }
    if (url.username || url.password) {
      throw new SsrfError(`URL must not carry userinfo (credentials): ${url.host}.`);
    }
    this.assertPortAllowed(url);
    const rawHostname = url.hostname.replace(/^\[|\]$/g, "");
    if (isDeniedHostname(rawHostname, this.hostnameDenylist)) {
      throw new SsrfError(`Host is on the cloud-internal denylist: ${rawHostname}.`);
    }
    const hostname = normalizeHostForClassification(url.hostname);
    if (isDeniedHostname(hostname, this.hostnameDenylist)) {
      throw new SsrfError(`Host is on the cloud-internal denylist: ${hostname}.`);
    }
    const literalKind = classifyIpLiteral(hostname);
    if (literalKind !== 0) {
      this.assertResolvedAddressesAllowed(url, hostname, [
        { address: hostname, family: literalKind }
      ]);
      return;
    }
    let lookup;
    if (this.injectedLookup) {
      lookup = this.injectedLookup;
    } else if (this.usingDefaultNodeLookup) {
      try {
        lookup = await this.resolveDefaultLookup();
      } catch (cause) {
        if (cause instanceof NodeDnsUnavailableError) {
          this.assertDnslessHostnameAllowed(url.protocol, hostname);
          return;
        }
        throw new SsrfError(`node:dns probe failed for ${hostname}: ${message(cause)}`, { cause });
      }
    } else {
      this.assertDnslessHostnameAllowed(url.protocol, hostname);
      return;
    }
    if (this.requireDnsPinning && !this.havePinningFetch) {
      throw new SsrfError(
        `URL refused \u2014 requireDnsPinning is set and "${hostname}" is a hostname, which cannot be DNS-pinned without an explicit pinningFetch. Pass a pinningFetch (asserted to pin DNS), or use an IP literal.`
      );
    }
    let resolved;
    try {
      resolved = await lookup(hostname);
    } catch (cause) {
      throw new SsrfError(`Host did not resolve: ${hostname}: ${message(cause)}`, { cause });
    }
    if (resolved.length === 0) {
      throw new SsrfError(`Host resolved to no addresses: ${hostname}.`);
    }
    this.assertResolvedAddressesAllowed(url, hostname, resolved);
  }
  /** Port gate: in production an explicit port must be 443 (https). Inert under allowLoopback. */
  assertPortAllowed(url) {
    if (!this.enforcePortGate || this.allowLoopback) {
      return;
    }
    if (url.port === "") {
      return;
    }
    const port = Number(url.port);
    if (!(url.protocol === "https:" && port === 443)) {
      throw new GuardError(
        `URL port not allowed (${url.port}) for ${url.host}; only 443 (https) is permitted in production.`
      );
    }
  }
  resolveDefaultLookup() {
    if (this.defaultLookup === void 0) {
      this.defaultLookup = loadNodeDnsLookup();
    }
    return this.defaultLookup;
  }
  /** DNS-LESS branch hostname guard (no resolver). The IP-literal cases are handled by the caller. */
  assertDnslessHostnameAllowed(protocol, hostname) {
    const lower = hostname.toLowerCase().replace(/\.$/, "");
    if (this.requireDnsPinning && !this.allowUnresolvedHosts) {
      throw new SsrfError(
        `URL refused \u2014 requireDnsPinning is set but no DNS resolver is available in this runtime to pin "${hostname}". A browser cannot pin a socket; set allowUnresolvedHosts to accept the residual, or run on Node with a pinningFetch.`
      );
    }
    if (lower === "local" || lower.endsWith(".local")) {
      throw new SsrfError(
        `URL refused \u2014 "${hostname}" is an mDNS/link-local (.local) name denoting a private LAN target. Use a public https host.`
      );
    }
    if (lower === "localhost" || lower.endsWith(".localhost")) {
      if (this.allowLoopback) {
        return;
      }
      throw new SsrfError(
        `URL refused \u2014 "${hostname}" is a loopback name (localhost/*.localhost), which denotes a private target. Use a public https host.`
      );
    }
    if (protocol === "http:") {
      throw new SsrfError(
        `URL refused \u2014 http: is allowed only for a loopback name (localhost/*.localhost) in this runtime; "${hostname}" is not loopback. Use https:.`
      );
    }
    if (this.isBrowser || this.allowUnresolvedHosts) {
      return;
    }
    throw new SsrfError(
      `URL refused \u2014 no DNS resolver is available in this runtime to classify "${hostname}", and this is not a positively-identified browser context. Set allowUnresolvedHosts to accept that hostname targets cannot be classified here (you trust the URL source), or run on Node where the full DNS-resolve guard applies.`
    );
  }
  /**
   * Enforce the address-level policy on a set of resolved (or literal) addresses: under
   * `allowLoopback` an http: URL must resolve to loopback ONLY, and EVERY address must be
   * public (or loopback when allowLoopback) — one private record fails the whole request
   * (rebinding mitigation).
   */
  assertResolvedAddressesAllowed(url, hostname, resolved) {
    if (url.protocol === "http:" && this.allowLoopback) {
      for (const r of resolved) {
        if (!isLoopbackAddress(r.address)) {
          throw new SsrfError(
            `URL refused \u2014 http: is allowed only when every resolved address is loopback (got ${r.address} for ${hostname}). Use https:.`
          );
        }
      }
    }
    for (const r of resolved) {
      if (!isPublicAddress(r.address, this.allowLoopback)) {
        throw new SsrfError(
          `URL refused \u2014 ${hostname} resolves to a non-public address (${r.address}).`
        );
      }
    }
  }
};
function isRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
function isNullBodyStatus(status) {
  return status === 101 || status === 204 || status === 205 || status === 304;
}
function isBodyBearingStatus(status) {
  return status >= 200 && status < 300 && status !== 204 && status !== 205;
}
function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
function safeProtocol(u) {
  try {
    return new URL(u).protocol;
  } catch {
    return "";
  }
}
var CREDENTIAL_HEADERS = /* @__PURE__ */ new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "www-authenticate",
  "dpop"
]);
var CONTENT_HEADERS = /* @__PURE__ */ new Set([
  "content-length",
  "content-type",
  "content-encoding",
  "content-language",
  "content-location"
]);
function rewriteInitForRedirect(init, status, crossOrigin) {
  const method = (init.method ?? "GET").toUpperCase();
  const methodChanges = status === 303 || (status === 301 || status === 302) && method !== "GET" && method !== "HEAD";
  const dropBody = methodChanges || crossOrigin;
  const headers = new Headers(init.headers ?? {});
  if (crossOrigin) {
    for (const name of CREDENTIAL_HEADERS) {
      headers.delete(name);
    }
  }
  if (dropBody) {
    for (const name of CONTENT_HEADERS) {
      headers.delete(name);
    }
  }
  const kept = {};
  headers.forEach((value, key) => {
    kept[key] = value;
  });
  const {
    body: _body,
    duplex: _duplex,
    method: _method,
    ...rest
  } = init;
  const next = { ...rest, headers: kept };
  if (methodChanges) {
    next.method = "GET";
  } else if (init.method !== void 0) {
    next.method = init.method;
    if (!dropBody && init.body !== void 0) {
      next.body = init.body;
      const duplex = init.duplex;
      if (duplex !== void 0) {
        next.duplex = duplex;
      }
    }
  }
  return next;
}
function normalizeRequest(input, init) {
  if (typeof input === "string") {
    return { url: input, init };
  }
  if (input instanceof URL) {
    return { url: input.toString(), init };
  }
  const req = input;
  const fromRequest = {
    method: req.method,
    headers: req.headers,
    credentials: req.credentials,
    redirect: req.redirect,
    ...req.signal ? { signal: req.signal } : {},
    ...req.body ? { body: req.body, duplex: "half" } : {}
  };
  return { url: req.url, init: { ...fromRequest, ...init ?? {} } };
}
function hasNodeDns() {
  return typeof process !== "undefined" && process.versions !== void 0 && process.versions.node !== void 0;
}
function isBrowserContext() {
  const g = globalThis;
  return typeof g.window !== "undefined" && g.window === globalThis && typeof g.document !== "undefined" && g.document !== null;
}
function message(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

// src/registry.ts
async function discoverFromRegistry(registryUrl, options = {}) {
  const fetchImpl = guardedFetchFor(options);
  const parsed = await parseRegistry(registryUrl, { fetch: fetchImpl });
  const members = parsed.members.map((v) => {
    const membership = v.membership ?? { app: "" };
    const status = membership.status;
    return {
      id: membership.app,
      source: registryUrl,
      membership,
      ...status !== void 0 ? { status } : {},
      trusted: status !== void 0 && TRUSTED_STATUS.has(status),
      valid: v.valid,
      issues: v.issues
    };
  });
  return { members, valid: parsed.valid, issues: parsed.issues };
}
async function resolveStorageSpecVersion(storageUrl, options = {}) {
  const fetchImpl = guardedFetchFor(options);
  const result = await parseStorage(storageUrl, { fetch: fetchImpl });
  const storage = result.storage;
  const acceptsSpecList = result.valid ? storage?.acceptsSpec ?? [] : [];
  const supportsSectorList = result.valid ? storage?.supportsSector ?? [] : [];
  const specView = { acceptsSpec: acceptsSpecList };
  return {
    id: storage?.id ?? storageUrl,
    ...result.valid && storage?.storage !== void 0 ? { storage: storage.storage } : {},
    acceptsSpec: acceptsSpecList,
    supportsSector: supportsSectorList,
    valid: result.valid,
    issues: result.issues,
    accepts: (specVersionIri) => acceptsSpec(specView, specVersionIri),
    unsupported: (wanted) => unsupportedSpecs(specView, wanted)
  };
}
function guardedFetchFor(options) {
  return createGuardedFetch({
    ...options.guard ?? {},
    ...options.fetch !== void 0 ? { fetch: options.fetch } : {}
  });
}

// node_modules/@jeswr/rdf-serialize/dist/serialize.js
import { Writer as Writer2 } from "n3";
var DEFAULT_FORMAT = "text/turtle";
function serialize(quads, options) {
  const format = options?.format ?? DEFAULT_FORMAT;
  const prefixes = options?.prefixes ?? {};
  const emptyAsEmptyString = options?.emptyAsEmptyString ?? true;
  if (emptyAsEmptyString && quads.length === 0) {
    return Promise.resolve("");
  }
  return new Promise((resolve, reject) => {
    const writer = new Writer2({ format, prefixes });
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

// src/serialize.ts
var PREFIXES = {
  fedapp: FEDAPP,
  acl: ACL,
  sh: SHACL,
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
};
function serialize2(quads, format = "text/turtle") {
  return legacySerialize(quads, format, PREFIXES, false);
}

// src/selfDescribe.ts
function applyCommon(node, sectors, access, consumes, produces) {
  for (const sector of sectors) {
    node.addSector(sector);
  }
  for (const mode of access) {
    node.addAccess(ACL_MODES[mode]);
  }
  for (const shape of consumes) {
    node.addConsumes(shape);
  }
  for (const shape of produces) {
    node.addProduces(shape);
  }
}
function selfDescribe(app) {
  if (!app.id) {
    throw new TypeError("selfDescribe: AppRegistration.id (the client_id IRI) is required.");
  }
  const builder = new FederationBuilder();
  const node = builder.app(app.id);
  applyCommon(node, app.sectors ?? [], app.access ?? [], app.consumes ?? [], app.produces ?? []);
  for (const shape of app.declaresShape ?? []) {
    node.addDeclaresShape(shape);
  }
  for (const su of app.sectorUse ?? []) {
    const suNode = node.linkSectorUse();
    applyCommon(suNode, [su.sector], su.access, su.consumes ?? [], su.produces ?? []);
  }
  const quads = builder.quads();
  return {
    quads,
    toString: (format) => serialize2(quads, format)
  };
}
export {
  ACL_MODES,
  FEDAPP,
  KNOWN_SECTOR_SLUGS,
  SsrfError,
  VALID_ACCESS_MODE_IRIS,
  accessModeName,
  createGuardedFetch,
  discoverFromRegistry,
  guardedFetch,
  isLoopbackAddress,
  isPublicAddress,
  list,
  resolveStorageSpecVersion,
  sectorIri,
  selfDescribe,
  serialize2 as serialize,
  verify,
  verifyDataset
};
//# sourceMappingURL=index.js.map
