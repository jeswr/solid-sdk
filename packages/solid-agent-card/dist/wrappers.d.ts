import type { DatasetCore, Quad } from "@rdfjs/types";
import { DatasetWrapper, TermWrapper, type TermWrapper as TermWrapperType } from "@rdfjs/wrapper";
/** A typed view of an `ad:Skill` node. */
export declare class SkillNode extends TermWrapper {
    get skillId(): Set<TermWrapperType>;
    get names(): Set<TermWrapperType>;
    get descriptions(): Set<TermWrapperType>;
}
/** A typed view of an `ad:SecurityScheme` node. */
export declare class SecuritySchemeNode extends TermWrapper {
    get schemeTypes(): Set<TermWrapperType>;
    get descriptions(): Set<TermWrapperType>;
    get urls(): Set<TermWrapperType>;
}
/**
 * A typed view of an `ad:AgentDescription` node — the agent's self-description.
 */
export declare class AgentDescriptionNode extends TermWrapper {
    get names(): Set<TermWrapperType>;
    get descriptions(): Set<TermWrapperType>;
    get urls(): Set<TermWrapperType>;
    get owners(): Set<TermWrapperType>;
    get dids(): Set<TermWrapperType>;
    get protocolSources(): Set<TermWrapperType>;
    /** Linked `ad:Skill` nodes, projected to typed wrappers (term-type-preserving). */
    get skills(): Set<SkillNode>;
    /** Linked `ad:SecurityScheme` nodes, projected to typed wrappers. */
    get securitySchemes(): Set<SecuritySchemeNode>;
}
/** A dataset wrapper for an agent-description document. */
export declare class AgentDataset extends DatasetWrapper {
    /** Every `ad:AgentDescription` subject in the dataset. */
    agentDescriptions(): AgentDescriptionNode[];
    /** A typed view of a single agent-description subject. */
    agentDescription(id: string): AgentDescriptionNode;
}
/**
 * A dataset wrapper for a WebID profile, exposing the person→agent pointer(s).
 */
export declare class ProfileDataset extends DatasetWrapper {
    /**
     * Read every agent-pointer object for `webId` across the agent-pointer
     * predicates, in priority order. Returns `[predicate, agentTerm]` pairs so the
     * caller knows which predicate linked each, and can reject non-IRI objects.
     */
    agentPointers(webId: string): {
        predicate: string;
        agent: TermWrapperType;
    }[];
}
/** Wrap an `RDF.DatasetCore` as an {@link AgentDataset}. */
export declare function wrapAgent(dataset: DatasetCore): AgentDataset;
/** Wrap an `RDF.DatasetCore` as a {@link ProfileDataset}. */
export declare function wrapProfile(dataset: DatasetCore): ProfileDataset;
/** A `ad:Skill` node opened for writing. */
declare class WritableSkill extends TermWrapper {
    typeSkill(): void;
    setId(id: string): void;
    setName(name: string): void;
    setDescription(d: string): void;
}
/** A `ad:SecurityScheme` node opened for writing. */
declare class WritableSecurityScheme extends TermWrapper {
    typeScheme(): void;
    setType(t: string): void;
    setDescription(d: string): void;
    setIssuer(iri: string): void;
}
/** An `ad:AgentDescription` node opened for WRITING. */
declare class WritableAgentDescription extends TermWrapper {
    typeAgentDescription(): void;
    setName(name: string): void;
    setDescription(d: string): void;
    setUrl(iri: string): void;
    setOwner(iri: string): void;
    setDid(did: string): void;
    addProtocolSource(iri: string): void;
    /** Link a fresh blank-node Skill node, typed `ad:Skill`. */
    linkSkill(): WritableSkill;
    /** Link a fresh blank-node SecurityScheme node, typed `ad:SecurityScheme`. */
    linkSecurityScheme(): WritableSecurityScheme;
    /** Mint a blank node, link it from this subject via `predicate`, return the term. */
    private linkBlank;
}
/**
 * Builder over a fresh `N3.Store` for the agent-description graph. Returns the
 * store so the caller can serialise it with `n3.Writer`.
 */
export declare class AgentBuilder {
    private readonly store;
    private readonly factory;
    /** Open the agent-description subject (`id` is the agent IRI) for writing. */
    agent(id: string): WritableAgentDescription;
    /** The accumulated quads. */
    quads(): Quad[];
}
/**
 * Builder for the person→agent pointer triple in a WebID profile. Emits the
 * pointer through the typed write path (never a hand-built triple).
 */
export declare class PointerBuilder {
    private readonly store;
    private readonly factory;
    /**
     * Add the pointer `(<webId>, <predicate>, <agent>)`. `predicate` defaults to
     * `interop:hasAuthorizationAgent` (the SAI "agent that represents you").
     */
    link(webId: string, agent: string, predicate: string): void;
    /** The accumulated quads. */
    quads(): Quad[];
}
/** Re-export the base type for callers extending the wrappers. */
export type { TermWrapperType };
//# sourceMappingURL=wrappers.d.ts.map