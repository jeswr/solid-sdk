// AUTHORED-BY Codex GPT-5

import { readFile } from "node:fs/promises";
import type { Term } from "@rdfjs/types";
import { Parser, Store } from "n3";
import type { PropertyModel, SectorModel, ShapeModel, ValueMapping } from "./model.ts";
import { namespaceConstantName, screamingSnakeIdentifier } from "./names.ts";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const OWL_CLASS = "http://www.w3.org/2002/07/owl#Class";
const OWL_DATATYPE_PROPERTY = "http://www.w3.org/2002/07/owl#DatatypeProperty";
const OWL_OBJECT_PROPERTY = "http://www.w3.org/2002/07/owl#ObjectProperty";
const VANN_PREFERRED_NAMESPACE_URI = "http://purl.org/vocab/vann/preferredNamespaceUri";
const SH = "http://www.w3.org/ns/shacl#";
const XSD = "http://www.w3.org/2001/XMLSchema#";

const SH_NODE_SHAPE = `${SH}NodeShape`;
const SH_PROPERTY = `${SH}property`;
const SH_TARGET_CLASS = `${SH}targetClass`;
const SH_PATH = `${SH}path`;
const SH_NAME = `${SH}name`;
const SH_DATATYPE = `${SH}datatype`;
const SH_CLASS = `${SH}class`;
const SH_NODE_KIND = `${SH}nodeKind`;
const SH_IRI = `${SH}IRI`;
const SH_MIN_COUNT = `${SH}minCount`;
const SH_MAX_COUNT = `${SH}maxCount`;
const SH_MESSAGE = `${SH}message`;

const SUPPORTED_NODE_SHAPE_PREDICATES = new Set([SH_PROPERTY, SH_TARGET_CLASS]);
const SUPPORTED_PROPERTY_SHAPE_PREDICATES = new Set([
  SH_CLASS,
  SH_DATATYPE,
  SH_MAX_COUNT,
  SH_MESSAGE,
  SH_MIN_COUNT,
  SH_NAME,
  SH_NODE_KIND,
  SH_PATH,
  `${SH}severity`,
]);

const RESERVED_ACCESSORS = new Set([
  "constructor",
  "dataset",
  "equals",
  "factory",
  "id",
  "mark",
  "termType",
  "types",
  "value",
]);

function one(store: Store, subject: Term, predicate: string): Term | undefined {
  const values = store.getObjects(subject, predicate, null);
  if (values.length > 1) {
    throw new Error(`Expected at most one <${predicate}> on ${subject.value}`);
  }
  return values[0];
}

function requiredNamedNode(store: Store, subject: Term, predicate: string): string {
  const value = one(store, subject, predicate);
  if (value?.termType !== "NamedNode") {
    throw new Error(`Expected one named-node <${predicate}> on ${subject.value}`);
  }
  return value.value;
}

function optionalNamedNode(store: Store, subject: Term, predicate: string): string | undefined {
  const value = one(store, subject, predicate);
  if (value === undefined) return undefined;
  if (value.termType !== "NamedNode") {
    throw new Error(`Expected a named-node <${predicate}> on ${subject.value}`);
  }
  return value.value;
}

function count(store: Store, subject: Term, predicate: string): number | undefined {
  const value = one(store, subject, predicate);
  if (value === undefined) return undefined;
  if (value.termType !== "Literal" || !/^\d+$/.test(value.value)) {
    throw new Error(`Expected a non-negative integer <${predicate}> on ${subject.value}`);
  }
  return Number(value.value);
}

function rejectUnsupportedShaclPredicates(
  store: Store,
  subject: Term,
  supported: ReadonlySet<string>,
): void {
  for (const quad of store.getQuads(subject as never, null, null, null)) {
    const predicate = quad.predicate.value;
    if (predicate.startsWith(SH) && !supported.has(predicate)) {
      throw new Error(`Unsupported SHACL predicate <${predicate}> on ${subject.value}`);
    }
  }
}

function parseTurtle(source: string): { prefixes: Record<string, string>; store: Store } {
  const prefixes: Record<string, string> = {};
  const quads = new Parser().parse(source, null, (prefix, namespace) => {
    prefixes[prefix] = namespace.value;
  });
  return { prefixes, store: new Store(quads) };
}

function mergePrefixes(
  ...inputs: ReadonlyArray<Readonly<Record<string, string>>>
): Record<string, string> {
  const prefixes: Record<string, string> = {};
  for (const input of inputs) {
    for (const [prefix, namespace] of Object.entries(input)) {
      const existing = prefixes[prefix];
      if (existing !== undefined && existing !== namespace) {
        throw new Error(`Prefix ${prefix}: maps to both <${existing}> and <${namespace}>`);
      }
      prefixes[prefix] = namespace;
    }
  }
  return prefixes;
}

function validateNamespaceConstantNames(prefixes: Readonly<Record<string, string>>): void {
  const names = new Map<string, string>();
  for (const prefix of Object.keys(prefixes)) {
    const name = namespaceConstantName(prefix);
    const existing = names.get(name);
    if (existing !== undefined && existing !== prefix) {
      throw new Error(`Prefixes ${existing}: and ${prefix}: collide as namespace constant ${name}`);
    }
    names.set(name, prefix);
  }
}

function localName(iri: string): string {
  const boundary = Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"));
  const local = iri.slice(boundary + 1);
  if (local.length === 0) throw new Error(`Cannot derive a local name from <${iri}>`);
  return local;
}

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0);
}

function pascalCase(value: string): string {
  const result = words(value)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
  if (result.length === 0) throw new Error(`Cannot derive a TypeScript name from ${value}`);
  return /^\d/.test(result) ? `Value${result}` : result;
}

function camelCase(value: string): string {
  const pascal = pascalCase(value);
  const result = `${pascal[0]?.toLowerCase() ?? ""}${pascal.slice(1)}`;
  return RESERVED_ACCESSORS.has(result) ? `${result}Value` : result;
}

function prefixFor(iri: string, prefixes: Readonly<Record<string, string>>): string {
  const candidates = Object.entries(prefixes)
    .filter(([, namespace]) => iri.startsWith(namespace))
    .sort((left, right) => right[1].length - left[1].length);
  return candidates[0]?.[0] ?? "IRI";
}

function constantFor(iri: string, prefixes: Readonly<Record<string, string>>): string {
  return `${screamingSnakeIdentifier(prefixFor(iri, prefixes))}_${screamingSnakeIdentifier(localName(iri))}`;
}

function valueMapping(
  datatype: string | undefined,
  requiredClass: string | undefined,
  nodeKind: string | undefined,
  path: string,
): ValueMapping {
  if (datatype !== undefined) {
    switch (datatype) {
      case `${XSD}string`:
        return {
          typescriptType: "string",
          readMapper: "LiteralAs.string",
          writeMapper: "LiteralFrom.string",
          termKind: "literal",
        };
      case `${XSD}boolean`:
        return {
          typescriptType: "boolean",
          readMapper: "LiteralAs.boolean",
          writeMapper: "LiteralFrom.boolean",
          termKind: "literal",
        };
      case `${XSD}date`:
        return {
          typescriptType: "Date",
          readMapper: "LiteralAs.date",
          writeMapper: "LiteralFrom.date",
          termKind: "literal",
        };
      case `${XSD}dateTime`:
        return {
          typescriptType: "Date",
          readMapper: "LiteralAs.date",
          writeMapper: "LiteralFrom.dateTime",
          termKind: "literal",
        };
      case `${XSD}double`:
        return {
          typescriptType: "number",
          readMapper: "LiteralAs.number",
          writeMapper: "LiteralFrom.double",
          termKind: "literal",
        };
      default:
        throw new Error(`Unsupported SHACL datatype <${datatype}> on <${path}>`);
    }
  }

  if (requiredClass !== undefined || nodeKind === SH_IRI) {
    return {
      typescriptType: "string",
      readMapper: "NamedNodeAs.string",
      writeMapper: "NamedNodeFrom.string",
      termKind: "iri",
    };
  }

  throw new Error(
    `Property <${path}> needs a supported sh:datatype, sh:class, or sh:nodeKind sh:IRI`,
  );
}

function parseProperty(
  store: Store,
  property: Term,
  prefixes: Readonly<Record<string, string>>,
): PropertyModel {
  rejectUnsupportedShaclPredicates(store, property, SUPPORTED_PROPERTY_SHAPE_PREDICATES);
  const path = requiredNamedNode(store, property, SH_PATH);
  const datatype = optionalNamedNode(store, property, SH_DATATYPE);
  const requiredClass = optionalNamedNode(store, property, SH_CLASS);
  const nodeKind = optionalNamedNode(store, property, SH_NODE_KIND);
  if (datatype !== undefined && (requiredClass !== undefined || nodeKind !== undefined)) {
    throw new Error(
      `Conflicting SHACL value constraints on <${path}>: sh:datatype cannot be combined with sh:class or sh:nodeKind in this PoC`,
    );
  }
  if (nodeKind !== undefined && nodeKind !== SH_IRI) {
    throw new Error(
      `Unsupported sh:nodeKind <${nodeKind}> on <${path}>; this PoC supports only sh:IRI`,
    );
  }
  const minCount = count(store, property, SH_MIN_COUNT) ?? 0;
  const maxCount = count(store, property, SH_MAX_COUNT);
  if (maxCount !== undefined && maxCount !== 1) {
    throw new Error(`Unsupported sh:maxCount ${maxCount} on <${path}>; this PoC supports only 1`);
  }
  if (maxCount !== undefined && minCount > maxCount) {
    throw new Error(`sh:minCount exceeds sh:maxCount on <${path}>`);
  }

  const shapeName = one(store, property, SH_NAME)?.value;
  const message = one(store, property, SH_MESSAGE)?.value;
  return {
    accessorName: camelCase(shapeName ?? localName(path)),
    constantName: constantFor(path, prefixes),
    ...(datatype === undefined ? {} : { datatype }),
    ...(maxCount === undefined ? {} : { maxCount }),
    minCount,
    ...(message === undefined ? {} : { message }),
    path,
    ...(requiredClass === undefined ? {} : { requiredClass }),
    ...(shapeName === undefined ? {} : { shapeName }),
    value: valueMapping(datatype, requiredClass, nodeKind, path),
  };
}

function parseShapes(store: Store, prefixes: Readonly<Record<string, string>>): ShapeModel[] {
  const shapes = store.getSubjects(RDF_TYPE, SH_NODE_SHAPE, null).map((shape) => {
    rejectUnsupportedShaclPredicates(store, shape, SUPPORTED_NODE_SHAPE_PREDICATES);
    const targetClass = requiredNamedNode(store, shape, SH_TARGET_CLASS);
    const properties = store
      .getObjects(shape, SH_PROPERTY, null)
      .map((property) => parseProperty(store, property, prefixes))
      .sort((left, right) => left.accessorName.localeCompare(right.accessorName));
    const duplicate = properties.find(
      (property, index) =>
        properties.findIndex((candidate) => candidate.accessorName === property.accessorName) !==
        index,
    );
    if (duplicate !== undefined) {
      throw new Error(`Duplicate accessor name ${duplicate.accessorName} on ${shape.value}`);
    }
    const duplicatePath = properties.find(
      (property, index) =>
        properties.findIndex((candidate) => candidate.path === property.path) !== index,
    );
    if (duplicatePath !== undefined) {
      throw new Error(`Duplicate property path <${duplicatePath.path}> on ${shape.value}`);
    }
    const className = pascalCase(localName(targetClass));
    const typeHelper = `is${className}`;
    if (properties.some((property) => property.accessorName === typeHelper)) {
      throw new Error(
        `Accessor ${typeHelper} on ${shape.value} collides with a generated type helper`,
      );
    }
    return {
      classConstantName: `${screamingSnakeIdentifier(localName(targetClass))}_CLASS`,
      className,
      properties,
      shapeIri: shape.value,
      targetClass,
    };
  });
  if (shapes.length === 0) throw new Error("No sh:NodeShape with sh:targetClass was found");
  const duplicateClass = shapes.find(
    (shape, index) =>
      shapes.findIndex((candidate) => candidate.className === shape.className) !== index,
  );
  if (duplicateClass !== undefined) {
    throw new Error(`Duplicate generated class name ${duplicateClass.className}`);
  }
  return shapes.sort((left, right) => left.className.localeCompare(right.className));
}

function validateAgainstOntology(ontology: Store, shapes: readonly ShapeModel[]): void {
  const declaredClasses = new Set(
    ontology.getSubjects(RDF_TYPE, OWL_CLASS, null).map((term) => term.value),
  );
  const datatypeProperties = new Set(
    ontology.getSubjects(RDF_TYPE, OWL_DATATYPE_PROPERTY, null).map((term) => term.value),
  );
  const objectProperties = new Set(
    ontology.getSubjects(RDF_TYPE, OWL_OBJECT_PROPERTY, null).map((term) => term.value),
  );
  const namespace = ontology.getObjects(null, VANN_PREFERRED_NAMESPACE_URI, null)[0]?.value;

  for (const shape of shapes) {
    if (!declaredClasses.has(shape.targetClass)) {
      throw new Error(
        `SHACL target class <${shape.targetClass}> is not an owl:Class in the ontology`,
      );
    }
    for (const property of shape.properties) {
      if (namespace !== undefined && property.path.startsWith(namespace)) {
        const isDatatypeProperty = datatypeProperties.has(property.path);
        const isObjectProperty = objectProperties.has(property.path);
        if (!isDatatypeProperty && !isObjectProperty) {
          throw new Error(`Local SHACL path <${property.path}> is not a property in the ontology`);
        }
        if (isDatatypeProperty === isObjectProperty) {
          throw new Error(
            `Local SHACL path <${property.path}> must have exactly one ontology property kind`,
          );
        }
        if (isDatatypeProperty !== (property.value.termKind === "literal")) {
          throw new Error(
            `SHACL term kind for <${property.path}> conflicts with its ontology property kind`,
          );
        }
      }
    }
  }
}

export async function parseSector(ontologyPath: string, shapesPath: string): Promise<SectorModel> {
  const [ontologySource, shapesSource] = await Promise.all([
    readFile(ontologyPath, "utf8"),
    readFile(shapesPath, "utf8"),
  ]);
  const ontology = parseTurtle(ontologySource);
  const shapesGraph = parseTurtle(shapesSource);
  const prefixes = mergePrefixes(shapesGraph.prefixes, ontology.prefixes);
  validateNamespaceConstantNames(prefixes);
  const shapes = parseShapes(shapesGraph.store, prefixes);
  validateAgainstOntology(ontology.store, shapes);

  const terms: Record<string, string> = { RDF_TYPE };
  const addTerm = (name: string, iri: string): void => {
    const existing = terms[name];
    if (existing !== undefined && existing !== iri) {
      throw new Error(`Generated constant ${name} collides for <${existing}> and <${iri}>`);
    }
    terms[name] = iri;
  };
  for (const shape of shapes) {
    addTerm(shape.classConstantName, shape.targetClass);
    for (const property of shape.properties) addTerm(property.constantName, property.path);
    if (shape.properties.some((property) => property.requiredClass !== undefined)) {
      for (const property of shape.properties) {
        if (property.requiredClass !== undefined) {
          addTerm(constantFor(property.requiredClass, prefixes), property.requiredClass);
        }
      }
    }
  }

  for (const prefix of Object.keys(prefixes)) {
    const namespaceName = namespaceConstantName(prefix);
    if (terms[namespaceName] !== undefined) {
      throw new Error(`Namespace constant ${namespaceName} collides with a generated RDF term`);
    }
  }

  return { prefixes, shapes, terms };
}
