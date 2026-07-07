// AUTHORED-BY Claude Opus 4.8
/**
 * The per-domain CODEGEN CONFIG — the committed, hashed input that supplies the
 * guard flags a SHACL profile cannot express (design §7.2): the subject
 * convention, entity naming, and the historical lexical behaviours
 * (`emptyStringDrop`, defaults, `trim`/`dropBlank`/`sortOnRead`, …). Every manifest
 * guard that has no shapes source MUST trace to a config entry — the fidelity
 * assertion checks exactly that, so a guard can never be minted silently.
 *
 * The config is DATA (flags / enums / literal defaults), matching the runtime's
 * data-not-code invariant.
 */

import type { ManifestScalar } from "@jeswr/model-runtime";

/** Per-field guard configuration (only the flags SHACL cannot express live here). */
export interface FieldConfig {
  /** `build` drops an empty-string value. */
  emptyStringDrop?: boolean;
  /** A literal default value applied on read/build. */
  default?: ManifestScalar;
  /** dateTime field: `build` defaults an absent value to the current instant. */
  defaultNow?: boolean;
  /** `build` always materialises the default when the value is absent. */
  materializeDefault?: boolean;
  /** Set member: trim before adding. */
  trim?: boolean;
  /** Set member: skip a blank member. */
  dropBlank?: boolean;
  /** `parse` returns a set field sorted. */
  sortOnRead?: boolean;
  /** Disable text sanitization on write (default is ON). */
  sanitizeText?: boolean;
  /** Force fail-closed on absence (usually derived from minCount ≥ 1). */
  requiredFailClosed?: boolean;
  /** Force the http(s) scheme filter (usually derived from an `^https?://` pattern). */
  iriScheme?: "http-https";
}

export interface EntityConfig {
  /** The `sh:targetClass` this entry configures. */
  targetClass: string;
  /** The entity name (also the generated Wrapper / TS type base name). */
  name: string;
  /** Subject convention. */
  subject: { convention: "hash-it" | "self" };
  /** Per-field config, keyed by the field name (`sh:name`). */
  fields?: Record<string, FieldConfig>;
}

/**
 * Per-field config for a COMPOSITE node's flat field — the flat {@link FieldConfig}
 * plus a `rename` (the composite projection is ONE flat object, so same-local-name
 * fields on different nodes — e.g. `dct:title` on a Track and an Album — need distinct
 * names). The rename, like every guard flag, is a config choice that must trace.
 */
export interface CompositeFieldConfig extends FieldConfig {
  /** Emit the flat field under this name (must be a valid identifier). */
  rename?: string;
}

/**
 * One node of a composite entity config — the NodeShape (by `targetClass`) to project,
 * the document `fragment` its subject lives at, which of its shape properties become
 * FLAT fields (`fields`, with per-field config), and which IRI-link properties become
 * NESTED links to a sub-node (`links`, keyed by the shape field name → the target node
 * name). A shape property that is neither `fields` nor `links` is OMITTED — but a
 * Violation-graded (MUST) property may never be omitted (the fidelity assertion enforces
 * this), so a security-critical constraint is never silently dropped.
 */
export interface CompositeNodeConfig {
  /** The `sh:targetClass` of the node's NodeShape (distinct across the composite's nodes). */
  targetClass: string;
  /** The document fragment (e.g. `it`, `track`) — the node IRI is `${resourceUrl}#${fragment}`. */
  fragment: string;
  /** Shape properties (by shape field name) to project as FLAT fields. */
  fields?: Record<string, CompositeFieldConfig>;
  /** Shape IRI-link properties (by shape field name) to project as NESTED links → a sub-node name. */
  links?: Record<string, string>;
}

/** A composite (document-projection) entity config — a root node + named sub-nodes. */
export interface CompositeEntityConfig {
  /** The entity name (also the generated type base name). */
  name: string;
  /** Discriminator. */
  kind: "composite";
  /** The node name (a key of `nodes`) that is the root (build / parse entry point). */
  root: string;
  /** node name → node config. */
  nodes: Record<string, CompositeNodeConfig>;
}

/** A config entity — a flat single-node entity or a composite document projection. */
export type AnyEntityConfig = EntityConfig | CompositeEntityConfig;

/** Type guard — narrows a config entity to the composite variant. */
export function isCompositeConfig(entity: AnyEntityConfig): entity is CompositeEntityConfig {
  return (entity as { kind?: string }).kind === "composite";
}

export interface CodegenConfig {
  /** Namespace the skolem shape IRIs are minted under. */
  shapesBase: string;
  /** Prefix map for the emitted `shapes.ttl` + the manifest / serializer. */
  prefixes: Record<string, string>;
  entities: AnyEntityConfig[];
}

/** Look up the FLAT entity config for a target class (composite configs are excluded). */
export function entityConfigFor(
  config: CodegenConfig,
  targetClass: string,
): EntityConfig | undefined {
  return config.entities.find(
    (e): e is EntityConfig => !isCompositeConfig(e) && e.targetClass === targetClass,
  );
}

/** The guard keys a FieldConfig may set (used by the fidelity traceability check). */
export const FIELD_CONFIG_GUARD_KEYS = [
  "emptyStringDrop",
  "default",
  "defaultNow",
  "materializeDefault",
  "trim",
  "dropBlank",
  "sortOnRead",
  "sanitizeText",
  "requiredFailClosed",
  "iriScheme",
] as const;
