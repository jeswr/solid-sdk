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
import { ACL_MODES } from "./vocab.js";
import { FederationBuilder } from "./wrappers.js";

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

  for (const sector of app.sectors ?? []) {
    node.addSector(sector);
  }
  for (const mode of app.access ?? []) {
    node.addAccess(ACL_MODES[mode]);
  }
  for (const shape of app.consumes ?? []) {
    node.addConsumes(shape);
  }
  for (const shape of app.produces ?? []) {
    node.addProduces(shape);
  }
  for (const shape of app.declaresShape ?? []) {
    node.addDeclaresShape(shape);
  }

  for (const su of app.sectorUse ?? []) {
    const suNode = node.linkSectorUse();
    suNode.addSector(su.sector);
    for (const mode of su.access) {
      suNode.addAccess(ACL_MODES[mode]);
    }
    for (const shape of su.consumes ?? []) {
      suNode.addConsumes(shape);
    }
    for (const shape of su.produces ?? []) {
      suNode.addProduces(shape);
    }
  }

  const quads = builder.quads();
  return {
    quads,
    toString: (format?: string) => serialize(quads, format),
  };
}
