// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Solid type-index integration for Pod Drive.
//
// Two halves:
//   - READ: given a fetched type-index dataset, find the container(s) registered
//     for the app's primary class (poddrive:DriveRoot) so the app can discover a
//     user's drive roots without guessing pod paths.
//   - WRITE: build the quads for a TypeRegistration, serialised via n3.Writer
//     (NEVER hand-built), ready for the UI layer to PATCH into the index.
//
// All quad construction goes through the n3 DataFactory; all reads go through
// @rdfjs/wrapper typed accessors. This is the pod-shaped registration the
// federation expects: peers read the index to learn where DriveRoot data lives.

import type { DatasetCore, Quad, Quad_Subject } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { iri } from "./serialize.js";
import { PODDRIVE, RDF, SOLID } from "./vocab.js";

const { namedNode, quad } = DataFactory;

/** A `solid:TypeRegistration` node read from a type index. */
export class TypeRegistration extends TermWrapper {
  /** The class(es) this registration is `solid:forClass`. */
  get forClasses(): Set<string> {
    return SetFrom.subjectPredicate(this, SOLID.forClass, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** `solid:instance` resources registered for the class. */
  get instances(): Set<string> {
    return SetFrom.subjectPredicate(this, SOLID.instance, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** `solid:instanceContainer` containers registered for the class. */
  get instanceContainers(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      SOLID.instanceContainer,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}

/**
 * Find every container registered for {@link PODDRIVE.DriveRoot} in a fetched
 * type-index dataset, i.e. the user's drive-root containers. Returns the
 * `solid:instanceContainer` URLs across all matching registrations, de-duped.
 *
 * Source of truth is the index document the caller fetched; this never invents
 * a default path.
 */
export function findDriveRoots(
  index: DatasetCore,
  forClass: string = PODDRIVE.DriveRoot,
): string[] {
  const roots = new Set<string>();
  const klass = namedNode(forClass);
  // Every subject that is `solid:forClass <DriveRoot>` is a registration. Pass
  // the ORIGINAL subject term (not its `.value`) to TypeRegistration so a
  // blank-node registration — common in type-index docs — keeps its term type
  // and matches; reconstructing from `.value` would always mint a NamedNode and
  // silently miss blank-node registrations' solid:instanceContainer values.
  for (const q of index.match(null, namedNode(SOLID.forClass), klass)) {
    const reg = new TypeRegistration(q.subject, index, DataFactory);
    for (const c of reg.instanceContainers) {
      roots.add(c);
    }
  }
  return [...roots];
}

/**
 * Build the quads for a `solid:TypeRegistration` of {@link PODDRIVE.DriveRoot}
 * pointing at `driveRootContainer`, anchored at `registrationIri` (typically a
 * fragment in the type-index doc, e.g. `<index.ttl#poddrive>`). Serialise the
 * result with {@link quadsToTurtle} to PATCH/PUT it into the index.
 *
 * The TypeRegistration is also declared `a solid:TypeRegistration`; the index
 * document itself should already be a `solid:TypeIndex` (we do not re-assert
 * that here — that is the index's own metadata).
 */
export function buildDriveRootRegistration(
  registrationIri: string,
  driveRootContainer: string,
  forClass: string = PODDRIVE.DriveRoot,
): Quad[] {
  const subject: Quad_Subject = iri(registrationIri);
  return [
    quad(subject, namedNode(RDF.type), namedNode(SOLID.TypeRegistration)),
    quad(subject, namedNode(SOLID.forClass), namedNode(forClass)),
    quad(subject, namedNode(SOLID.instanceContainer), namedNode(driveRootContainer)),
  ];
}

/**
 * Build the quads marking `containerUrl` as a {@link PODDRIVE.DriveRoot} (the
 * marker triple written into the container's own description). Pairs with the
 * type-index registration so a peer that follows the index finds a container
 * that self-identifies as a drive root.
 */
export function buildDriveRootMarker(containerUrl: string): Quad[] {
  return [quad(iri(containerUrl), namedNode(RDF.type), namedNode(PODDRIVE.DriveRoot))];
}
