import type { AgentDescriptor, AgentDescriptorDocuments } from "./types.js";
/**
 * Build an agent's two co-located self-descriptors from a single
 * {@link AgentDescriptor}.
 *
 * - `agentCard` — a plain-JSON A2A Agent Card (serve at the A2A well-known path).
 * - `agentDescription` — the ANP Agent Description as RDF quads + Turtle/JSON-LD
 *   serialisers (serve at the ANP `.well-known/agent-descriptions` path).
 *
 * @param descriptor - the agent self-description (`descriptor.id` is the agent IRI).
 * @returns both descriptor encodings; see {@link AgentDescriptorDocuments}.
 */
export declare function describeAgent(descriptor: AgentDescriptor): AgentDescriptorDocuments;
//# sourceMappingURL=describe.d.ts.map