"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  assertWithinPod: () => assertWithinPod,
  isContainerUrl: () => isContainerUrl,
  normalizePodBase: () => normalizePodBase,
  parseContainerListing: () => parseContainerListing,
  redactUserinfo: () => redactUserinfo,
  resolveTarget: () => resolveTarget
});
module.exports = __toCommonJS(src_exports);

// node_modules/@jeswr/fetch-rdf/dist/parse.js
var import_content_type = __toESM(require("content-type"), 1);
var import_n3 = require("n3");
var import_jsonld_streaming_parser = require("jsonld-streaming-parser");

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
    mediaType = import_content_type.default.parse(rawHeader).type;
  } catch (cause) {
    throw new RdfFetchError(`Invalid Content-Type header: "${rawHeader}".`, { cause, contentType: rawHeader });
  }
  const baseIRI = options.baseIRI;
  let parser;
  if (N3_FAMILY.has(mediaType)) {
    parser = new import_n3.StreamParser({
      format: mediaType,
      ...baseIRI !== void 0 && { baseIRI }
    });
  } else if (JSON_LD_FAMILY.has(mediaType)) {
    parser = new import_jsonld_streaming_parser.JsonLdParser({
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
    const store = new import_n3.Store();
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

// node_modules/@rdfjs/wrapper/dist/TermWrapper.js
var TermWrapper = class {
  original;
  _dataset;
  _factory;
  constructor(term, dataset, factory) {
    this.original = typeof term === "string" ? factory.namedNode(term) : term;
    this._dataset = dataset;
    this._factory = factory;
  }
  /**
   * The dataset that contains this term.
   *
   * This accessor provides access to the underlying RDF graph that is the containing context of a node mapped to JavaScript by instances of this class.
   *
   * @remarks
   * RDF/JS, like many other RDF frameworks, keeps terms and datasets separate. This means that terms do not hold a reference to a dataset they reside in (or were found in). This, in turn, means that a dataset must always be available, separate from the term, if either changes to the underlying data or further traversal of the underlying data is called for. In an object-oriented context however, where property chaining is idiomatic (i.e. `instance.property1.property2`), there is no way to supply the dataset when dereferencing a link in the chain.
   *
   * This property solves the problem by keeping a reference to the dataset.
   *
   * @exmaple
   * Using the dataset to modify information related to this node in the underlying data:
   * ```ts
   * class Book extends TermWrapper {
   *   set author(value: string) {
   *     const subject = this as Quad_Subject
   *     const predicate = this.factory.namedNode("http://example.com/author")
   *     const object = this.factory.literal(value)
   *     const oldAuthors = this.factory.quad(subject, predicate)
   *     const newAuthor = this.factory.quad(subject, predicate, object)
   *
   *     this.dataset.delete(oldAuthors)
   *     this.dataset.add(newAuthor)
   *   }
   * }
   * ```
   * Note: The above example operates on a low level to explain this property. Library users are more likely to interact with {@link OptionalAs}, {@link RequiredAs} and {@link LiteralFrom} for a better experience.
   *
   * @exmaple
   * Using the dataset to modify data related to this node in the underlying data:
   * ```ts
   * class Container extends TermWrapper {
   *   add(something: string) {
   *     const subject = this as Quad_Subject
   *     const predicate = this.factory.namedNode("http://example.com/contains")
   *     const object = this.factory.literal(something)
   *     const quad = this.factory.quad(subject, predicate, object)
   *
   *     this.dataset.add(quad)
   *   }
   * }
   * ```
   */
  get dataset() {
    return this._dataset;
  }
  /**
   * The data factory this instance was instantiated with. A collection of methods that can be used to create terms by this or subsequent wrappers.
   *
   * @exmaple
   * Using the factory to create a literal term from the current date and time:
   * ```ts
   * class Calendar extends TermWrapper {
   *   get currentDate(): Literal {
   *     const date = new Date().toISOString()
   *     const xsdDateTime = this.factory.namedNode("http://www.w3.org/2001/XMLSchema#dateTime")
   *
   *     return this.factory.literal(date, xsdDateTime)
   *   }
   * }
   * ```
   *
   * @exmaple
   * Using the factory to create a quad:
   * ```ts
   * class Container extends TermWrapper {
   *   add(something: string) {
   *     const subject = this as Quad_Subject
   *     const predicate = this.factory.namedNode("http://example.com/contains")
   *     const object = this.factory.literal(something)
   *     const quad = this.factory.quad(subject, predicate, object)
   *
   *     this.dataset.add(quad)
   *   }
   * }
   * ```
   */
  get factory() {
    return this._factory;
  }
  /**
   * The well-known property containing a string that represents the type of this object.
   */
  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
  //#region Implementation of RDF/JS Term
  get termType() {
    return this.original.termType;
  }
  get value() {
    return this.original.value;
  }
  equals(other) {
    return this.original.equals(other);
  }
  //#region Implementation of RDF/JS Literal
  get language() {
    return this.original.language;
  }
  get direction() {
    return this.original.direction;
  }
  get datatype() {
    return this.original.datatype;
  }
  //#endregion
  //#region Implementation of RDF/JS Quad
  get subject() {
    return this.original.subject;
  }
  get predicate() {
    return this.original.predicate;
  }
  get object() {
    return this.original.object;
  }
  get graph() {
    return this.original.graph;
  }
};

// node_modules/@rdfjs/wrapper/dist/IndexerInterceptor.js
var IndexerInterceptor = class {
  get(target, property, receiver) {
    if (notNumeric(property)) {
      return Reflect.get(target, property, receiver);
    }
    return target.at(Number.parseInt(property));
  }
  set(target, property, value, receiver) {
    if (notNumeric(property)) {
      return Reflect.set(target, property, value, receiver);
    }
    const i = Number.parseInt(property);
    target.fill(value, i, i + 1);
    return true;
  }
  deleteProperty(target, property) {
    if (notNumeric(property)) {
      return Reflect.deleteProperty(target, property);
    }
    return false;
  }
};
function notNumeric(property) {
  return typeof property === "symbol" || isNaN(parseInt(property));
}

// node_modules/@rdfjs/wrapper/dist/vocabulary/RDF.js
var RDF = {
  langString: "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
  type: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
  first: "http://www.w3.org/1999/02/22-rdf-syntax-ns#first",
  rest: "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest",
  nil: "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil"
};

// node_modules/@rdfjs/wrapper/dist/mapping/TermFrom.js
var TermFrom;
(function(TermFrom2) {
  function instance(value, factory) {
    return itself(value, factory);
  }
  TermFrom2.instance = instance;
  function itself(value, _) {
    return value;
  }
  TermFrom2.itself = itself;
})(TermFrom || (TermFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/RequiredFrom.js
var RequiredFrom;
(function(RequiredFrom2) {
  function subjectPredicate(anchor1, p, termAs) {
    if (termAs === void 0) {
      throw new Error();
    }
    const anchor2 = anchor1.factory.namedNode(p);
    const matches = anchor1.dataset.match(anchor1, anchor2)[Symbol.iterator]();
    const { value: first, done: none } = matches.next();
    if (none) {
      throw new Error(`No value found for predicate ${p} on term ${anchor1.value}`);
    }
    if (!matches.next().done) {
      throw new Error(`More than one value for predicate ${p} on term ${anchor1.value}`);
    }
    return termAs(new TermWrapper(first.object, anchor1.dataset, anchor1.factory));
  }
  RequiredFrom2.subjectPredicate = subjectPredicate;
})(RequiredFrom || (RequiredFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/OptionalFrom.js
var OptionalFrom;
(function(OptionalFrom2) {
  function subjectPredicate(anchor, p, termAs) {
    if (termAs === void 0) {
      throw new Error();
    }
    const predicate = anchor.factory.namedNode(p);
    for (const q of anchor.dataset.match(anchor, predicate)) {
      return termAs(new TermWrapper(q.object, anchor.dataset, anchor.factory));
    }
    return void 0;
  }
  OptionalFrom2.subjectPredicate = subjectPredicate;
})(OptionalFrom || (OptionalFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/OptionalAs.js
var OptionalAs;
(function(OptionalAs2) {
  function object(anchor, p, value, termFrom) {
    if (termFrom === void 0) {
      throw new Error();
    }
    const predicate = anchor.factory.namedNode(p);
    for (const q2 of anchor.dataset.match(anchor, predicate)) {
      anchor.dataset.delete(q2);
    }
    if (value === void 0) {
      return;
    }
    if (!isQuadSubject(anchor)) {
      return;
    }
    const o = termFrom(value, anchor.factory);
    if (o === void 0) {
      return;
    }
    if (!isQuadObject(o)) {
      return;
    }
    const q = anchor.factory.quad(anchor, predicate, o);
    anchor.dataset.add(q);
  }
  OptionalAs2.object = object;
})(OptionalAs || (OptionalAs = {}));
function isQuadSubject(term) {
  return ["NamedNode", "BlankNode", "Quad", "Variable"].includes(term.termType);
}
function isQuadObject(term) {
  return ["NamedNode", "Literal", "BlankNode", "Quad", "Variable"].includes(term.termType);
}

// node_modules/@rdfjs/wrapper/dist/mapping/RequiredAs.js
var RequiredAs;
(function(RequiredAs2) {
  function object(anchor, p, value, termFrom) {
    if (value === void 0) {
      throw new Error("value cannot be undefined");
    }
    OptionalAs.object(anchor, p, value, termFrom);
  }
  RequiredAs2.object = object;
})(RequiredAs || (RequiredAs = {}));

// node_modules/@rdfjs/wrapper/dist/ListItem.js
var ListItem = class _ListItem extends TermWrapper {
  termAs;
  termFrom;
  constructor(term, dataset, factory, termAs, termFrom) {
    super(term, dataset, factory);
    this.termAs = termAs;
    this.termFrom = termFrom;
  }
  get firstRaw() {
    return OptionalFrom.subjectPredicate(this, RDF.first, TermAs.term);
  }
  set firstRaw(value) {
    OptionalAs.object(this, RDF.first, value, TermFrom.itself);
  }
  get restRaw() {
    return OptionalFrom.subjectPredicate(this, RDF.rest, TermAs.term);
  }
  set restRaw(value) {
    OptionalAs.object(this, RDF.rest, value, TermFrom.itself);
  }
  get isListItem() {
    return this.firstRaw !== void 0 && this.restRaw !== void 0;
  }
  get isNil() {
    return this.equals(this.factory.namedNode(RDF.nil));
  }
  get first() {
    return RequiredFrom.subjectPredicate(this, RDF.first, this.termAs);
  }
  set first(value) {
    RequiredAs.object(this, RDF.first, value, this.termFrom);
  }
  get rest() {
    return RequiredFrom.subjectPredicate(this, RDF.rest, (w) => new _ListItem(w, w.dataset, w.factory, this.termAs, this.termFrom));
  }
  set rest(value) {
    RequiredAs.object(this, RDF.rest, value, TermFrom.instance);
  }
  pop() {
    try {
      return this.first;
    } finally {
      this.firstRaw = void 0;
      this.restRaw = this.factory.namedNode(RDF.nil);
    }
  }
  *items() {
    if (this.firstRaw === void 0) {
      return;
    }
    yield this;
    for (const more of this.rest.items()) {
      yield more;
    }
  }
};

// node_modules/@rdfjs/wrapper/dist/Overwriter.js
var Overwriter = class extends TermWrapper {
  p;
  constructor(subject, p) {
    super(subject, subject.dataset, subject.factory);
    this.p = p;
  }
  set listNode(object) {
    RequiredAs.object(this, this.p, object, TermFrom.instance);
  }
};

// node_modules/@rdfjs/wrapper/dist/RdfList.js
var RdfList = class {
  subject;
  predicate;
  termAs;
  termFrom;
  root;
  constructor(root, subject, predicate, termAs, termFrom) {
    this.subject = subject;
    this.predicate = predicate;
    this.termAs = termAs;
    this.termFrom = termFrom;
    this.root = new ListItem(root, this.subject.dataset, this.subject.factory, termAs, termFrom);
    return new Proxy(this, new IndexerInterceptor());
  }
  get [Symbol.unscopables]() {
    return Array.prototype[Symbol.unscopables];
  }
  get length() {
    return [...this.items].length;
  }
  set length(_) {
    throw new Error("this array is based on an RDF Collection. Its length cannot be modified like this.");
  }
  [Symbol.iterator]() {
    return this.values();
  }
  at(index) {
    return [...this.items].at(index)?.first;
  }
  concat(...items) {
    return [...this].concat(...items);
  }
  copyWithin(target, start, end) {
    throw new Error("not implemented");
  }
  entries() {
    return [...this].entries();
  }
  every(predicate, thisArg) {
    return [...this].every(predicate, thisArg);
  }
  fill(value, start, end) {
    throw new Error("not implemented");
  }
  filter(predicate, thisArg) {
    return [...this].filter(predicate, thisArg);
  }
  find(predicate, thisArg) {
    return [...this].find(predicate, thisArg);
  }
  findIndex(predicate, thisArg) {
    return [...this].findIndex(predicate, thisArg);
  }
  flat(depth) {
    throw new Error("not implemented");
  }
  flatMap(callback, thisArg) {
    return [...this].flatMap(callback, thisArg);
  }
  forEach(callback, thisArg) {
    [...this].forEach(callback, thisArg);
  }
  includes(searchElement, fromIndex) {
    return [...this].includes(searchElement, fromIndex);
  }
  indexOf(searchElement, fromIndex) {
    return [...this].indexOf(searchElement, fromIndex);
  }
  join(separator) {
    return [...this].join(separator);
  }
  keys() {
    return [...this.items].keys();
  }
  lastIndexOf(searchElement, fromIndex) {
    return [...this].lastIndexOf(searchElement, fromIndex);
  }
  map(callback, thisArg) {
    return [...this].map(callback, thisArg);
  }
  pop() {
    return [...this.items].at(-1)?.pop();
  }
  push(...items) {
    const nil = this.subject.factory.namedNode(RDF.nil);
    for (const item of items) {
      const newNode = new ListItem(this.subject.factory.blankNode(), this.subject.dataset, this.subject.factory, this.termAs, this.termFrom);
      const lastNode = this.root.isNil ? (
        // The statement representing an empty list is replaced by a new one whose object is the new node
        // The representation of the first item (root, currently rdf:nil, the empty list) is overwritten by the new node
        this.root = new Overwriter(this.subject, this.predicate).listNode = newNode
      ) : (
        // replace rest of current last with new and return is because it's the new last
        [...this.items].at(-1).rest = newNode
      );
      lastNode.first = item;
      lastNode.restRaw = nil;
    }
    return this.length;
  }
  reduce(callback, initialValue) {
    return [...this].reduce(callback, initialValue);
  }
  reduceRight(callback, initialValue) {
    return [...this].reduceRight(callback, initialValue);
  }
  reverse() {
    throw new Error("not implemented");
  }
  shift() {
    if (this.root.isNil) {
      return void 0;
    }
    const value = this.root.first;
    if (this.root.rest.isNil) {
      new Overwriter(this.subject, this.predicate).listNode = this.root.rest;
      this.root.firstRaw = void 0;
      this.root.restRaw = void 0;
    } else {
      this.root.firstRaw = this.root.rest.firstRaw;
      this.root.restRaw = this.root.rest.restRaw;
    }
    return value;
  }
  slice(start, end) {
    return [...this].slice(start, end);
  }
  some(predicate, thisArg) {
    return [...this].some(predicate, thisArg);
  }
  sort(compareFn) {
    throw new Error("not implemented");
  }
  splice(start, deleteCount, ...items) {
    throw new Error("not implemented");
  }
  unshift(...items) {
    for (const item of items.reverse()) {
      const firstNode = this.root;
      this.root = new Overwriter(this.subject, this.predicate).listNode = new ListItem(this.subject.factory.blankNode(), this.subject.dataset, this.subject.factory, this.termAs, this.termFrom);
      this.root.first = item;
      this.root.rest = firstNode;
    }
    return this.length;
  }
  *values() {
    for (const item of this.items) {
      yield item.first;
    }
  }
  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
  get items() {
    return this.root.items();
  }
};

// node_modules/@rdfjs/wrapper/dist/errors/WrapperError.js
var WrapperError = class extends Error {
  /**
   * Creates a new instance of {@link WrapperError}.
   *
   * @param message - A human-readable description of the error.
   * @param cause - The specific original cause of the error.
   */
  constructor(message, cause) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
  }
  //#region Ignore in documentation
  /** @ignore */
  static captureStackTrace(targetObject, constructorOpt) {
    super.captureStackTrace(targetObject, constructorOpt);
  }
  /** @ignore */
  static prepareStackTrace(err, stackTraces) {
    super.prepareStackTrace(err, stackTraces);
  }
  /** @ignore */
  static get stackTraceLimit() {
    return super.stackTraceLimit;
  }
  /** @ignore */
  static set stackTraceLimit(value) {
    super.stackTraceLimit = value;
  }
};

// node_modules/@rdfjs/wrapper/dist/errors/TermError.js
var TermError = class extends WrapperError {
  term;
  /**
   * Creates a new instance of {@link TermError}.
   *
   * @param term - The term associated with this error.
   * @param message - A human-readable description of the error.
   * @param cause - The specific original cause of the error.
   */
  constructor(term, message, cause) {
    super(message, cause);
    this.term = term;
  }
};

// node_modules/@rdfjs/wrapper/dist/errors/TermTypeError.js
var TermTypeError = class extends TermError {
  termType;
  /**
   * Creates a new instance of {@link TermTypeError}.
   *
   * @param term - The term associated with this error.
   * @param termType - The expected term type.
   * @param cause - The specific original cause of the error.
   */
  constructor(term, termType, cause) {
    super(term, `Term type must be ${termType} but was ${term.termType}`, cause);
    this.termType = termType;
  }
};

// node_modules/@rdfjs/wrapper/dist/errors/LiteralDatatypeError.js
var LiteralDatatypeError = class extends TermError {
  datatypes;
  /**
   * Creates a new instance of {@link LiteralDatatypeError}.
   *
   * @param literal - The literal associated with this error.
   * @param datatypes - The expected datatypes.
   * @param cause - The specific original cause of the error.
   */
  constructor(literal, datatypes, cause) {
    super(literal, `Datatype must be one of ${[...datatypes].join()} but was ${literal.datatype}`, cause);
    this.datatypes = datatypes;
  }
};

// node_modules/@rdfjs/wrapper/dist/errors/ListRootError.js
var ListRootError = class extends TermError {
  constructor(term, cause) {
    super(term, `List root must be rdf:nil or a BlankNode but was ${term.value}`, cause);
  }
};

// node_modules/@rdfjs/wrapper/dist/ensure.js
function ensurePresent(object) {
  if (object !== void 0 && object !== null) {
    return;
  }
  throw new ReferenceError("Object must not be undefined or null");
}
function ensureIs(object, type) {
  if (object instanceof type) {
    return;
  }
  throw new TypeError(`Object must be a ${type}`);
}
function ensureTermType(term, type) {
  if (term.termType === type) {
    return;
  }
  throw new TermTypeError(term, type);
}
function ensureDatatype(term, ...datatypes) {
  if (datatypes.includes(term.datatype.value)) {
    return;
  }
  throw new LiteralDatatypeError(term, datatypes);
}
function ensureListRoot(term) {
  if (term.termType === "NamedNode" && term.value === RDF.nil) {
    return;
  }
  if (term.termType === "BlankNode") {
    return;
  }
  throw new ListRootError(term);
}

// node_modules/@rdfjs/wrapper/dist/mapping/TermAs.js
var TermAs;
(function(TermAs2) {
  function instance(constructor) {
    return (term2) => {
      ensurePresent(term2);
      ensureIs(term2, TermWrapper);
      return new constructor(term2, term2.dataset, term2.factory);
    };
  }
  TermAs2.instance = instance;
  function is(term2) {
    return term2;
  }
  TermAs2.is = is;
  function list(subject, predicate, termAs, termFrom) {
    return (term2) => {
      ensurePresent(term2);
      ensureIs(term2, TermWrapper);
      ensureListRoot(term2);
      return new RdfList(term2, subject, predicate, termAs, termFrom);
    };
  }
  TermAs2.list = list;
  function term(term2) {
    return term2;
  }
  TermAs2.term = term;
})(TermAs || (TermAs = {}));

// node_modules/@rdfjs/wrapper/dist/vocabulary/XSD.js
var XSD = {
  anyURI: "http://www.w3.org/2001/XMLSchema#anyURI",
  base64Binary: "http://www.w3.org/2001/XMLSchema#base64Binary",
  boolean: "http://www.w3.org/2001/XMLSchema#boolean",
  byte: "http://www.w3.org/2001/XMLSchema#byte",
  date: "http://www.w3.org/2001/XMLSchema#date",
  dateTime: "http://www.w3.org/2001/XMLSchema#dateTime",
  decimal: "http://www.w3.org/2001/XMLSchema#decimal",
  double: "http://www.w3.org/2001/XMLSchema#double",
  float: "http://www.w3.org/2001/XMLSchema#float",
  hexBinary: "http://www.w3.org/2001/XMLSchema#hexBinary",
  int: "http://www.w3.org/2001/XMLSchema#int",
  integer: "http://www.w3.org/2001/XMLSchema#integer",
  long: "http://www.w3.org/2001/XMLSchema#long",
  negativeInteger: "http://www.w3.org/2001/XMLSchema#negativeInteger",
  nonNegativeInteger: "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
  nonPositiveInteger: "http://www.w3.org/2001/XMLSchema#nonPositiveInteger",
  positiveInteger: "http://www.w3.org/2001/XMLSchema#positiveInteger",
  short: "http://www.w3.org/2001/XMLSchema#short",
  string: "http://www.w3.org/2001/XMLSchema#string",
  unsignedByte: "http://www.w3.org/2001/XMLSchema#unsignedByte",
  unsignedInt: "http://www.w3.org/2001/XMLSchema#unsignedInt",
  unsignedLong: "http://www.w3.org/2001/XMLSchema#unsignedLong",
  unsignedShort: "http://www.w3.org/2001/XMLSchema#unsignedShort"
};

// node_modules/@rdfjs/wrapper/dist/mapping/LiteralAs.js
var LiteralAs;
(function(LiteralAs2) {
  function bigint(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, ...integerDatatypes);
    return BigInt(term.value);
  }
  LiteralAs2.bigint = bigint;
  function boolean(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, XSD.boolean);
    return term.value === "true" || term.value === "1";
  }
  LiteralAs2.boolean = boolean;
  function date(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, ...dateDatatypes);
    return new Date(term.value);
  }
  LiteralAs2.date = date;
  function langString(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, RDF.langString);
    return { lang: term.language, string: term.value };
  }
  LiteralAs2.langString = langString;
  function number(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, ...numericDatatypes);
    if (term.value === "INF") {
      return Number.POSITIVE_INFINITY;
    }
    if (term.value === "-INF") {
      return Number.NEGATIVE_INFINITY;
    }
    if (term.value === "NaN") {
      return Number.NaN;
    }
    return Number(term.value);
  }
  LiteralAs2.number = number;
  function string(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    return term.value;
  }
  LiteralAs2.string = string;
  function symbol(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    return Symbol.for(term.value);
  }
  LiteralAs2.symbol = symbol;
  function uInt8Array(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, ...byteArrayDatatypes);
    switch (term.datatype.value) {
      case XSD.hexBinary:
        return Uint8Array.from(Buffer.from(term.value, "hex"));
      default:
      case XSD.base64Binary:
        return Uint8Array.from(Buffer.from(term.value, "base64"));
    }
  }
  LiteralAs2.uInt8Array = uInt8Array;
  function url(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, XSD.anyURI);
    return new URL(term.value);
  }
  LiteralAs2.url = url;
  function langTuple(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    ensureDatatype(term, RDF.langString);
    return [term.language, term.value];
  }
  LiteralAs2.langTuple = langTuple;
  function datatypeTuple(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "Literal");
    return [term.datatype.value, term.value];
  }
  LiteralAs2.datatypeTuple = datatypeTuple;
})(LiteralAs || (LiteralAs = {}));
var byteArrayDatatypes = [
  XSD.base64Binary,
  XSD.hexBinary
];
var integerDatatypes = [
  XSD.integer,
  XSD.nonPositiveInteger,
  XSD.long,
  XSD.nonNegativeInteger,
  XSD.negativeInteger,
  XSD.int,
  XSD.unsignedLong,
  XSD.positiveInteger,
  XSD.short,
  XSD.unsignedInt,
  XSD.byte,
  XSD.unsignedShort,
  XSD.unsignedByte
];
var numericDatatypes = integerDatatypes.concat([
  XSD.decimal,
  XSD.float,
  XSD.double
]);
var dateDatatypes = [
  XSD.date,
  XSD.dateTime
];

// node_modules/@rdfjs/wrapper/dist/mapping/LiteralFrom.js
var LiteralFrom;
(function(LiteralFrom2) {
  function anyUriString(value, factory) {
    return factory.literal(value, factory.namedNode(XSD.anyURI));
  }
  LiteralFrom2.anyUriString = anyUriString;
  function anyUriUrl(value, factory) {
    return anyUriString(value.toString(), factory);
  }
  LiteralFrom2.anyUriUrl = anyUriUrl;
  function base64(value, factory) {
    return factory.literal(value.toBase64(), factory.namedNode(XSD.base64Binary));
  }
  LiteralFrom2.base64 = base64;
  function boolean(value, factory) {
    return factory.literal(value.toString(), factory.namedNode(XSD.boolean));
  }
  LiteralFrom2.boolean = boolean;
  function date(value, factory) {
    return factory.literal(value.toISOString(), factory.namedNode(XSD.date));
  }
  LiteralFrom2.date = date;
  function dateTime(value, factory) {
    return factory.literal(value.toISOString(), factory.namedNode(XSD.dateTime));
  }
  LiteralFrom2.dateTime = dateTime;
  function double(value, factory) {
    return factory.literal(value.toString(), factory.namedNode(XSD.double));
  }
  LiteralFrom2.double = double;
  function integer(value, factory) {
    return factory.literal(value.toString(), factory.namedNode(XSD.integer));
  }
  LiteralFrom2.integer = integer;
  function hex(value, factory) {
    return factory.literal(value.toHex(), factory.namedNode(XSD.hexBinary));
  }
  LiteralFrom2.hex = hex;
  function langString(value, factory) {
    return factory.literal(value.string, { language: value.lang });
  }
  LiteralFrom2.langString = langString;
  function string(value, factory) {
    return factory.literal(value);
  }
  LiteralFrom2.string = string;
  function langTuple([key, value], factory) {
    return factory.literal(value, key);
  }
  LiteralFrom2.langTuple = langTuple;
  function datatypeTuple([key, value], factory) {
    return factory.literal(value, factory.namedNode(key));
  }
  LiteralFrom2.datatypeTuple = datatypeTuple;
})(LiteralFrom || (LiteralFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/NamedNodeFrom.js
var NamedNodeFrom;
(function(NamedNodeFrom2) {
  function string(value, factory) {
    return factory.namedNode(value);
  }
  NamedNodeFrom2.string = string;
  function url(value, factory) {
    return string(value.toString(), factory);
  }
  NamedNodeFrom2.url = url;
})(NamedNodeFrom || (NamedNodeFrom = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/NamedNodeAs.js
var NamedNodeAs;
(function(NamedNodeAs2) {
  function string(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "NamedNode");
    return term.value;
  }
  NamedNodeAs2.string = string;
  function url(term) {
    ensurePresent(term);
    ensureIs(term, TermWrapper);
    ensureTermType(term, "NamedNode");
    return new URL(term.value);
  }
  NamedNodeAs2.url = url;
})(NamedNodeAs || (NamedNodeAs = {}));

// node_modules/@rdfjs/wrapper/dist/mapping/BlankNodeFrom.js
var BlankNodeFrom;
(function(BlankNodeFrom2) {
  function string(value, factory) {
    return factory.blankNode(value);
  }
  BlankNodeFrom2.string = string;
})(BlankNodeFrom || (BlankNodeFrom = {}));

// node_modules/@rdfjs/wrapper/dist/WrappingMap.js
var WrappingMap = class {
  subject;
  predicate;
  termAs;
  termFrom;
  constructor(subject, predicate, termAs, termFrom) {
    this.subject = subject;
    this.predicate = predicate;
    this.termAs = termAs;
    this.termFrom = termFrom;
  }
  clear() {
    for (const q of this.matches) {
      this.subject.dataset.delete(q);
    }
  }
  delete(k) {
    const p = this.subject.factory.namedNode(this.predicate);
    for (const entry of this) {
      if (entry[0] !== k) {
        continue;
      }
      this.subject.dataset.delete(this.subject.factory.quad(this.subject, p, this.termFrom(entry, this.subject.factory)));
      return true;
    }
    return false;
  }
  forEach(callback, thisArg) {
    for (const [key, value] of this) {
      callback.call(thisArg, value, key, this);
    }
  }
  get(k) {
    for (const [key, value] of this) {
      if (key !== k) {
        continue;
      }
      return value;
    }
    return void 0;
  }
  has(k) {
    return this.get(k) !== void 0;
  }
  set(k, v) {
    this.delete(k);
    this.add(k, v);
    return this;
  }
  get size() {
    return [...this.matches].length;
  }
  set size(_) {
    throw new Error("not supported");
  }
  *entries() {
    for (const quad of this.matches) {
      yield this.termAs(new TermWrapper(quad.object, this.subject.dataset, this.subject.factory));
    }
  }
  *keys() {
    for (const [key] of this) {
      yield key;
    }
  }
  *values() {
    for (const [, value] of this) {
      yield value;
    }
  }
  [Symbol.iterator]() {
    return this.entries();
  }
  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
  get matches() {
    const p = this.subject.factory.namedNode(this.predicate);
    return this.subject.dataset.match(this.subject, p);
  }
  add(k, v) {
    const p = this.subject.factory.namedNode(this.predicate);
    this.subject.dataset.add(this.subject.factory.quad(this.subject, p, this.termFrom([k, v], this.subject.factory)));
  }
};

// node_modules/@rdfjs/wrapper/dist/mapping/Mapping.js
var Mapping;
(function(Mapping2) {
  function languageDictionary(anchor, p, termAs, termFrom) {
    if (termAs === void 0) {
      throw new Error();
    }
    if (termFrom === void 0) {
      throw new Error();
    }
    return new WrappingMap(anchor, p, termAs, termFrom);
  }
  Mapping2.languageDictionary = languageDictionary;
})(Mapping || (Mapping = {}));

// node_modules/@rdfjs/wrapper/dist/WrappingSet.js
var WrappingSet = class {
  subject;
  predicate;
  termAs;
  termFrom;
  // TODO: Direction
  constructor(subject, predicate, termAs, termFrom) {
    this.subject = subject;
    this.predicate = predicate;
    this.termAs = termAs;
    this.termFrom = termFrom;
  }
  add(value) {
    this.subject.dataset.add(this.quad(value));
    return this;
  }
  clear() {
    for (const q of this.matches) {
      this.subject.dataset.delete(q);
    }
  }
  delete(value) {
    if (!this.has(value)) {
      return false;
    }
    const o = this.termFrom(value, this.subject.factory);
    const p = this.subject.factory.namedNode(this.predicate);
    for (const q of this.subject.dataset.match(this.subject, p, o)) {
      this.subject.dataset.delete(q);
    }
    return true;
  }
  forEach(cb, thisArg) {
    for (const item of this) {
      cb.call(thisArg, item, item, this);
    }
  }
  has(value) {
    return this.subject.dataset.has(this.quad(value));
  }
  get size() {
    return this.matches.size;
  }
  [Symbol.iterator]() {
    return this.values();
  }
  *entries() {
    for (const v of this) {
      yield [v, v];
    }
  }
  keys() {
    return this.values();
  }
  *values() {
    for (const q of this.matches) {
      yield this.termAs(new TermWrapper(q.object, this.subject.dataset, this.subject.factory));
    }
  }
  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
  quad(value) {
    const s = this.subject;
    const p = this.subject.factory.namedNode(this.predicate);
    const o = this.termFrom(value, this.subject.factory);
    const q = this.subject.factory.quad(s, p, o);
    return q;
  }
  get matches() {
    const p = this.subject.factory.namedNode(this.predicate);
    return this.subject.dataset.match(this.subject, p);
  }
};

// node_modules/@rdfjs/wrapper/dist/mapping/SetFrom.js
var SetFrom;
(function(SetFrom2) {
  function subjectPredicate(anchor, p, termAs, termFrom) {
    if (termAs === void 0) {
      throw new Error();
    }
    if (termFrom === void 0) {
      throw new Error();
    }
    return new WrappingSet(anchor, p, termAs, termFrom);
  }
  SetFrom2.subjectPredicate = subjectPredicate;
})(SetFrom || (SetFrom = {}));

// node_modules/@rdfjs/wrapper/dist/DatasetWrapper.js
var DatasetWrapper = class {
  dataset;
  factory;
  //#region DatasetCore
  constructor(dataset, factory) {
    this.dataset = dataset;
    this.factory = factory;
  }
  get size() {
    return this.dataset.size;
  }
  *[Symbol.iterator]() {
    yield* this.dataset;
  }
  add(quad) {
    this.dataset.add(quad);
    return this;
  }
  delete(quad) {
    this.dataset.delete(quad);
    return this;
  }
  has(quad) {
    return this.dataset.has(quad);
  }
  match(subject, predicate, object, graph) {
    return this.dataset.match(subject, predicate, object, graph);
  }
  //#endregion
  //#region Utilities
  subjectsOf(predicate, termWrapper) {
    return this.matchSubjectsOf(termWrapper, this.factory.namedNode(predicate));
  }
  objectsOf(predicate, termWrapper) {
    return this.matchObjectsOf(termWrapper, void 0, this.factory.namedNode(predicate));
  }
  instancesOf(klass, constructor) {
    return this.matchSubjectsOf(constructor, this.factory.namedNode(RDF.type), this.factory.namedNode(klass));
  }
  named(graph, klass) {
    const g = typeof graph === "string" ? this.factory.namedNode(graph) : graph;
    return new klass(g, this.dataset, this.factory);
  }
  *matchSubjectsOf(termWrapper, predicate, object, graph) {
    for (const q of this.match(void 0, predicate, object, graph)) {
      yield new termWrapper(q.subject, this, this.factory);
    }
  }
  *matchObjectsOf(termWrapper, subject, predicate, graph) {
    for (const q of this.match(subject, predicate, void 0, graph)) {
      yield new termWrapper(q.object, this, this.factory);
    }
  }
  //#endregion
  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
};

// node_modules/@solid/object/dist/vocabulary/dc.js
var DC = {
  modified: "http://purl.org/dc/terms/modified",
  title: "http://purl.org/dc/terms/title"
};

// node_modules/@solid/object/dist/vocabulary/ldp.js
var LDP = {
  contains: "http://www.w3.org/ns/ldp#contains"
};

// node_modules/@solid/object/dist/vocabulary/posix.js
var POSIX = {
  size: "http://www.w3.org/ns/posix/stat#size",
  mtime: "http://www.w3.org/ns/posix/stat#mtime"
};

// node_modules/@solid/object/dist/vocabulary/rdf.js
var RDF2 = {
  type: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
};

// node_modules/@solid/object/dist/vocabulary/rdfs.js
var RDFS = {
  label: "http://www.w3.org/2000/01/rdf-schema#label"
};

// node_modules/@solid/object/dist/solid/Resource.js
var Resource = class extends TermWrapper {
  #ianaMediaTypePattern = /^http:\/\/www\.w3\.org\/ns\/iana\/media-types\/(.+)#Resource$/;
  get id() {
    return this.value;
  }
  get isContainer() {
    return this.id.endsWith("/");
  }
  get fileType() {
    return this.isContainer ? "folder" : "file";
  }
  get title() {
    return OptionalFrom.subjectPredicate(this, DC.title, LiteralAs.string);
  }
  get label() {
    return OptionalFrom.subjectPredicate(this, RDFS.label, LiteralAs.string);
  }
  get name() {
    return this.title ?? this.label ?? this.extractNameFromUrl(this.id);
  }
  get modified() {
    return OptionalFrom.subjectPredicate(this, DC.modified, LiteralAs.date);
  }
  get mtime() {
    return OptionalFrom.subjectPredicate(this, POSIX.mtime, LiteralAs.date);
  }
  get lastModified() {
    return this.modified ?? this.mtime;
  }
  get size() {
    return OptionalFrom.subjectPredicate(this, POSIX.size, LiteralAs.number);
  }
  get type() {
    return SetFrom.subjectPredicate(this, RDF2.type, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get mimeType() {
    const matches = [...this.type].map((t) => this.#ianaMediaTypePattern.exec(t)).filter((results) => results !== null).map((results) => results[0]);
    for (const match of matches) {
      return match;
    }
    return;
  }
  toString() {
    return this.id;
  }
  // TODO: review implementation of this
  extractNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/").filter(Boolean);
      let name = pathParts[pathParts.length - 1] || urlObj.hostname;
      try {
        name = decodeURIComponent(name);
      } catch (e) {
      }
      return name;
    } catch (e) {
      const parts = url.split("/").filter(Boolean);
      const lastPart = parts[parts.length - 1] || url;
      try {
        return decodeURIComponent(lastPart);
      } catch {
        return lastPart;
      }
    }
  }
};

// node_modules/@solid/object/dist/solid/Container.js
var Container = class extends Resource {
  get contains() {
    return SetFrom.subjectPredicate(this, LDP.contains, TermAs.instance(Resource), TermFrom.instance);
  }
};

// node_modules/@solid/object/dist/solid/ContainerDataset.js
var ContainerDataset = class extends DatasetWrapper {
  // TODO: Consider that this might be undefined if there are no contained resources. We might need different matching.
  get container() {
    for (const s of this.subjectsOf(LDP.contains, Container)) {
      return s;
    }
    return;
  }
};

// src/container.ts
var import_n32 = require("n3");

// src/scope.ts
function redactUserinfo(value) {
  if (typeof value !== "string") {
    return String(value);
  }
  return value.replace(/\/\/[^/?#]*@/g, "//<redacted>@");
}
function normalizePodBase(base) {
  if (typeof base !== "string" || base.trim().length === 0) {
    throw new Error("[n8n-nodes-solid] pod base URL must be a non-empty string");
  }
  let url;
  try {
    url = new URL(base.trim());
  } catch {
    throw new Error(
      `[n8n-nodes-solid] pod base URL must be absolute, got: ${redactUserinfo(base)}`
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `[n8n-nodes-solid] pod base URL must be http(s), got protocol: ${url.protocol}`
    );
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}
function assertWithinPod(base, url) {
  const b = new URL(base);
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`[n8n-nodes-solid] target URL is invalid: ${redactUserinfo(url)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(
      `[n8n-nodes-solid] target URL must be http(s), got protocol: ${u.protocol} (refused)`
    );
  }
  if (u.origin !== b.origin) {
    throw new Error(
      `[n8n-nodes-solid] target URL ${redactUserinfo(url)} escapes pod origin ${b.origin} (refused)`
    );
  }
  if (!u.pathname.startsWith(b.pathname)) {
    throw new Error(
      `[n8n-nodes-solid] target URL ${redactUserinfo(url)} escapes pod path ${b.pathname} (refused)`
    );
  }
}
function resolveTarget(base, target) {
  if (typeof target !== "string" || target.trim().length === 0) {
    throw new Error("[n8n-nodes-solid] target must be a non-empty string");
  }
  const trimmed = target.trim();
  if (trimmed.startsWith("//")) {
    throw new Error(
      `[n8n-nodes-solid] target must not be scheme-relative ("//..."): ${redactUserinfo(target)} (refused)`
    );
  }
  let resolved;
  try {
    const ref = /^https?:\/\//i.test(trimmed) ? trimmed : trimmed.replace(/^\/+/, "");
    resolved = new URL(ref, base);
  } catch {
    throw new Error(`[n8n-nodes-solid] target URL is invalid: ${redactUserinfo(target)}`);
  }
  if (resolved.username !== "" || resolved.password !== "") {
    throw new Error(
      "[n8n-nodes-solid] target URL must not embed credentials (user:pass@) (refused)"
    );
  }
  const url = resolved.toString();
  assertWithinPod(base, url);
  return { url, container: isContainerUrl(url) };
}
function isContainerUrl(url) {
  try {
    return new URL(url).pathname.endsWith("/");
  } catch {
    return url.endsWith("/");
  }
}

// src/container.ts
async function parseContainerListing(body, contentType2, containerUrl, base) {
  const dataset = await parseRdf(body, contentType2, { baseIRI: containerUrl });
  const container = new ContainerDataset(dataset, import_n32.DataFactory).container;
  if (!container) {
    return [];
  }
  const members = [];
  for (const resource of container.contains) {
    const absolute = new URL(resource.id, containerUrl).toString();
    try {
      assertWithinPod(base, absolute);
    } catch {
      continue;
    }
    if (absolute === containerUrl) {
      continue;
    }
    members.push({ url: absolute, container: isContainerUrl(absolute) });
  }
  return members;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  assertWithinPod,
  isContainerUrl,
  normalizePodBase,
  parseContainerListing,
  redactUserinfo,
  resolveTarget
});
//# sourceMappingURL=index.js.map
