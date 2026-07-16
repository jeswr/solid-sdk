// AUTHORED-BY GPT-5.6 Sol via codex

import { DataFactory } from "n3";

const { namedNode } = DataFactory;

export const NS = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  sh: "http://www.w3.org/ns/shacl#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
} as const;

export const RDF = {
  first: namedNode(`${NS.rdf}first`),
  nil: namedNode(`${NS.rdf}nil`),
  rest: namedNode(`${NS.rdf}rest`),
  type: namedNode(`${NS.rdf}type`),
} as const;

export const RDFS = {
  subClassOf: namedNode(`${NS.rdfs}subClassOf`),
} as const;

export const SH = {
  NodeShape: namedNode(`${NS.sh}NodeShape`),
  and: namedNode(`${NS.sh}and`),
  class: namedNode(`${NS.sh}class`),
  closed: namedNode(`${NS.sh}closed`),
  datatype: namedNode(`${NS.sh}datatype`),
  deactivated: namedNode(`${NS.sh}deactivated`),
  disjoint: namedNode(`${NS.sh}disjoint`),
  equals: namedNode(`${NS.sh}equals`),
  flags: namedNode(`${NS.sh}flags`),
  hasValue: namedNode(`${NS.sh}hasValue`),
  ignoredProperties: namedNode(`${NS.sh}ignoredProperties`),
  in: namedNode(`${NS.sh}in`),
  languageIn: namedNode(`${NS.sh}languageIn`),
  lessThan: namedNode(`${NS.sh}lessThan`),
  lessThanOrEquals: namedNode(`${NS.sh}lessThanOrEquals`),
  maxCount: namedNode(`${NS.sh}maxCount`),
  maxExclusive: namedNode(`${NS.sh}maxExclusive`),
  maxInclusive: namedNode(`${NS.sh}maxInclusive`),
  maxLength: namedNode(`${NS.sh}maxLength`),
  minCount: namedNode(`${NS.sh}minCount`),
  minExclusive: namedNode(`${NS.sh}minExclusive`),
  minInclusive: namedNode(`${NS.sh}minInclusive`),
  minLength: namedNode(`${NS.sh}minLength`),
  node: namedNode(`${NS.sh}node`),
  nodeKind: namedNode(`${NS.sh}nodeKind`),
  not: namedNode(`${NS.sh}not`),
  or: namedNode(`${NS.sh}or`),
  order: namedNode(`${NS.sh}order`),
  path: namedNode(`${NS.sh}path`),
  pattern: namedNode(`${NS.sh}pattern`),
  property: namedNode(`${NS.sh}property`),
  qualifiedMaxCount: namedNode(`${NS.sh}qualifiedMaxCount`),
  qualifiedMinCount: namedNode(`${NS.sh}qualifiedMinCount`),
  qualifiedValueShape: namedNode(`${NS.sh}qualifiedValueShape`),
  sparql: namedNode(`${NS.sh}sparql`),
  target: namedNode(`${NS.sh}target`),
  targetClass: namedNode(`${NS.sh}targetClass`),
  targetNode: namedNode(`${NS.sh}targetNode`),
  targetObjectsOf: namedNode(`${NS.sh}targetObjectsOf`),
  targetSubjectsOf: namedNode(`${NS.sh}targetSubjectsOf`),
  uniqueLang: namedNode(`${NS.sh}uniqueLang`),
  xone: namedNode(`${NS.sh}xone`),
} as const;

export const XSD = {
  boolean: namedNode(`${NS.xsd}boolean`),
  byte: namedNode(`${NS.xsd}byte`),
  date: namedNode(`${NS.xsd}date`),
  dateTime: namedNode(`${NS.xsd}dateTime`),
  decimal: namedNode(`${NS.xsd}decimal`),
  double: namedNode(`${NS.xsd}double`),
  float: namedNode(`${NS.xsd}float`),
  int: namedNode(`${NS.xsd}int`),
  integer: namedNode(`${NS.xsd}integer`),
  long: namedNode(`${NS.xsd}long`),
  negativeInteger: namedNode(`${NS.xsd}negativeInteger`),
  nonNegativeInteger: namedNode(`${NS.xsd}nonNegativeInteger`),
  nonPositiveInteger: namedNode(`${NS.xsd}nonPositiveInteger`),
  positiveInteger: namedNode(`${NS.xsd}positiveInteger`),
  short: namedNode(`${NS.xsd}short`),
  string: namedNode(`${NS.xsd}string`),
  unsignedByte: namedNode(`${NS.xsd}unsignedByte`),
  unsignedInt: namedNode(`${NS.xsd}unsignedInt`),
  unsignedLong: namedNode(`${NS.xsd}unsignedLong`),
  unsignedShort: namedNode(`${NS.xsd}unsignedShort`),
} as const;

export const DEFAULT_PREFIXES = {
  rdf: NS.rdf,
  sh: NS.sh,
  xsd: NS.xsd,
} as const;
