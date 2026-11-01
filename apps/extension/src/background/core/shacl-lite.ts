// AUTHORED-BY Codex GPT-6
/** C4's deliberately bounded SHACL subset. Unknown constraints never prove conformance. */
import { DataFactory, type Store } from 'n3';
import type { ResolutionBudget } from './class-resolution-budget';

const SH = 'http://www.w3.org/ns/shacl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const SUBCLASS = 'http://www.w3.org/2000/01/rdf-schema#subClassOf';
type Term = Parameters<Store['addQuads']>[0][number]['object'];
const termToId = (term: Term): string =>
  JSON.stringify(
    term.termType === 'Literal'
      ? [term.termType, term.value, term.language, term.datatype.value]
      : [term.termType, term.value],
  );
const nn = DataFactory.namedNode;
export interface ClassShape {
  readonly iri: string;
  readonly store: Store;
}
export interface Validation {
  /** Supported constraints only; incomplete takes precedence when interpreting evidence. */
  readonly conforms: boolean;
  readonly incomplete: boolean;
}
export type MemberEvidence = 'conforms' | 'non-conforming' | 'incomplete';
export const SHACL_LIMITS = { properties: 128, list: 1024, operations: 1_000_000 } as const;
type Rule = {
  path?: { iri: string; inverse: boolean };
  classes: string[];
  datatype?: string;
  kinds?: readonly string[];
  min?: number;
  max?: number;
  inside?: Set<string>;
  has: Term[];
};
const NODE_KINDS: Record<string, readonly string[]> = {
  IRI: ['NamedNode'],
  BlankNode: ['BlankNode'],
  Literal: ['Literal'],
  BlankNodeOrIRI: ['BlankNode', 'NamedNode'],
  BlankNodeOrLiteral: ['BlankNode', 'Literal'],
  IRIOrLiteral: ['NamedNode', 'Literal'],
};
const SUPPORTED_DATATYPES = new Set([
  ...['string', 'boolean', 'integer', 'decimal', 'float', 'double', 'dateTime'].map((s) => XSD + s),
  `${RDF}langString`,
]);

/** No network, recursion, SPARQL, nested shapes, or executable regex supplied by the pod. */
export function compileShaclLite(
  shape: ClassShape,
  budget: ResolutionBudget,
  signal?: AbortSignal,
): (data: Store, classIRI: string) => Validation & { focusNodes: number } {
  let incomplete = false;
  let operations = 0;
  const tick = () => {
    signal?.throwIfAborted();
    if (!budget.active()) budget.signal.throwIfAborted();
    if (++operations > SHACL_LIMITS.operations) throw new Error('SHACL work limit');
  };
  const objects = (subject: Term, predicate: string): Term[] => {
    const out: Term[] = [];
    for (const q of shape.store.readQuads(subject, nn(predicate), null, null)) {
      tick();
      out.push(q.object);
    }
    return out;
  };
  const list = (head: Term): Set<string> | undefined => {
    const seen = new Set<string>();
    const out = new Set<string>();
    while (!head.equals(nn(`${RDF}nil`))) {
      tick();
      const key = termToId(head);
      if (
        (head.termType !== 'BlankNode' && head.termType !== 'NamedNode') ||
        seen.has(key) ||
        seen.size >= SHACL_LIMITS.list
      ) {
        incomplete = true;
        return;
      }
      seen.add(key);
      const first = objects(head, `${RDF}first`);
      const rest = objects(head, `${RDF}rest`);
      if (first.length !== 1 || rest.length !== 1) {
        incomplete = true;
        return;
      }
      if (first[0].termType === 'Quad') incomplete = true;
      out.add(termToId(first[0]));
      head = rest[0];
    }
    // rdf:nil is a list node too: SHACL forbids rdf:first/rdf:rest on the
    // terminator, including an empty list. Charge its inspection to the same budget.
    tick();
    const first = objects(head, `${RDF}first`);
    const rest = objects(head, `${RDF}rest`);
    if (first.length || rest.length) {
      incomplete = true;
      return;
    }
    return out;
  };
  const compile = (node: Term, property: boolean): Rule => {
    const rule: Rule = { classes: [], has: [] };
    const seen = new Set<string>();
    let statements = 0;
    for (const q of shape.store.readQuads(node, null, null, null)) {
      tick();
      statements++;
      const p = q.predicate.value;
      const v = q.object;
      // These parameters are single-valued in SHACL, unlike class/targetClass/hasValue.
      if (
        ['path', 'datatype', 'nodeKind', 'minCount', 'maxCount', 'in'].some((s) => p === SH + s)
      ) {
        if (seen.has(p)) incomplete = true;
        seen.add(p);
      }
      if (p === `${RDF}type`) {
        if (!v.equals(nn(`${SH}${property ? 'PropertyShape' : 'NodeShape'}`))) incomplete = true;
      } else if (p === `${SH}targetClass`) {
        if (v.termType !== 'NamedNode') incomplete = true;
      } else if (p === `${SH}property` && !property) {
        // Compiled separately below, never recursively.
        if (v.termType !== 'NamedNode' && v.termType !== 'BlankNode') incomplete = true;
      } else if (p === `${SH}path` && property) {
        if (v.termType === 'NamedNode') rule.path = { iri: v.value, inverse: false };
        else if (v.termType === 'BlankNode') {
          let inverse: string | undefined;
          let count = 0;
          for (const path of shape.store.readQuads(v, null, null, null)) {
            tick();
            count++;
            if (path.predicate.value === `${SH}inversePath` && path.object.termType === 'NamedNode')
              inverse = path.object.value;
          }
          if (count === 1 && inverse) rule.path = { iri: inverse, inverse: true };
          else incomplete = true;
        } else incomplete = true;
      } else if (p === `${SH}class` || p === `${SH}datatype`) {
        if (v.termType !== 'NamedNode') incomplete = true;
        else if (p === `${SH}class`) rule.classes.push(v.value);
        else {
          rule.datatype = v.value;
          if (!SUPPORTED_DATATYPES.has(v.value)) incomplete = true;
        }
      } else if (p === `${SH}nodeKind`) {
        rule.kinds = v.termType === 'NamedNode' ? NODE_KINDS[v.value.slice(SH.length)] : undefined;
        if (!v.value.startsWith(SH) || !rule.kinds) incomplete = true;
      } else if ((p === `${SH}minCount` || p === `${SH}maxCount`) && property) {
        const count = Number(v.value);
        if (
          v.termType !== 'Literal' ||
          v.datatype.value !== `${XSD}integer` ||
          !/^[+-]?[0-9]+$/.test(v.value) ||
          count < 0 ||
          !Number.isSafeInteger(count)
        )
          incomplete = true;
        else if (p === `${SH}minCount`) rule.min = count;
        else rule.max = count;
      } else if (p === `${SH}in`) rule.inside = list(v);
      else if (p === `${SH}hasValue`) {
        if (v.termType === 'Quad') incomplete = true;
        else rule.has.push(v);
      } else incomplete = true;
    }
    if (!statements || (property && !rule.path)) incomplete = true;
    return rule;
  };
  const rules: Rule[] = [];
  try {
    rules.push(compile(nn(shape.iri), false));
    for (const property of objects(nn(shape.iri), `${SH}property`)) {
      tick();
      if (rules.length > SHACL_LIMITS.properties) {
        incomplete = true;
        break;
      }
      if (property.termType === 'NamedNode' || property.termType === 'BlankNode')
        rules.push(compile(property, true));
    }
  } catch {
    incomplete = true;
  }
  return (data, classIRI) => {
    operations = 0;
    let conforms = true;
    let focusNodes = -1; // A failed focus scan is incomplete, never evidence of absence.
    let unknown = incomplete;
    // Per required class, a reverse subclass traversal and indexed type scan run once.
    const instances = new Map<string, Set<string>>();
    const typed = (iri: string): Set<string> => {
      const cached = instances.get(iri);
      if (cached) return cached;
      const classes = new Map<string, Term>([[iri, nn(iri)]]);
      const found = new Set<string>();
      for (const type of classes.values()) {
        tick();
        for (const q of data.readQuads(null, nn(SUBCLASS), type, null)) {
          tick();
          classes.set(termToId(q.subject), q.subject);
        }
        for (const q of data.readQuads(null, nn(`${RDF}type`), type, null)) {
          tick();
          found.add(termToId(q.subject));
        }
      }
      instances.set(iri, found);
      return found;
    };
    try {
      const focuses = new Map<string, Term>();
      // C4 requires positive, explicit type evidence for the requested class.
      for (const q of data.readQuads(null, nn(`${RDF}type`), nn(classIRI), null)) {
        tick();
        focuses.set(termToId(q.subject), q.subject);
      }
      focusNodes = focuses.size;
      for (const focus of focuses.values()) {
        tick();
        const paths = new Map<string, Map<string, Term>>();
        for (const rule of rules) {
          tick();
          let values = new Map<string, Term>([[termToId(focus), focus]]);
          if (rule.path) {
            const { iri, inverse } = rule.path;
            const key = `${inverse} ${iri}`;
            const cached = paths.get(key);
            if (cached) values = cached;
            else {
              values = new Map();
              for (const q of data.readQuads(
                inverse ? null : focus,
                nn(iri),
                inverse ? focus : null,
                null,
              )) {
                tick();
                const value = inverse ? q.subject : q.object;
                values.set(termToId(value), value);
              }
              paths.set(key, values);
            }
          } else if (rule !== rules[0]) continue; // Unsupported path: ignore just that constraint.
          if (values.size < (rule.min ?? 0) || values.size > (rule.max ?? Infinity))
            conforms = false;
          for (const required of rule.has) {
            tick();
            if (!values.has(termToId(required))) conforms = false;
          }
          for (const value of values.values()) {
            tick();
            if (value.termType === 'Quad') {
              unknown = true;
              continue;
            }
            for (const cls of rule.classes) {
              tick();
              if (value.termType === 'Literal' || !typed(cls).has(termToId(value)))
                conforms = false;
            }
            if (rule.kinds && !rule.kinds.includes(value.termType)) conforms = false;
            if (rule.inside && !rule.inside.has(termToId(value))) conforms = false;
            if (rule.datatype) {
              const valid = datatypeMatches(value, rule.datatype);
              if (valid === undefined) unknown = true;
              else if (!valid) conforms = false;
            }
          }
        }
      }
    } catch {
      unknown = true;
    }
    return { conforms, incomplete: unknown, focusNodes };
  };
}

/** SPARQL datatypes need lexical checks as well as matching datatype IRIs (SHACL §4.1.2). */
function datatypeMatches(value: Term, datatype: string): boolean | undefined {
  if (value.termType !== 'Literal' || value.datatype.value !== datatype) return false;
  const text = value.value;
  if (datatype === `${XSD}string` || datatype === `${RDF}langString`) return true;
  if (datatype === `${XSD}boolean`) return /^(true|false|0|1)$/.test(text);
  if (datatype === `${XSD}integer`) return /^[+-]?[0-9]+$/.test(text);
  if (datatype === `${XSD}decimal`) return /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(text);
  if (datatype === `${XSD}double` || datatype === `${XSD}float`)
    return /^(?:[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|-?INF|NaN)$/.test(text);
  if (datatype === `${XSD}dateTime`) {
    const match =
      /^(-?)([0-9]{4,})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-4]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]+))?(Z|[+-](?:0[0-9]|1[0-4]):[0-5][0-9])?$/.exec(
        text,
      );
    if (!match) return false;
    const [, , year, month, day, hour, minute, second, fraction, zone] = match;
    if (/^0+$/.test(year) || (year.length > 4 && year.startsWith('0'))) return false;
    const y = Number(year.slice(-4));
    const days = [
      31,
      y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ];
    return (
      Number(day) <= days[Number(month) - 1] &&
      (hour !== '24' ||
        (minute === '00' && second === '00' && (!fraction || /^0+$/.test(fraction)))) &&
      (!zone || (!zone.startsWith('+14:') && !zone.startsWith('-14:')) || zone.endsWith(':00'))
    );
  }
  // Derived integers (including their ranges), date, and custom datatypes are
  // unsupported until their lexical spaces are checked. IRI equality is not evidence.
  return undefined;
}

export function memberEvidence(
  data: Store,
  classIRI: string,
  budget: ResolutionBudget,
  validate?: ReturnType<typeof compileShaclLite>,
  signal?: AbortSignal,
): MemberEvidence {
  signal?.throwIfAborted();
  if (!budget.active()) budget.signal.throwIfAborted();
  if (validate) {
    const result = validate(data, classIRI);
    return result.focusNodes === 0
      ? 'non-conforming'
      : result.incomplete
        ? 'incomplete'
        : result.focusNodes > 0 && result.conforms
          ? 'conforms'
          : 'non-conforming';
  }
  return data
    .readQuads(null, nn(`${RDF}type`), nn(classIRI), null)
    [Symbol.iterator]()
    .next().done
    ? 'non-conforming'
    : 'conforms';
}
