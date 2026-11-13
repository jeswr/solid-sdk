// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// Semantic agent browser: the in-memory contract shared by @jeswr/site-model,
// @jeswr/site-profiler and @jeswr/site-executor. Design of record:
// https://claude.ai/artifact/HPiNzsDzndQ1aGJFgqHeyJ
//
// The RDF form of a site model is the source of truth on disk and in the pod;
// these types are its typed projection (site-model reads/writes RDF <-> these).
// IRIs are absolute strings. Vocabulary: schema.org actions + EntryPoint, and the
// provisional `sab:` namespace https://jeswr.org/ns/site-action# for the rest.

export const SAB = 'https://jeswr.org/ns/site-action#';
export const SCHEMA = 'https://schema.org/';

/** What running an operation changes. The Answerable outbound gate keys off this. */
export type EffectClass = 'read' | 'reversible-write' | 'irreversible-write' | 'payment';

/** How an operation was learned. */
export type LearnMethod = 'crawl' | 'form' | 'js-analysis' | 'demonstration' | 'fallback' | 'manual';

export interface Provenance {
  /** IRIs (or urn:uuid) of the recorded runs/traces this was derived from. */
  derivedFrom: string[];
  learnedAt: string; // ISO 8601
  method: LearnMethod;
  /** 0..1, the profiler's confidence in the action label and mapping. */
  confidence: number;
  lastVerified?: string; // ISO 8601, last successful replay check
  /** Successes / attempts since learned. */
  successes?: number;
  attempts?: number;
}

export type ParamLocation = 'path' | 'query' | 'body' | 'form' | 'header';

export interface Parameter {
  /** Template variable name used in urlTemplate / bodyTemplate / form fields. */
  name: string;
  /**
   * Property path on the RDF action node that supplies this value, e.g.
   * ['https://schema.org/query'] or ['https://schema.org/object', 'https://schema.org/sku'].
   * Empty = only settable from a flow binding.
   */
  path: string[];
  /** xsd datatype IRI or a class IRI (value is then an IRI or an id extracted from one). */
  range: string;
  required: boolean;
  location: ParamLocation;
  description?: string;
  /** Allowed values, e.g. from a <select>. */
  options?: string[];
  example?: string;
  /** Default used when the action does not supply a value. */
  default?: string;
}

export interface RequestTemplate {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** RFC 6570 template, absolute, on the site origin: https://shop.test/api/search{?q,page} */
  urlTemplate: string;
  contentType?: 'application/json' | 'application/x-www-form-urlencoded' | 'multipart/form-data';
  /** JSON body with {var} placeholders (whole-value placeholders keep JSON types). */
  bodyTemplate?: string;
  /** Static headers the site expects (never credentials; the vault adds those). */
  headers?: Record<string, string>;
}

export type CsrfSource =
  | { kind: 'cookie'; name: string }
  | { kind: 'html'; urlTemplate: string; selector: string; attribute: string }
  | { kind: 'json'; urlTemplate: string; pointer: string }
  | { kind: 'meta'; urlTemplate: string; name: string };

export type CsrfTarget =
  | { kind: 'header'; name: string }
  | { kind: 'form'; name: string }
  | { kind: 'query'; name: string };

export interface CsrfRule {
  source: CsrfSource;
  target: CsrfTarget;
}

export interface FieldRule {
  /** Predicate IRI on the extracted item, e.g. https://schema.org/name */
  property: string;
  /** JSON: RFC 6901 pointer relative to the item. HTML: CSS selector relative to the item. */
  path: string;
  /** HTML only: attribute to read instead of text content (e.g. href, content). */
  attribute?: string;
  /** xsd datatype IRI for literals; 'iri' to emit a named node (resolved against the page URL). */
  datatype?: string;
  /** Free text written by third parties (reviews, descriptions): the planner sees it as untrusted. */
  untrusted?: boolean;
}

export interface Extraction {
  format: 'json' | 'html';
  /** JSON: pointer to an array or object. HTML: CSS selector matching each item. Omit = whole document is one item. */
  itemPath?: string;
  /** rdf:type for each extracted item, e.g. https://schema.org/Product */
  itemType: string;
  /** Field rule (from fields) whose value becomes the item's IRI; else a blank node. */
  idField?: string;
  fields: FieldRule[];
}

export interface Operation {
  /** IRI of the operation within the site model document. */
  id: string;
  /** schema.org action type IRI: SearchAction, AddToCartAction, ViewAction, CommentAction, ... */
  actionType: string;
  /** Short human/LLM label, e.g. "Search products". */
  label: string;
  description?: string;
  inputs: Parameter[];
  request: RequestTemplate;
  session: 'none' | 'signed-in';
  csrf?: CsrfRule[];
  effect: EffectClass;
  extraction?: Extraction;
  /** SHACL shape IRI the extracted graph must satisfy. */
  returnsShape?: string;
  provenance: Provenance;
}

export interface FlowStep {
  operation: string; // Operation id
  /**
   * Values for the operation's parameters: '$input.<name>' (a flow input),
   * '$step<N>.<propertyIRI>' (first value of that property on step N's first extracted item),
   * or a literal string.
   */
  bind: Record<string, string>;
}

export interface Flow {
  id: string;
  actionType: string; // e.g. https://schema.org/BuyAction
  label: string;
  description?: string;
  inputs: Parameter[];
  steps: FlowStep[];
  /** The strongest effect among the steps. */
  effect: EffectClass;
  provenance: Provenance;
}

export interface LoginRoute {
  /** 'password' (form post), 'passkey', 'sso:<provider>' e.g. 'sso:google', 'magic-link', 'otp'. */
  method: string;
  /** Operation id of the login form post, when method = password. */
  operation?: string;
  /** How a signed-in session is recognised: cookie name(s) or a probe URL that 200s only when signed in. */
  sessionCookies?: string[];
  probeUrl?: string;
  /** Refresh endpoint and token pointer, when the site uses bearer + refresh tokens. */
  refresh?: { urlTemplate: string; tokenPointer: string; expiresInPointer?: string };
}

export interface SiteModel {
  /** IRI of the site model document. */
  id: string;
  /** Site origin, e.g. https://shop.test */
  site: string;
  /** Semver-ish version; bump when operations change. */
  version: string;
  generatedAt: string;
  operations: Operation[];
  flows: Flow[];
  login?: LoginRoute[];
}

/** A request from the planner, parsed from RDF: one action node and its properties. */
export interface ActionRequest {
  /** The action node (IRI or blank node label). */
  node: string;
  /** rdf:type IRIs of the action node. */
  types: string[];
  /** Resolve a property path from the action node to its values (literals as lexical strings, IRIs as IRIs). */
  values(path: string[]): string[];
}

/** One extracted fact set, returned to the planner. */
export interface Observation {
  operation: string;
  status: number;
  /** Turtle of the extracted graph (prefixed), untrusted literals marked per FieldRule.untrusted. */
  turtle: string;
  itemCount: number;
}

/** Executor-authored receipt for a terminal effectful execution, never a planner claim. */
export interface ActionOutcome {
  status: 'completed' | 'failed';
  /** Operation or flow label. */
  target: string;
  effect: Exclude<EffectClass, 'read'>;
  /** Authorized total, rather than the planner's spending cap. */
  amount?: string;
  currency?: string;
  /** Created item's trusted, on-origin IRI, when identified. */
  result?: string;
}
