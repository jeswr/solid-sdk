// AUTHORED-BY Codex GPT-6
/** Read/remove only the outer proof graph; embedded credential proofs remain signed data. */
import type { DataIntegrityProof } from "@jeswr/solid-vc";
import { DataFactory, Store } from "n3";
import { DocumentError } from "./contexts.js";

const SEC = "https://w3id.org/security#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const fields = new Map([
  [RDF_TYPE, "type"],
  [SEC + "cryptosuite", "cryptosuite"],
  ["http://purl.org/dc/terms/created", "created"],
  [SEC + "proofPurpose", "proofPurpose"],
  [SEC + "proofValue", "proofValue"],
  [SEC + "verificationMethod", "verificationMethod"],
]);
export function outerProof(
  dataset: Store,
  root: string,
): { proof: DataIntegrityProof; unsigned: Store } {
  const links = dataset.getQuads(
    DataFactory.namedNode(root),
    DataFactory.namedNode(SEC + "proof"),
    null,
    DataFactory.defaultGraph(),
  );
  if (links.length !== 1) throw new DocumentError("malformed-proof");
  const link = links[0]!;
  if (dataset.countQuads(null, DataFactory.namedNode(SEC + "proof"), link.object, null) !== 1)
    throw new DocumentError("malformed-proof");
  if (link.object.termType !== "NamedNode" && link.object.termType !== "BlankNode")
    throw new DocumentError("malformed-proof");
  const quads = dataset.getQuads(null, null, null, link.object);
  if (quads.length !== 6 || new Set(quads.map((quad) => quad.subject.value)).size !== 1)
    throw new DocumentError("malformed-proof");
  const values: Record<string, string> = {};
  for (const quad of quads) {
    const field = fields.get(quad.predicate.value);
    if (!field || values[field] !== undefined) throw new DocumentError("malformed-proof");
    const term = quad.object;
    if (["type", "proofPurpose", "verificationMethod"].includes(field)) {
      if (term.termType !== "NamedNode") throw new DocumentError("malformed-proof");
    } else {
      const datatype =
        field === "created"
          ? XSD + "dateTime"
          : field === "cryptosuite"
            ? SEC + "cryptosuiteString"
            : SEC + "multibase";
      if (term.termType !== "Literal" || term.language || term.datatype.value !== datatype)
        throw new DocumentError("malformed-proof");
    }
    values[field] = term.value;
  }
  if (
    values.type !== SEC + "DataIntegrityProof" ||
    values.cryptosuite !== "eddsa-rdfc-2022" ||
    values.proofPurpose !== SEC + "assertionMethod"
  )
    throw new DocumentError("malformed-proof");
  const unsigned = new Store([...dataset]);
  unsigned.removeQuad(link);
  unsigned.removeQuads(quads);
  return {
    proof: {
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-rdfc-2022",
      proofPurpose: "assertionMethod",
      verificationMethod: values.verificationMethod!,
      created: values.created!,
      proofValue: values.proofValue!,
    },
    unsigned,
  };
}

/** Digest exclusion applies to either supported outer authenticity proof representation. */
export function withoutOuterProof(dataset: Store, root: string): Store {
  const links = dataset.getQuads(
    DataFactory.namedNode(root),
    DataFactory.namedNode(SEC + "proof"),
    null,
    DataFactory.defaultGraph(),
  );
  if (!links.length) return new Store([...dataset]);
  if (links.length !== 1) throw new DocumentError("malformed-proof");
  const link = links[0]!;
  if (dataset.countQuads(null, DataFactory.namedNode(SEC + "proof"), link.object, null) !== 1)
    throw new DocumentError("malformed-proof");
  if (link.object.termType !== "NamedNode" && link.object.termType !== "BlankNode")
    throw new DocumentError("malformed-proof");
  const unsigned = new Store([...dataset]);
  unsigned.removeQuad(link);
  unsigned.removeQuads(unsigned.getQuads(null, null, null, link.object));
  return unsigned;
}
