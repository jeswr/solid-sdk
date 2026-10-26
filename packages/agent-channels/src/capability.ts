// AUTHORED-BY Codex GPT-6.1-Sol
import { type ChannelCapability, toRdf as modelToRdf, recordToTurtle } from "@jeswr/agent-model";

/** DESIGN §3.3 record, sharing the validated agent-model vocabulary and RDF mapping. */
export type { ChannelCapability };
/** Construct through agent-model's Solid Resource / RDFJS wrapper typed accessors. */
export function toRdf(capability: ChannelCapability): ReturnType<typeof modelToRdf> {
  return modelToRdf(capability);
}
/** Serialize through agent-model's rdf-serialize path, with no remote contexts. */
export function capabilityToTurtle(capability: ChannelCapability): Promise<string> {
  return recordToTurtle(capability);
}
