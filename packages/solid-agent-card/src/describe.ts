// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// describeAgent(...) — the EMIT side. From a single AgentDescriptor domain object
// build the TWO co-located descriptors a pod serves (roadmap M1): an A2A Agent
// Card (plain JSON, industry reach) and an ANP-aligned Agent Description (RDF
// quads — built via the typed wrapper write path, never hand-built triples —
// with Turtle + JSON-LD serialisers). Projecting both from one source means the
// two encodings cannot drift.

import { escapeIri, safeHttpIri } from "./iri.js";
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
  // FAIL CLOSED on the required `ad:url`. The Agent Description's `url` is a
  // required, resolvable http(s) IRI; it falls back to `descriptor.id`. If the
  // effective url is not a safe absolute http(s) IRI (e.g. `id` is a `did:`/`urn:`
  // and no explicit http(s) `url` was supplied), the RDF write path would SILENTLY
  // drop `ad:url` (safeHttpIri → undefined) and emit a descriptor missing a
  // required field. Reject the descriptor instead of emitting an invalid one.
  if (safeHttpIri(descriptor.url ?? descriptor.id) === undefined) {
    throw new TypeError(
      "describeAgent: a resolvable http(s) `url` is required (AgentDescriptor.url, " +
        "which falls back to `id`); a non-http(s) `id` (did:/urn:) MUST supply an " +
        "explicit http(s) `url`.",
    );
  }

  return {
    agentCard: buildAgentCard(descriptor),
    agentDescription: buildAgentDescription(descriptor),
  };
}

/** Project a descriptor into an A2A Agent Card (plain JSON). */
function buildAgentCard(descriptor: AgentDescriptor): AgentCard {
  // The A2A card is the THIRD descriptor projection (beside the RDF quads +
  // JSON-LD). Its IRI-valued fields carry the SAME sanitised/validated values as
  // the other two so the three encodings never disagree and no raw
  // IRIREF-forbidden char leaks through this public descriptor. `url` is
  // guaranteed http(s) by the fail-closed check in describeAgent.
  const url = safeHttpIri(descriptor.url ?? descriptor.id);
  if (url === undefined) {
    // Unreachable in practice — describeAgent fails closed on this first — but
    // keep buildAgentCard self-consistent (required `url`) rather than emit a
    // card with a dropped url that disagrees with the RDF/JSON-LD.
    throw new TypeError(
      "describeAgent: a resolvable http(s) `url` is required (AgentDescriptor.url / id).",
    );
  }

  const securitySchemes: Record<string, AgentCardSecurityScheme> = {};
  for (const scheme of descriptor.securitySchemes ?? []) {
    // Key each scheme by its type (a stable, human-readable handle in the card).
    // `openIdConnectUrl` is IRI-valued → validate via safeHttpIri, drop if unsafe
    // (matches the RDF `ad:url` / JSON-LD `url` drop behaviour for the issuer).
    const issuer = scheme.issuer !== undefined ? safeHttpIri(scheme.issuer) : undefined;
    const entry: AgentCardSecurityScheme = {
      type: scheme.type,
      ...(scheme.description !== undefined && { description: scheme.description }),
      ...(issuer !== undefined && { openIdConnectUrl: issuer }),
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
  // owner is IRI-valued → validate + drop if unsafe (matches the RDF/JSON-LD).
  if (descriptor.owner !== undefined) {
    const owner = safeHttpIri(descriptor.owner);
    if (owner !== undefined) {
      ext.owner = owner;
    }
  }
  // The RDF Agent Description is co-located at the agent IRI's `#ad` fragment by
  // convention; callers serving it elsewhere can post-edit this field. The IRI is
  // id-derived (id may be did:/urn:) → escape scheme-agnostically.
  ext.agentDescription = escapeIri(`${descriptor.id}#ad`);
  if (descriptor.protocolSources && descriptor.protocolSources.length > 0) {
    // Each protocol source is IRI-valued → validate + drop unsafe entries
    // (matches the RDF/JSON-LD projections exactly).
    const sources = descriptor.protocolSources
      .map((s) => safeHttpIri(s))
      .filter((s): s is string => s !== undefined);
    if (sources.length > 0) {
      ext.protocolSources = sources;
    }
  }
  return ext;
}

/** The writable agent-description node `AgentBuilder.agent` opens (kept internal). */
type AgentNode = ReturnType<AgentBuilder["agent"]>;

/**
 * Project a descriptor into an ANP Agent Description (RDF, via typed wrappers).
 *
 * The write itself is delegated to three small, single-concern helpers (scalars,
 * skills, schemes) so the body reads as a spec rather than a long guard ladder —
 * each helper owns exactly one part of the SAME graph, in the SAME order, so the
 * emitted quads are byte-identical to the prior inline form.
 */
function buildAgentDescription(descriptor: AgentDescriptor): AgentDescriptionDocument {
  const builder = new AgentBuilder();
  const node = builder.agent(descriptor.id);

  writeScalarFields(node, descriptor);
  writeSkills(node, descriptor.skills);
  writeSecuritySchemes(node, descriptor.securitySchemes);

  const quads = builder.quads();
  return {
    quads,
    toTurtle: (format?: string) => serialize(quads, format),
    toJsonLd: () => Promise.resolve(buildJsonLd(descriptor)),
  };
}

/** Write the scalar agent fields + protocol-source links onto the node. */
function writeScalarFields(node: AgentNode, descriptor: AgentDescriptor): void {
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
}

/** Link + populate one `ad:Skill` blank node per advertised skill. */
function writeSkills(node: AgentNode, skills: AgentDescriptor["skills"]): void {
  for (const skill of skills ?? []) {
    const sk = node.linkSkill();
    sk.setId(skill.id);
    sk.setName(skill.name);
    if (skill.description !== undefined) {
      sk.setDescription(skill.description);
    }
  }
}

/** Link + populate one `ad:SecurityScheme` blank node per scheme. */
function writeSecuritySchemes(node: AgentNode, schemes: AgentDescriptor["securitySchemes"]): void {
  for (const scheme of schemes ?? []) {
    const sc = node.linkSecurityScheme();
    sc.setType(scheme.type);
    if (scheme.description !== undefined) {
      sc.setDescription(scheme.description);
    }
    if (scheme.issuer !== undefined) {
      sc.setIssuer(scheme.issuer);
    }
  }
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
  // IRI sanitisation applies to the JSON-LD encoding TOO, not just the Turtle/quads
  // path: a consumer parses this document into RDF (the `@id` / `@type:@id` terms
  // become IRIs), so an untrusted value must not carry an unescaped break-out char
  // into that RDF. `@id` is scheme-agnostic (may be `did:`/`urn:`) → escapeIri;
  // the http(s)-contract fields (url/owner/protocolSource/issuer) → safeHttpIri,
  // dropping any field whose value is not a safe absolute http(s) IRI. `url` is
  // guaranteed present by the fail-closed check in describeAgent.
  const doc: Record<string, unknown> = {
    // A SELF-CONTAINED inline context (not a bare remote URL) so the document
    // parses offline + deterministically and carries no SSRF/availability
    // dependency on the CG-draft context endpoint. See ANP_INLINE_CONTEXT.
    "@context": ANP_INLINE_CONTEXT,
    "@id": escapeIri(descriptor.id),
    "@type": "AgentDescription",
    name: descriptor.name,
    url: safeHttpIri(descriptor.url ?? descriptor.id),
  };
  if (descriptor.description !== undefined) {
    doc.description = descriptor.description;
  }
  if (descriptor.owner !== undefined) {
    const owner = safeHttpIri(descriptor.owner);
    if (owner !== undefined) {
      doc.owner = { "@id": owner };
    }
  }
  if (descriptor.did !== undefined) {
    doc.did = descriptor.did;
  }
  if (descriptor.protocolSources && descriptor.protocolSources.length > 0) {
    const sources = descriptor.protocolSources
      .map((s) => safeHttpIri(s))
      .filter((s): s is string => s !== undefined);
    if (sources.length > 0) {
      doc.protocolSource = sources.map((s) => ({ "@id": s }));
    }
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
        const issuer = safeHttpIri(sc.issuer);
        if (issuer !== undefined) {
          scheme.url = { "@id": issuer };
        }
      }
      return scheme;
    });
  }
  return doc;
}
