// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore, Quad, Term } from "@rdfjs/types";
import {
  BlankNodeFrom,
  NamedGraphDataset,
  NamedNodeFrom,
  SetFrom,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { canonicalA2aIri, RDF, RDF_TYPE, RDFS, SH } from "./vocab.js";

// These are links to nodes, not vocabulary operands. Everything else in a
// shapes graph is normalized by default, including new constraint operands.
const NODE_REFERENCES = new Set([
  `${SH}targetNode`,
  `${SH}node`,
  `${SH}property`,
  `${SH}not`,
  `${SH}qualifiedValueShape`,
  `${SH}and`,
  `${SH}or`,
  `${SH}xone`,
  `${SH}group`,
  `${SH}defaultValue`,
  `${SH}sparql`,
  `${SH}prefixes`,
  `${SH}declare`,
  `${SH}parameter`,
  `${SH}validator`,
  `${RDF}first`,
  `${RDF}rest`,
]);

type ListRole = "path" | "vocabulary" | "value" | "typeValue" | "typeShape";
const NESTED_SHAPES = new Set([`${SH}node`, `${SH}not`, `${SH}qualifiedValueShape`]);
const SHAPE_LISTS = new Set([`${SH}and`, `${SH}or`, `${SH}xone`]);

/**
 * A disposable alias-equivalent view; NEVER use it when hashing or serializing a PD.
 * Pass the original data graph when projecting a shapes graph.
 */
export function validationDataset(dataset: DatasetCore, data?: DatasetCore): Store {
  const store = new Store();
  const lists = new Map<string, Term>();
  const typeShapes = new Map<string, Term>();
  const resources = new Set<string>();
  const subClasses = new Map<string, Map<string, Term>>();
  let classProjectionRequired = false;
  if (data) {
    for (const quad of data) {
      // Register BOTH spellings of every resource family as identities. Even an
      // unmatched sh:hasValue/sh:in operand must not become an alias of a linked
      // resource. Classes (rdf:type objects) instead denote vocabulary terms.
      if (quad.subject.termType === "NamedNode") resources.add(canonicalA2aIri(quad.subject.value));
      if (quad.predicate.value === `${RDFS}subClassOf`) {
        const parent = classKey(quad.object);
        const children = subClasses.get(parent) ?? new Map<string, Term>();
        children.set(classKey(quad.subject), canonical(quad.subject));
        subClasses.set(parent, children);
        classProjectionRequired ||= !canonical(quad.subject).equals(quad.subject);
      } else if (quad.predicate.value !== RDF_TYPE && quad.object.termType === "NamedNode") {
        resources.add(canonicalA2aIri(quad.object.value));
      }
    }
    for (const quad of dataset) {
      if (quad.predicate.value === `${SH}targetNode` && quad.object.termType === "NamedNode") {
        resources.add(canonicalA2aIri(quad.object.value));
      }
    }
  }

  function canonical(term: Term): Term {
    return term.termType === "NamedNode"
      ? NamedNodeFrom.string(canonicalA2aIri(term.value), DataFactory)
      : term;
  }

  function add(subject: Term, predicate: string, object: Term, graph: Quad["graph"]): void {
    const node = new TermWrapper(
      subject,
      new NamedGraphDataset(graph, store, DataFactory),
      DataFactory,
    );
    SetFrom.subjectPredicate(
      node,
      predicate,
      (value) => TermFrom.instance(value, DataFactory),
      TermFrom.itself,
    ).add(object);
  }

  function objects(subject: Term, predicate: string, graph: Quad["graph"]): Term[] {
    const node = new TermWrapper(
      subject,
      new NamedGraphDataset(graph, dataset, DataFactory),
      DataFactory,
    );
    return [
      ...SetFrom.subjectPredicate(
        node,
        predicate,
        (value) => TermFrom.instance(value, DataFactory),
        TermFrom.itself,
      ),
    ];
  }

  function value(term: Term, typeValue = false): Term {
    return typeValue || !resources.has(canonicalA2aIri(term.value)) ? canonical(term) : term;
  }

  function key(term: Term, graph: Quad["graph"], role: string): string {
    return JSON.stringify([graph.termType, graph.value, term.termType, term.value, role]);
  }

  function items(head: Term, graph: Quad["graph"], seen = new Set<string>()): Term[] {
    const id = key(head, graph, "items");
    if (seen.has(id)) return [];
    seen.add(id);
    return [
      ...objects(head, `${RDF}first`, graph),
      ...objects(head, `${RDF}rest`, graph).flatMap((rest) => items(rest, graph, seen)),
    ];
  }

  function returnsTypes(
    term: Term,
    graph: Quad["graph"],
    inputTypes = false,
    seen = new Set<string>(),
  ): boolean {
    if (term.termType === "NamedNode")
      return term.value === RDF_TYPE || term.value === `${RDFS}subClassOf`;
    const id = key(term, graph, "pathType");
    if (seen.has(id)) return false;
    const visited = new Set(seen).add(id);
    const sequence = items(term, graph);
    if (sequence.length > 0) {
      return sequence.reduce(
        (types, step) => returnsTypes(step, graph, types, visited),
        inputTypes,
      );
    }
    const alternatives = objects(term, `${SH}alternativePath`, graph).flatMap((head) =>
      items(head, graph),
    );
    if (alternatives.length > 0) {
      return alternatives.every((step) => returnsTypes(step, graph, inputTypes, visited));
    }
    return (
      objects(term, `${SH}oneOrMorePath`, graph).some((step) =>
        returnsTypes(step, graph, inputTypes, visited),
      ) ||
      (inputTypes &&
        [`${SH}zeroOrMorePath`, `${SH}zeroOrOnePath`].some((predicate) =>
          objects(term, predicate, graph).some((step) => returnsTypes(step, graph, true, visited)),
        ))
    );
  }

  function shapeTypeValues(subject: Term, graph: Quad["graph"], inherited = false): boolean {
    const paths = objects(subject, `${SH}path`, graph);
    return paths.length > 0
      ? paths.every((term) => returnsTypes(term, graph, inherited))
      : inherited;
  }

  function typeShape(subject: Term, graph: Quad["graph"]): Term {
    const id = key(subject, graph, "typeShape");
    const cached = typeShapes.get(id);
    if (cached) return cached;
    const copy = BlankNodeFrom.string(undefined, DataFactory);
    typeShapes.set(id, copy);
    // A referenced shape inherits its value role, but may also be referenced by
    // a resource-valued constraint. Keep those views separate, just like lists.
    // Targets apply only to the original shape's independent validation roots.
    const typeValues = shapeTypeValues(subject, graph, true);
    for (const quad of dataset.match(subject, null, null, graph)) {
      if (!quad.predicate.value.startsWith(`${SH}target`)) {
        addShapeQuad(copy, quad, typeValues, false);
      }
    }
    return copy;
  }

  function path(term: Term, graph: Quad["graph"]): Term {
    // Named predicate paths are vocabulary; blank path expressions are syntax
    // nodes. A sequence list needs its own vocabulary-valued projection.
    return term.termType === "BlankNode" && objects(term, `${RDF}first`, graph).length > 0
      ? list(term, "path", graph)
      : canonical(term);
  }

  function list(head: Term, role: ListRole, graph: Quad["graph"]): Term {
    if (head.value === `${RDF}nil`) return head;
    const id = key(head, graph, role);
    const cached = lists.get(id);
    if (cached) return cached;
    const copy = BlankNodeFrom.string(undefined, DataFactory);
    lists.set(id, copy);
    for (const item of objects(head, `${RDF}first`, graph)) {
      const mapped =
        role === "path"
          ? path(item, graph)
          : role === "typeShape"
            ? typeShape(item, graph)
            : role === "vocabulary"
              ? canonical(item)
              : value(item, role === "typeValue");
      add(copy, `${RDF}first`, mapped, graph);
    }
    for (const rest of objects(head, `${RDF}rest`, graph)) {
      add(copy, `${RDF}rest`, list(rest, role, graph), graph);
    }
    return copy;
  }

  function shapeObject(quad: Quad, typeValue: boolean): Term {
    const predicate = canonicalA2aIri(quad.predicate.value);
    const object = quad.object;
    if (predicate === `${SH}in`) return list(object, typeValue ? "typeValue" : "value", quad.graph);
    if (predicate === `${SH}hasValue`) return value(object, typeValue);
    if (predicate === `${SH}ignoredProperties`) return list(object, "vocabulary", quad.graph);
    if (predicate === `${SH}alternativePath`) return list(object, "path", quad.graph);
    if (predicate === `${SH}path` || (predicate.startsWith(SH) && predicate.endsWith("Path"))) {
      return path(object, quad.graph);
    }
    if (typeValue && NESTED_SHAPES.has(predicate)) return typeShape(object, quad.graph);
    if (typeValue && SHAPE_LISTS.has(predicate)) return list(object, "typeShape", quad.graph);
    return NODE_REFERENCES.has(predicate) ? object : canonical(object);
  }

  function classes(term: Term): Term[] {
    const root = canonical(term);
    const descendants = new Map([[classKey(root), root]]);
    for (const [id] of descendants) {
      for (const [childId, child] of subClasses.get(id) ?? []) descendants.set(childId, child);
    }
    // Traverse blank class nodes too, while keeping sh:class/targetClass operands
    // as IRIs. The original hierarchy still handles blank-node class instances.
    return [...descendants.values()].filter(
      (child) => child.termType === "NamedNode" || child.equals(root),
    );
  }

  function classKey(term: Term): string {
    const normalized = canonical(term);
    return JSON.stringify([normalized.termType, normalized.value]);
  }

  function addShapeQuad(subject: Term, quad: Quad, typeValues: boolean, targets = true): void {
    const predicate = canonicalA2aIri(quad.predicate.value);
    if (predicate === `${SH}targetClass`) {
      for (const type of classes(quad.object)) add(subject, predicate, type, quad.graph);
      return;
    }
    if (targets && predicate === RDF_TYPE && quad.object.value === `${RDFS}Class`) {
      // Implicit class targets refer to the shape subject AS A CLASS, while its
      // subject and all links to that named shape must keep their exact identity.
      for (const type of classes(quad.subject)) add(subject, `${SH}targetClass`, type, quad.graph);
    }
    if (predicate === `${SH}class` && classProjectionRequired) {
      const types = classes(quad.object);
      if (types.length > 1) {
        // Compute alias-aware class inheritance without relabelling class-axiom
        // SUBJECTS (which may also identify resources). An OR of class checks is
        // equivalent to testing membership of the class or any of its subclasses.
        // Nest it under sh:node so it composes with existing logical constraints.
        const constraint = BlankNodeFrom.string(undefined, DataFactory);
        let head: Term = NamedNodeFrom.string(`${RDF}nil`, DataFactory);
        for (const type of types) {
          const branch = BlankNodeFrom.string(undefined, DataFactory);
          const cell = BlankNodeFrom.string(undefined, DataFactory);
          add(branch, `${SH}class`, type, quad.graph);
          add(cell, `${RDF}first`, branch, quad.graph);
          add(cell, `${RDF}rest`, head, quad.graph);
          head = cell;
        }
        add(constraint, `${SH}or`, head, quad.graph);
        add(subject, `${SH}node`, constraint, quad.graph);
        return;
      }
    }
    add(subject, predicate, shapeObject(quad, typeValues), quad.graph);
  }

  for (const quad of dataset) {
    const predicate = canonicalA2aIri(quad.predicate.value);
    let object: Term = quad.object;
    if (data) {
      // Correctness comes from separating REFERENCES from OPERANDS, rather than
      // an allowlist of constraints to fix: every vocabulary operand is aliased,
      // wherever SHACL stores it. Lists are projected by their owner's semantic
      // role, so a shared list can denote paths/classes in one place and exact
      // resources/shapes in another. Value roles propagate through nested shapes.
      // Subjects, graph names, action/parameter links and distinct named shapes
      // never collapse across namespace spellings.
      addShapeQuad(quad.subject, quad, shapeTypeValues(quad.subject, quad.graph));
      continue;
    } else if (predicate === RDF_TYPE || predicate === `${RDFS}subClassOf`) {
      object = canonical(object);
    }
    add(quad.subject, predicate, object, quad.graph);
  }
  return store;
}
