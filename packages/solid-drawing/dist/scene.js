var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/@jeswr/fetch-rdf/dist/errors.js
var RdfFetchError;
var init_errors = __esm({
  "node_modules/@jeswr/fetch-rdf/dist/errors.js"() {
    RdfFetchError = class extends Error {
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
  }
});

// node_modules/@jeswr/fetch-rdf/dist/parse.js
import contentType from "content-type";
import { Store, StreamParser } from "n3";
import { JsonLdParser } from "jsonld-streaming-parser";
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
function extractMediaType(headerValue) {
  if (!headerValue)
    return null;
  try {
    return contentType.parse(headerValue).type;
  } catch {
    return null;
  }
}
function collectIntoStore(parser) {
  return new Promise((resolve, reject) => {
    const store = new Store();
    parser.on("data", (quad2) => {
      store.addQuad(quad2);
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
var SUPPORTED_RDF_MEDIA_TYPES, N3_FAMILY, JSON_LD_FAMILY;
var init_parse = __esm({
  "node_modules/@jeswr/fetch-rdf/dist/parse.js"() {
    init_errors();
    SUPPORTED_RDF_MEDIA_TYPES = [
      "text/turtle",
      "application/n-triples",
      "application/n-quads",
      "application/trig",
      "application/ld+json"
    ];
    N3_FAMILY = /* @__PURE__ */ new Set([
      "text/turtle",
      "application/n-triples",
      "application/n-quads",
      "application/trig"
    ]);
    JSON_LD_FAMILY = /* @__PURE__ */ new Set([
      "application/ld+json"
    ]);
  }
});

// node_modules/@jeswr/fetch-rdf/dist/fetch.js
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
var ACCEPT;
var init_fetch = __esm({
  "node_modules/@jeswr/fetch-rdf/dist/fetch.js"() {
    init_parse();
    init_errors();
    ACCEPT = "text/turtle, application/ld+json;q=0.9";
  }
});

// node_modules/@jeswr/fetch-rdf/dist/index.js
var dist_exports = {};
__export(dist_exports, {
  RdfFetchError: () => RdfFetchError,
  SUPPORTED_RDF_MEDIA_TYPES: () => SUPPORTED_RDF_MEDIA_TYPES,
  extractMediaType: () => extractMediaType,
  fetchRdf: () => fetchRdf,
  parseRdf: () => parseRdf
});
var init_dist = __esm({
  "node_modules/@jeswr/fetch-rdf/dist/index.js"() {
    init_parse();
    init_fetch();
    init_errors();
  }
});

// src/scene.ts
import { DataFactory as DataFactory2, Store as Store2, Writer } from "n3";

// src/vocab.ts
import { DataFactory } from "n3";
var { namedNode } = DataFactory;
var DRAW = "https://w3id.org/jeswr/drawing#";
var DCT = "http://purl.org/dc/terms/";
var SCHEMA = "http://schema.org/";
var PROV = "http://www.w3.org/ns/prov#";
var RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var RDFS = "http://www.w3.org/2000/01/rdf-schema#";
var XSD = "http://www.w3.org/2001/XMLSchema#";
var draw = (local) => `${DRAW}${local}`;
var dct = (local) => `${DCT}${local}`;
var schema = (local) => `${SCHEMA}${local}`;
var prov = (local) => `${PROV}${local}`;
var rdf = (local) => `${RDF}${local}`;
var xsd = (local) => `${XSD}${local}`;
var DRAW_SCENE_IRI = draw("Scene");
var DRAW_SCENE_DOCUMENT_IRI = draw("sceneDocument");
var DRAW_SCHEMA_VERSION_IRI = draw("schemaVersion");
var DRAW_VIEW_BACKGROUND_COLOR_IRI = draw("viewBackgroundColor");
var DRAW_THUMBNAIL_IRI = draw("thumbnail");
var SCHEMA_CREATIVE_WORK_IRI = schema("CreativeWork");
var DCT_TITLE_IRI = dct("title");
var DCT_CREATED_IRI = dct("created");
var DCT_MODIFIED_IRI = dct("modified");
var SCHEMA_ABOUT_IRI = schema("about");
var PROV_WAS_GENERATED_BY_IRI = prov("wasGeneratedBy");
var RDF_TYPE_IRI = rdf("type");
var DRAW_SCENE = namedNode(DRAW_SCENE_IRI);
var DRAW_SCENE_DOCUMENT = namedNode(DRAW_SCENE_DOCUMENT_IRI);
var DRAW_SCHEMA_VERSION = namedNode(DRAW_SCHEMA_VERSION_IRI);
var DRAW_VIEW_BACKGROUND_COLOR = namedNode(DRAW_VIEW_BACKGROUND_COLOR_IRI);
var DRAW_THUMBNAIL = namedNode(DRAW_THUMBNAIL_IRI);
var SCHEMA_CREATIVE_WORK = namedNode(SCHEMA_CREATIVE_WORK_IRI);
var DCT_TITLE = namedNode(DCT_TITLE_IRI);
var DCT_CREATED = namedNode(DCT_CREATED_IRI);
var DCT_MODIFIED = namedNode(DCT_MODIFIED_IRI);
var SCHEMA_ABOUT = namedNode(SCHEMA_ABOUT_IRI);
var PROV_WAS_GENERATED_BY = namedNode(PROV_WAS_GENERATED_BY_IRI);
var RDF_TYPE = namedNode(RDF_TYPE_IRI);
var XSD_DATE_TIME = namedNode(xsd("dateTime"));
var XSD_STRING = namedNode(xsd("string"));
var PREFIXES = {
  draw: DRAW,
  dct: DCT,
  schema: SCHEMA,
  prov: PROV,
  rdf: RDF,
  rdfs: RDFS,
  xsd: XSD
};

// src/scene.ts
var { namedNode: namedNode2, literal, quad } = DataFactory2;
function sceneSubject(resourceUrl) {
  return namedNode2(`${resourceUrl}#it`);
}
function dateTime(value) {
  return literal(value, XSD_DATE_TIME);
}
function buildScene(resourceUrl, data) {
  const subject = sceneSubject(resourceUrl);
  const store = new Store2();
  store.addQuad(quad(subject, RDF_TYPE, DRAW_SCENE));
  store.addQuad(quad(subject, DRAW_SCENE_DOCUMENT, namedNode2(data.sceneDocument)));
  if (data.title !== void 0) {
    store.addQuad(quad(subject, DCT_TITLE, literal(data.title)));
  }
  if (data.created !== void 0) {
    store.addQuad(quad(subject, DCT_CREATED, dateTime(data.created)));
  }
  if (data.modified !== void 0) {
    store.addQuad(quad(subject, DCT_MODIFIED, dateTime(data.modified)));
  }
  if (data.schemaVersion !== void 0) {
    store.addQuad(quad(subject, DRAW_SCHEMA_VERSION, literal(data.schemaVersion)));
  }
  if (data.viewBackgroundColor !== void 0) {
    store.addQuad(quad(subject, DRAW_VIEW_BACKGROUND_COLOR, literal(data.viewBackgroundColor)));
  }
  if (data.thumbnail !== void 0) {
    store.addQuad(quad(subject, DRAW_THUMBNAIL, namedNode2(data.thumbnail)));
  }
  if (data.about !== void 0) {
    store.addQuad(quad(subject, SCHEMA_ABOUT, namedNode2(data.about)));
  }
  if (data.wasGeneratedBy !== void 0) {
    store.addQuad(quad(subject, PROV_WAS_GENERATED_BY, namedNode2(data.wasGeneratedBy)));
  }
  return store;
}
function storeToTurtle(store) {
  const writer = new Writer({ prefixes: { ...PREFIXES } });
  writer.addQuads([...store]);
  return new Promise((resolve, reject) => {
    writer.end((error, result) => error ? reject(error) : resolve(result));
  });
}
function serializeScene(resourceUrl, data) {
  return storeToTurtle(buildScene(resourceUrl, data));
}
function exactlyOne(dataset, subject, predicate) {
  const matches = dataset.match(subject, predicate, null, null);
  if (matches.size !== 1) return void 0;
  for (const q of matches) return q.object;
  return void 0;
}
function exactlyOneIri(dataset, subject, predicate) {
  const obj = exactlyOne(dataset, subject, predicate);
  return obj?.termType === "NamedNode" ? obj.value : void 0;
}
function exactlyOneLiteral(dataset, subject, predicate, datatype) {
  const obj = exactlyOne(dataset, subject, predicate);
  if (obj?.termType !== "Literal") return void 0;
  if (datatype !== void 0 && obj.datatype.value !== datatype.value) return void 0;
  return obj.value;
}
function setIfDefined(data, key, value) {
  if (value !== void 0) data[key] = value;
}
function parseScene(resourceUrl, dataset) {
  const subject = sceneSubject(resourceUrl);
  const isScene = dataset.match(subject, RDF_TYPE, DRAW_SCENE, null).size > 0;
  if (!isScene) return void 0;
  const sceneDocument = exactlyOneIri(dataset, subject, DRAW_SCENE_DOCUMENT);
  if (sceneDocument === void 0) return void 0;
  const data = { sceneDocument };
  setIfDefined(data, "title", exactlyOneLiteral(dataset, subject, DCT_TITLE, XSD_STRING));
  setIfDefined(data, "created", exactlyOneLiteral(dataset, subject, DCT_CREATED, XSD_DATE_TIME));
  setIfDefined(data, "modified", exactlyOneLiteral(dataset, subject, DCT_MODIFIED, XSD_DATE_TIME));
  setIfDefined(data, "schemaVersion", exactlyOneLiteral(dataset, subject, DRAW_SCHEMA_VERSION));
  setIfDefined(
    data,
    "viewBackgroundColor",
    exactlyOneLiteral(dataset, subject, DRAW_VIEW_BACKGROUND_COLOR)
  );
  setIfDefined(data, "thumbnail", exactlyOneIri(dataset, subject, DRAW_THUMBNAIL));
  setIfDefined(data, "about", exactlyOneIri(dataset, subject, SCHEMA_ABOUT));
  setIfDefined(data, "wasGeneratedBy", exactlyOneIri(dataset, subject, PROV_WAS_GENERATED_BY));
  return data;
}
async function parseSceneTtl(url, body, contentType2 = "text/turtle") {
  const resolvedContentType = contentType2 ?? "text/turtle";
  const { parseRdf: parseRdf2 } = await Promise.resolve().then(() => (init_dist(), dist_exports));
  const dataset = await parseRdf2(body, resolvedContentType, { baseIRI: url });
  return parseScene(url, dataset);
}
export {
  buildScene,
  parseScene,
  parseSceneTtl,
  sceneSubject,
  serializeScene,
  storeToTurtle
};
//# sourceMappingURL=scene.js.map
