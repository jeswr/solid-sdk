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
/** Type guard — narrows a config entity to the composite variant. */
export function isCompositeConfig(entity) {
    return entity.kind === "composite";
}
/** Look up the FLAT entity config for a target class (composite configs are excluded). */
export function entityConfigFor(config, targetClass) {
    return config.entities.find((e) => !isCompositeConfig(e) && e.targetClass === targetClass);
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
];
//# sourceMappingURL=config.js.map