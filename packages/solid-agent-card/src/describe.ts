// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// describeAgent(...) — the EMIT side. From a single AgentDescriptor domain object
// build the TWO co-located descriptors a pod serves (roadmap M1): an A2A Agent
// Card (plain JSON, industry reach) and an ANP-aligned Agent Description (RDF
// quads — built via the typed wrapper write path, never hand-built triples —
// with Turtle + JSON-LD serialisers). Projecting both from one source means the
// two encodings cannot drift.

import { serialize } from "./serialize.js";
import type {
  AgentCard,
  AgentCardSecurityScheme,
  AgentDescriptionDocument,
  AgentDescriptor,
  AgentDescriptorDocuments,
} from "./types.js";
import { A2A_PROTOCOL_VERSION, ANP_INLINE_CONTEXT } from "./vocab.js";
import { AgentBuilder } from "./wrappers.js";

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
export function describeAgent(descriptor: AgentDescriptor): AgentDescriptorDocuments {
  if (!descriptor.id) {
    throw new TypeError("describeAgent: AgentDescriptor.id (the agent IRI) is required.");
  }
  if (!descriptor.name) {
    throw new TypeError("describeAgent: AgentDescriptor.name is required.");
  }

  return {
    agentCard: buildAgentCard(descriptor),
    agentDescription: buildAgentDescription(descriptor),
  };
}

/** Project a descriptor into an A2A Agent Card (plain JSON). */
function buildAgentCard(descriptor: AgentDescriptor): AgentCard {
  const url = descriptor.url ?? descriptor.id;

  const securitySchemes: Record<string, AgentCardSecurityScheme> = {};
  for (const scheme of descriptor.securitySchemes ?? []) {
    // Key each scheme by its type (a stable, human-readable handle in the card).
    const entry: AgentCardSecurityScheme = {
      type: scheme.type,
      ...(scheme.description !== undefined && { description: scheme.description }),
      ...(scheme.issuer !== undefined && { openIdConnectUrl: scheme.issuer }),
    };
    securitySchemes[scheme.type] = entry;
  }

  const card: AgentCard = {
    protocolVersion: A2A_PROTOCOL_VERSION,
    name: descriptor.name,
    ...(descriptor.description !== undefined && { description: descriptor.description }),
    url,
    preferredTransport: "JSONRPC",
    ...(descriptor.skills && descriptor.skills.length > 0
      ? {
          skills: descriptor.skills.map((s) => ({
            id: s.id,
            name: s.name,
            ...(s.description !== undefined && { description: s.description }),
            ...(s.tags && s.tags.length > 0 ? { tags: [...s.tags] } : {}),
          })),
        }
      : {}),
    ...(Object.keys(securitySchemes).length > 0 ? { securitySchemes } : {}),
    // The Solid/ANP extension block — plain A2A tooling ignores `x-solid`; a
    // Solid/ANP-aware peer reads the owner WebID, the RDF Agent Description and
    // the M2 protocol sources from here.
    "x-solid": buildSolidExtension(descriptor),
  };
  return card;
}

/** The `x-solid` extension block of the A2A card, omitting empty fields. */
function buildSolidExtension(descriptor: AgentDescriptor): NonNullable<AgentCard["x-solid"]> {
  const ext: { owner?: string; agentDescription?: string; protocolSources?: string[] } = {};
  if (descriptor.owner !== undefined) {
    ext.owner = descriptor.owner;
  }
  // The RDF Agent Description is co-located at the agent IRI's `#ad` fragment by
  // convention; callers serving it elsewhere can post-edit this field.
  ext.agentDescription = `${descriptor.id}#ad`;
  if (descriptor.protocolSources && descriptor.protocolSources.length > 0) {
    ext.protocolSources = [...descriptor.protocolSources];
  }
  return ext;
}

/** Project a descriptor into an ANP Agent Description (RDF, via typed wrappers). */
function buildAgentDescription(descriptor: AgentDescriptor): AgentDescriptionDocument {
  const builder = new AgentBuilder();
  const node = builder.agent(descriptor.id);

  node.setName(descriptor.name);
  if (descriptor.description !== undefined) {
    node.setDescription(descriptor.description);
  }
  node.setUrl(descriptor.url ?? descriptor.id);
  if (descriptor.owner !== undefined) {
    node.setOwner(descriptor.owner);
  }
  if (descriptor.did !== undefined) {
    node.setDid(descriptor.did);
  }
  for (const source of descriptor.protocolSources ?? []) {
    node.addProtocolSource(source);
  }

  for (const skill of descriptor.skills ?? []) {
    const sk = node.linkSkill();
    sk.setId(skill.id);
    sk.setName(skill.name);
    if (skill.description !== undefined) {
      sk.setDescription(skill.description);
    }
  }

  for (const scheme of descriptor.securitySchemes ?? []) {
    const sc = node.linkSecurityScheme();
    sc.setType(scheme.type);
    if (scheme.description !== undefined) {
      sc.setDescription(scheme.description);
    }
    if (scheme.issuer !== undefined) {
      sc.setIssuer(scheme.issuer);
    }
  }

  const quads = builder.quads();
  return {
    quads,
    toTurtle: (format?: string) => serialize(quads, format),
    toJsonLd: () => Promise.resolve(buildJsonLd(descriptor)),
  };
}

/**
 * Build the JSON-LD document for the Agent Description. This is a deterministic
 * projection of the SAME descriptor (so it stays in lock-step with the RDF quads
 * above) with the pinned ANP `@context` — NOT a re-serialisation through a
 * JSON-LD library (we never need to round-trip arbitrary RDF to JSON-LD here; we
 * own the exact shape). A consumer parses it via `@jeswr/fetch-rdf` (which
 * handles `application/ld+json`) — see {@link import("./verify.js").verifyDescriptor}.
 */
function buildJsonLd(descriptor: AgentDescriptor): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    // A SELF-CONTAINED inline context (not a bare remote URL) so the document
    // parses offline + deterministically and carries no SSRF/availability
    // dependency on the CG-draft context endpoint. See ANP_INLINE_CONTEXT.
    "@context": ANP_INLINE_CONTEXT,
    "@id": descriptor.id,
    "@type": "AgentDescription",
    name: descriptor.name,
    url: descriptor.url ?? descriptor.id,
  };
  if (descriptor.description !== undefined) {
    doc.description = descriptor.description;
  }
  if (descriptor.owner !== undefined) {
    doc.owner = { "@id": descriptor.owner };
  }
  if (descriptor.did !== undefined) {
    doc.did = descriptor.did;
  }
  if (descriptor.protocolSources && descriptor.protocolSources.length > 0) {
    doc.protocolSource = descriptor.protocolSources.map((s) => ({ "@id": s }));
  }
  if (descriptor.skills && descriptor.skills.length > 0) {
    doc.skill = descriptor.skills.map((s) => {
      const skill: Record<string, unknown> = {
        "@type": "Skill",
        skillId: s.id,
        name: s.name,
      };
      if (s.description !== undefined) {
        skill.description = s.description;
      }
      return skill;
    });
  }
  if (descriptor.securitySchemes && descriptor.securitySchemes.length > 0) {
    doc.securityScheme = descriptor.securitySchemes.map((sc) => {
      const scheme: Record<string, unknown> = {
        "@type": "SecurityScheme",
        schemeType: sc.type,
      };
      if (sc.description !== undefined) {
        scheme.description = sc.description;
      }
      if (sc.issuer !== undefined) {
        scheme.url = { "@id": sc.issuer };
      }
      return scheme;
    });
  }
  return doc;
}
