import {
  AccessDeniedError,
  DataController,
  DataControllerError,
  DataFormatError,
  JeswrShaclView,
  N3DataFactory_default,
  N3Store,
  NetworkError,
  NotFoundError,
  VALUES_SUBJECT_SENTINEL,
  b,
  classifyReadError,
  countTurtleQuads,
  i,
  neutraliseValuesTurtle,
  resolveGraphToTurtle,
  serializeTurtle
} from "./chunks/chunk-RABM7REG.js";
import "./chunks/chunk-BNRDLDVI.js";

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
    const i2 = Number.parseInt(property);
    target.fill(value, i2, i2 + 1);
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

// node_modules/@jeswr/solid-task-model/dist/iri.js
function httpIriOrUndefined(value) {
  if (!value)
    return void 0;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : void 0;
  } catch {
    return void 0;
  }
}
function isHttpIri(value) {
  return value !== void 0 && httpIriOrUndefined(value) === value;
}

// node_modules/@jeswr/solid-task-model/dist/vocab.js
var WF = "http://www.w3.org/2005/01/wf/flow#";
var DCT = "http://purl.org/dc/terms/";
var RDF2 = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var SCHEMA = "http://schema.org/";
var PROV = "http://www.w3.org/ns/prov#";
var VCARD = "http://www.w3.org/2006/vcard/ns#";
var wf = (local) => `${WF}${local}`;
var dct = (local) => `${DCT}${local}`;
var rdf = (local) => `${RDF2}${local}`;
var schema = (local) => `${SCHEMA}${local}`;
var prov = (local) => `${PROV}${local}`;
var vcard = (local) => `${VCARD}${local}`;
var TASK_CLASS = wf("Task");
var WF_OPEN = wf("Open");
var WF_CLOSED = wf("Closed");
var RDF_TYPE = rdf("type");
var WF_TRACKER = wf("Tracker");
var WF_ISSUE_CLASS = wf("issueClass");
var WF_ISSUE_CATEGORY = wf("issueCategory");
var WF_STATE = wf("State");
var WF_INITIAL_STATE = wf("initialState");
var WF_ALLOWED_TRANS = wf("allowedTransitions");
var WF_STATE_STORE = wf("stateStore");
var WF_ASSIGNEE_GROUP = wf("assigneeGroup");
var VCARD_ADDRESS_BOOK = vcard("AddressBook");
var VCARD_NAME_EMAIL_INDEX = vcard("nameEmailIndex");
var VCARD_GROUP_INDEX = vcard("groupIndex");
var VCARD_IN_ADDRESS_BOOK = vcard("inAddressBook");
var VCARD_INCLUDES_GROUP = vcard("includesGroup");
var VCARD_INDIVIDUAL = vcard("Individual");
var VCARD_GROUP = vcard("Group");
var VCARD_FN = vcard("fn");
var VCARD_HAS_EMAIL = vcard("hasEmail");
var VCARD_HAS_TELEPHONE = vcard("hasTelephone");
var VCARD_HAS_UID = vcard("hasUID");
var VCARD_URL = vcard("url");
var VCARD_NOTE = vcard("note");
var VCARD_ORGANIZATION_NAME = vcard("organization-name");
var VCARD_VALUE = vcard("value");
var VCARD_HAS_MEMBER = vcard("hasMember");
var VCARD_HOME = vcard("Home");
var VCARD_CELL = vcard("Cell");
var VCARD_WEB_ID = vcard("WebId");

// node_modules/@jeswr/solid-task-model/dist/task.js
var PRIORITIES = ["high", "medium", "low"];
function normalizePriority(value) {
  const v = (value ?? "").toLowerCase().trim();
  return PRIORITIES.includes(v) ? v : void 0;
}
var Task = class extends TermWrapper {
  /** The task subject IRI. */
  get id() {
    return this.value;
  }
  /** The `rdf:type` set as a live set of IRI strings. */
  get types() {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** Stamp this subject as a `wf:Task`. Idempotent; returns `this` for chaining. */
  mark() {
    this.types.add(TASK_CLASS);
    return this;
  }
  /** Whether this subject is a `wf:Task`. */
  get isTask() {
    return this.types.has(TASK_CLASS);
  }
  get title() {
    return OptionalFrom.subjectPredicate(this, dct("title"), LiteralAs.string);
  }
  set title(value) {
    OptionalAs.object(this, dct("title"), value, LiteralFrom.string);
  }
  /**
   * The body. The two existing producers DIVERGE on the predicate — solid-issues
   * writes `wf:description`, the Pod Manager writes `dct:description` — so the
   * shared model must read BOTH or it would silently drop a PM-written body on a
   * cross-app read. The getter prefers `wf:description` and falls back to
   * `dct:description`; the setter writes BOTH (and clears both on undefined) so a
   * consumer querying either predicate finds it. This is the convergence point:
   * once apps adopt this package they all read/write the same pair.
   */
  get description() {
    return OptionalFrom.subjectPredicate(this, wf("description"), LiteralAs.string) ?? OptionalFrom.subjectPredicate(this, dct("description"), LiteralAs.string);
  }
  set description(value) {
    OptionalAs.object(this, wf("description"), value, LiteralFrom.string);
    OptionalAs.object(this, dct("description"), value, LiteralFrom.string);
  }
  get created() {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }
  get modified() {
    return OptionalFrom.subjectPredicate(this, dct("modified"), LiteralAs.date);
  }
  set modified(value) {
    OptionalAs.object(this, dct("modified"), value, LiteralFrom.dateTime);
  }
  /** `prov:endedAtTime` — completion time. Set automatically by {@link state}. */
  get endedAt() {
    return OptionalFrom.subjectPredicate(this, prov("endedAtTime"), LiteralAs.date);
  }
  set endedAt(value) {
    OptionalAs.object(this, prov("endedAtTime"), value, LiteralFrom.dateTime);
  }
  get creator() {
    return OptionalFrom.subjectPredicate(this, dct("creator"), NamedNodeAs.string);
  }
  set creator(value) {
    OptionalAs.object(this, dct("creator"), value, NamedNodeFrom.string);
  }
  /** `wf:assignee` — the assigned agent's WebID. */
  get assignee() {
    return OptionalFrom.subjectPredicate(this, wf("assignee"), NamedNodeAs.string);
  }
  set assignee(value) {
    OptionalAs.object(this, wf("assignee"), value, NamedNodeFrom.string);
  }
  /** `wf:tracker` — the project / tracker document. */
  get project() {
    return OptionalFrom.subjectPredicate(this, wf("tracker"), NamedNodeAs.string);
  }
  set project(value) {
    OptionalAs.object(this, wf("tracker"), value, NamedNodeFrom.string);
  }
  /** `wf:dateDue` — the due date (stored as xsd:dateTime; well-formed + round-trips). */
  get dueDate() {
    return OptionalFrom.subjectPredicate(this, wf("dateDue"), LiteralAs.date);
  }
  set dueDate(value) {
    OptionalAs.object(this, wf("dateDue"), value, LiteralFrom.dateTime);
  }
  /** `schema:priority` — high/medium/low, as a string literal. */
  get priority() {
    return normalizePriority(OptionalFrom.subjectPredicate(this, schema("priority"), LiteralAs.string));
  }
  set priority(value) {
    OptionalAs.object(this, schema("priority"), value, LiteralFrom.string);
  }
  /** `schema:position` — backlog rank; lower sorts first. */
  get rank() {
    return OptionalFrom.subjectPredicate(this, schema("position"), LiteralAs.number);
  }
  set rank(value) {
    OptionalAs.object(this, schema("position"), value, LiteralFrom.double);
  }
  /** `dct:isPartOf` — the parent issue. */
  get parent() {
    return OptionalFrom.subjectPredicate(this, dct("isPartOf"), NamedNodeAs.string);
  }
  set parent(value) {
    OptionalAs.object(this, dct("isPartOf"), value, NamedNodeFrom.string);
  }
  /** `dct:isReplacedBy` — the canonical successor (close-as-duplicate). */
  get duplicateOf() {
    return OptionalFrom.subjectPredicate(this, dct("isReplacedBy"), NamedNodeAs.string);
  }
  set duplicateOf(value) {
    OptionalAs.object(this, dct("isReplacedBy"), value, NamedNodeFrom.string);
  }
  /** `prov:wasDerivedFrom` — the single original this task was cloned from. */
  get clonedFrom() {
    return OptionalFrom.subjectPredicate(this, prov("wasDerivedFrom"), NamedNodeAs.string);
  }
  set clonedFrom(value) {
    OptionalAs.object(this, prov("wasDerivedFrom"), value, NamedNodeFrom.string);
  }
  /** `dct:requires` — issues this one is blocked by (live set of IRIs). */
  get blockedBy() {
    return SetFrom.subjectPredicate(this, dct("requires"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** `dct:relation` — non-blocking, symmetric relates-to links (live set of IRIs). */
  get relatesTo() {
    return SetFrom.subjectPredicate(this, dct("relation"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  /**
   * Lifecycle state, read from / written to `rdf:type wf:Open` / `wf:Closed`.
   * Setting `closed` stamps `prov:endedAtTime` (once — preserved on re-close);
   * setting `open` clears it. Always keeps `wf:Task` typed.
   */
  get state() {
    return this.types.has(WF_CLOSED) ? "closed" : "open";
  }
  set state(value) {
    const types = this.types;
    types.add(TASK_CLASS);
    if (value === "closed") {
      types.add(WF_CLOSED);
      types.delete(WF_OPEN);
      this.endedAt ??= /* @__PURE__ */ new Date();
    } else {
      types.add(WF_OPEN);
      types.delete(WF_CLOSED);
      this.endedAt = void 0;
    }
  }
  /** Convenience: is this task open? */
  get isOpen() {
    return this.state === "open";
  }
};

// src/vocab.ts
var TASK_CLASS2 = "http://www.w3.org/2005/01/wf/flow#Task";
var VCARD_INDIVIDUAL2 = "http://www.w3.org/2006/vcard/ns#Individual";
var VCARD_ADDRESS_BOOK2 = "http://www.w3.org/2006/vcard/ns#AddressBook";
var BOOKMARK_CLASS = "https://w3id.org/jeswr/bookmark#Bookmark";
var LDP_CONTAINER = "http://www.w3.org/ns/ldp#Container";
var LDP_BASIC_CONTAINER = "http://www.w3.org/ns/ldp#BasicContainer";
var RDF_TYPE2 = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

// src/components/shared.ts
var BASE_INPUT_PROPS = ["src", "fetch", "publicFetch"];
var AbstractReadElement = class extends i {
  /** A monotonically increasing token to drop the result of a superseded read. */
  #readToken = 0;
  static properties = {
    src: {},
    fetch: { attribute: false },
    publicFetch: { attribute: false },
    publicRead: { type: Boolean, attribute: "public-read" },
    store: { attribute: false },
    status: { state: true },
    errorMessage: { state: true },
    graph: { state: true },
    baseUrl: { state: true }
  };
  constructor() {
    super();
    this.src = void 0;
    this.fetch = void 0;
    this.publicFetch = void 0;
    this.publicRead = false;
    this.store = void 0;
    this.status = "idle";
    this.errorMessage = "";
    this.graph = void 0;
    this.baseUrl = void 0;
  }
  /** Render into the light DOM so a consuming app can `::part`/style the output. */
  createRenderRoot() {
    return this;
  }
  /** The input prop names this element re-reads on. Override to extend the base set. */
  inputProps() {
    return BASE_INPUT_PROPS;
  }
  willUpdate(changed) {
    const changedKeys = changed;
    if (changedKeys.has("store")) {
      void this.#applyDirectStore();
      return;
    }
    if (this.inputProps().some((k) => changedKeys.has(k))) {
      void this.#read();
    }
  }
  /** Render the directly-set `store` (no network), or fall back to idle when cleared. */
  async #applyDirectStore() {
    const token = ++this.#readToken;
    const ds = this.store;
    if (!ds) {
      this.graph = void 0;
      this.baseUrl = void 0;
      this.status = this.src ? this.status : "idle";
      if (this.src) void this.#read();
      return;
    }
    this.graph = ds;
    this.baseUrl = this.src ?? "";
    this.errorMessage = "";
    if (token === this.#readToken) this.status = "ready";
  }
  /** Read `src` through a DataController, classify any failure, drop a superseded result. */
  async #read() {
    const token = ++this.#readToken;
    if (this.store) return;
    const src = this.src;
    if (!src) {
      this.graph = void 0;
      this.baseUrl = void 0;
      this.errorMessage = "";
      this.status = "idle";
      return;
    }
    this.status = "loading";
    this.errorMessage = "";
    const seam = {
      ...this.fetch ? { fetch: this.fetch } : {},
      ...this.publicFetch ? { publicFetch: this.publicFetch } : {}
    };
    const controller = new DataController(seam);
    try {
      const { graph, baseUrl } = await this.loadFrom(controller, src, this.publicRead);
      if (token !== this.#readToken) return;
      this.graph = graph;
      this.baseUrl = baseUrl;
      this.status = "ready";
    } catch (error) {
      if (token !== this.#readToken) return;
      this.graph = void 0;
      this.baseUrl = void 0;
      this.errorMessage = errorMessageOf(error);
      this.status = "error";
    }
  }
  render() {
    switch (this.status) {
      case "idle":
        return b`<slot name="empty"><p part="empty">Nothing to display.</p></slot>`;
      case "loading":
        return b`<slot name="loading"><p part="loading">Loading…</p></slot>`;
      case "error":
        return b`<p part="error" role="alert">${this.errorMessage}</p>`;
      default:
        return this.graph !== void 0 && this.baseUrl !== void 0 ? this.renderReady(this.graph, this.baseUrl) : b`<slot name="empty"><p part="empty">Nothing to display.</p></slot>`;
    }
  }
};
function errorMessageOf(error) {
  if (error instanceof DataControllerError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
function safeHref(value) {
  if (!value) return void 0;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? value : void 0;
  } catch {
    return void 0;
  }
}
function safeMailto(value) {
  return value && /^mailto:[^\s]+@?[^\s]*$/i.test(value) ? value : void 0;
}
function safeTel(value) {
  return value && /^tel:[^\s]+$/i.test(value) ? value : void 0;
}
function stripScheme(value) {
  return value.replace(/^(mailto:|tel:)/i, "");
}
function formatDate(date) {
  if (!date) return "";
  try {
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}

// src/components/task-list.ts
var JeswrTaskList = class extends AbstractReadElement {
  async loadFrom(controller, src, publicRead) {
    const result = await controller.read(src, publicRead ? { public: true } : {});
    return { graph: result.dataset ?? new N3Store(), baseUrl: result.url };
  }
  renderReady(graph) {
    const tasks = collectTasks(graph);
    if (tasks.length === 0) {
      return b`<slot name="empty"><p part="empty">No tasks.</p></slot>`;
    }
    return b`
      <ul part="list">
        ${tasks.map((t) => this.#renderTask(t))}
      </ul>
    `;
  }
  #renderTask(task) {
    const meta = [];
    if (task.assignee) meta.push(`Assignee: ${task.assignee}`);
    if (task.priority) meta.push(`Priority: ${task.priority}`);
    const due = formatDate(task.dueDate);
    if (due) meta.push(`Due: ${due}`);
    return b`
      <li part="task" data-state=${task.state}>
        <span part="title">${task.title ?? "(untitled task)"}</span>
        <span part="state" data-state=${task.state}>${task.state}</span>
        ${task.description ? b`<p>${task.description}</p>` : null}
        ${meta.length > 0 ? b`<small part="meta">${meta.join(" \xB7 ")}</small>` : null}
      </li>
    `;
  }
};
function collectTasks(graph) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const quad of graph.getQuads(null, N3DataFactory_default.namedNode(RDF_TYPE2), null, null)) {
    if (quad.object.value !== TASK_CLASS2) continue;
    const subject = quad.subject.value;
    if (seen.has(subject)) continue;
    seen.add(subject);
    out.push(new Task(subject, graph, N3DataFactory_default));
  }
  return out;
}
if (!customElements.get("jeswr-task-list")) {
  customElements.define("jeswr-task-list", JeswrTaskList);
}

// node_modules/@jeswr/solid-task-model/dist/contacts.js
function isMailto(value) {
  return /^mailto:.+/.test(value);
}
function isTel(value) {
  return /^tel:.+/.test(value);
}
var blankNodeLabel = (term) => term.value;
function addStructuredValue(parent, predicate, kind, iriValue) {
  const bnode = parent.factory.blankNode();
  SetFrom.subjectPredicate(parent, predicate, blankNodeLabel, BlankNodeFrom.string).add(bnode.value);
  const child = new TermWrapper(bnode, parent.dataset, parent.factory);
  SetFrom.subjectPredicate(child, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string).add(kind);
  OptionalAs.object(child, VCARD_VALUE, iriValue, NamedNodeFrom.string);
}
function readStructuredValues(parent, predicate) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const p = parent.factory.namedNode(predicate);
  for (const q of parent.dataset.match(parent, p)) {
    const obj = q.object;
    if (obj.termType === "NamedNode") {
      if (!seen.has(obj.value)) {
        seen.add(obj.value);
        out.push(obj.value);
      }
      continue;
    }
    if (obj.termType === "BlankNode") {
      const child = new TermWrapper(obj, parent.dataset, parent.factory);
      const value = OptionalFrom.subjectPredicate(child, VCARD_VALUE, NamedNodeAs.string);
      if (value !== void 0 && !seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
  }
  return out;
}
var Contact = class extends TermWrapper {
  /** The individual subject IRI (`<person>#this`). */
  get id() {
    return this.value;
  }
  /** The `rdf:type` set as a live set of IRI strings. */
  get types() {
    return SetFrom.subjectPredicate(this, rdf("type"), NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** Stamp this subject as a `vcard:Individual`. Idempotent; returns `this`. */
  mark() {
    this.types.add(VCARD_INDIVIDUAL);
    return this;
  }
  /** Whether this subject is a `vcard:Individual`. */
  get isIndividual() {
    return this.types.has(VCARD_INDIVIDUAL);
  }
  /** `vcard:fn` — the formatted/display name. */
  get name() {
    return OptionalFrom.subjectPredicate(this, VCARD_FN, LiteralAs.string);
  }
  set name(value) {
    OptionalAs.object(this, VCARD_FN, value, LiteralFrom.string);
  }
  /** `vcard:inAddressBook` — the owning address book IRI. */
  get inAddressBook() {
    return OptionalFrom.subjectPredicate(this, VCARD_IN_ADDRESS_BOOK, NamedNodeAs.string);
  }
  set inAddressBook(value) {
    OptionalAs.object(this, VCARD_IN_ADDRESS_BOOK, value, NamedNodeFrom.string);
  }
  /** `vcard:hasUID` — a stable unique id literal (the model writes `urn:uuid:<v4>`). */
  get uid() {
    return OptionalFrom.subjectPredicate(this, VCARD_HAS_UID, LiteralAs.string);
  }
  set uid(value) {
    OptionalAs.object(this, VCARD_HAS_UID, value, LiteralFrom.string);
  }
  /** `dct:created` (DC Terms) — the person document's creation time. */
  get created() {
    return OptionalFrom.subjectPredicate(this, dct("created"), LiteralAs.date);
  }
  set created(value) {
    OptionalAs.object(this, dct("created"), value, LiteralFrom.dateTime);
  }
  /** `vcard:note` — a free-text note. */
  get note() {
    return OptionalFrom.subjectPredicate(this, VCARD_NOTE, LiteralAs.string);
  }
  set note(value) {
    OptionalAs.object(this, VCARD_NOTE, value, LiteralFrom.string);
  }
  /**
   * `vcard:organization-name` — the contact's organisation/company name (the standard
   * W3C vCard `ORG` term). A plain string literal; clears the triple on `undefined`.
   */
  get organization() {
    return OptionalFrom.subjectPredicate(this, VCARD_ORGANIZATION_NAME, LiteralAs.string);
  }
  set organization(value) {
    OptionalAs.object(this, VCARD_ORGANIZATION_NAME, value, LiteralFrom.string);
  }
  /**
   * The contact's emails as canonical `mailto:` IRIs. Reads BOTH a direct
   * `vcard:hasEmail <mailto:..>` and the structured `vcard:hasEmail [ vcard:value
   * <mailto:..> ]` form (the crux behaviour). Only well-formed `mailto:` IRIs are
   * returned: pod data is untrusted, so a `javascript:`/`http:`/literal value from a
   * malicious or malformed contact is DROPPED rather than handed to UI as an email
   * (the public contract is canonical `mailto:` values).
   */
  get emails() {
    return readStructuredValues(this, VCARD_HAS_EMAIL).filter(isMailto);
  }
  /**
   * Replace the contact's emails. Clears any prior `vcard:hasEmail` (structured nodes
   * and direct IRIs), then writes each as the STRUCTURED `[ a vcard:Home; vcard:value
   * <mailto:..> ]` form SolidOS reads. Non-`mailto:` entries are dropped (untrusted
   * input). Accepts either a bare address or a full `mailto:` IRI.
   */
  setEmails(emails) {
    this.clearStructured(VCARD_HAS_EMAIL);
    for (const raw of emails) {
      const iri = raw.startsWith("mailto:") ? raw : `mailto:${raw}`;
      if (isMailto(iri))
        addStructuredValue(this, VCARD_HAS_EMAIL, VCARD_HOME, iri);
    }
  }
  /**
   * The contact's phones as canonical `tel:` IRIs. Reads BOTH a direct
   * `vcard:hasTelephone <tel:..>` and the structured `vcard:hasTelephone [ vcard:value
   * <tel:..> ]` form. Only well-formed `tel:` IRIs are returned: an untrusted/malformed
   * value (e.g. `javascript:`) is DROPPED rather than handed to UI as a phone link.
   */
  get phones() {
    return readStructuredValues(this, VCARD_HAS_TELEPHONE).filter(isTel);
  }
  /**
   * Replace the contact's phones. Clears any prior `vcard:hasTelephone`, then writes
   * each as the STRUCTURED `[ a vcard:Cell; vcard:value <tel:..> ]` form. Non-`tel:`
   * entries are dropped. Accepts either a bare number or a full `tel:` IRI.
   */
  setPhones(phones) {
    this.clearStructured(VCARD_HAS_TELEPHONE);
    for (const raw of phones) {
      const iri = raw.startsWith("tel:") ? raw : `tel:${raw}`;
      if (isTel(iri))
        addStructuredValue(this, VCARD_HAS_TELEPHONE, VCARD_CELL, iri);
    }
  }
  /**
   * The contact's WebID, read from the structured `vcard:url [ a vcard:WebId;
   * vcard:value <webid> ]` form (or a direct `vcard:url <webid>`). Only http(s) IRIs.
   */
  get webId() {
    return readStructuredValues(this, VCARD_URL).find(isHttpIri);
  }
  /**
   * Replace the contact's WebID. Clears any prior `vcard:url`, then writes the
   * structured `[ a vcard:WebId; vcard:value <webid> ]` form. A non-http(s) value is
   * dropped (untrusted input).
   */
  setWebId(webId) {
    this.clearStructured(VCARD_URL);
    if (isHttpIri(webId))
      addStructuredValue(this, VCARD_URL, VCARD_WEB_ID, webId);
  }
  /**
   * Remove every `predicate` edge AND any blank-node value node it pointed at, so a
   * replace leaves no orphan structured node behind. Direct-IRI objects are removed by
   * the edge deletion alone; blank-node objects have their own triples cleared too.
   */
  clearStructured(predicate) {
    const p = this.factory.namedNode(predicate);
    const edges = [...this.dataset.match(this, p)];
    for (const q of edges) {
      if (q.object.termType === "BlankNode") {
        for (const inner of [...this.dataset.match(q.object)])
          this.dataset.delete(inner);
      }
      this.dataset.delete(q);
    }
  }
};

// src/components/contact-list.ts
var JeswrContactList = class extends AbstractReadElement {
  async loadFrom(controller, src, publicRead) {
    const result = await controller.read(src, publicRead ? { public: true } : {});
    return { graph: result.dataset ?? new N3Store(), baseUrl: result.url };
  }
  renderReady(graph) {
    const contacts = collectContacts(graph);
    if (contacts.length === 0) {
      return b`<slot name="empty"><p part="empty">No contacts.</p></slot>`;
    }
    return b`
      <ul part="list">
        ${contacts.map((c) => this.#renderContact(c))}
      </ul>
    `;
  }
  #renderContact(contact) {
    const webIdHref = safeHref(contact.webId);
    return b`
      <li part="contact">
        <span part="name">${contact.name ?? "(unnamed contact)"}</span>
        ${contact.organization ? b`<small>${contact.organization}</small>` : null}
        ${this.#renderEmails(contact.emails)} ${this.#renderPhones(contact.phones)}
        ${webIdHref ? b`<a part="webid" href=${webIdHref} rel="noopener noreferrer">${contact.webId}</a>` : null}
        ${contact.note ? b`<p>${contact.note}</p>` : null}
      </li>
    `;
  }
  #renderEmails(emails) {
    if (emails.length === 0) return null;
    return b`<ul part="emails">
      ${emails.map((e) => {
      const href = safeMailto(e);
      const text = stripScheme(e);
      return b`<li>
          ${href ? b`<a href=${href}>${text}</a>` : b`<span>${text}</span>`}
        </li>`;
    })}
    </ul>`;
  }
  #renderPhones(phones) {
    if (phones.length === 0) return null;
    return b`<ul part="phones">
      ${phones.map((p) => {
      const href = safeTel(p);
      const text = stripScheme(p);
      return b`<li>
          ${href ? b`<a href=${href}>${text}</a>` : b`<span>${text}</span>`}
        </li>`;
    })}
    </ul>`;
  }
};
function collectContacts(graph) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const quad of graph.getQuads(null, N3DataFactory_default.namedNode(RDF_TYPE2), null, null)) {
    if (quad.object.value !== VCARD_INDIVIDUAL2) continue;
    const subject = quad.subject.value;
    if (seen.has(subject)) continue;
    seen.add(subject);
    out.push(new Contact(subject, graph, N3DataFactory_default));
  }
  return out;
}
if (!customElements.get("jeswr-contact-list")) {
  customElements.define("jeswr-contact-list", JeswrContactList);
}

// node_modules/@solid/object/dist/vocabulary/foaf.js
var FOAF = {
  isPrimaryTopicOf: "http://xmlns.com/foaf/0.1/isPrimaryTopicOf",
  primaryTopic: "http://xmlns.com/foaf/0.1/primaryTopic",
  name: "http://xmlns.com/foaf/0.1/name",
  email: "http://xmlns.com/foaf/0.1/email",
  homepage: "http://xmlns.com/foaf/0.1/homepage",
  knows: "http://xmlns.com/foaf/0.1/knows",
  /**
   * @remarks [When used in WAC](https://solidproject.org/TR/wac#acl-agentclass-foaf-agent), allows access to any agent, i.e., the public.
   */
  Agent: "http://xmlns.com/foaf/0.1/Agent"
};

// node_modules/@solid/object/dist/vocabulary/pim.js
var PIM = {
  storage: "http://www.w3.org/ns/pim/space#storage"
};

// node_modules/@solid/object/dist/vocabulary/solid.js
var SOLID = {
  oidcIssuer: "http://www.w3.org/ns/solid/terms#oidcIssuer",
  storage: "http://www.w3.org/ns/solid/terms#storage"
};

// node_modules/@solid/object/dist/vocabulary/vcard.js
var VCARD2 = {
  fn: "http://www.w3.org/2006/vcard/ns#fn",
  Email: "http://www.w3.org/2006/vcard/ns#Email",
  email: "http://www.w3.org/2006/vcard/ns#email",
  hasEmail: "http://www.w3.org/2006/vcard/ns#hasEmail",
  hasMember: "http://www.w3.org/2006/vcard/ns#hasMember",
  hasValue: "http://www.w3.org/2006/vcard/ns#hasValue",
  hasPhoto: "http://www.w3.org/2006/vcard/ns#hasPhoto",
  tel: "http://www.w3.org/2006/vcard/ns#tel",
  hasTelephone: "http://www.w3.org/2006/vcard/ns#hasTelephone",
  title: "http://www.w3.org/2006/vcard/ns#title",
  hasUrl: "http://www.w3.org/2006/vcard/ns#hasUrl",
  organizationName: "http://www.w3.org/2006/vcard/ns#organization-name",
  phone: "http://www.w3.org/2006/vcard/ns#phone",
  role: "http://www.w3.org/2006/vcard/ns#role",
  value: "http://www.w3.org/2006/vcard/ns#value",
  telephoneType: "http://www.w3.org/2006/vcard/ns#TelephoneType"
};

// node_modules/@solid/object/dist/webid/Agent.js
var Agent = class extends TermWrapper {
  get vcardFn() {
    return OptionalFrom.subjectPredicate(this, VCARD2.fn, LiteralAs.string);
  }
  get vcardHasUrl() {
    return OptionalFrom.subjectPredicate(this, VCARD2.hasUrl, NamedNodeAs.string);
  }
  get organization() {
    return OptionalFrom.subjectPredicate(this, VCARD2.organizationName, NamedNodeAs.string) ?? null;
  }
  get role() {
    return OptionalFrom.subjectPredicate(this, VCARD2.role, NamedNodeAs.string) ?? null;
  }
  get title() {
    return OptionalFrom.subjectPredicate(this, VCARD2.title, LiteralAs.string) ?? null;
  }
  get phone() {
    return this.hasTelephone?.value ?? null;
  }
  get hasTelephone() {
    return OptionalFrom.subjectPredicate(this, VCARD2.hasTelephone, TermAs.instance(HasValue));
  }
  get foafName() {
    return OptionalFrom.subjectPredicate(this, FOAF.name, LiteralAs.string);
  }
  get name() {
    return this.vcardFn ?? this.foafName ?? this.value.split("/").pop()?.split("#")[0] ?? null;
  }
  get storageUrls() {
    return /* @__PURE__ */ new Set([...this.pimStorage, ...this.solidStorage]);
  }
  get foafHomepage() {
    return OptionalFrom.subjectPredicate(this, FOAF.homepage, LiteralAs.string);
  }
  get website() {
    return this.vcardHasUrl ?? this.foafHomepage ?? null;
  }
  get photoUrl() {
    return OptionalFrom.subjectPredicate(this, VCARD2.hasPhoto, LiteralAs.string) ?? null;
  }
  get pimStorage() {
    return SetFrom.subjectPredicate(this, PIM.storage, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get solidStorage() {
    return SetFrom.subjectPredicate(this, SOLID.storage, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get oidcIssuer() {
    return SetFrom.subjectPredicate(this, SOLID.oidcIssuer, NamedNodeAs.string, NamedNodeFrom.string);
  }
  get email() {
    return this.hasEmail?.value ?? null;
  }
  get hasEmail() {
    return OptionalFrom.subjectPredicate(this, VCARD2.hasEmail, TermAs.instance(HasValue));
  }
  get knows() {
    return SetFrom.subjectPredicate(this, FOAF.knows, NamedNodeAs.string, NamedNodeFrom.string);
  }
};
var HasValue = class extends TermWrapper {
  get hasValue() {
    return OptionalFrom.subjectPredicate(this, VCARD2.hasValue, NamedNodeAs.string);
  }
};

// src/components/profile-card.ts
var VCARD_ORG_NAME = "http://www.w3.org/2006/vcard/ns#organization-name";
var VCARD_ROLE = "http://www.w3.org/2006/vcard/ns#role";
var SCHEMA_NAME = "http://schema.org/name";
var IMG_PREDICATES = [
  "http://www.w3.org/2006/vcard/ns#hasPhoto",
  "http://xmlns.com/foaf/0.1/img",
  "http://xmlns.com/foaf/0.1/depiction",
  "http://schema.org/image"
];
var SITE_PREDICATES = [
  "http://www.w3.org/2006/vcard/ns#url",
  "http://xmlns.com/foaf/0.1/homepage",
  "http://schema.org/url"
];
var JeswrProfileCard = class extends AbstractReadElement {
  async loadFrom(controller, src, publicRead) {
    const result = await controller.read(src, publicRead ? { public: true } : {});
    return { graph: result.dataset ?? new N3Store(), baseUrl: src };
  }
  renderReady(graph, baseUrl) {
    const fields = readProfileFields(graph, baseUrl);
    const hasProfileData = graph.getQuads(N3DataFactory_default.namedNode(baseUrl), null, null, null).length > 0;
    const { name, photo, website, org, role, issuer } = fields;
    if (!hasProfileData && !photo && !website && !org && !role && !issuer) {
      return b`<slot name="empty"><p part="empty">No profile to display.</p></slot>`;
    }
    const webId = safeHref(baseUrl);
    return b`
      <article part="card">
        ${photo ? b`<img part="photo" src=${photo} alt=${name ? `${name}'s avatar` : "avatar"} />` : null}
        <h2 part="name">${name ?? "(unnamed)"}</h2>
        ${org || role ? b`<p part="org">${[role, org].filter(Boolean).join(" \xB7 ")}</p>` : null}
        ${website ? b`<a part="website" href=${website} rel="noopener noreferrer">${website}</a>` : null}
        ${webId ? b`<a part="webid" href=${webId} rel="noopener noreferrer">${baseUrl}</a>` : null}
        ${issuer ? b`<small part="issuer">Issuer: ${issuer}</small>` : null}
      </article>
    `;
  }
};
function readProfileFields(graph, baseUrl) {
  const agent = new Agent(baseUrl, graph, N3DataFactory_default);
  return {
    name: tryRead(() => agent.name) ?? readValue(graph, baseUrl, [SCHEMA_NAME]) ?? void 0,
    photo: safeHref(tryRead(() => agent.photoUrl) ?? readValue(graph, baseUrl, IMG_PREDICATES)),
    website: safeHref(tryRead(() => agent.website) ?? readValue(graph, baseUrl, SITE_PREDICATES)),
    org: tryRead(() => agent.organization) ?? readValue(graph, baseUrl, [VCARD_ORG_NAME]),
    role: tryRead(() => agent.role) ?? tryRead(() => agent.title) ?? readValue(graph, baseUrl, [VCARD_ROLE]),
    issuer: safeHref(tryRead(() => [...agent.oidcIssuer][0]))
  };
}
function tryRead(read) {
  try {
    return read();
  } catch {
    return void 0;
  }
}
function readValue(graph, subject, predicates) {
  const s = N3DataFactory_default.namedNode(subject);
  for (const predicate of predicates) {
    for (const quad of graph.getQuads(s, N3DataFactory_default.namedNode(predicate), null, null)) {
      if (quad.object.termType === "Literal" || quad.object.termType === "NamedNode") {
        return quad.object.value;
      }
    }
  }
  return void 0;
}
if (!customElements.get("jeswr-profile-card")) {
  customElements.define("jeswr-profile-card", JeswrProfileCard);
}

// node_modules/@jeswr/solid-bookmark/dist/vocab.js
var BOOK = "https://w3id.org/jeswr/bookmark#";
var SCHEMA2 = "http://schema.org/";
var DCT2 = "http://purl.org/dc/terms/";
var RDF3 = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
var book = (local) => `${BOOK}${local}`;
var schema2 = (local) => `${SCHEMA2}${local}`;
var dct2 = (local) => `${DCT2}${local}`;
var rdf2 = (local) => `${RDF3}${local}`;
var BOOKMARK_CLASS2 = book("Bookmark");
var BOOK_ARCHIVED = book("archived");
var BOOK_NOTES = book("notes");
var SCHEMA_URL = schema2("url");
var SCHEMA_KEYWORDS = schema2("keywords");
var DCT_TITLE = dct2("title");
var DCT_DESCRIPTION = dct2("description");
var DCT_CREATED = dct2("created");
var DCT_MODIFIED = dct2("modified");
var RDF_TYPE3 = rdf2("type");

// node_modules/@jeswr/solid-bookmark/dist/bookmark.js
var Bookmark = class extends TermWrapper {
  /** The bookmark subject IRI. */
  get id() {
    return this.value;
  }
  /** The `rdf:type` set as a live set of IRI strings. */
  get types() {
    return SetFrom.subjectPredicate(this, RDF_TYPE3, NamedNodeAs.string, NamedNodeFrom.string);
  }
  /** Stamp this subject as a `book:Bookmark`. Idempotent; returns `this` for chaining. */
  mark() {
    this.types.add(BOOKMARK_CLASS2);
    return this;
  }
  /** Whether this subject is a `book:Bookmark`. */
  get isBookmark() {
    return this.types.has(BOOKMARK_CLASS2);
  }
  /** `schema:url` — the bookmarked URL (an http(s) IRI). */
  get url() {
    return OptionalFrom.subjectPredicate(this, SCHEMA_URL, NamedNodeAs.string);
  }
  set url(value) {
    OptionalAs.object(this, SCHEMA_URL, value, NamedNodeFrom.string);
  }
  /** `dct:title`. */
  get title() {
    return OptionalFrom.subjectPredicate(this, DCT_TITLE, LiteralAs.string);
  }
  set title(value) {
    OptionalAs.object(this, DCT_TITLE, value, LiteralFrom.string);
  }
  /** `dct:description` — the short summary / blurb. */
  get description() {
    return OptionalFrom.subjectPredicate(this, DCT_DESCRIPTION, LiteralAs.string);
  }
  set description(value) {
    OptionalAs.object(this, DCT_DESCRIPTION, value, LiteralFrom.string);
  }
  /** `book:notes` — the user's markdown notes. */
  get notes() {
    return OptionalFrom.subjectPredicate(this, BOOK_NOTES, LiteralAs.string);
  }
  set notes(value) {
    OptionalAs.object(this, BOOK_NOTES, value, LiteralFrom.string);
  }
  /**
   * `book:archived` — `xsd:boolean`. Absent triple reads as `false` (a bookmark
   * is not archived until explicitly so). The setter writes `false` explicitly
   * too, so the boolean is always observable on the wire rather than relying on
   * absence — except `undefined` clears it.
   */
  get archived() {
    return OptionalFrom.subjectPredicate(this, BOOK_ARCHIVED, LiteralAs.boolean) ?? false;
  }
  set archived(value) {
    OptionalAs.object(this, BOOK_ARCHIVED, value, LiteralFrom.boolean);
  }
  /** `dct:created`. */
  get created() {
    return OptionalFrom.subjectPredicate(this, DCT_CREATED, LiteralAs.date);
  }
  set created(value) {
    OptionalAs.object(this, DCT_CREATED, value, LiteralFrom.dateTime);
  }
  /** `dct:modified`. */
  get modified() {
    return OptionalFrom.subjectPredicate(this, DCT_MODIFIED, LiteralAs.date);
  }
  set modified(value) {
    OptionalAs.object(this, DCT_MODIFIED, value, LiteralFrom.dateTime);
  }
  /**
   * `schema:keywords` — the tags, as a live set of free-text labels (one triple
   * per tag). A `Set` rather than a list because tags are unordered + unique.
   */
  get tags() {
    return SetFrom.subjectPredicate(this, SCHEMA_KEYWORDS, LiteralAs.string, LiteralFrom.string);
  }
};

// src/components/bookmark-list.ts
var JeswrBookmarkList = class extends AbstractReadElement {
  async loadFrom(controller, src, publicRead) {
    const result = await controller.read(src, publicRead ? { public: true } : {});
    return { graph: result.dataset ?? new N3Store(), baseUrl: result.url };
  }
  renderReady(graph) {
    const bookmarks = collectBookmarks(graph);
    if (bookmarks.length === 0) {
      return b`<slot name="empty"><p part="empty">No bookmarks.</p></slot>`;
    }
    return b`
      <ul part="list">
        ${bookmarks.map((b2) => this.#renderBookmark(b2))}
      </ul>
    `;
  }
  #renderBookmark(bookmark) {
    const href = safeHref(bookmark.url);
    const title = bookmark.title ?? bookmark.url ?? "(untitled bookmark)";
    const tags = [...bookmark.tags].sort();
    const meta = [];
    const created = formatDate(bookmark.created);
    if (created) meta.push(`Added: ${created}`);
    if (bookmark.archived) meta.push("Archived");
    return b`
      <li part="bookmark" data-archived=${bookmark.archived ? "true" : "false"}>
        ${href ? b`<a part="title" href=${href} rel="noopener noreferrer">${title}</a>` : b`<span part="title">${title}</span>`}
        ${bookmark.description ? b`<p>${bookmark.description}</p>` : null}
        ${tags.length > 0 ? b`<ul part="tags">
              ${tags.map((t) => b`<li>${t}</li>`)}
            </ul>` : null}
        ${meta.length > 0 ? b`<small part="meta">${meta.join(" \xB7 ")}</small>` : null}
      </li>
    `;
  }
};
function collectBookmarks(graph) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const quad of graph.getQuads(null, N3DataFactory_default.namedNode(RDF_TYPE2), null, null)) {
    if (quad.object.value !== BOOKMARK_CLASS) continue;
    const subject = quad.subject.value;
    if (seen.has(subject)) continue;
    seen.add(subject);
    const bookmark = new Bookmark(subject, graph, N3DataFactory_default);
    if (!safeHref(bookmark.url)) continue;
    out.push(bookmark);
  }
  return out;
}
if (!customElements.get("jeswr-bookmark-list")) {
  customElements.define("jeswr-bookmark-list", JeswrBookmarkList);
}

// src/components/collection.ts
var JeswrCollection = class extends AbstractReadElement {
  /** The children of the last listing (kept so render uses the listing, not a re-scan). */
  #children = [];
  static get properties() {
    return {
      ...AbstractReadElement.properties,
      typeIndex: { attribute: false }
    };
  }
  constructor() {
    super();
    this.typeIndex = void 0;
  }
  inputProps() {
    return ["src", "fetch", "publicFetch", "typeIndex"];
  }
  async loadFrom(controller, src, publicRead) {
    const listing = await controller.listContainer(src, publicRead ? { public: true } : {});
    this.#children = listing.children;
    return { graph: listing.dataset, baseUrl: listing.url };
  }
  renderReady() {
    const children = this.#children;
    if (children.length === 0) {
      return b`<slot name="empty"><p part="empty">Empty container.</p></slot>`;
    }
    const labels = typeIndexLabels(this.typeIndex);
    return b`
      <ul part="list">
        ${children.map((child) => this.#renderChild(child, labels))}
      </ul>
    `;
  }
  #renderChild(child, labels) {
    const href = safeHref(child.url);
    const label = labels.get(child.url);
    const text = displayName(child.url);
    return b`
      <li part="child" data-container=${child.isContainer ? "true" : "false"}>
        ${href ? b`<a part="link" href=${href} rel="noopener noreferrer">${text}</a>` : b`<span part="link">${text}</span>`}
        ${child.isContainer ? b`<span part="type">container</span>` : null}
        ${label ? b`<span part="type">${label}</span>` : null}
      </li>
    `;
  }
};
function typeIndexLabels(entries) {
  const m = /* @__PURE__ */ new Map();
  for (const e of entries ?? []) {
    if (!safeHref(e.instanceContainer)) continue;
    m.set(e.instanceContainer, `holds ${localName(e.class)}`);
  }
  return m;
}
function displayName(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.replace(/\/$/, "").split("/");
    const last = segments[segments.length - 1] || u.pathname || url;
    return decodeURIComponent(last);
  } catch {
    return url;
  }
}
function localName(iri) {
  const hash = iri.lastIndexOf("#");
  const slash = iri.lastIndexOf("/");
  const cut = Math.max(hash, slash);
  return cut >= 0 && cut < iri.length - 1 ? iri.slice(cut + 1) : iri;
}
if (!customElements.get("jeswr-collection")) {
  customElements.define("jeswr-collection", JeswrCollection);
}

// src/resolver.ts
var RESOLVER_ENTRIES = [
  {
    targetClass: "http://www.w3.org/2005/01/wf/flow#Task",
    tagName: "jeswr-task-list",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 70
  },
  {
    targetClass: "http://www.w3.org/2006/vcard/ns#AddressBook",
    tagName: "jeswr-contact-list",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 70
  },
  {
    targetClass: "http://www.w3.org/2006/vcard/ns#Individual",
    tagName: "jeswr-contact-list",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 65
  },
  {
    targetClass: "https://w3id.org/jeswr/bookmark#Bookmark",
    tagName: "jeswr-bookmark-list",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 70
  },
  // The generic LDP container listing — LOWEST priority so a typed container (an
  // AddressBook, a bookmarks container that ALSO types ldp:Container) renders with
  // its typed element, and only an UNtyped container falls through to the listing.
  {
    targetClass: LDP_CONTAINER,
    tagName: "jeswr-collection",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 10
  },
  {
    targetClass: LDP_BASIC_CONTAINER,
    tagName: "jeswr-collection",
    importSpec: "@jeswr/solid-components",
    mode: "view",
    priority: 10
  }
];
var BY_CLASS = (() => {
  const m = /* @__PURE__ */ new Map();
  for (const e of RESOLVER_ENTRIES) if (!m.has(e.targetClass)) m.set(e.targetClass, e);
  return m;
})();
function resolveComponent(types, options = {}) {
  const wanted = new Set(types);
  let best;
  RESOLVER_ENTRIES.forEach((entry, index) => {
    if (!wanted.has(entry.targetClass)) return;
    if (options.mode && entry.mode !== options.mode) return;
    if (best === void 0 || entry.priority > best.entry.priority || // equal priority → keep the earlier registration (lower index), PM's tie-break.
    entry.priority === best.entry.priority && index < best.index) {
      best = { entry, index };
    }
  });
  return best?.entry;
}
function resolveComponentForClass(targetClass, options = {}) {
  const direct = BY_CLASS.get(targetClass);
  if (direct && (!options.mode || direct.mode === options.mode)) return direct;
  return resolveComponent([targetClass], options);
}
function collectTypes(dataset, subject) {
  const types = /* @__PURE__ */ new Set();
  for (const quad of iterateQuads(dataset)) {
    if (quad.predicate?.value !== RDF_TYPE2) continue;
    if (quad.object?.termType !== "NamedNode") continue;
    const objectValue = quad.object.value;
    if (objectValue === void 0) continue;
    if (subject !== void 0 && quad.subject?.value !== subject) continue;
    types.add(objectValue);
  }
  return types;
}
function iterateQuads(dataset) {
  return dataset;
}

// src/components/solid-view.ts
var INPUT_PROPS = ["src", "classIri", "mode", "fetch", "publicFetch", "publicRead"];
var SolidView = class extends i {
  /** A supersede token so a stale probe never mounts over a newer one. */
  #token = 0;
  static properties = {
    src: {},
    classIri: { attribute: "class-iri" },
    mode: {},
    fetch: { attribute: false },
    publicFetch: { attribute: false },
    publicRead: { type: Boolean, attribute: "public-read" },
    status: { state: true },
    errorMessage: { state: true },
    resolved: { state: true }
  };
  constructor() {
    super();
    this.src = void 0;
    this.classIri = void 0;
    this.mode = "view";
    this.fetch = void 0;
    this.publicFetch = void 0;
    this.publicRead = false;
    this.status = "idle";
    this.errorMessage = "";
    this.resolved = void 0;
  }
  /** Light DOM so the consuming app can `::part`/style the mounted child. */
  createRenderRoot() {
    return this;
  }
  willUpdate(changed) {
    const changedKeys = changed;
    if (INPUT_PROPS.some((k) => changedKeys.has(k))) void this.#resolve();
  }
  async #resolve() {
    const token = ++this.#token;
    const src = this.src;
    if (!src) {
      this.resolved = void 0;
      this.errorMessage = "";
      this.status = "idle";
      return;
    }
    if (this.classIri) {
      const entry = resolveComponentForClass(this.classIri, { mode: this.mode });
      this.#applyResolution(token, entry);
      return;
    }
    this.status = "loading";
    this.errorMessage = "";
    const seam = {
      ...this.fetch ? { fetch: this.fetch } : {},
      ...this.publicFetch ? { publicFetch: this.publicFetch } : {}
    };
    const controller = new DataController(seam);
    try {
      const result = await controller.read(src, this.publicRead ? { public: true } : {});
      if (token !== this.#token) return;
      const types = result.dataset ? collectTypes(result.dataset) : /* @__PURE__ */ new Set();
      const entry = resolveComponent(types, { mode: this.mode });
      this.#applyResolution(token, entry, types);
    } catch (error) {
      if (token !== this.#token) return;
      this.resolved = void 0;
      this.errorMessage = error instanceof DataControllerError ? error.message : error instanceof Error ? error.message : String(error);
      this.status = "error";
    }
  }
  /** Apply a resolution: lazy-load + mount the element, or fall back to unsupported. */
  #applyResolution(token, entry, types) {
    if (token !== this.#token) return;
    if (entry) {
      this.resolved = entry;
      this.status = "ready";
      void this.#ensureRegistered(entry.importSpec, token);
      return;
    }
    const isContainer = types !== void 0 && (types.has(LDP_CONTAINER) || types.has(LDP_BASIC_CONTAINER));
    if (isContainer) {
      this.resolved = resolveComponentForClass(LDP_CONTAINER, { mode: this.mode });
      this.status = this.resolved ? "ready" : "unsupported";
      return;
    }
    this.resolved = void 0;
    this.status = "unsupported";
  }
  /** Lazy-import the element's module so its `customElements.define` has run. */
  async #ensureRegistered(importSpec, token) {
    if (customElements.get(this.resolved?.tagName ?? "")) return;
    try {
      await import(
        /* @vite-ignore */
        importSpec
      );
    } catch (error) {
      if (token !== this.#token) return;
      this.errorMessage = `Failed to load the view module "${importSpec}": ${error instanceof Error ? error.message : String(error)}`;
      this.status = "error";
    }
  }
  render() {
    switch (this.status) {
      case "idle":
        return b`<slot name="empty"><p part="empty">No resource to display.</p></slot>`;
      case "loading":
        return b`<slot name="loading"><p part="loading">Loading…</p></slot>`;
      case "error":
        return b`<p part="error" role="alert">${this.errorMessage}</p>`;
      case "unsupported":
        return b`<slot name="unsupported"
          ><p part="unsupported">No typed view is available for this resource.</p></slot
        >`;
      default:
        return this.#renderResolved();
    }
  }
  /** Mount the resolved child element, forwarding the seam + src as properties. */
  #renderResolved() {
    const entry = this.resolved;
    if (!entry) return b`<p part="unsupported">No typed view is available.</p>`;
    return b`<div part="host" data-tag=${entry.tagName} data-src=${this.src ?? ""}></div>`;
  }
  /**
   * After render, (re)mount the resolved child with the seam + src wired as
   * properties. Done in `updated` (not the template) so the OBJECT props (`fetch`,
   * `publicFetch`) are set on the element instance, which a string attribute can't do.
   */
  updated(_changed) {
    const host = this.querySelector('[part="host"]');
    if (!host || !this.resolved) return;
    const tag = this.resolved.tagName;
    let child = host.firstElementChild;
    if (!child || child.tagName.toLowerCase() !== tag) {
      host.replaceChildren();
      child = document.createElement(tag);
      host.append(child);
    }
    const c = child;
    c.fetch = this.fetch;
    c.publicFetch = this.publicFetch;
    c.publicRead = this.publicRead;
    c.src = this.src;
  }
};
if (!customElements.get("solid-view")) {
  customElements.define("solid-view", SolidView);
}
export {
  AbstractReadElement,
  AccessDeniedError,
  BOOKMARK_CLASS,
  DataController,
  DataControllerError,
  DataFormatError,
  JeswrBookmarkList,
  JeswrCollection,
  JeswrContactList,
  JeswrProfileCard,
  JeswrShaclView,
  JeswrTaskList,
  LDP_BASIC_CONTAINER,
  LDP_CONTAINER,
  NetworkError,
  NotFoundError,
  RDF_TYPE2 as RDF_TYPE,
  RESOLVER_ENTRIES,
  SolidView,
  TASK_CLASS2 as TASK_CLASS,
  VALUES_SUBJECT_SENTINEL,
  VCARD_ADDRESS_BOOK2 as VCARD_ADDRESS_BOOK,
  VCARD_INDIVIDUAL2 as VCARD_INDIVIDUAL,
  classifyReadError,
  collectTypes,
  countTurtleQuads,
  formatDate,
  neutraliseValuesTurtle,
  resolveComponent,
  resolveComponentForClass,
  resolveGraphToTurtle,
  safeHref,
  safeMailto,
  safeTel,
  serializeTurtle,
  stripScheme
};
