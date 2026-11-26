// AUTHORED-BY Codex (GPT-6.1 Sol)
import { expect, it } from "vitest";
import { compileForm } from "../src/index.js";
import { graph } from "./helpers.js";

// Fixture copied from solid-components/src/components/shapes.ts (CONTACT_SHAPE_TTL).
const CONTACT_SHAPE_TTL = `
@prefix sh:     <http://www.w3.org/ns/shacl#> .
@prefix vcard:  <http://www.w3.org/2006/vcard/ns#> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .

[] a sh:NodeShape ;
  sh:targetClass vcard:Individual ;
  sh:property [ sh:path vcard:fn ;                sh:name "Name" ;         sh:order 1 ; sh:datatype xsd:string ; sh:minCount 1 ; sh:maxCount 1 ] ;
  sh:property [ sh:path vcard:organization-name ; sh:name "Organisation" ; sh:order 2 ; sh:datatype xsd:string ; sh:maxCount 1 ] ;
  sh:property [ sh:path vcard:note ;              sh:name "Note" ;         sh:order 3 ; sh:datatype xsd:string ; sh:maxCount 1 ] .
`;
it("compiles the copied solid-components contact fixture after naming its anonymous root", () => {
  // compileForm takes a shape IRI; a designer gives anonymous source shapes a name.
  const data = graph(
    CONTACT_SHAPE_TTL.replace(
      "[] a sh:NodeShape",
      "<https://example.org/ContactForm> a sh:NodeShape",
    ),
  );
  const model = compileForm(data, "https://example.org/ContactForm");
  expect(model.targetClass).toBe("http://www.w3.org/2006/vcard/ns#Individual");
  expect(model.fields.map((field) => field.key)).toEqual(["Name", "Organisation", "Note"]);
  expect(model.fields[0]?.minCount).toBe(1);
});
