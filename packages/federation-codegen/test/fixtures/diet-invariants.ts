// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { CodegenConfig } from "../../src/config.js";
export const EX = "https://example.org/diet#";
export const H = `@prefix diet: <${EX}>.
@prefix sh: <http://www.w3.org/ns/shacl#>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
@prefix owl: <http://www.w3.org/2002/07/owl#>.
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.`;
export const ontologyTtl = `${H}
${["GeneticSummary", "HlaMarker", "HlaRiskHaplotype", "MarkerPresence", "CoeliacGeneticRisk"].map((c) => `diet:${c} a owl:Class; rdfs:label "${c}"; rdfs:comment "${c}".`).join("\n")}
${["DQ2_5", "DQ2_2", "DQ7", "DQ8"].map((v) => `diet:${v} a diet:HlaRiskHaplotype.`).join("\n")}
diet:markerPresent a diet:MarkerPresence. diet:markerAbsent a diet:MarkerPresence.
diet:riskHaplotypeAbsent a diet:CoeliacGeneticRisk. diet:riskHaplotypePresent a diet:CoeliacGeneticRisk.`;
export const baseShapes = `${H}
diet:SummaryShape a sh:NodeShape; sh:targetClass diet:GeneticSummary;
  sh:property [ sh:path diet:coverageComplete; sh:datatype xsd:boolean; sh:maxCount 1 ],
    [ sh:path diet:coeliacGeneticRisk; sh:class diet:CoeliacGeneticRisk; sh:maxCount 1; sh:severity sh:Warning ],
    [ sh:path diet:hlaMarker; sh:class diet:HlaMarker; sh:severity sh:Warning ],
    [ sh:path diet:consentGiven; sh:datatype xsd:boolean; sh:maxCount 1; sh:hasValue true ].
diet:MarkerShape a sh:NodeShape; sh:targetClass diet:HlaMarker;
  sh:property [ sh:path diet:rsid; sh:datatype xsd:string; sh:minCount 1; sh:maxCount 1 ],
    [ sh:path diet:riskHaplotype; sh:class diet:HlaRiskHaplotype; sh:maxCount 1; sh:severity sh:Warning ],
    [ sh:path diet:markerPresence; sh:class diet:MarkerPresence; sh:maxCount 1; sh:severity sh:Warning ].`;
// Mirrors GeneticRiskCoverageShape and GeneticRiskMarkerConsistencyShape in diet.shacl.ttl.
export const safetyShapes = `
diet:CoverageSafety a sh:NodeShape; sh:targetClass diet:GeneticSummary;
  sh:severity sh:Violation; sh:message "Absent requires complete coverage"@en;
  sh:not [ sh:and (
    [ sh:path diet:coeliacGeneticRisk; sh:hasValue diet:riskHaplotypeAbsent ]
    [ sh:not [ sh:path diet:coverageComplete; sh:hasValue true ] ]
  ) ].
diet:MarkerSafety a sh:NodeShape; sh:targetClass diet:GeneticSummary;
  sh:message "Absent cannot contradict a present risk marker";
  sh:not [ sh:and (
    [ sh:path diet:coeliacGeneticRisk; sh:hasValue diet:riskHaplotypeAbsent ]
    [ sh:path diet:hlaMarker; sh:qualifiedMinCount 1; sh:qualifiedValueShape [ sh:and (
      [ sh:path diet:markerPresence; sh:hasValue diet:markerPresent ]
      [ sh:or (
        [ sh:path diet:riskHaplotype; sh:hasValue diet:DQ2_5 ]
        [ sh:path diet:riskHaplotype; sh:hasValue diet:DQ2_2 ]
        [ sh:path diet:riskHaplotype; sh:hasValue diet:DQ8 ]
      ) ]
    ) ] ]
  ) ].`;
export const config: CodegenConfig = {
  shapesBase: "https://example.org/diet-shapes#",
  prefixes: { diet: EX },
  entities: [
    { name: "Summary", targetClass: `${EX}GeneticSummary`, subject: { convention: "self" } },
    { name: "Marker", targetClass: `${EX}HlaMarker`, subject: { convention: "self" } },
  ],
};
