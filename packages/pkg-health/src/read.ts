// AUTHORED-BY Codex GPT-6.1-Sol
// Compatibility views for the closed-admission gaps documented in README.
import { readLiteral } from "@jeswr/model-runtime";
import type { DatasetCore, Literal, Term } from "@rdfjs/types";
import { SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory as df } from "n3";

export const H = "https://jeswr.org/ns/sectors/health#";
export const OLD_H = "https://w3id.org/jeswr/sectors/health#";
export const S = "https://schema.org/";
export const FHIR = "http://hl7.org/fhir/";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const TIME = "http://www.w3.org/2006/time#";
export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
export const LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
export const health = (local: string): string[] => [H + local, OLD_H + local];
/** All outgoing subject aliases: no owner link may hide a conflicting alias. */
export const SUBJECT_LINK_PREDICATES: readonly string[] = Object.freeze([
  ...health("patient"),
  `${FHIR}subject`,
  ...[S, "http://schema.org/"].flatMap((ns) =>
    ["subject", "patient", "about"].map((local) => ns + local),
  ),
]);

export class ReadNode extends TermWrapper {
  readonly term: Term;
  constructor(id: string | Term, dataset: DatasetCore) {
    const term = typeof id === "string" ? df.namedNode(id) : id;
    super(term, dataset, df);
    this.term = term;
  }
  terms(predicate: string): Term[] {
    return [...SetFrom.subjectPredicate(this, predicate, TermAs.term, TermFrom.itself)];
  }
  /** Canonical-first singleton semantics; ambiguous predicates never fall back. */
  one(...predicates: string[]): Term | undefined {
    for (const predicate of predicates) {
      const terms = this.terms(predicate);
      if (terms.length) return terms.length === 1 ? terms[0] : undefined;
    }
    return undefined;
  }
  literal(...predicates: string[]): Literal | undefined {
    const term = this.one(...predicates);
    return term?.termType === "Literal" ? term : undefined;
  }
  text(...predicates: string[]): string | undefined {
    const term = this.literal(...predicates);
    return term && (term.datatype.value === `${XSD}string` || term.language)
      ? term.value
      : undefined;
  }
  link(...predicates: string[]): Term | undefined {
    const term = this.one(...predicates);
    return term?.termType === "NamedNode" || term?.termType === "BlankNode" ? term : undefined;
  }
  child(...predicates: string[]): ReadNode | undefined {
    const term = this.link(...predicates);
    return term ? new ReadNode(term, this.dataset) : undefined;
  }
  get label(): string | undefined {
    return this.text(`${S}name`, LABEL);
  }
  get owners(): Term[] {
    return SUBJECT_LINK_PREDICATES.flatMap((p) => this.terms(p));
  }
  get dose(): { value: string; unit: string; frequency?: string } | undefined {
    const schedule = this.child(`${S}doseSchedule`);
    const value = schedule?.literal(`${S}doseValue`);
    const unit = schedule?.text(`${S}doseUnit`);
    return value?.datatype.value === `${XSD}decimal` && unit !== undefined
      ? { value: value.value, unit, frequency: schedule?.text(`${S}frequency`) }
      : undefined;
  }
  get atcCode(): string | undefined {
    const code = this.child(`${S}code`);
    return code?.text(`${S}codingSystem`)?.toLowerCase() === "atc"
      ? code.text(`${S}codeValue`)
      : undefined;
  }
  get observationValue(): number | string | undefined {
    const term = this.literal(...health("value"));
    if (!term) return undefined;
    if ([`${XSD}decimal`, `${XSD}integer`, `${XSD}double`].includes(term.datatype.value)) {
      try {
        // The runtime numeric mapper either returns a finite, faithful number or throws.
        const number = readLiteral(term) as number;
        return Number.isFinite(number) ? number : term.value;
      } catch {
        return term.value;
      }
    }
    if (term.datatype.value !== `${XSD}string`) return undefined;
    const lexical = term.value.trim();
    // Strict decimal/exponent strings only: no hex, units, empty values or Infinity.
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(lexical)) {
      try {
        return readLiteral(df.literal(lexical, df.namedNode(`${XSD}decimal`))) as number;
      } catch {
        return term.value;
      }
    }
    return term.value;
  }
}
