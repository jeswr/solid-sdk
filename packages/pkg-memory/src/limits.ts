// AUTHORED-BY Claude Sonnet 5.5

/**
 * Heads one parse or classification accepts; more fail closed with a fixed error,
 * before any graph is read. This is the only size cap on reads.
 */
export const MAX_CLASSIFIED_NANOPUBLICATIONS = 20_000;
/**
 * Replacing envelope IDs listed in `ClassifiedNanopublication.replacedBy`: the
 * smallest IDs in code-unit order. The envelope is past whatever the list holds.
 */
export const MAX_REPLACED_BY = 64;
/**
 * Unresolved update targets a tolerant parse returns. Above this the list is
 * truncated and `skippedTargetsOverflow` is set, so every nanopub counts as affected.
 */
export const MAX_SKIPPED_TARGETS = 10_000;
