// AUTHORED-BY Codex GPT-6.1-Sol
import { parseBoundedRdf } from "./bounded-rdf.js";

/** Container creation may declare its LDP type, but must not write its description. */
export async function requireContainerCreationBody(
  target: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  if (!new URL(target).pathname.endsWith("/") || !body.byteLength) return;
  const dataset = await parseBoundedRdf(new TextDecoder().decode(body), contentType, target);
  for (const quad of dataset) {
    if (
      quad.subject.value !== target ||
      quad.predicate.value !== "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" ||
      quad.object.termType !== "NamedNode" ||
      !["Container", "BasicContainer", "DirectContainer", "IndirectContainer"].some(
        (type) => quad.object.value === `http://www.w3.org/ns/ldp#${type}`,
      ) ||
      quad.graph.termType !== "DefaultGraph"
    )
      throw new Error("Container creation cannot preserve user metadata");
  }
}
