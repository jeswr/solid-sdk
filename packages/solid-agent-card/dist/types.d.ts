import type { SecuritySchemeType } from "./vocab.js";
/**
 * A capability the agent advertises (an ANP/A2A "skill"). Kept minimal +
 * descriptor-agnostic so it round-trips into both the A2A Agent Card `skills[]`
 * and the ANP Agent Description `ad:skill` graph.
 */
export interface AgentSkill {
    /** Stable skill id (slug). Unique within the agent. */
    readonly id: string;
    /** Human-readable name. */
    readonly name: string;
    /** What the skill does (NL — the A2A/ANP baseline; an agent reads this first). */
    readonly description?: string;
    /** Free-form capability tags (e.g. `"scheduling"`, `"read-contacts"`). */
    readonly tags?: readonly string[];
}
/**
 * How an agent authenticates to interact with this agent. M1 default is
 * `solid-oidc` (WebID + Solid-OIDC + DPoP, RFC 9449) for the agent's OWN WebID;
 * delegated `act`-chain tokens are deferred to the gated CORE-PSS milestone
 * (M5(b)), so a delegation scheme is intentionally absent here.
 */
export interface SecurityScheme {
    /** The scheme kind. */
    readonly type: SecuritySchemeType;
    /** Identity-provider / issuer IRI (for `solid-oidc` / `oauth2`). */
    readonly issuer?: string;
    /** Human-readable note. */
    readonly description?: string;
}
/**
 * The agent's machine-readable self-description — "how an agent should interact
 * with me." A single domain object that {@link describeAgent} projects into BOTH
 * an A2A Agent Card (industry-reach JSON) and an ANP Agent Description
 * (RDF-reach JSON-LD/Turtle), so the two descriptors cannot drift.
 */
export interface AgentDescriptor {
    /** The agent's IRI — its stable endpoint / id (typically a pod URL). */
    readonly id: string;
    /** Human-readable agent name (shown on consent screens, A2A directories). */
    readonly name: string;
    /** What the agent is / does (NL). */
    readonly description?: string;
    /**
     * The WebID of the principal (person/org) this agent represents. The agent
     * pointer in that WebID's profile should point BACK here ({@link buildAgentPointer}).
     */
    readonly owner?: string;
    /** A `did:` for the agent, where one exists (ANP did:wba reach). Optional. */
    readonly did?: string;
    /** The interaction endpoint URL clients post to (defaults to {@link id}). */
    readonly url?: string;
    /** Capabilities the agent advertises. */
    readonly skills?: readonly AgentSkill[];
    /**
     * How to authenticate. Empty / omitted ⇒ a single implicit `public` scheme is
     * assumed by the validator (unauthenticated read).
     */
    readonly securitySchemes?: readonly SecurityScheme[];
    /**
     * URLs of M2 protocol documents (`protocolSources` in ANP/AGORA terms) — the
     * hash-pinned RDF/SHACL protocol documents an upgrading peer fetches. M1 just
     * carries the links; M2 (`@jeswr/agora-rdf`) defines their bodies.
     */
    readonly protocolSources?: readonly string[];
}
/** The two co-located descriptor encodings {@link describeAgent} produces. */
export interface AgentDescriptorDocuments {
    /**
     * The A2A Agent Card as a plain JSON object (industry reach). Serialise with
     * `JSON.stringify` and serve at {@link import("./vocab.js").WELL_KNOWN_AGENT_CARD}.
     */
    readonly agentCard: AgentCard;
    /**
     * The ANP Agent Description as the parsed RDF quads (RDF reach), plus
     * serialisers to Turtle and to a JSON-LD document (with the pinned `@context`).
     */
    readonly agentDescription: AgentDescriptionDocument;
}
/**
 * A JSON-serialisable A2A Agent Card. A deliberately small, spec-shaped subset
 * (the A2A card schema is a pinned watch item — see vocab). Plain JSON so it is
 * readable by industry tooling that does not grok JSON-LD.
 */
export interface AgentCard {
    readonly protocolVersion: string;
    readonly name: string;
    readonly description?: string;
    readonly url: string;
    readonly preferredTransport?: string;
    readonly skills?: readonly {
        readonly id: string;
        readonly name: string;
        readonly description?: string;
        readonly tags?: readonly string[];
    }[];
    readonly securitySchemes?: Readonly<Record<string, AgentCardSecurityScheme>>;
    /**
     * Solid/ANP extension block — the RDF-reach pointers that plain A2A tooling
     * ignores but a Solid/ANP-aware peer reads. Namespaced under `x-solid` so it
     * is unambiguously an extension, not a core A2A field.
     */
    readonly "x-solid"?: {
        readonly owner?: string;
        readonly agentDescription?: string;
        readonly protocolSources?: readonly string[];
    };
}
/** An A2A Agent Card security-scheme entry. */
export interface AgentCardSecurityScheme {
    readonly type: string;
    readonly description?: string;
    readonly openIdConnectUrl?: string;
}
/** The ANP Agent Description encoding: the quads + serialisers. */
export interface AgentDescriptionDocument {
    /** The constructed quads (an `ad:AgentDescription` graph). */
    readonly quads: readonly import("@rdfjs/types").Quad[];
    /** Serialise to Turtle (default) or another n3 format. */
    toTurtle(format?: string): Promise<string>;
    /**
     * A JSON-LD document object (the quads framed minimally with the pinned ANP
     * `@context`). Returned as a plain object — `JSON.stringify` it to serve.
     */
    toJsonLd(): Promise<Record<string, unknown>>;
}
/**
 * A discovered agent pointer — the result of reading a WebID profile for the
 * "agent that represents you" link.
 */
export interface AgentPointer {
    /** The WebID the pointer was read from. */
    readonly webId: string;
    /** The agent IRI the profile points to. */
    readonly agent: string;
    /** The predicate that linked them (one of the agent-pointer predicates). */
    readonly predicate: string;
}
/** The full result of {@link discoverAgent}. */
export interface AgentDiscovery {
    /** The WebID (or document URL) discovery started from. */
    readonly webId: string;
    /** The agent pointer(s) found in the profile (empty if none). */
    readonly pointers: readonly AgentPointer[];
    /**
     * The resolved + verified agent descriptor, when an agent pointer was found,
     * its description fetched, and it verified well-formed.
     */
    readonly descriptor?: AgentDescriptor;
    /** Verification result for the resolved descriptor (if one was resolved). */
    readonly verification?: VerificationResult;
}
/** A single validation problem found by {@link verifyDescriptor}. */
export interface VerificationIssue {
    /** Machine-readable code. */
    readonly code: VerificationIssueCode;
    /** Human-readable description. */
    readonly message: string;
    /** The offending subject IRI / blank-node id, where applicable. */
    readonly subject?: string;
    /** The offending value, where applicable. */
    readonly value?: string;
}
/** The closed set of issue codes the validator can emit. */
export type VerificationIssueCode = "no-agent-description" | "multiple-agent-descriptions" | "subject-mismatch" | "missing-name" | "missing-url" | "invalid-url" | "invalid-owner" | "skill-missing-id" | "skill-missing-name" | "duplicate-skill-id" | "invalid-security-scheme" | "invalid-protocol-source" | "fetch-failed" | "parse-failed";
/** The result of verifying an agent descriptor. */
export interface VerificationResult {
    /** `true` when the descriptor is well-formed. */
    readonly valid: boolean;
    /** The parsed descriptor, when one well-formed `ad:AgentDescription` was found. */
    readonly descriptor?: AgentDescriptor;
    /** All problems found. Empty iff `valid`. */
    readonly issues: readonly VerificationIssue[];
}
//# sourceMappingURL=types.d.ts.map