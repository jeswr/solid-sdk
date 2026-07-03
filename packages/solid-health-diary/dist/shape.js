// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Access to the canonical SHACL profile + vocabulary.
 *
 * Both `.ttl` files are **vendored verbatim** from the landed `diet:` sub-sector
 * in `solid-federation-vocab` (Brief 1B, `sectors/health/diet/`): the normative
 * SHACL profile (`shapes/diet.shacl.ttl`) and the vocabulary (`shapes/diet.vocab.ttl`).
 * Vendoring keeps this package self-contained (GitHub-installable, no cross-repo
 * runtime dep) and pins the exact contract the accessors emit against. The vocab
 * is needed alongside the data graph when validating, because several SHACL
 * constraints are `sh:class` checks over the coded-value concept IRIs (e.g.
 * `diet:sulphites a diet:TriggerClass`), whose class typing lives in the vocab.
 *
 * **Node-only — the `./shape` subpath is the SOLE home for this module.** It
 * imports `node:fs`/`node:url`, so nothing here is re-exported from the root
 * (`.`) entry — a browser bundler cannot resolve those specifiers. Import from
 * `@jeswr/solid-health-diary/shape` in server-only or test code; a browser/client
 * component wants the root barrel, which is browser-safe.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
/** Filesystem path to the vendored SHACL profile (`shapes/diet.shacl.ttl`). */
export const DIET_SHACL_PATH = fileURLToPath(new URL("../shapes/diet.shacl.ttl", import.meta.url));
/** Filesystem path to the vendored vocabulary (`shapes/diet.vocab.ttl`). */
export const DIET_VOCAB_PATH = fileURLToPath(new URL("../shapes/diet.vocab.ttl", import.meta.url));
let cachedShacl;
let cachedVocab;
/**
 * The canonical health-diary SHACL profile, as a Turtle string. Cached after the
 * first read. Pass it (with the data graph + {@link dietVocabTtl}) to a SHACL
 * validator — see `src/shape.test.ts` for the `rdf-validate-shacl` pattern.
 */
export function dietShaclTtl() {
    if (cachedShacl === undefined)
        cachedShacl = readFileSync(DIET_SHACL_PATH, "utf8");
    return cachedShacl;
}
/**
 * The `diet:` vocabulary, as a Turtle string. Cached after the first read. Load it
 * INTO THE DATA GRAPH alongside the instance data when validating, so the SHACL
 * `sh:class` checks over the coded-value concept IRIs resolve.
 */
export function dietVocabTtl() {
    if (cachedVocab === undefined)
        cachedVocab = readFileSync(DIET_VOCAB_PATH, "utf8");
    return cachedVocab;
}
//# sourceMappingURL=shape.js.map