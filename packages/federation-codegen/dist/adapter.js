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
import { DataFactory } from "n3";
import { FEDGEN, Graph, OWL, RDF, RDFS, SKOS } from "./rdf.js";
const VANN_PREFERRED_NS_URI = "http://purl.org/vocab/vann/preferredNamespaceUri";
function labelsOf(graph, iri) {
    return [...graph.objects(iri, `${RDFS}label`), ...graph.objects(iri, `${SKOS}prefLabel`)]
        .map((t) => t.value)
        .filter((v) => v.length > 0);
}
function definitionsOf(graph, iri) {
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
export const owlRdfsAdapter = {
    name: "owl-rdfs-v1",
    adapt(quads) {
        const graph = new Graph(quads);
        const classIris = new Set();
        for (const type of CLASS_TYPES) {
            for (const s of graph.subjects(`${RDF}type`, DataFactory.namedNode(type))) {
                if (s.termType === "NamedNode")
                    classIris.add(s.value);
            }
        }
        const propertyIris = new Set();
        for (const type of PROPERTY_TYPES) {
            for (const s of graph.subjects(`${RDF}type`, DataFactory.namedNode(type))) {
                if (s.termType === "NamedNode")
                    propertyIris.add(s.value);
            }
        }
        const classes = [...classIris].sort().map((iri) => ({
            iri,
            labels: labelsOf(graph, iri),
            definitions: definitionsOf(graph, iri),
        }));
        const properties = [...propertyIris].sort().map((iri) => {
            const domain = graph.value(iri, `${RDFS}domain`);
            const range = graph.value(iri, `${RDFS}range`);
            const waiver = graph.value(iri, `${FEDGEN}deliberatelyUnconstrained`);
            const prop = {
                iri,
                labels: labelsOf(graph, iri),
                definitions: definitionsOf(graph, iri),
            };
            if (domain)
                prop.domain = domain;
            if (range)
                prop.range = range;
            if (waiver)
                prop.unconstrainedWaiver = waiver;
            return prop;
        });
        // The ontology subject: something with rdf:type owl:Ontology.
        let versionIri;
        let namespace;
        for (const s of graph.subjects(`${RDF}type`, DataFactory.namedNode(`${OWL}Ontology`))) {
            versionIri = graph.value(s, `${OWL}versionIRI`) ?? versionIri;
            namespace = graph.value(s, VANN_PREFERRED_NS_URI) ?? namespace;
        }
        const result = { classes, properties };
        if (versionIri)
            result.versionIri = versionIri;
        if (namespace)
            result.namespace = namespace;
        return result;
    },
};
//# sourceMappingURL=adapter.js.map