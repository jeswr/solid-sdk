// AUTHORED-BY Codex GPT-6.1-Sol
import type { BlankNode, NamedNode, Term } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { Resource } from "@solid/object";

const XSD = "http://www.w3.org/2001/XMLSchema#";
export type ScalarKind =
  | "iri"
  | "string"
  | "boolean"
  | "integer"
  | "double"
  | "decimal"
  | "dateTime"
  | "duration"
  | "json";
/** Expand exponent notation because xsd:decimal does not permit an exponent. */
function decimalText(value: number): string {
  const text = String(value);
  if (!text.includes("e")) return text;
  const [mantissa = "", exponent = "0"] = text.split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

const datatype = (kind: ScalarKind) =>
  kind === "json" ? "http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON" : `${XSD}${kind}`;

/** Solid Resource with strict, cardinality-checked RDF/JS typed accessors. */
export class RdfResource extends Resource {
  // N3 optimizes terms with an `id` property. Solid Resource.id omits the `_:`
  // prefix for blank nodes, so use a plain TermWrapper as the accessor anchor.
  private get anchor(): TermWrapper {
    return this.termType === "BlankNode"
      ? new TermWrapper(this.subjectTerm, this.dataset, this.factory)
      : this;
  }

  override get type(): Set<string> {
    return SetFrom.subjectPredicate(
      this.anchor,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }

  /** Add a term through wrapper mutation machinery (used by the pilot evidence exporter). */
  addTerm(predicate: string, term: Term): void {
    SetFrom.subjectPredicate(
      this.anchor,
      predicate,
      (node) => node as Term,
      (value) => value,
    ).add(term);
  }

  /** RDF subject term, preserving blank-node identity for nested structures. */
  get subjectTerm(): NamedNode | BlankNode {
    return this.termType === "BlankNode"
      ? this.factory.blankNode(this.value)
      : this.factory.namedNode(this.id);
  }

  private checkCardinality(predicate: string): void {
    if (this.dataset.match(this.subjectTerm, this.factory.namedNode(predicate)).size > 1) {
      throw new Error(`ambiguous property ${predicate}`);
    }
  }

  /** A structural child may be a named or blank node; scalar IRI fields may not. */
  readNode(predicate: string): NamedNode | BlankNode | undefined {
    this.checkCardinality(predicate);
    return OptionalFrom.subjectPredicate(this.anchor, predicate, (term) => {
      if (term.termType === "NamedNode") return this.factory.namedNode(NamedNodeAs.string(term));
      if (term.termType === "BlankNode") return this.factory.blankNode(term.value);
      throw new TypeError(`expected structural node for ${predicate}`);
    });
  }

  read(predicate: string, kind: ScalarKind): string | number | boolean | undefined {
    this.checkCardinality(predicate);
    return OptionalFrom.subjectPredicate(this.anchor, predicate, (term: TermWrapper) => {
      if (kind === "iri") return NamedNodeAs.string(term);
      if (term.termType !== "Literal" || term.datatype.value !== datatype(kind) || term.language) {
        throw new TypeError(`wrong datatype for ${predicate}`);
      }
      if (kind === "boolean") {
        if (!["true", "false", "1", "0"].includes(term.value))
          throw new TypeError("invalid boolean");
        return LiteralAs.boolean(term);
      }
      if (["integer", "double", "decimal"].includes(kind)) {
        const pattern =
          kind === "integer"
            ? /^[+-]?\d+$/
            : kind === "decimal"
              ? /^[+-]?(\d+(\.\d*)?|\.\d+)$/
              : /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
        if (!pattern.test(term.value)) throw new TypeError("invalid numeric literal");
        const value = LiteralAs.number(term);
        if (!Number.isFinite(value)) throw new TypeError("non-finite number");
        return value;
      }
      return LiteralAs.string(term);
    });
  }

  write(predicate: string, kind: ScalarKind, value: string | number | boolean): void {
    if (kind === "iri")
      OptionalAs.object(this.anchor, predicate, String(value), NamedNodeFrom.string);
    else if (kind === "boolean")
      OptionalAs.object(this.anchor, predicate, Boolean(value), LiteralFrom.boolean);
    else if (kind === "integer")
      OptionalAs.object(this.anchor, predicate, Number(value), LiteralFrom.integer);
    else if (kind === "double")
      OptionalAs.object(this.anchor, predicate, Number(value), LiteralFrom.double);
    else
      OptionalAs.object(
        this.anchor,
        predicate,
        [datatype(kind), kind === "decimal" ? decimalText(Number(value)) : String(value)] as [
          string,
          string,
        ],
        LiteralFrom.datatypeTuple,
      );
  }
}
