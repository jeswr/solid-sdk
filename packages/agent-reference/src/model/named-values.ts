// AUTHORED-BY Codex GPT-6
/** Open domain data: named PropertyValue entries, never rdf:JSON or JSON strings. */
import type { Term } from "@jeswr/fetch-rdf";
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import { objectTerms } from "@jeswr/rdf-serialize/wrapper";
import { RequiredAs, TermAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { digestBytes, isIri } from "../core/canonical.js";
import { assertJsonBounds, DEFAULT_LIMITS } from "../core/limits.js";
import type { Json, JsonObject } from "../core/types.js";
import { AWP } from "../profile/vocabulary.js";
import { RdfNode } from "./nodes.js";

export const SCHEMA = "https://schema.org/";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export function scopedId(parent: string, field: string): string {
  return (
    "urn:awp:n:" +
    Buffer.from(digestBytes(parent + "\0" + field).slice(8), "hex").toString("base64url")
  );
}
const FIELD = "urn:awp:legacy-field:";
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
  get entries(): readonly NamedValueNode[] {
    const entries = [...objectTerms(this, SCHEMA + "itemListElement")].map(
      (t) => new NamedValueNode(TermAs.term(t), this.dataset),
    );
    entries.sort((a, b) => a.position - b.position);
    for (let i = 0; i < entries.length; i++)
      if (entries[i]?.position !== i)
        throw new TypeError("Non-contiguous or duplicate list position");
    return entries;
  }
  get isObject(): boolean {
    return this.types.has(AWP + "NamedValueCollection");
  }
  toValue(seen = new Set<string>(), depth = 0): JsonObject | Json[] {
    if (seen.has(this.id) || depth > 32) throw new TypeError("Cyclic or overdeep named values");
    seen.add(this.id);
    const pairs = this.entries.map((entry) => {
      if (entry.propertyID !== parameterIri(entry.name))
        throw new TypeError("Parameter name/IRI mismatch");
      return [entry.name, readValue(entry.domainValue, this.dataset, seen, depth + 1)] as const;
    });
    seen.delete(this.id);
    if (!this.isObject) {
      if (!this.types.has(SCHEMA + "ItemList")) throw new TypeError("Expected an ItemList");
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
  ): NamedValuesNode {
    // Object construction is distinct from wire admission. Still bound work and
    // cycles here; the selected carriage limits apply when the graph is written/read.
    assertJsonBounds(value, { ...DEFAULT_LIMITS, maxStringLength: 1_048_576 });
    const node = new NamedValuesNode(id, dataset);
    node.types.add(Array.isArray(value) ? SCHEMA + "ItemList" : AWP + "NamedValueCollection");
    for (const [index, [name, item]] of Object.entries(value).entries()) {
      const entry = new NamedValueNode(scopedId(id, "entry:" + index), dataset);
      entry.initialise(name, index);
      entry.domainValue = writeValue(item, scopedId(entry.id, "value"), dataset);
      dataset.addQuad(
        node as never,
        DataFactory.namedNode(SCHEMA + "itemListElement"),
        entry as never,
      );
    }
    return node;
  }
}

export function writeValue(value: Json, id: string, dataset: Store): Term {
  if (value === null) {
    const node = new RdfNode(id, dataset);
    node.types.add(AWP + "NullValue");
    return TermAs.term(node);
  }
  if (typeof value === "object") return TermAs.term(NamedValuesNode.from(value, id, dataset));
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
function decimalLexical(value: number): string {
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
export function readValue(term: Term, dataset: Store, seen = new Set<string>(), depth = 0): Json {
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
  if (node.types.has(AWP + "NullValue")) return null;
  if (node.types.has(AWP + "NamedValueCollection") || node.types.has(SCHEMA + "ItemList"))
    return node.toValue(seen, depth);
  return term.value;
}
function missing(field: string): never {
  throw new TypeError(`Missing named value ${field}`);
}
