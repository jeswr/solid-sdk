// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Access to the canonical chat-message SHACL shape (`shapes/message.shacl.ttl`).
 *
 * The shape lives in a single `.ttl` file at the package root (the human- and
 * tool-readable artifact `rdf-validate-shacl` consumes directly, and the artifact
 * the codegen framework's shape-driven message components — `jeswr-message-list`,
 * `jeswr-shacl-view` / `-form` — render from). This module reads it as a string so
 * consumers can feed it into whatever SHACL engine they already depend on (the
 * suite uses `rdf-validate-shacl` over a `@zazuko/env` dataset). Reading the file
 * rather than embedding a copy means the string can never drift from the canonical
 * `.ttl`.
 *
 * The relative path `../shapes/message.shacl.ttl` resolves identically from the
 * source tree (`src/shape.ts` → `shapes/message.shacl.ttl`) and the built output
 * (`dist/shape.js` → `shapes/message.shacl.ttl`), because both `src/` and `dist/`
 * sit one level below the package root next to `shapes/`. The `shapes/` directory
 * is shipped in the package `files` allow-list, so it is present after install.
 *
 * Mirrors `@jeswr/solid-task-model`'s `./shape` export exactly, so the access
 * pattern is consistent across the suite's federated RDF models.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
/** Filesystem path to the canonical chat-message SHACL shape file. */
export const MESSAGE_SHAPE_PATH = fileURLToPath(new URL("../shapes/message.shacl.ttl", import.meta.url));
let cachedMessage;
/**
 * The canonical chat-message SHACL shape (`as:Note`), as a Turtle string. Cached
 * after the first read. Pass it (with the data graph) to a SHACL validator — see
 * `src/message-shape.test.ts` for the `rdf-validate-shacl` pattern — or hand it to
 * the codegen framework's shape-driven message components to render a message from
 * its shape.
 */
export function messageShapeTtl() {
    if (cachedMessage === undefined)
        cachedMessage = readFileSync(MESSAGE_SHAPE_PATH, "utf8");
    return cachedMessage;
}
//# sourceMappingURL=shape.js.map