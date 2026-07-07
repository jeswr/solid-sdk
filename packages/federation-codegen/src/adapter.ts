// AUTHORED-BY Claude Opus 4.8
/**
 * L0 — the ontology-INPUT adapter seam (design §3.4). An adapter consumes a source
 * ontology and yields a NORMALIZED description (classes, properties, labels /
 * definitions, domain / range or a waiver, version identity) that the admission
 * checks (L1) and manifest compilation consume. V1 is the OWL/RDFS reader below;
 * a future V2 (content-addressed foundational ontology) is a different adapter
 * producing the same normalized description, leaving everything downstream — the
 * stable waist (shapes) and the manifest — untouched.
 */

import type { Quad } from "@rdfjs/types";
import { DataFactory } from "n3";
import { FEDGEN, Graph, OWL, RDF, RDFS, SKOS } from "./rdf.js";

const VANN_PREFERRED_NS_URI = "http://purl.org/vocab/vann/preferredNamespaceUri";

export interface OntologyClass {
  iri: string;
  labels: string[];
  definitions: string[];
}

export interface OntologyProperty {
  iri: string;
  labels: string[];
  definitions: string[];
  domain?: string;
  range?: string;
  /** `fedgen:deliberatelyUnconstrained "reason"` — a machine-readable waiver. */
  unconstrainedWaiver?: string;
}

export interface NormalizedOntology {
  /** The `owl:versionIRI` of the ontology, if declared. */
  versionIri?: string;
  /** `vann:preferredNamespaceUri` — the sector namespace, if declared. */
  namespace?: string;
  classes: OntologyClass[];
  properties: OntologyProperty[];
}

/** An ontology-input adapter (the L0 seam). Part of the hash-pinned generator artifact. */
export interface OntologyAdapter {
  /** A stable adapter identifier recorded in the codegen manifest. */
  readonly name: string;
  adapt(quads: Quad[]): NormalizedOntology;
}

function labelsOf(graph: Graph, iri: string): string[] {
  return [...graph.objects(iri, `${RDFS}label`), ...graph.objects(iri, `${SKOS}prefLabel`)]
    .map((t) => t.value)
    .filter((v) => v.length > 0);
}

function definitionsOf(graph: Graph, iri: string): string[] {
  return [...graph.objects(iri, `${RDFS}comment`), ...graph.objects(iri, `${SKOS}definition`)]
    .map((t) => t.value)
    .filter((v) => v.length > 0);
}

const CLASS_TYPES = [`${OWL}Class`, `${RDFS}Class`];
const PROPERTY_TYPES = [
  `${OWL}DatatypeProperty`,
  `${OWL}ObjectProperty`,
  `${OWL}AnnotationProperty`,
  `${RDF}Property`,
];

/** The committed V1 adapter: reads OWL / RDFS + SKOS annotation vocabulary. */
export const owlRdfsAdapter: OntologyAdapter = {
  name: "owl-rdfs-v1",
  adapt(quads: Quad[]): NormalizedOntology {
    const graph = new Graph(quads);

    const classIris = new Set<string>();
    for (const type of CLASS_TYPES) {
      for (const s of graph.subjects(`${RDF}type`, DataFactory.namedNode(type))) {
        if (s.termType === "NamedNode") classIris.add(s.value);
      }
    }

    const propertyIris = new Set<string>();
    for (const type of PROPERTY_TYPES) {
      for (const s of graph.subjects(`${RDF}type`, DataFactory.namedNode(type))) {
        if (s.termType === "NamedNode") propertyIris.add(s.value);
      }
    }

    const classes: OntologyClass[] = [...classIris].sort().map((iri) => ({
      iri,
      labels: labelsOf(graph, iri),
      definitions: definitionsOf(graph, iri),
    }));

    const properties: OntologyProperty[] = [...propertyIris].sort().map((iri) => {
      const domain = graph.value(iri, `${RDFS}domain`);
      const range = graph.value(iri, `${RDFS}range`);
      const waiver = graph.value(iri, `${FEDGEN}deliberatelyUnconstrained`);
      const prop: OntologyProperty = {
        iri,
        labels: labelsOf(graph, iri),
        definitions: definitionsOf(graph, iri),
      };
      if (domain) prop.domain = domain;
      if (range) prop.range = range;
      if (waiver) prop.unconstrainedWaiver = waiver;
      return prop;
    });

    // The ontology subject: something with rdf:type owl:Ontology.
    let versionIri: string | undefined;
    let namespace: string | undefined;
    for (const s of graph.subjects(`${RDF}type`, DataFactory.namedNode(`${OWL}Ontology`))) {
      versionIri = graph.value(s, `${OWL}versionIRI`) ?? versionIri;
      namespace = graph.value(s, VANN_PREFERRED_NS_URI) ?? namespace;
    }

    const result: NormalizedOntology = { classes, properties };
    if (versionIri) result.versionIri = versionIri;
    if (namespace) result.namespace = namespace;
    return result;
  },
};
