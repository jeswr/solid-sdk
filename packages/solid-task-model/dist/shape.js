// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Access to the canonical SHACL shape (`shapes/task.ttl`).
 *
 * The shape lives in a single `.ttl` file at the package root (the human- and
 * tool-readable artifact `rdf-validate-shacl` consumes directly). This module
 * reads it as a string so consumers can feed it into whatever SHACL engine they
 * already depend on (the suite uses `rdf-validate-shacl` over a `@zazuko/env`
 * dataset). Reading the file rather than embedding a copy means the string can
 * never drift from the canonical `.ttl`.
 *
 * The relative path `../shapes/task.ttl` resolves identically from the source
 * tree (`src/shape.ts` → `shapes/task.ttl`) and the built output
 * (`dist/shape.js` → `shapes/task.ttl`), because both `src/` and `dist/` sit one
 * level below the package root next to `shapes/`. The `shapes/` directory is
 * shipped in the package `files` allow-list, so it is present after install.
 *
 * **Node-only — the `./shape` subpath is the SOLE home for this module.** It
 * imports `node:fs`/`node:url`, so nothing here is re-exported from the root
 * (`.`) entry — a browser bundler cannot resolve those specifiers. Import
 * `taskShapeTtl` / `TASK_SHAPE_PATH` etc. from `@jeswr/solid-task-model/shape`
 * in server-only or test code; a browser/client component wants `./task`,
 * `./tracker`, or `./contacts` instead.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
/** Filesystem path to the canonical SHACL shape file. */
export const TASK_SHAPE_PATH = fileURLToPath(new URL("../shapes/task.ttl", import.meta.url));
/** Filesystem path to the canonical tracker SHACL shape file. */
export const TRACKER_SHAPE_PATH = fileURLToPath(new URL("../shapes/tracker.ttl", import.meta.url));
/** Filesystem path to the canonical contacts SHACL shape file. */
export const CONTACTS_SHAPE_PATH = fileURLToPath(new URL("../shapes/contacts.ttl", import.meta.url));
let cachedTask;
let cachedTracker;
let cachedContacts;
/**
 * The canonical federated-task SHACL shape, as a Turtle string. Cached after the
 * first read. Pass it (with the data graph) to a SHACL validator — see the
 * round-trip + cross-app fixture tests for the `rdf-validate-shacl` pattern.
 */
export function taskShapeTtl() {
    if (cachedTask === undefined)
        cachedTask = readFileSync(TASK_SHAPE_PATH, "utf8");
    return cachedTask;
}
/**
 * The canonical federated-tracker SHACL shape, as a Turtle string. Cached after
 * the first read. Pass it (with the data graph) to a SHACL validator — see
 * `src/tracker.test.ts` for the `rdf-validate-shacl` pattern.
 */
export function trackerShapeTtl() {
    if (cachedTracker === undefined)
        cachedTracker = readFileSync(TRACKER_SHAPE_PATH, "utf8");
    return cachedTracker;
}
/**
 * The canonical federated-contacts (`vcard:AddressBook`) SHACL shape, as a Turtle
 * string. Cached after the first read. Pass it (with the data graph) to a SHACL
 * validator — see `src/contacts.test.ts` for the `rdf-validate-shacl` pattern.
 */
export function addressBookShapeTtl() {
    if (cachedContacts === undefined)
        cachedContacts = readFileSync(CONTACTS_SHAPE_PATH, "utf8");
    return cachedContacts;
}
//# sourceMappingURL=shape.js.map