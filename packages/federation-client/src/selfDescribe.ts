// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// selfDescribe(...) — build an app's own fedapp:App / AppVersion self-description
// graph (the declaresShape / consumes / produces / sectorUse graph) for
// publication in its Client Identifier Document. Returns the quads (built via the
// typed wrapper write path — never hand-built triples) and a `toTurtle()` helper
// that serialises through n3.Writer.

import type { Quad } from "@rdfjs/types";
import { serialize } from "./serialize.js";
import type { AppRegistration } from "./types.js";
import { ACL_MODES, type AccessMode } from "./vocab.js";
import { FederationBuilder } from "./wrappers.js";

/**
 * The write surface shared by the App node and each SectorUse node — the four
 * flat-form IRI properties (sector / access / consumes / produces) that attach
 * to both. Structural, so both `WritableApp` and `WritableSectorUse` (internal to
 * {@link ./wrappers.js}) satisfy it without a shared base class.
 */
interface CommonWriter {
  addSector(iri: string): void;
  addAccess(iri: string): void;
  addConsumes(iri: string): void;
  addProduces(iri: string): void;
}

/**
 * Apply the flat-form sector / access / consumes / produces lists to a node. Used
 * for BOTH the App node and each SectorUse node (they carry the same four
 * properties), so the projection lives in one place. Access modes map through
 * {@link ACL_MODES} to their `acl:` IRIs; the others are already IRIs.
 */
function applyCommon(
  node: CommonWriter,
  sectors: readonly string[],
  access: readonly AccessMode[],
  consumes: readonly string[],
  produces: readonly string[],
): void {
  for (const sector of sectors) {
    node.addSector(sector);
  }
  for (const mode of access) {
    node.addAccess(ACL_MODES[mode]);
  }
  for (const shape of consumes) {
    node.addConsumes(shape);
  }
  for (const shape of produces) {
    node.addProduces(shape);
  }
}

/** The output of {@link selfDescribe}. */
export interface SelfDescription {
  /** The constructed quads (an `fedapp:App` graph). */
  readonly quads: readonly Quad[];
  /** Serialise to Turtle (default) or another n3 format. */
  toString(format?: string): Promise<string>;
}

/**
 * Build an app's `fedapp:App` self-description from a plain {@link AppRegistration}.
 *
 * Flat-form sectors/access/consumes/produces are attached directly to the App;
 * each `sectorUse` block becomes a typed `fedapp:SectorUse` blank node linked via
 * `fedapp:sectorUse`. `declaresShape` shapes are attached to the App.
 *
 * @param app - the registration to describe (`app.id` is the client_id IRI).
 * @returns a {@link SelfDescription} carrying the quads + a Turtle serialiser.
 */
export function selfDescribe(app: AppRegistration): SelfDescription {
  if (!app.id) {
    throw new TypeError("selfDescribe: AppRegistration.id (the client_id IRI) is required.");
  }

  const builder = new FederationBuilder();
  const node = builder.app(app.id);

  // Flat-form properties on the App itself (declaresShape is App-only).
  applyCommon(node, app.sectors ?? [], app.access ?? [], app.consumes ?? [], app.produces ?? []);
  for (const shape of app.declaresShape ?? []) {
    node.addDeclaresShape(shape);
  }

  // Each SectorUse block: a fresh blank node carrying the same four flat-form
  // properties (its single `sector` passed as a one-element list).
  for (const su of app.sectorUse ?? []) {
    const suNode = node.linkSectorUse();
    applyCommon(suNode, [su.sector], su.access, su.consumes ?? [], su.produces ?? []);
  }

  const quads = builder.quads();
  return {
    quads,
    toString: (format?: string) => serialize(quads, format),
  };
}
