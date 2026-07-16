// AUTHORED-BY GPT-5.6 Sol via codex

import type { DatasetCore, Literal, NamedNode, Term } from "@rdfjs/types";
import type { PropertyConstraints } from "./types.js";
import { RDF, SH, XSD } from "./vocab.js";

const MAX_GENERATED_COUNT = 1_024;
const MAX_GENERATED_LENGTH = 256;

const NUMERIC_DATATYPES = new Set([
  "http://www.w3.org/2001/XMLSchema#byte",
  "http://www.w3.org/2001/XMLSchema#decimal",
  "http://www.w3.org/2001/XMLSchema#double",
  "http://www.w3.org/2001/XMLSchema#float",
  "http://www.w3.org/2001/XMLSchema#int",
  "http://www.w3.org/2001/XMLSchema#integer",
  "http://www.w3.org/2001/XMLSchema#long",
  "http://www.w3.org/2001/XMLSchema#negativeInteger",
  "http://www.w3.org/2001/XMLSchema#nonNegativeInteger",
  "http://www.w3.org/2001/XMLSchema#nonPositiveInteger",
  "http://www.w3.org/2001/XMLSchema#positiveInteger",
  "http://www.w3.org/2001/XMLSchema#short",
  "http://www.w3.org/2001/XMLSchema#unsignedByte",
  "http://www.w3.org/2001/XMLSchema#unsignedInt",
  "http://www.w3.org/2001/XMLSchema#unsignedLong",
  "http://www.w3.org/2001/XMLSchema#unsignedShort",
]);

export interface ParsedNodeShape {
  term: NamedNode;
  properties: readonly PropertyConstraints[];
  targetClasses: readonly NamedNode[];
  closed: boolean;
  ignoredProperties: readonly NamedNode[];
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function termKey(term: Term): string {
  switch (term.termType) {
    case "Literal":
      return `3:${term.value}:${term.language}:${term.datatype.value}`;
    case "Quad":
      return `4:${termKey(term.subject)}:${termKey(term.predicate)}:${termKey(term.object)}:${termKey(term.graph)}`;
    default:
      return `${term.termType === "NamedNode" ? "1" : "2"}:${term.value}`;
  }
}

export function compareTerms(left: Term, right: Term): number {
  return compareStrings(termKey(left), termKey(right));
}

function objects(dataset: DatasetCore, subject: Term, predicate: NamedNode): Term[] {
  return [...dataset.match(subject, predicate, null, null)]
    .map((quad) => quad.object)
    .sort(compareTerms);
}

function optionalObject(
  dataset: DatasetCore,
  subject: Term,
  predicate: NamedNode,
): Term | undefined {
  const values = objects(dataset, subject, predicate);
  if (values.length > 1) {
    throw new Error(`${predicate.value} must occur at most once on ${termKey(subject)}`);
  }
  return values[0];
}

function optionalNamedNode(
  dataset: DatasetCore,
  subject: Term,
  predicate: NamedNode,
): NamedNode | undefined {
  const value = optionalObject(dataset, subject, predicate);
  if (value !== undefined && value.termType !== "NamedNode") {
    throw new Error(`${predicate.value} on ${termKey(subject)} must be a named node`);
  }
  return value;
}

function optionalLiteral(
  dataset: DatasetCore,
  subject: Term,
  predicate: NamedNode,
): Literal | undefined {
  const value = optionalObject(dataset, subject, predicate);
  if (value !== undefined && value.termType !== "Literal") {
    throw new Error(`${predicate.value} on ${termKey(subject)} must be a literal`);
  }
  return value;
}

function integerValue(
  dataset: DatasetCore,
  subject: Term,
  predicate: NamedNode,
): number | undefined {
  const literal = optionalLiteral(dataset, subject, predicate);
  if (literal === undefined) return undefined;
  const value = Number(literal.value);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${predicate.value} on ${termKey(subject)} must be a non-negative integer`);
  }
  return value;
}

function numericValue(
  dataset: DatasetCore,
  subject: Term,
  predicate: NamedNode,
): number | undefined {
  const literal = optionalLiteral(dataset, subject, predicate);
  if (literal === undefined) return undefined;
  const value = Number(literal.value);
  if (!Number.isFinite(value)) {
    throw new Error(`${predicate.value} on ${termKey(subject)} must be finite numeric data`);
  }
  return value;
}

function booleanValue(
  dataset: DatasetCore,
  subject: Term,
  predicate: NamedNode,
): boolean | undefined {
  const literal = optionalLiteral(dataset, subject, predicate);
  if (literal === undefined) return undefined;
  if (literal.value === "true" || literal.value === "1") return true;
  if (literal.value === "false" || literal.value === "0") return false;
  throw new Error(`${predicate.value} on ${termKey(subject)} must be an xsd:boolean lexical value`);
}

export function readList(dataset: DatasetCore, head: Term): Term[] {
  if (head.equals(RDF.nil)) return [];
  const values: Term[] = [];
  const visited = new Set<string>();
  let cursor = head;
  while (!cursor.equals(RDF.nil)) {
    const key = termKey(cursor);
    if (visited.has(key)) throw new Error(`Cyclic RDF list starting at ${termKey(head)}`);
    visited.add(key);
    const first = objects(dataset, cursor, RDF.first);
    const rest = objects(dataset, cursor, RDF.rest);
    if (first.length !== 1 || rest.length !== 1) {
      throw new Error(
        `Malformed RDF list node ${termKey(cursor)}: expected one rdf:first and rdf:rest`,
      );
    }
    const item = first[0];
    const next = rest[0];
    if (item === undefined || next === undefined) throw new Error("Malformed RDF list");
    values.push(item);
    cursor = next;
  }
  return values;
}

function assertUnsupported(dataset: DatasetCore, subject: Term): void {
  const unsupported = [
    SH.and,
    SH.disjoint,
    SH.equals,
    SH.flags,
    SH.lessThan,
    SH.lessThanOrEquals,
    SH.nodeKind,
    SH.not,
    SH.or,
    SH.qualifiedMaxCount,
    SH.qualifiedMinCount,
    SH.qualifiedValueShape,
    SH.sparql,
    SH.xone,
  ];
  for (const predicate of unsupported) {
    if (dataset.match(subject, predicate, null, null).size > 0) {
      throw new Error(`Unsupported SHACL constraint ${predicate.value} on ${termKey(subject)}`);
    }
  }
}

function assertNoNodeLevelPropertyConstraints(dataset: DatasetCore, shape: NamedNode): void {
  const propertyOnly = [
    SH.class,
    SH.datatype,
    SH.hasValue,
    SH.in,
    SH.languageIn,
    SH.maxCount,
    SH.maxExclusive,
    SH.maxInclusive,
    SH.maxLength,
    SH.minCount,
    SH.minExclusive,
    SH.minInclusive,
    SH.minLength,
    SH.node,
    SH.path,
    SH.pattern,
    SH.uniqueLang,
  ];
  for (const predicate of propertyOnly) {
    if (dataset.match(shape, predicate, null, null).size > 0) {
      throw new Error(
        `Unsupported node-level SHACL constraint ${predicate.value} on ${shape.value}`,
      );
    }
  }
}

function language(
  dataset: DatasetCore,
  subject: Term,
): { language: "en"; uniqueLang: boolean } | undefined {
  const languageHead = optionalObject(dataset, subject, SH.languageIn);
  const unique = booleanValue(dataset, subject, SH.uniqueLang);
  if (languageHead === undefined) {
    if (unique === true) {
      throw new Error(`${SH.uniqueLang.value} is supported only with sh:languageIn ("en")`);
    }
    return undefined;
  }
  const languages = readList(dataset, languageHead);
  if (
    languages.length !== 1 ||
    languages[0]?.termType !== "Literal" ||
    languages[0].value.toLowerCase() !== "en"
  ) {
    throw new Error(`${SH.languageIn.value} supports only the single language "en"`);
  }
  return { language: "en", uniqueLang: unique === true };
}

function assertSupportedOrderingFacets(
  path: NamedNode,
  datatype: NamedNode | undefined,
  facets: readonly (Literal | undefined)[],
): void {
  const specified = facets.filter((facet): facet is Literal => facet !== undefined);
  if (specified.length === 0) return;
  if (datatype !== undefined && !NUMERIC_DATATYPES.has(datatype.value)) {
    throw new Error(
      `Unsupported ordering facets for non-numeric datatype ${datatype.value} on ${path.value}`,
    );
  }
  for (const facet of specified) {
    if (!NUMERIC_DATATYPES.has(facet.datatype.value) || !Number.isFinite(Number(facet.value))) {
      throw new Error(`Unsupported non-numeric ordering facet on ${path.value}`);
    }
  }
}

function parseProperty(dataset: DatasetCore, propertyShape: Term): PropertyConstraints | undefined {
  if (booleanValue(dataset, propertyShape, SH.deactivated) === true) return undefined;
  assertUnsupported(dataset, propertyShape);
  for (const predicate of [SH.property, SH.closed, SH.ignoredProperties]) {
    if (dataset.match(propertyShape, predicate, null, null).size > 0) {
      throw new Error(
        `Unsupported property-shape SHACL constraint ${predicate.value} on ${termKey(propertyShape)}`,
      );
    }
  }
  const path = optionalObject(dataset, propertyShape, SH.path);
  if (path === undefined)
    throw new Error(`Property shape ${termKey(propertyShape)} has no sh:path`);
  if (path.termType !== "NamedNode") {
    throw new Error(`Unsupported non-predicate SHACL path on ${termKey(propertyShape)}`);
  }
  const minCount = integerValue(dataset, propertyShape, SH.minCount) ?? 0;
  const maxCount = integerValue(dataset, propertyShape, SH.maxCount);
  if (minCount > MAX_GENERATED_COUNT || (maxCount ?? 0) > MAX_GENERATED_COUNT) {
    throw new Error(
      `Generated cardinality facets may not exceed ${MAX_GENERATED_COUNT} on ${path.value}`,
    );
  }
  if (maxCount !== undefined && maxCount < minCount) {
    throw new Error(`sh:maxCount is below sh:minCount for ${path.value}`);
  }
  const minLength = integerValue(dataset, propertyShape, SH.minLength);
  const maxLength = integerValue(dataset, propertyShape, SH.maxLength);
  if ((minLength ?? 0) > MAX_GENERATED_LENGTH || (maxLength ?? 0) > MAX_GENERATED_LENGTH) {
    throw new Error(
      `Generated length facets may not exceed ${MAX_GENERATED_LENGTH} on ${path.value}`,
    );
  }
  if (maxLength !== undefined && minLength !== undefined && maxLength < minLength) {
    throw new Error(`sh:maxLength is below sh:minLength for ${path.value}`);
  }
  const patternTerm = optionalLiteral(dataset, propertyShape, SH.pattern);
  const inHead = optionalObject(dataset, propertyShape, SH.in);
  const inValues = inHead === undefined ? [] : readList(dataset, inHead).sort(compareTerms);
  const order = numericValue(dataset, propertyShape, SH.order);
  const datatype = optionalNamedNode(dataset, propertyShape, SH.datatype);
  const node = optionalNamedNode(dataset, propertyShape, SH.node);
  const requiredClass = optionalNamedNode(dataset, propertyShape, SH.class);
  const minInclusive = optionalLiteral(dataset, propertyShape, SH.minInclusive);
  const maxInclusive = optionalLiteral(dataset, propertyShape, SH.maxInclusive);
  const minExclusive = optionalLiteral(dataset, propertyShape, SH.minExclusive);
  const maxExclusive = optionalLiteral(dataset, propertyShape, SH.maxExclusive);
  if (
    datatype !== undefined &&
    !datatype.equals(XSD.string) &&
    (minLength !== undefined || maxLength !== undefined || patternTerm !== undefined)
  ) {
    throw new Error(
      `Unsupported lexical string facets for non-string datatype ${datatype.value} on ${path.value}`,
    );
  }
  assertSupportedOrderingFacets(path, datatype, [
    minInclusive,
    maxInclusive,
    minExclusive,
    maxExclusive,
  ]);
  const languageConstraint = language(dataset, propertyShape);
  const constraints: PropertyConstraints = {
    path,
    propertyShape,
    hasValue: objects(dataset, propertyShape, SH.hasValue),
    in: inValues,
    inSpecified: inHead !== undefined,
    minCount,
    uniqueLang: languageConstraint?.uniqueLang ?? false,
    ...(maxCount === undefined ? {} : { maxCount }),
    ...(datatype === undefined ? {} : { datatype }),
    ...(node === undefined ? {} : { node }),
    ...(requiredClass === undefined ? {} : { class: requiredClass }),
    ...(minInclusive === undefined ? {} : { minInclusive }),
    ...(maxInclusive === undefined ? {} : { maxInclusive }),
    ...(minExclusive === undefined ? {} : { minExclusive }),
    ...(maxExclusive === undefined ? {} : { maxExclusive }),
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
    ...(patternTerm === undefined ? {} : { pattern: patternTerm.value }),
    ...(languageConstraint === undefined ? {} : { language: languageConstraint.language }),
    ...(order === undefined ? {} : { order }),
  };
  return constraints;
}

const TARGET_PREDICATES = [
  SH.target,
  SH.targetClass,
  SH.targetNode,
  SH.targetObjectsOf,
  SH.targetSubjectsOf,
] as const;

export function hasTarget(dataset: DatasetCore, shape: NamedNode): boolean {
  return TARGET_PREDICATES.some(
    (predicate) => dataset.match(shape, predicate, null, null).size > 0,
  );
}

export function parseNodeShapes(dataset: DatasetCore): Map<string, ParsedNodeShape> {
  const propertiesOfDeactivatedShapes = new Set<string>();
  for (const deactivation of dataset.match(null, SH.deactivated, null, null)) {
    if (booleanValue(dataset, deactivation.subject, SH.deactivated) !== true) continue;
    for (const property of objects(dataset, deactivation.subject, SH.property)) {
      propertiesOfDeactivatedShapes.add(termKey(property));
    }
  }
  const candidates: Term[] = [...dataset.match(null, RDF.type, SH.NodeShape, null)].map(
    (quad) => quad.subject,
  );
  for (const predicate of TARGET_PREDICATES) {
    candidates.push(...[...dataset.match(null, predicate, null, null)].map((quad) => quad.subject));
  }
  candidates.push(
    ...[...dataset.match(null, SH.property, null, null)]
      .map((quad) => quad.subject)
      .filter((term) => term.termType === "NamedNode"),
  );
  candidates.push(
    ...[...dataset.match(null, SH.node, null, null)]
      .filter(
        (quad) =>
          booleanValue(dataset, quad.subject, SH.deactivated) !== true &&
          !propertiesOfDeactivatedShapes.has(termKey(quad.subject)),
      )
      .map((quad) => quad.object),
  );
  const shapeTerms = [...new Map(candidates.map((term) => [termKey(term), term])).values()]
    .map((term) => {
      if (term.termType !== "NamedNode") {
        throw new Error(
          `Synthetic RDF generation requires named node shapes, got ${termKey(term)}`,
        );
      }
      return term;
    })
    .sort(compareTerms);
  const map = new Map<string, ParsedNodeShape>();
  for (const term of shapeTerms) {
    if (booleanValue(dataset, term, SH.deactivated) === true) continue;
    assertUnsupported(dataset, term);
    assertNoNodeLevelPropertyConstraints(dataset, term);
    if (dataset.match(term, SH.target, null, null).size > 0) {
      throw new Error(`Unsupported custom SHACL target on ${term.value}`);
    }
    const properties = objects(dataset, term, SH.property)
      .map((propertyShape) => parseProperty(dataset, propertyShape))
      .filter((property): property is PropertyConstraints => property !== undefined);
    const paths = new Set<string>();
    for (const property of properties) {
      if (paths.has(property.path.value)) {
        throw new Error(`Multiple property shapes for path ${property.path.value} are unsupported`);
      }
      paths.add(property.path.value);
    }
    properties.sort((left, right) => {
      const leftOrder = left.order ?? Number.POSITIVE_INFINITY;
      const rightOrder = right.order ?? Number.POSITIVE_INFINITY;
      return leftOrder - rightOrder || compareTerms(left.path, right.path);
    });
    const targetClasses = objects(dataset, term, SH.targetClass).map((value) => {
      if (value.termType !== "NamedNode") {
        throw new Error(`sh:targetClass on ${term.value} must be a named node`);
      }
      return value;
    });
    const ignoredHead = optionalObject(dataset, term, SH.ignoredProperties);
    const ignoredProperties =
      ignoredHead === undefined
        ? []
        : readList(dataset, ignoredHead).map((value) => {
            if (value.termType !== "NamedNode") {
              throw new Error(
                `sh:ignoredProperties on ${term.value} must contain only named nodes`,
              );
            }
            return value;
          });
    map.set(term.value, {
      term,
      properties,
      targetClasses,
      closed: booleanValue(dataset, term, SH.closed) ?? false,
      ignoredProperties,
    });
  }
  return map;
}
