// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8
/** Integration example: exercise the shipped facade and generated SHACL together. */
import { readFileSync } from "node:fs";

export * from "../../../solid-bookmark/src/index.js";
export { httpIriOrUndefined } from "../../../solid-bookmark/src/iri.js";
export { bookmarkOntologyTtl } from "../../../solid-bookmark/src/shape.js";

/** Validate the generated shape as well as the package's normative shape oracle. */
export function bookmarkShapeTtl(): string {
  return readFileSync(
    new URL("../../../solid-bookmark/src/generated/shapes.ttl", import.meta.url),
    "utf8",
  );
}
