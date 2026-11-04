// AUTHORED-BY Codex GPT-6.1-Sol
import { type Approval, issueApproval } from "@jeswr/agent-mandate";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { type AgentMemoryOptions, createAgentMemory, type RememberProposal } from "../src/index.js";
import { createMemoryApprovalQueue } from "../src/testing.js";

export const OWNER = "https://example.org/people/avery#me";
export const AGENT = "https://example.org/agents/assistant";
export const ROOT = "https://example.org/pod/agent/";
export const CONTAINER = `${ROOT}memory/`;
export const PD = "https://w3id.org/dpv/pd#";
export const NOW = new Date("2026-11-01T12:00:00Z");
export const QUERY = { purpose: "https://w3id.org/dpv#Personalisation", limit: 20 };
export const mandate = {
  id: "urn:example:mandate",
  issuer: OWNER,
  subject: AGENT,
  validFrom: "2026-10-31T00:00:00Z",
  validUntil: "2026-11-02T00:00:00Z",
};
export const claim = {
  fact: {
    template: "preference",
    value: { propertyID: "scheduling", value: "Afternoon meetings" },
  },
  categories: ["pd:Preference"],
  origin: {
    kind: "owner-conversation",
    source: "https://example.org/conversation/turn-1",
    quote: "I prefer afternoon meetings.",
  },
} as const;
// A synthetic SHACL contract for these fixtures. Production must supply the canonical KG shapes.
export const SHAPES = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix np: <http://www.nanopub.org/nschema#> .
@prefix pkg: <https://jeswr.org/ns/pkg#> .
@prefix dpv: <https://w3id.org/dpv#> .
<urn:example:NanopubShape> a sh:NodeShape; sh:targetClass np:Nanopublication;
 sh:property [ sh:path np:hasAssertion; sh:minCount 1; sh:maxCount 1; sh:nodeKind sh:IRI ];
 sh:property [ sh:path np:hasProvenance; sh:minCount 1; sh:maxCount 1; sh:nodeKind sh:IRI ];
 sh:property [ sh:path np:hasPublicationInfo; sh:minCount 1; sh:maxCount 1; sh:nodeKind sh:IRI ] .
<urn:example:ProvenanceShape> a sh:NodeShape; sh:targetSubjectsOf pkg:epistemicStatus;
 sh:property [ sh:path pkg:validityStatus; sh:minCount 1; sh:maxCount 1 ];
 sh:property [ sh:path dpv:hasPersonalData; sh:minCount 1; sh:nodeKind sh:IRI ] .
`;
export async function approvalKey() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  return { verificationMethod: `${OWNER}-approval`, ...pair };
}
export async function harness(overrides: Partial<AgentMemoryOptions> = {}) {
  const storage = overrides.storage ?? createMemoryStorage({ root: ROOT });
  if (!overrides.storage) {
    await storage.create(ROOT, null, { name: "memory", kind: "container" });
    await storage.create(CONTAINER, null, { name: "pending", kind: "container" });
  }
  const queue = createMemoryApprovalQueue();
  const key = await approvalKey();
  const webIdKeyResolver = {
    resolveKey: async (method: string) =>
      method === key.verificationMethod ? key.publicKey : undefined,
    isControlledBy: async (method: string, owner: string) =>
      method === key.verificationMethod && owner === OWNER,
  };
  const options: AgentMemoryOptions = {
    storage,
    container: CONTAINER,
    ownerWebId: OWNER,
    agentId: AGENT,
    loadMandate: async () => mandate,
    queueApproval: queue.queueApproval,
    webIdKeyResolver,
    shapes: SHAPES,
    now: () => NOW,
    ...overrides,
  };
  const memory = createAgentMemory(options);
  return {
    memory,
    storage,
    queue,
    options,
    key,
    async sign(proposal: RememberProposal, changes: Partial<Approval> = {}) {
      const approval: Approval = {
        id: `${ROOT}approvals/one`,
        approves: proposal.id,
        termsDigest: proposal.termsDigest,
        expires: "2026-11-01T13:00:00Z",
        decision: "approve",
        ...changes,
      };
      return { id: approval.id, document: await issueApproval(approval, key, NOW) };
    },
  };
}
