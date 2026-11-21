// AUTHORED-BY Codex GPT-6
/** Open domain data: named PropertyValue entries, never rdf:JSON or JSON strings. */
import type { Term } from "@jeswr/fetch-rdf";
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import { RequiredAs, TermAs, TermFrom } from "@rdfjs/wrapper";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createHash } from "crypto";
import { DataFactory, Store } from "n3";
import { isIri } from "../core/canonical.js";
import { assertJsonBounds, DEFAULT_LIMITS, type PilotLimits } from "../core/limits.js";
import type { Json, JsonObject } from "../core/types.js";
import { AWP } from "../profile/vocabulary.js";
import { attachmentGraph, attachmentTerm } from "./attachments.js";
import { containsObject, subjectsAt } from "./indexed-store.js";
import { RdfNode } from "./nodes.js";

export const SCHEMA = "https://schema.org/";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export function scopedId(parent: string, field: string): string {
  const digest = createHash("sha256").update(`${parent}\0${field}`).digest("base64url");
  return `urn:awp:n:${digest}`;
}
const FIELD = "urn:awp:legacy-field:";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const DEFAULT_GRAPH = DataFactory.defaultGraph();
const COLLECTION = DataFactory.namedNode(`${AWP}NamedValueCollection`);
const ITEM_LIST = DataFactory.namedNode(`${SCHEMA}ItemList`);
const NULL_VALUE = DataFactory.namedNode(`${AWP}NullValue`);

function hasType(node: NamedValuesNode, type: Term): boolean {
  return node.dataset.countQuads(node as never, RDF_TYPE, type, DEFAULT_GRAPH) === 1;
}

const liveCollections = new WeakMap<object, NamedValuesNode>();
/** Recover the graph behind an actual live view; object properties cannot forge this association. */
export function namedValuesOf(value: unknown): NamedValuesNode | undefined {
  return value !== null && typeof value === "object" ? liveCollections.get(value) : undefined;
}
export function parameterIri(key: string): string {
  return isIri(key) && isSafeAbsoluteIri(key) ? key : FIELD + encodeURIComponent(key);
}

export class NamedValueNode extends RdfNode {
  get name(): string {
    return this.text(SCHEMA + "name") ?? missing("name");
  }
  get propertyID(): string {
    return this.iri(SCHEMA + "propertyID") ?? missing("propertyID");
  }
  get position(): number {
    return Number(this.text(SCHEMA + "position", XSD + "integer") ?? missing("position"));
  }
  get domainValue(): Term {
    return this.one(SCHEMA + "value") ?? missing("domainValue");
  }
  set domainValue(term: Term) {
    RequiredAs.object(this, SCHEMA + "value", term, TermFrom.itself);
  }
  initialise(name: string, position: number): void {
    this.types.add(SCHEMA + "PropertyValue");
    this.setText(SCHEMA + "name", name);
    this.setIri(SCHEMA + "propertyID", parameterIri(name));
    RequiredAs.object(this, SCHEMA + "position", String(position), (v) =>
      DataFactory.literal(v, DataFactory.namedNode(XSD + "integer")),
    );
  }
}

/** ItemList for arrays; NamedValueCollection for objects. Positions retain duplicates/order. */
export class NamedValuesNode extends RdfNode {
  /** Property access resolves the current typed RDF value, including verified attachments. */
  get live(): JsonObject | Json[] {
    const array = !this.isObject;
    const target = array ? [] : {};
    const keys = () => {
      const entries = this.entries;
      const names = entries.map((entry) => entry.name);
      if (new Set(names).size !== names.length) throw new TypeError("Duplicate parameter name");
      if (array && names.some((name, index) => name !== String(index)))
        throw new TypeError("Invalid array entry name");
      return names;
    };
    // Indexed lookups keep iteration linear without caching a value or membership.
    // Every access still observes edits to the admitted store and attachment graph.
    const entryFor = (name: string): NamedValueNode | undefined => {
      const graph = attachmentGraph(this.dataset, this.id) ?? this.dataset;
      const terms = subjectsAt(graph, SCHEMA + "name", DataFactory.literal(name)).filter((term) =>
        containsObject(graph, this as never, SCHEMA + "itemListElement", term),
      );
      if (terms.length > 1) throw new TypeError("Duplicate parameter name");
      if (!terms[0]) return undefined;
      const entry = new NamedValueNode(terms[0], graph);
      if (entry.propertyID !== parameterIri(entry.name))
        throw new TypeError("Parameter name/IRI mismatch");
      return entry;
    };
    const length = () => {
      const graph = attachmentGraph(this.dataset, this.id) ?? this.dataset;
      return graph.countQuads(
        this as never,
        DataFactory.namedNode(SCHEMA + "itemListElement"),
        null,
        null,
      );
    };
    const view = new Proxy(target, {
      ownKeys: () => (array ? [...keys(), "length"] : keys()),
      getOwnPropertyDescriptor: (target, key) =>
        key === "length" && array
          ? { ...Object.getOwnPropertyDescriptor(target, "length")!, value: length() }
          : typeof key === "string" && entryFor(key)
            ? { enumerable: true, configurable: true }
            : undefined,
      has: (_target, key) => typeof key === "string" && !!entryFor(key),
      get: (target, key) => {
        if (key === "length" && array) return length();
        const entry = typeof key === "string" ? entryFor(key) : undefined;
        return entry ? liveValue(entry.domainValue, entry.dataset) : Reflect.get(target, key);
      },
      set: () => {
        throw new TypeError("Domain values are read-only RDF views");
      },
    }) as JsonObject | Json[];
    liveCollections.set(view, this);
    return view;
  }
  get entries(): readonly NamedValueNode[] {
    const graph = attachmentGraph(this.dataset, this.id);
    if (graph) return new NamedValuesNode(this.id, graph).entries;
    const terms = this.objects(SCHEMA + "itemListElement");
    const entries = new Array<NamedValueNode>(terms.length);
    for (const term of terms) {
      const entry = new NamedValueNode(term, this.dataset);
      const position = entry.position;
      if (
        !Number.isInteger(position) ||
        position < 0 ||
        position >= entries.length ||
        entries[position]
      )
        throw new TypeError("Non-contiguous or duplicate list position");
      entries[position] = entry;
    }
    return entries;
  }
  get isObject(): boolean {
    return hasType(this, COLLECTION);
  }
  toValue(seen = new Set<string>(), depth = 0): JsonObject | Json[] {
    if (seen.has(this.id) || depth > 32) throw new TypeError("Cyclic or overdeep named values");
    seen.add(this.id);
    const pairs = this.entries.map((entry, index) => {
      if (entry.termType !== "NamedNode" || entry.id !== scopedId(this.id, "entry:" + index))
        throw new TypeError("Invalid scoped named-value entry");
      const name = entry.name;
      if (entry.propertyID !== parameterIri(name))
        throw new TypeError("Parameter name/IRI mismatch");
      return [
        name,
        readValue(
          entry.domainValue,
          entry.dataset,
          () => scopedId(entry.id, "value"),
          seen,
          depth + 1,
        ),
      ] as const;
    });
    seen.delete(this.id);
    if (!this.isObject) {
      if (!hasType(this, ITEM_LIST)) throw new TypeError("Expected an ItemList");
      if (pairs.some(([key], index) => key !== String(index)))
        throw new TypeError("Invalid array entry name");
      return pairs.map(([, value]) => value);
    }
    if (new Set(pairs.map(([name]) => name)).size !== pairs.length)
      throw new TypeError("Duplicate parameter name");
    return Object.fromEntries(pairs);
  }
  toObject(): JsonObject {
    const value = this.toValue();
    if (Array.isArray(value)) throw new TypeError("Expected named object values");
    return value;
  }
  static from(
    value: JsonObject | readonly Json[],
    id: string,
    dataset = new Store(),
    limits?: PilotLimits,
  ): NamedValuesNode {
    // Object construction is distinct from wire admission. Still bound work and
    // cycles here; the selected carriage limits apply when the graph is written/read.
    assertJsonBounds(value, limits ?? { ...DEFAULT_LIMITS, maxStringLength: 1_048_576 });
    const node = new NamedValuesNode(id, dataset);
    node.types.add(Array.isArray(value) ? SCHEMA + "ItemList" : AWP + "NamedValueCollection");
    for (const [index, [name, item]] of Object.entries(value).entries()) {
      const entry = new NamedValueNode(scopedId(id, "entry:" + index), dataset);
      entry.initialise(name, index);
      entry.domainValue = writeValue(item, () => scopedId(entry.id, "value"), dataset, limits);
      dataset.addQuad(
        node as never,
        DataFactory.namedNode(SCHEMA + "itemListElement"),
        entry as never,
      );
    }
    return node;
  }
}

export function writeValue(
  value: Json,
  id: string | (() => string),
  dataset: Store,
  limits?: PilotLimits,
): Term {
  if (typeof value === "object") {
    const nodeId = typeof id === "string" ? id : id();
    if (value !== null) return TermAs.term(NamedValuesNode.from(value, nodeId, dataset, limits));
    const node = new RdfNode(nodeId, dataset);
    node.types.add(AWP + "NullValue");
    return TermAs.term(node);
  }
  if (typeof value === "string")
    return isIri(value) && isSafeAbsoluteIri(value)
      ? DataFactory.namedNode(value)
      : DataFactory.literal(value);
  if (typeof value === "boolean")
    return DataFactory.literal(String(value), DataFactory.namedNode(XSD + "boolean"));
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new TypeError("Expected finite domain value");
  const datatype = Number.isSafeInteger(value) && !Object.is(value, -0) ? "integer" : "decimal";
  return DataFactory.literal(decimalLexical(value), DataFactory.namedNode(XSD + datatype));
}
/** Exact shortest round-trippable JS decimal, expanded without exponent notation. */
export function decimalLexical(value: number): string {
  if (Object.is(value, -0)) return "-0";
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [coefficient, exponent] = text.toLowerCase().split("e");
  const sign = coefficient!.startsWith("-") ? "-" : "";
  const digits = coefficient!.replace("-", "").replace(".", "");
  const point = coefficient!.replace("-", "").split(".")[0]!.length + Number(exponent);
  return (
    sign +
    (point <= 0
      ? "0." + "0".repeat(-point) + digits
      : point >= digits.length
        ? digits + "0".repeat(point - digits.length)
        : digits.slice(0, point) + "." + digits.slice(point))
  );
}
export function readValue(
  term: Term,
  dataset: Store,
  expectedId?: string | (() => string),
  seen = new Set<string>(),
  depth = 0,
): Json {
  term = attachmentTerm(dataset, term);
  if (term.termType === "Literal") {
    if (term.language) throw new TypeError("Language literal has no legacy scalar representation");
    switch (term.datatype.value) {
      case XSD + "string":
        return term.value;
      case XSD + "boolean":
        if (!["true", "false", "1", "0"].includes(term.value))
          throw new TypeError("Invalid boolean");
        return term.value === "true" || term.value === "1";
      case XSD + "integer":
      case XSD + "double":
      case XSD + "decimal": {
        const value = Number(term.value);
        if (!term.value || !Number.isFinite(value)) throw new TypeError("Invalid number");
        return value;
      }
      default:
        throw new TypeError("Unsupported domain literal datatype");
    }
  }
  if (term.termType !== "NamedNode") throw new TypeError("Expected a named domain value");
  const node = new NamedValuesNode(term, dataset);
  const isNull = hasType(node, NULL_VALUE);
  if (!isNull && !hasType(node, COLLECTION) && !hasType(node, ITEM_LIST)) return term.value;
  // A structured value belongs to exactly one position in its parent's tree.
  if (
    expectedId !== undefined &&
    node.id !== (typeof expectedId === "string" ? expectedId : expectedId())
  )
    throw new TypeError(seen.has(node.id) ? "Cyclic named values" : "Invalid scoped named value");
  return isNull ? null : node.toValue(seen, depth);
}
function missing(field: string): never {
  throw new TypeError(`Missing named value ${field}`);
}

/** Typed live domain values; no object snapshot enters a gate through this accessor. */
export function liveValue(term: Term, dataset: Store): Json {
  term = attachmentTerm(dataset, term);
  if (term.termType === "NamedNode") {
    const node = new NamedValuesNode(term, dataset);
    if (node.types.has(AWP + "NamedValueCollection") || node.types.has(SCHEMA + "ItemList"))
      return node.live;
  }
  return readValue(term, dataset);
}
