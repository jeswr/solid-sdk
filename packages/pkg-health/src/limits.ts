// AUTHORED-BY Claude Sonnet 5.5
import { MAX_CLASSIFIED_NANOPUBLICATIONS, type Nanopublication } from "@jeswr/pkg-memory";
import { HealthGraphError } from "./types.js";

/** Nanopublications one import or projection accepts (the pkg-memory read cap). */
export const MAX_IMPORT_NANOPUBLICATIONS = MAX_CLASSIFIED_NANOPUBLICATIONS;
/** Facts plus unrecognised records one projection builds, however the subjects are shared. */
export const MAX_PROJECTED_FACTS = 20_000;

/** Fail closed, with a fixed error carrying no input value, when a read is too large. */
export function assertWithinLimits(nanopubs: readonly Pick<Nanopublication, "id">[]): void {
  if (new Set(nanopubs.map((np) => np.id)).size > MAX_IMPORT_NANOPUBLICATIONS)
    throw new HealthGraphError("too-large");
}
