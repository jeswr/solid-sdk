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
    subject: {
        convention: "hash-it" | "self";
    };
    /** Per-field config, keyed by the field name (`sh:name`). */
    fields?: Record<string, FieldConfig>;
}
export interface CodegenConfig {
    /** Namespace the skolem shape IRIs are minted under. */
    shapesBase: string;
    /** Prefix map for the emitted `shapes.ttl` + the manifest / serializer. */
    prefixes: Record<string, string>;
    entities: EntityConfig[];
}
/** Look up the entity config for a target class. */
export declare function entityConfigFor(config: CodegenConfig, targetClass: string): EntityConfig | undefined;
/** The guard keys a FieldConfig may set (used by the fidelity traceability check). */
export declare const FIELD_CONFIG_GUARD_KEYS: readonly ["emptyStringDrop", "default", "defaultNow", "materializeDefault", "trim", "dropBlank", "sortOnRead", "sanitizeText", "requiredFailClosed", "iriScheme"];
//# sourceMappingURL=config.d.ts.map