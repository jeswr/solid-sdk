// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import {
  assertWritableQuads,
  type ClassWalkBudget,
  hasDatasetClass,
  httpIriOrUndefined,
  isSafeAbsoluteIri,
  literalMapper,
  readLiteral,
  VALIDATED_DATATYPES,
  XSD,
} from "@jeswr/model-runtime";
import type { DatasetCore, Term } from "@rdfjs/types";
import { TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { checkedPrefixes, DASH, LIMIT, objects, put, RDF, RDFS, SH, termId } from "./rdf.js";
import {
  type FieldDescriptor,
  FormAdmissionError,
  type FormModel,
  type GroupDescriptor,
} from "./types.js";

const META = ["name", "description", "message", "order", "group", "severity"];
const PROPERTY = new Set([
  ...META,
  "path",
  "datatype",
  "nodeKind",
  "minCount",
  "maxCount",
  "in",
  "minInclusive",
  "maxInclusive",
  "minLength",
  "pattern",
  "class",
  "node",
]);
const NODE = new Set([...META, "targetClass", "property", "declare"]);
/** Reviewed non-SHACL predicates per subject role; everything else (dash:*, owl:imports, …) fails closed. */
const DISPLAY = [`${RDF}type`, `${RDFS}label`, `${RDFS}comment`];
const FOREIGN = {
  node: new Set(DISPLAY),
  property: new Set([...DISPLAY, `${DASH}singleLine`]),
  group: new Set(DISPLAY),
  declaration: new Set([`${RDF}type`]),
} as const;
/** Issue keys use `.` and `[i]` as separators, so field keys must not contain them. */
const AMBIGUOUS_KEY = /[.[\]]/;
export const compiledForms = new WeakSet<FormModel>();
export const localName = (iri: string): string =>
  iri.slice(Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/")) + 1) || "field";
export function compileForm(shapes: DatasetCore, shapeIri: string): FormModel {
  function reject(component: string, subject = shapeIri, reason?: string): never {
    throw new FormAdmissionError(component, subject, reason);
  }
  if (!isSafeAbsoluteIri(shapeIri)) reject("shape", shapeIri, "expected a safe absolute shape IRI");
  // Snapshot the bounded input: callers cannot alter constraints after admission.
  const store = new Store();
  let bytes = 0;
  let rawQuads = 0;
  for (const q of shapes) {
    bytes += q.subject.value.length + q.predicate.value.length + q.object.value.length;
    if (q.object.termType === "Literal")
      bytes += q.object.datatype.value.length + q.object.language.length;
    if (++rawQuads > LIMIT.quads || bytes > LIMIT.bytes) reject("graph limit");
    try {
      assertWritableQuads([q]);
    } catch {
      reject("RDF term", q.subject.value);
    }
    // assertWritableQuads is the single IRI/datatype/language policy for admitted terms.
    if (q.graph.termType !== "DefaultGraph") reject("named graph", q.subject.value);
    store.add(q);
  }
  const all = (subject: Term, predicate: string): Term[] => [...objects(store, subject, predicate)];
  const one = (subject: Term, predicate: string): Term | undefined => {
    const values = all(subject, predicate);
    if (values.length > 1) reject(predicate, subject.value, "multiple parameters");
    return values[0];
  };
  const iri = (subject: Term, predicate: string): string | undefined => {
    const term = one(subject, predicate);
    if (!term) return undefined;
    if (term.termType !== "NamedNode" || !isSafeAbsoluteIri(term.value))
      reject(predicate, subject.value, "expected an absolute IRI");
    return term.value;
  };
  const text = (subject: Term, predicate: string): string | undefined => {
    const term = one(subject, predicate);
    if (!term) return undefined;
    if (term.termType !== "Literal" || term.language || term.datatype.value !== `${XSD}string`)
      reject(predicate, subject.value, "expected xsd:string");
    return term.value;
  };
  const number = (subject: Term, component: string, count = false): number | undefined => {
    const term = one(subject, SH + component);
    if (!term) return undefined;
    const value = (() => {
      try {
        return readLiteral(term);
      } catch {
        return undefined;
      }
    })();
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (count &&
        (term.termType !== "Literal" ||
          term.datatype.value !== `${XSD}integer` ||
          !Number.isSafeInteger(value) ||
          value < 0))
    )
      reject(SH + component, subject.value, "invalid numeric parameter");
    return value as number;
  };
  // Closed admission inspects orphan and referenced SHACL constraints as well.
  const subjects = new Map<string, Term>();
  for (const q of store)
    if (
      q.predicate.value.startsWith(SH) ||
      (q.predicate.value === `${RDF}type` &&
        [`${SH}NodeShape`, `${SH}PropertyShape`, `${SH}PropertyGroup`].includes(q.object.value))
    )
      subjects.set(termId(q.subject), q.subject);
  const classGraph = new Store(store);
  // One read budget for every implicit-class walk in this compile (not per subject).
  const classBudget: ClassWalkBudget = { reads: 0, limit: LIMIT.classReads };
  let focusId = 0;
  for (const subject of subjects.values()) {
    let focus: ReturnType<typeof DataFactory.namedNode> = DataFactory.namedNode(
      `urn:shacl-forms:class-check:${++focusId}`,
    );
    while (
      classGraph.countQuads(focus, null, null, null) ||
      classGraph.countQuads(null, null, focus, null)
    )
      focus = DataFactory.namedNode(`${focus.value}:next`);
    for (const type of all(subject, `${RDF}type`)) put(classGraph, focus, `${RDF}type`, type);
    const doc = new TermWrapper(focus, classGraph, DataFactory);
    const implicit = hasDatasetClass(
      doc,
      focus.value,
      [`${RDFS}Class`, "http://www.w3.org/2002/07/owl#Class"],
      classBudget,
    );
    // An exhausted budget makes the walk answer false; treat that as unknown and reject.
    if (classBudget.reads > classBudget.limit)
      reject("class walk limit", subject.value, "subclass graph exceeds the read budget");
    if (implicit) reject("implicit class target", subject.value);
    const property =
      all(subject, `${SH}path`).length > 0 ||
      store.countQuads(subject, `${RDF}type`, DataFactory.namedNode(`${SH}PropertyShape`), null) >
        0;
    const group =
      store.countQuads(subject, `${RDF}type`, DataFactory.namedNode(`${SH}PropertyGroup`), null) >
      0;
    const declaration =
      all(subject, `${SH}prefix`).length > 0 || all(subject, `${SH}namespace`).length > 0;
    const role = declaration ? "declaration" : group ? "group" : property ? "property" : "node";
    const allowed = {
      declaration: new Set(["prefix", "namespace"]),
      group: new Set(["order"]),
      property: PROPERTY,
      node: NODE,
    }[role];
    for (const q of store.getQuads(subject, null, null, null)) {
      if (!q.predicate.value.startsWith(SH)) {
        if (!FOREIGN[role].has(q.predicate.value)) reject(q.predicate.value, subject.value);
        continue;
      }
      const component = q.predicate.value.slice(SH.length);
      if (!allowed.has(component)) reject(q.predicate.value, subject.value);
      if (component !== "property" && component !== "declare") one(subject, q.predicate.value);
    }
    if (property) {
      const datatype = iri(subject, `${SH}datatype`);
      const nodeKind = iri(subject, `${SH}nodeKind`);
      const hasClass = iri(subject, `${SH}class`);
      const nested = iri(subject, `${SH}node`);
      if (datatype && !VALIDATED_DATATYPES.includes(datatype))
        reject(`${SH}datatype`, subject.value);
      if (nodeKind && ![`${SH}IRI`, `${SH}Literal`].includes(nodeKind))
        reject(`${SH}nodeKind`, subject.value);
      for (const component of ["minCount", "maxCount", "minLength"])
        number(subject, component, true);
      for (const component of ["minInclusive", "maxInclusive", "order"]) number(subject, component);
      const pattern = text(subject, `${SH}pattern`);
      const isIri = nodeKind === `${SH}IRI` || !!hasClass || !!nested || !datatype;
      if (
        pattern !== undefined &&
        !(
          (isIri && ["^https?://", "^https://"].includes(pattern)) ||
          ((isIri || (datatype && literalMapper(datatype).jsType === "string")) &&
            pattern === "\\S")
        )
      )
        reject(`${SH}pattern`, subject.value);
    }
    const severity = iri(subject, `${SH}severity`);
    if (severity && ![`${SH}Violation`, `${SH}Warning`, `${SH}Info`].includes(severity))
      reject(`${SH}severity`, subject.value);
  }
  const prefixes: Record<string, string> = Object.create(null);
  for (const q of store.match(null, DataFactory.namedNode(`${SH}declare`))) {
    const prefix = text(q.object, `${SH}prefix`);
    const namespaceTerm = one(q.object, `${SH}namespace`);
    if (
      prefix === undefined ||
      namespaceTerm?.termType !== "Literal" ||
      namespaceTerm.datatype.value !== `${XSD}anyURI` ||
      !isSafeAbsoluteIri(namespaceTerm.value)
    )
      reject(`${SH}declare`, q.subject.value);
    if (prefixes[prefix] !== undefined && prefixes[prefix] !== namespaceTerm.value)
      reject(`${SH}prefix`, q.subject.value, "conflicting prefix");
    prefixes[prefix] = namespaceTerm.value;
  }
  try {
    checkedPrefixes(prefixes);
  } catch {
    reject(`${SH}prefix`);
  }
  const groupRanks = new Map(
    store
      .getQuads(null, `${RDF}type`, DataFactory.namedNode(`${SH}PropertyGroup`), null)
      .map((q, i) => [q.subject.value, i]),
  );
  let fieldCount = 0;
  const readNode = (id: string, ancestors: Set<string>): FormModel => {
    if (ancestors.has(id)) reject(`${SH}node`, id, "cyclic shape reference");
    if (ancestors.size >= LIMIT.depth) reject(`${SH}node`, id, "maximum depth is four NodeShapes");
    const subject = DataFactory.namedNode(id);
    if (!store.countQuads(subject, `${RDF}type`, DataFactory.namedNode(`${SH}NodeShape`), null))
      reject(`${SH}NodeShape`, id, "missing NodeShape declaration");
    const next = new Set(ancestors).add(id);
    const form: FormModel = { shape: id, fields: [], groups: [], prefixes: { ...prefixes } };
    form.targetClass = iri(subject, `${SH}targetClass`);
    form.label = text(subject, `${RDFS}label`) ?? text(subject, `${SH}name`);
    form.description = text(subject, `${SH}description`);
    const paths = new Set<string>();
    const keys = new Set<string>();
    const groups = new Map<string, GroupDescriptor>();
    for (const prop of all(subject, `${SH}property`)) {
      if (++fieldCount > LIMIT.fields) reject("field limit", id);
      if (prop.termType !== "NamedNode" && prop.termType !== "BlankNode")
        reject(`${SH}property`, id);
      const path = iri(prop, `${SH}path`);
      if (!path) reject(`${SH}path`, prop.value, "a single predicate is required");
      if (path === `${RDF}type` || paths.has(path))
        reject(`${SH}path`, id, "reserved or duplicate predicate");
      paths.add(path);
      const name = text(prop, `${SH}name`);
      const base = name ?? localName(path);
      if (!base || base.length > 4096 || ["__proto__", "prototype", "constructor"].includes(base))
        reject(`${SH}name`, prop.value, "unsafe field key");
      if (AMBIGUOUS_KEY.test(base))
        reject(`${SH}name`, prop.value, "field keys cannot contain '.', '[' or ']'");
      let key = base;
      for (let suffix = 2; keys.has(key); suffix++) key = `${base}_${suffix}`;
      keys.add(key);
      const datatype = iri(prop, `${SH}datatype`);
      const nodeKind = iri(prop, `${SH}nodeKind`);
      const hasClass = iri(prop, `${SH}class`);
      const node = iri(prop, `${SH}node`);
      // nodeKind/datatype/pattern allowlists were already enforced for every property subject.
      const isIri = nodeKind === `${SH}IRI` || !!hasClass || !!node || !datatype;
      if (
        (isIri && datatype) ||
        (!isIri && nodeKind === `${SH}IRI`) ||
        (isIri && nodeKind === `${SH}Literal`)
      )
        reject(`${SH}datatype`, prop.value, "contradictory term kinds or missing literal datatype");
      const mapper = isIri ? undefined : literalMapper(datatype as string);
      const field: FieldDescriptor = {
        path,
        key,
        name,
        datatype,
        hasClass,
        kind: node
          ? "node"
          : isIri
            ? "iri"
            : mapper?.jsType === "number"
              ? [`${XSD}decimal`, `${XSD}double`, `${XSD}float`].includes(datatype as string)
                ? "decimal"
                : "integer"
              : datatype === `${XSD}date`
                ? "date"
                : datatype === `${XSD}dateTime`
                  ? "dateTime"
                  : mapper?.jsType === "boolean"
                    ? "boolean"
                    : "text",
        minCount: number(prop, "minCount", true) ?? 0,
        maxCount: number(prop, "maxCount", true),
        minLength: number(prop, "minLength", true),
        minInclusive: number(prop, "minInclusive"),
        maxInclusive: number(prop, "maxInclusive"),
        severity: (
          {
            [`${SH}Violation`]: "violation",
            [`${SH}Warning`]: "warning",
            [`${SH}Info`]: "info",
          } as const
        )[iri(prop, `${SH}severity`) ?? `${SH}Violation`] as FieldDescriptor["severity"],
        label: text(prop, `${RDFS}label`) ?? name,
        description: text(prop, `${SH}description`),
        message: text(prop, `${SH}message`),
        order: number(prop, "order"),
        group: iri(prop, `${SH}group`),
      };
      if (field.maxCount !== undefined && field.minCount > field.maxCount)
        reject(`${SH}minCount`, prop.value, "minimum exceeds maximum");
      if (
        field.minInclusive !== undefined &&
        field.maxInclusive !== undefined &&
        field.minInclusive > field.maxInclusive
      )
        reject(`${SH}minInclusive`, prop.value, "minimum exceeds maximum");
      if (field.minLength !== undefined && !isIri && mapper?.jsType !== "string")
        reject(`${SH}minLength`, prop.value);
      if (
        (field.minInclusive !== undefined || field.maxInclusive !== undefined) &&
        mapper?.jsType !== "number"
      )
        reject(`${SH}minInclusive/maxInclusive`, prop.value);
      const pattern = text(prop, `${SH}pattern`);
      if (pattern !== undefined) field.pattern = pattern as FieldDescriptor["pattern"];
      const singleLine = one(prop, `${DASH}singleLine`);
      if (singleLine) {
        if (singleLine.termType !== "Literal" || singleLine.datatype.value !== `${XSD}boolean`)
          reject(`${DASH}singleLine`, prop.value);
        let flag: unknown;
        try {
          flag = readLiteral(singleLine);
        } catch {
          reject(`${DASH}singleLine`, prop.value);
        }
        if (field.kind !== "text") reject(`${DASH}singleLine`, prop.value);
        if (flag === false) field.kind = "multiline";
        else field.singleLine = true;
      }
      const head = one(prop, `${SH}in`);
      if (head) {
        const options: NonNullable<FieldDescriptor["options"]> = [];
        const seen = new Set<string>();
        let cell = head;
        while (!(cell.termType === "NamedNode" && cell.value === `${RDF}nil`)) {
          if (
            !["NamedNode", "BlankNode"].includes(cell.termType) ||
            seen.has(termId(cell)) ||
            options.length >= LIMIT.options
          )
            reject(`${SH}in`, prop.value, "malformed or excessive list");
          seen.add(termId(cell));
          const member = one(cell, `${RDF}first`);
          const rest = one(cell, `${RDF}rest`);
          if (!member || !rest) reject(`${SH}in`, prop.value, "malformed list");
          if (isIri) {
            if (
              member.termType !== "NamedNode" ||
              !isSafeAbsoluteIri(member.value) ||
              httpIriOrUndefined(member.value) === undefined
            )
              reject(`${SH}in`, prop.value);
          } else {
            if (
              member.termType !== "Literal" ||
              member.datatype.value !== datatype ||
              member.language
            )
              reject(`${SH}in`, prop.value);
            try {
              const value = readLiteral(member);
              if (
                value instanceof Date ||
                (typeof value === "number" && !Number.isFinite(value)) ||
                !member.equals(mapper?.from(value as never, DataFactory))
              )
                reject(`${SH}in`, prop.value, "noncanonical enum member");
            } catch {
              reject(`${SH}in`, prop.value, "invalid enum literal");
            }
          }
          options.push({
            value: member.value,
            termType: isIri ? "NamedNode" : "Literal",
            label: member.termType === "NamedNode" ? text(member, `${RDFS}label`) : undefined,
          });
          cell = rest;
        }
        if (!options.length) reject(`${SH}in`, prop.value, "empty enumeration");
        field.options = options;
        field.kind = "choice";
      }
      if (node) {
        if (
          head ||
          field.minLength !== undefined ||
          pattern ||
          field.minInclusive !== undefined ||
          field.maxInclusive !== undefined
        )
          reject(`${SH}node`, prop.value, "nested links cannot carry scalar guards");
        field.form = readNode(node, next);
      }
      if (field.group && !groups.has(field.group)) {
        const term = DataFactory.namedNode(field.group);
        if (
          !store.countQuads(term, `${RDF}type`, DataFactory.namedNode(`${SH}PropertyGroup`), null)
        )
          reject(`${SH}group`, prop.value, "missing PropertyGroup declaration");
        groups.set(field.group, {
          iri: field.group,
          label: text(term, `${RDFS}label`),
          order: number(term, "order"),
        });
      }
      form.fields.push(field);
    }
    form.fields.sort(
      (a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY),
    );
    keys.clear();
    for (const field of form.fields) {
      const base = field.name ?? localName(field.path);
      let key = base;
      for (let suffix = 2; keys.has(key); suffix++) key = `${base}_${suffix}`;
      keys.add(key);
      field.key = key;
    }
    form.groups = [...groups.values()].sort(
      (a, b) =>
        (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) ||
        (groupRanks.get(a.iri) ?? 0) - (groupRanks.get(b.iri) ?? 0),
    );
    return form;
  };
  const form = readNode(shapeIri, new Set());
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  };
  freeze(form);
  const register = (model: FormModel): void => {
    compiledForms.add(model);
    for (const field of model.fields) if (field.form) register(field.form);
  };
  register(form);
  return form;
}
