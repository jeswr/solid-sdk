// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Typed @rdfjs/wrapper accessors over an ANP-style Agent Description graph + the
// person→agent pointer in a WebID profile. This is the ONLY place RDF terms are
// read/written for the agent-pointer surface: the SDK surface
// (describeAgent / discoverAgent / verifyDescriptor) goes through these wrappers,
// never through hand-built quads (the house rule). Reading uses
// SetFrom.subjectPredicate; writing uses NamedNodeFrom/Literal + the dataset add,
// all from @rdfjs/wrapper.

import type { DataFactory as DataFactoryType, DatasetCore, Quad, Term } from "@rdfjs/types";
import {
  BlankNodeFrom,
  DatasetWrapper,
  LiteralFrom,
  NamedNodeFrom,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
  type TermWrapper as TermWrapperType,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import {
  AD_AGENT_DESCRIPTION,
  AD_DESCRIPTION,
  AD_DID,
  AD_NAME,
  AD_OWNER,
  AD_PROTOCOL_SOURCE,
  AD_SCHEME_TYPE,
  AD_SECURITY_SCHEME,
  AD_SECURITY_SCHEME_CLASS,
  AD_SKILL,
  AD_SKILL_CLASS,
  AD_SKILL_ID,
  AD_URL,
  AGENT_POINTER_PREDICATES,
  RDF_TYPE,
} from "./vocab.js";

/**
 * Read a property as a Set of the OBJECT TERMS themselves (not their lexical
 * `.value`) — so the term type survives the read and the validation layer can
 * reject malformed objects (e.g. a literal where an IRI is required). The factory
 * is shared so term identity / Set de-duplication hold.
 */
function objectTerms(node: TermWrapper, predicate: string): Set<TermWrapperType> {
  return SetFrom.subjectPredicate(node, predicate, TermAs.instance(TermWrapper), TermFrom.instance);
}

/** A typed view of an `ad:Skill` node. */
export class SkillNode extends TermWrapper {
  get skillId(): Set<TermWrapperType> {
    return objectTerms(this, AD_SKILL_ID);
  }
  get names(): Set<TermWrapperType> {
    return objectTerms(this, AD_NAME);
  }
  get descriptions(): Set<TermWrapperType> {
    return objectTerms(this, AD_DESCRIPTION);
  }
}

/** A typed view of an `ad:SecurityScheme` node. */
export class SecuritySchemeNode extends TermWrapper {
  get schemeTypes(): Set<TermWrapperType> {
    return objectTerms(this, AD_SCHEME_TYPE);
  }
  get descriptions(): Set<TermWrapperType> {
    return objectTerms(this, AD_DESCRIPTION);
  }
  get urls(): Set<TermWrapperType> {
    return objectTerms(this, AD_URL);
  }
}

/**
 * A typed view of an `ad:AgentDescription` node — the agent's self-description.
 */
export class AgentDescriptionNode extends TermWrapper {
  get names(): Set<TermWrapperType> {
    return objectTerms(this, AD_NAME);
  }
  get descriptions(): Set<TermWrapperType> {
    return objectTerms(this, AD_DESCRIPTION);
  }
  get urls(): Set<TermWrapperType> {
    return objectTerms(this, AD_URL);
  }
  get owners(): Set<TermWrapperType> {
    return objectTerms(this, AD_OWNER);
  }
  get dids(): Set<TermWrapperType> {
    return objectTerms(this, AD_DID);
  }
  get protocolSources(): Set<TermWrapperType> {
    return objectTerms(this, AD_PROTOCOL_SOURCE);
  }

  /** Linked `ad:Skill` nodes, projected to typed wrappers (term-type-preserving). */
  get skills(): Set<SkillNode> {
    return SetFrom.subjectPredicate(this, AD_SKILL, TermAs.instance(SkillNode), TermFrom.instance);
  }

  /** Linked `ad:SecurityScheme` nodes, projected to typed wrappers. */
  get securitySchemes(): Set<SecuritySchemeNode> {
    return SetFrom.subjectPredicate(
      this,
      AD_SECURITY_SCHEME,
      TermAs.instance(SecuritySchemeNode),
      TermFrom.instance,
    );
  }
}

/** A dataset wrapper for an agent-description document. */
export class AgentDataset extends DatasetWrapper {
  /** Every `ad:AgentDescription` subject in the dataset. */
  agentDescriptions(): AgentDescriptionNode[] {
    return [...this.instancesOf(AD_AGENT_DESCRIPTION, AgentDescriptionNode)];
  }

  /** A typed view of a single agent-description subject. */
  agentDescription(id: string): AgentDescriptionNode {
    return new AgentDescriptionNode(id, this, this.factory);
  }
}

/**
 * A dataset wrapper for a WebID profile, exposing the person→agent pointer(s).
 */
export class ProfileDataset extends DatasetWrapper {
  /**
   * Read every agent-pointer object for `webId` across the agent-pointer
   * predicates, in priority order. Returns `[predicate, agentTerm]` pairs so the
   * caller knows which predicate linked each, and can reject non-IRI objects.
   */
  agentPointers(webId: string): { predicate: string; agent: TermWrapperType }[] {
    const subject = new TermWrapper(webId, this, this.factory);
    const out: { predicate: string; agent: TermWrapperType }[] = [];
    for (const predicate of AGENT_POINTER_PREDICATES) {
      for (const agent of objectTerms(subject, predicate)) {
        out.push({ predicate, agent });
      }
    }
    return out;
  }
}

/** Wrap an `RDF.DatasetCore` as an {@link AgentDataset}. */
export function wrapAgent(dataset: DatasetCore): AgentDataset {
  return new AgentDataset(dataset, DataFactory as unknown as DataFactoryType);
}

/** Wrap an `RDF.DatasetCore` as a {@link ProfileDataset}. */
export function wrapProfile(dataset: DatasetCore): ProfileDataset {
  return new ProfileDataset(dataset, DataFactory as unknown as DataFactoryType);
}

// --- the write path (describeAgent / buildAgentPointer) ------------------

/** Add a single `(subject, predicate-IRI, object-IRI)` triple through the factory. */
function addIri(node: TermWrapper, predicate: string, objectIri: string): void {
  const factory = node.factory;
  const subject = node as unknown as Term;
  const p = NamedNodeFrom.string(predicate, factory);
  const o = NamedNodeFrom.string(objectIri, factory);
  node.dataset.add(factory.quad(subject as never, p as never, o as never));
}

/** Add a single `(subject, predicate-IRI, string-literal)` triple through the factory. */
function addLiteral(node: TermWrapper, predicate: string, value: string): void {
  const factory = node.factory;
  const subject = node as unknown as Term;
  const p = NamedNodeFrom.string(predicate, factory);
  const o = LiteralFrom.string(value, factory);
  node.dataset.add(factory.quad(subject as never, p as never, o as never));
}

/** A `ad:Skill` node opened for writing. */
class WritableSkill extends TermWrapper {
  typeSkill(): void {
    addIri(this, RDF_TYPE, AD_SKILL_CLASS);
  }
  setId(id: string): void {
    addLiteral(this, AD_SKILL_ID, id);
  }
  setName(name: string): void {
    addLiteral(this, AD_NAME, name);
  }
  setDescription(d: string): void {
    addLiteral(this, AD_DESCRIPTION, d);
  }
}

/** A `ad:SecurityScheme` node opened for writing. */
class WritableSecurityScheme extends TermWrapper {
  typeScheme(): void {
    addIri(this, RDF_TYPE, AD_SECURITY_SCHEME_CLASS);
  }
  setType(t: string): void {
    addLiteral(this, AD_SCHEME_TYPE, t);
  }
  setDescription(d: string): void {
    addLiteral(this, AD_DESCRIPTION, d);
  }
  setIssuer(iri: string): void {
    addIri(this, AD_URL, iri);
  }
}

/** An `ad:AgentDescription` node opened for WRITING. */
class WritableAgentDescription extends TermWrapper {
  typeAgentDescription(): void {
    addIri(this, RDF_TYPE, AD_AGENT_DESCRIPTION);
  }
  setName(name: string): void {
    addLiteral(this, AD_NAME, name);
  }
  setDescription(d: string): void {
    addLiteral(this, AD_DESCRIPTION, d);
  }
  setUrl(iri: string): void {
    addIri(this, AD_URL, iri);
  }
  setOwner(iri: string): void {
    addIri(this, AD_OWNER, iri);
  }
  setDid(did: string): void {
    addLiteral(this, AD_DID, did);
  }
  addProtocolSource(iri: string): void {
    addIri(this, AD_PROTOCOL_SOURCE, iri);
  }

  /** Link a fresh blank-node Skill node, typed `ad:Skill`. */
  linkSkill(): WritableSkill {
    const node = new WritableSkill(this.linkBlank(AD_SKILL), this.dataset, this.factory);
    node.typeSkill();
    return node;
  }

  /** Link a fresh blank-node SecurityScheme node, typed `ad:SecurityScheme`. */
  linkSecurityScheme(): WritableSecurityScheme {
    const node = new WritableSecurityScheme(
      this.linkBlank(AD_SECURITY_SCHEME),
      this.dataset,
      this.factory,
    );
    node.typeScheme();
    return node;
  }

  /** Mint a blank node, link it from this subject via `predicate`, return the term. */
  private linkBlank(predicate: string): Term {
    const factory = this.factory;
    const blank = BlankNodeFrom.string(undefined, factory) as Term;
    const subject = this as unknown as Term;
    const p = NamedNodeFrom.string(predicate, factory);
    this.dataset.add(factory.quad(subject as never, p as never, blank as never));
    return blank;
  }
}

/**
 * Builder over a fresh `N3.Store` for the agent-description graph. Returns the
 * store so the caller can serialise it with `n3.Writer`.
 */
export class AgentBuilder {
  private readonly store = new Store();
  private readonly factory = DataFactory as unknown as DataFactoryType;

  /** Open the agent-description subject (`id` is the agent IRI) for writing. */
  agent(id: string): WritableAgentDescription {
    const node = new WritableAgentDescription(
      id,
      this.store as unknown as DatasetCore,
      this.factory,
    );
    node.typeAgentDescription();
    return node;
  }

  /** The accumulated quads. */
  quads(): Quad[] {
    return [...this.store] as Quad[];
  }
}

/**
 * Builder for the person→agent pointer triple in a WebID profile. Emits the
 * pointer through the typed write path (never a hand-built triple).
 */
export class PointerBuilder {
  private readonly store = new Store();
  private readonly factory = DataFactory as unknown as DataFactoryType;

  /**
   * Add the pointer `(<webId>, <predicate>, <agent>)`. `predicate` defaults to
   * `interop:hasAuthorizationAgent` (the SAI "agent that represents you").
   */
  link(webId: string, agent: string, predicate: string): void {
    const node = new TermWrapper(webId, this.store as unknown as DatasetCore, this.factory);
    addIri(node, predicate, agent);
  }

  /** The accumulated quads. */
  quads(): Quad[] {
    return [...this.store] as Quad[];
  }
}

/** Re-export the base type for callers extending the wrappers. */
export type { TermWrapperType };
