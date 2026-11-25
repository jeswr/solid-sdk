// AUTHORED-BY Claude Sonnet 5.5
import {
  MAX_CLASSIFIED_NANOPUBLICATIONS,
  MAX_ENVELOPES_PER_ASSERTION,
  type Nanopublication,
} from "@jeswr/pkg-memory";
import { HealthGraphError } from "./types.js";

/** Nanopublications one import or projection accepts (the pkg-memory classification cap). */
export const MAX_IMPORT_NANOPUBLICATIONS = MAX_CLASSIFIED_NANOPUBLICATIONS;
/** Envelopes that may share one assertion graph (corroborating records). */
export const MAX_ENVELOPES_PER_IMPORTED_ASSERTION = MAX_ENVELOPES_PER_ASSERTION;
/** Facts plus unrecognised records one projection builds, however the subjects are shared. */
export const MAX_PROJECTED_FACTS = 20_000;

/** Fail closed, with a fixed error carrying no input value, when a read is too large. */
export function assertWithinLimits(
  nanopubs: readonly Pick<Nanopublication, "id" | "assertionId">[],
): void {
  const ids = new Set<string>();
  const perAssertion = new Map<string, number>();
  for (const { id, assertionId } of nanopubs) {
    if (ids.has(id)) continue;
    ids.add(id);
    const count = (perAssertion.get(assertionId) ?? 0) + 1;
    if (ids.size > MAX_IMPORT_NANOPUBLICATIONS || count > MAX_ENVELOPES_PER_IMPORTED_ASSERTION)
      throw new HealthGraphError("too-large");
    perAssertion.set(assertionId, count);
  }
}
