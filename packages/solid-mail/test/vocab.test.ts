// AUTHORED-BY Codex (GPT-6.1 Sol)
import { expect, it } from "vitest";
import * as shared from "../../pod-connectors/src/mail/constants.js";
import * as vocab from "../src/vocab.js";

it("keeps every app vocabulary export byte-identical to pod-connectors constants", () => {
  expect({ ...vocab }).toEqual({
    Classes: shared.Classes,
    DCT: shared.DCT,
    Flags: shared.Flags,
    FOAF: shared.FOAF,
    LDP: shared.LDP,
    PIM: shared.PIM,
    Predicates: shared.Predicates,
    RDF: shared.RDF,
    RDFS: shared.RDFS,
    SCHEMA: shared.SCHEMA,
    SIOC: shared.SIOC,
    SOLID: shared.SOLID,
    XSD: shared.XSD,
  });
  expect(vocab.SCHEMA).toBe("http://schema.org/");
});
