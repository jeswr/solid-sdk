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

// src/ip.ts
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
  const withoutZone = stripIpv6Zone(value);
  if (withoutZone === void 0) {
    return false;
  }
  if (withoutZone.length === 0 || /[^0-9a-fA-F:.]/.test(withoutZone)) {
    return false;
  }
  if ((withoutZone.match(/::/g)?.length ?? 0) > 1) {
    return false;
  }
  const stripped = stripEmbeddedV4(withoutZone);
  if (stripped === void 0) {
    return false;
  }
  return validateHextetGroups(
    stripped.core,
    8 - stripped.embeddedV4Groups,
    stripped.embeddedV4Groups > 0
  );
}
function stripIpv6Zone(value) {
  const pct = value.indexOf("%");
  if (pct === -1) {
    return value;
  }
  const zone = value.slice(pct + 1);
  if (zone.length === 0 || zone.includes("%")) {
    return void 0;
  }
  return value.slice(0, pct);
}
function stripEmbeddedV4(value) {
  const dot = value.indexOf(".");
  if (dot === -1) {
    return { core: value, embeddedV4Groups: 0 };
  }
  const lastColon = value.lastIndexOf(":");
  if (lastColon === -1 || lastColon > dot) {
    return void 0;
  }
  if (!isIpv4Literal(value.slice(lastColon + 1))) {
    return void 0;
  }
  return { core: value.slice(0, lastColon + 1), embeddedV4Groups: 2 };
}
function validateHextetGroups(core, requiredGroups, hadEmbeddedV4) {
  const compressionIdx = core.indexOf("::");
  if (compressionIdx !== -1) {
    const head = splitHextets(core.slice(0, compressionIdx));
    let tailStr = core.slice(compressionIdx + 2);
    if (hadEmbeddedV4 && tailStr.endsWith(":")) {
      tailStr = tailStr.slice(0, -1);
    }
    const tail = splitHextets(tailStr);
    if (!head.every(isHextet) || !tail.every(isHextet)) {
      return false;
    }
    return head.length + tail.length < requiredGroups;
  }
  let groupsStr = core;
  if (hadEmbeddedV4 && groupsStr.endsWith(":")) {
    groupsStr = groupsStr.slice(0, -1);
  }
  const groups = splitHextets(groupsStr);
  return groups.length === requiredGroups && groups.every(isHextet);
}
function splitHextets(s) {
  return s === "" ? [] : s.split(":");
}
function isHextet(group) {
  return /^[0-9a-fA-F]{1,4}$/.test(group);
}
function isPublicAddress(address, allowLoopback) {
  const family = classifyIpLiteral(address);
  if (family === 4) {
    return isPublicIpv4(address, allowLoopback);
  }
  if (family === 6) {
    return isPublicIpv6(address, allowLoopback);
  }
  return false;
}
function isLoopbackAddress(address) {
  const family = classifyIpLiteral(address);
  if (family === 4) {
    return address.startsWith("127.");
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") {
      return true;
    }
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice("::ffff:".length);
      return classifyIpLiteral(v4) === 4 && v4.startsWith("127.");
    }
  }
  return false;
}
var BLOCKED_IPV4_RANGES = [
  { label: "0.0.0.0/8", matches: (a) => a === 0 },
  { label: "RFC1918 10.0.0.0/8", matches: (a) => a === 10 },
  { label: "RFC1918 172.16.0.0/12", matches: (a, b) => a === 172 && b >= 16 && b <= 31 },
  { label: "RFC1918 192.168.0.0/16", matches: (a, b) => a === 192 && b === 168 },
  { label: "link-local 169.254.0.0/16", matches: (a, b) => a === 169 && b === 254 },
  { label: "CGNAT 100.64.0.0/10", matches: (a, b) => a === 100 && b >= 64 && b <= 127 },
  { label: "multicast 224.0.0.0/4", matches: (a) => a >= 224 && a <= 239 },
  { label: "reserved/broadcast 240.0.0.0/4", matches: (a) => a >= 240 },
  { label: "TEST-NET-1 192.0.2.0/24", matches: (a, b, c) => a === 192 && b === 0 && c === 2 },
  { label: "benchmarking 198.18.0.0/15", matches: (a, b) => a === 198 && (b === 18 || b === 19) },
  { label: "TEST-NET-2 198.51.100.0/24", matches: (a, b, c) => a === 198 && b === 51 && c === 100 },
  { label: "TEST-NET-3 203.0.113.0/24", matches: (a, b, c) => a === 203 && b === 0 && c === 113 }
];
function isPublicIpv4(address, allowLoopback) {
  const parts = address.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b, c] = parts;
  if (a === 127) {
    return allowLoopback;
  }
  if (BLOCKED_IPV4_RANGES.some((range) => range.matches(a, b, c))) {
    return false;
  }
  return true;
}
function extractEmbeddedV4(hextets, startHextet) {
  const h1 = hextets[startHextet];
  const h2 = hextets[startHextet + 1];
  if (!h1 || !h2) {
    return void 0;
  }
  const w1 = Number.parseInt(h1, 16);
  const w2 = Number.parseInt(h2, 16);
  if (Number.isNaN(w1) || Number.isNaN(w2) || w1 < 0 || w1 > 65535 || w2 < 0 || w2 > 65535) {
    return void 0;
  }
  return `${w1 >> 8 & 255}.${w1 & 255}.${w2 >> 8 & 255}.${w2 & 255}`;
}
function hextetsMatchPrefix(hextets, prefix) {
  return prefix.every((value, i) => hextets[i] === value);
}
var BLOCKED_IPV6_HIGH_MASKS = [
  { label: "fe80::/10 link-local", mask: 65472, value: 65152 },
  { label: "fc00::/7 unique-local", mask: 65024, value: 64512 },
  { label: "ff00::/8 multicast", mask: 65280, value: 65280 }
];
function embeddedV4IsPublic(hextets, startHextet, allowLoopback) {
  const v4 = extractEmbeddedV4(hextets, startHextet);
  return v4 !== void 0 && isPublicIpv4(v4, allowLoopback);
}
function embeddedTunnelV4IsBlocked(hextets, startHextet, allowLoopback) {
  const v4 = extractEmbeddedV4(hextets, startHextet);
  return v4 !== void 0 && !isPublicIpv4(v4, allowLoopback);
}
function isPublicIpv6(address, allowLoopback) {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") {
    return allowLoopback;
  }
  if (lower === "::" || lower === "0:0:0:0:0:0:0:0") {
    return false;
  }
  const expanded = expandIpv6(lower);
  if (expanded && hextetsMatchPrefix(expanded, ["0", "0", "0", "0", "0", "ffff"])) {
    return embeddedV4IsPublic(expanded, 6, allowLoopback);
  }
  const head = lower.split(":")[0] ?? "";
  const high = Number.parseInt(head, 16);
  if (Number.isNaN(high)) {
    return false;
  }
  if (BLOCKED_IPV6_HIGH_MASKS.some((m) => (high & m.mask) === m.value)) {
    return false;
  }
  if (tunnellingPrefixIsBlocked(high, expanded, allowLoopback)) {
    return false;
  }
  return true;
}
function tunnellingPrefixIsBlocked(high, expanded, allowLoopback) {
  if (high === 8194) {
    return !expanded || embeddedTunnelV4IsBlocked(expanded, 1, allowLoopback);
  }
  if (high === 100) {
    return expanded !== void 0 && hextetsMatchPrefix(expanded, ["64", "ff9b", "0", "0", "0", "0"]) && embeddedTunnelV4IsBlocked(expanded, 6, allowLoopback);
  }
  return false;
}
function expandIpv6(addr) {
  const folded = foldTrailingV4ToHextets(addr);
  if (folded === void 0) {
    return void 0;
  }
  const hextets = splitAndFillHextets(folded);
  if (hextets === void 0 || hextets.length !== 8) {
    return void 0;
  }
  return hextets.map(normalizeHextet);
}
function foldTrailingV4ToHextets(addr) {
  const dot = addr.lastIndexOf(".");
  if (dot === -1) {
    return addr;
  }
  const colon = addr.lastIndexOf(":", dot);
  if (colon === -1) {
    return void 0;
  }
  const v4 = addr.slice(colon + 1);
  if (classifyIpLiteral(v4) !== 4) {
    return void 0;
  }
  const [a, b, c, d] = v4.split(".").map((p) => Number.parseInt(p, 10));
  if (a === void 0 || b === void 0 || c === void 0 || d === void 0) {
    return void 0;
  }
  return `${addr.slice(0, colon)}:${(a << 8 | b).toString(16)}:${(c << 8 | d).toString(16)}`;
}
function splitAndFillHextets(s) {
  const doubleColon = s.indexOf("::");
  if (doubleColon === -1) {
    return s.split(":");
  }
  const head = splitHextets(s.slice(0, doubleColon));
  const tail = splitHextets(s.slice(doubleColon + 2));
  const fill = 8 - head.length - tail.length;
  if (fill < 0) {
    return void 0;
  }
  return [...head, ...Array(fill).fill("0"), ...tail];
}
function normalizeHextet(h) {
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n) || n < 0 || n > 65535) {
    return "BAD";
  }
  return n.toString(16);
}

// src/ssrf.ts
var SsrfError = class extends Error {
  constructor(message2, options) {
    super(message2, options);
    this.name = "SsrfError";
  }
};
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
var SsrfGuard = class {
  fetcher;
  /**
   * A caller-INJECTED DNS lookup (a custom resolver / test stub), or `undefined`. When
   * present it is the resolver and there is no import-failure fallback (an injected lookup
   * throwing is always a genuine resolution failure). Distinct from the DEFAULT node
   * lookup (see {@link usingDefaultNodeLookup}), which is probed lazily.
   */
  injectedLookup;
  maxBytes;
  timeoutMs;
  maxRedirects;
  allowLoopback;
  allowUnresolvedHosts;
  requireDnsPinning;
  /**
   * Whether the caller supplied a DISTINCT, branded {@link GuardOptions.pinningFetch}
   * (the explicit "this fetch pins DNS" attestation). A plain {@link GuardOptions.fetch}
   * does NOT set this — so a generic auth/custom fetch can never silently satisfy
   * `requireDnsPinning` (roborev round-2 High).
   */
  havePinningFetch;
  /**
   * Whether we are in a positively-identified BROWSER context (a DOM window). On the
   * DNS-less branch this gates whether a public-looking hostname is allowed by default:
   * a real browser accepts the documented residual; any other DNS-less runtime
   * (edge / workers) fails closed unless `allowUnresolvedHosts` (roborev #92 round-2
   * High). Captured once at construction.
   */
  isBrowser;
  /**
   * Whether the DEFAULT Node `node:dns` lookup is in play (no injected lookup AND the
   * process LOOKS like Node). The actual `node:dns` import is probed lazily by
   * {@link resolveDefaultLookup}; if it cannot be imported (a non-Node runtime with only a
   * `process` shim) the guard FALLS BACK to the DNS-less policy (roborev #92 round-3).
   */
  usingDefaultNodeLookup;
  /** Cached default-node-lookup probe (see {@link resolveDefaultLookup}). */
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
    const seen = /* @__PURE__ */ new Set();
    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      if (seen.has(currentUrl)) {
        throw new SsrfError(`Redirect loop detected at ${currentUrl}.`);
      }
      seen.add(currentUrl);
      await this.assertAllowed(currentUrl);
      let res;
      try {
        res = await this.fetcher(currentUrl, {
          ...currentInit,
          // We re-validate every hop ourselves, so the underlying fetch must NOT
          // auto-follow — a browser-style follow would let a hostile redirect bounce
          // to an internal address before the guard ever saw the Location.
          redirect: "manual",
          signal: controller.signal
        });
      } catch (cause) {
        throw new SsrfError(`Fetch failed for ${currentUrl}: ${message(cause)}`, { cause });
      }
      if (!isRedirect(res.status)) {
        return await this.capBody(res, currentUrl, controller);
      }
      const location = res.headers.get("location");
      if (!location) {
        return await this.capBody(res, currentUrl, controller);
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
      currentUrl = nextUrl;
    }
    throw new SsrfError(`Too many redirects (> ${this.maxRedirects}) starting from ${startUrl}.`);
  }
  /**
   * Buffer the response body up to `maxBytes` (rejecting an over-cap declared
   * `Content-Length` up front and an over-cap stream mid-read) and return a fresh
   * `Response` carrying the capped bytes + the original status/headers/url. Buffering
   * (rather than handing back a streaming body) makes the cap authoritative regardless
   * of how the downstream consumer reads it.
   */
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
   * Refuse `rawUrl` unless it is an https (or, under `allowLoopback`, http-to-loopback)
   * URL with no userinfo whose host is allowed by the active branch:
   *   - NODE branch (DNS available): an IP literal is checked directly; a hostname is
   *     DNS-resolved and EVERY record must be public (DNS-rebinding mitigation); under
   *     `requireDnsPinning` a hostname through the default fetch is refused outright.
   *   - BROWSER branch (no DNS): an IP literal is checked directly; a hostname is
   *     inspected SYNTACTICALLY (reject `localhost` / `*.local` / `*.localhost`) and
   *     otherwise allowed — see the module-header residual note (a hostname that
   *     resolves to a private IP at connect time is NOT caught: inherent to browser
   *     `fetch`).
   * The host-shape checks (scheme, userinfo, IP literal) are identical in both branches;
   * only the hostname (non-literal) path differs.
   */
  async assertAllowed(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new SsrfError(`Registry URL is malformed: ${rawUrl}.`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new SsrfError(
        `Registry URL must be https: (got ${url.protocol} for ${rawUrl}). Only http(s) is fetched.`
      );
    }
    if (url.protocol === "http:" && !this.allowLoopback) {
      throw new SsrfError(
        `Registry URL must be https: (got http: ${url.host}). http: is permitted only under allowLoopback (dev).`
      );
    }
    if (url.username || url.password) {
      throw new SsrfError(`Registry URL must not carry userinfo (credentials): ${url.host}.`);
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const literalKind = classifyIpLiteral(hostname);
    if (literalKind !== 0) {
      const r = { address: hostname, family: literalKind };
      this.assertResolvedAddressesAllowed(url, hostname, [r]);
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
        `Registry URL refused \u2014 requireDnsPinning is set and "${hostname}" is a hostname, which cannot be DNS-pinned without an explicit pinningFetch. Pass a pinningFetch (asserted to pin DNS), or use an IP literal.`
      );
    }
    let resolved;
    try {
      resolved = await lookup(hostname);
    } catch (cause) {
      throw new SsrfError(`Registry host did not resolve: ${hostname}: ${message(cause)}`, {
        cause
      });
    }
    if (resolved.length === 0) {
      throw new SsrfError(`Registry host resolved to no addresses: ${hostname}.`);
    }
    this.assertResolvedAddressesAllowed(url, hostname, resolved);
  }
  /**
   * Probe + cache the DEFAULT Node `node:dns` lookup. The import (capability) is attempted
   * ONCE and memoised; a successful probe yields the bound lookup, a failed import throws
   * {@link NodeDnsUnavailableError} (cached so we do not retry the import per request). The
   * caller (the hostname path) probes this BEFORE the requireDnsPinning rejection so the
   * strict posture fails before any network query (roborev #92 round-6 Medium).
   */
  resolveDefaultLookup() {
    if (this.defaultLookup === void 0) {
      this.defaultLookup = loadNodeDnsLookup();
    }
    return this.defaultLookup;
  }
  /**
   * DNS-LESS branch hostname guard (no resolver). The IP-literal cases are already
   * handled by the caller; here `hostname` is a non-literal name. We:
   *   1. REFUSE the obvious local/loopback names — `localhost`, `*.localhost`, `local`,
   *      `*.local` — which denote a private host on essentially every system (only
   *      permitted under the dev `allowLoopback` escape hatch);
   *   2. enforce the scheme policy WITH protocol context (roborev #92 round-2 Medium): an
   *      `http:` URL (reachable here only under `allowLoopback`) is allowed ONLY for the
   *      loopback NAMES above — never a public-looking hostname over `http:`, matching the
   *      Node branch's "http is loopback-only" intent;
   *   3. for a public-looking https hostname, ALLOW it ONLY in a positively-identified
   *      browser (the documented inherent residual — the page can `fetch` any origin
   *      anyway) OR when the caller set `allowUnresolvedHosts`. In a DNS-less *server*
   *      runtime (edge / workers) WITHOUT that opt-in we FAIL CLOSED (roborev #92 round-2
   *      High) — an unresolved public-looking hostname reaching private infra is a real
   *      SSRF escalation there, not the benign browser residual.
   * `requireDnsPinning` cannot be honoured without a resolver, so it fails closed for ANY
   * hostname (incl. a loopback name) unless `allowUnresolvedHosts` is set — and that check
   * runs FIRST, ahead of every allow path, so the `allowLoopback` dev hatch cannot let a
   * `localhost` target bypass the strict posture (roborev #92 round-3 Medium). The
   * browser-vs-server decision uses `this.isBrowser`, which is `process`-independent
   * (`window === globalThis`), so it is correct on the import-failure fallback path too.
   */
  assertDnslessHostnameAllowed(protocol, hostname) {
    const lower = hostname.toLowerCase().replace(/\.$/, "");
    if (this.requireDnsPinning && !this.allowUnresolvedHosts) {
      throw new SsrfError(
        `Registry URL refused \u2014 requireDnsPinning is set but no DNS resolver is available in this runtime to pin "${hostname}". A browser cannot pin a socket; set allowUnresolvedHosts to accept the residual, or run on Node with a pinningFetch.`
      );
    }
    if (lower === "local" || lower.endsWith(".local")) {
      throw new SsrfError(
        `Registry URL refused \u2014 "${hostname}" is an mDNS/link-local (.local) name denoting a private LAN target. Use a public https host.`
      );
    }
    if (lower === "localhost" || lower.endsWith(".localhost")) {
      if (this.allowLoopback) {
        return;
      }
      throw new SsrfError(
        `Registry URL refused \u2014 "${hostname}" is a loopback name (localhost/*.localhost), which denotes a private target. Use a public https host.`
      );
    }
    if (protocol === "http:") {
      throw new SsrfError(
        `Registry URL refused \u2014 http: is allowed only for a loopback name (localhost/*.localhost) in this runtime; "${hostname}" is not loopback. Use https:.`
      );
    }
    if (this.isBrowser || this.allowUnresolvedHosts) {
      return;
    }
    throw new SsrfError(
      `Registry URL refused \u2014 no DNS resolver is available in this runtime to classify "${hostname}", and this is not a positively-identified browser context. Set allowUnresolvedHosts to accept that hostname targets cannot be classified here (you trust the URL source), or run on Node where the full DNS-resolve guard applies.`
    );
  }
  /**
   * Enforce the address-level policy on a set of resolved (or literal) addresses, shared
   * by the IP-literal and Node-branch paths: under `allowLoopback` an http: URL must
   * resolve to loopback ONLY, and EVERY address must be public (or loopback when
   * allowLoopback) — one private record fails the whole request (rebinding mitigation).
   */
  assertResolvedAddressesAllowed(url, hostname, resolved) {
    if (url.protocol === "http:" && this.allowLoopback) {
      for (const r of resolved) {
        if (!isLoopbackAddress(r.address)) {
          throw new SsrfError(
            `Registry URL refused \u2014 http: is allowed only when every resolved address is loopback (got ${r.address} for ${hostname}). Use https:.`
          );
        }
      }
    }
    for (const r of resolved) {
      if (!isPublicAddress(r.address, this.allowLoopback)) {
        throw new SsrfError(
          `Registry URL refused \u2014 ${hostname} resolves to a non-public address (${r.address}).`
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
function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
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
    // `req.body` is a one-shot ReadableStream; only attach it when present (a GET/HEAD
    // Request has none). The guard issues at most a few hops; a non-replayable stream
    // body is a known fetch limitation, not introduced here.
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
