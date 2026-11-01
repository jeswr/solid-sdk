// AUTHORED-BY Codex GPT-6.1-Sol
// Ported from apps/pod-drive (original author: Claude Opus 4.8).
import { canonicalize, termsEqual } from "@jeswr/suite-vocab";
import type { DatasetCore, Quad } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { iri } from "./serialize.js";
import { PODDRIVE, RDF, SOLID } from "./vocab.js";

const { namedNode } = DataFactory;

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
  // Every subject that is `solid:forClass <DriveRoot>` is a registration. Pass
  // the ORIGINAL subject term (not its `.value`) to TypeRegistration so a
  // blank-node registration — common in type-index docs — keeps its term type
  // and matches; reconstructing from `.value` would always mint a NamedNode and
  // silently miss blank-node registrations' solid:instanceContainer values.
  for (const q of index.match(null, namedNode(SOLID.forClass), null)) {
    if (q.object.termType !== "NamedNode" || !termsEqual(q.object.value, forClass)) continue;
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
  const dataset = new Store();
  const registration = new TypeRegistration(iri(registrationIri), dataset, DataFactory);
  SetFrom.subjectPredicate(registration, RDF.type, TermAs.term, TermFrom.itself).add(
    namedNode(SOLID.TypeRegistration),
  );
  registration.forClasses.add(iri(canonicalize(forClass)).value);
  registration.instanceContainers.add(iri(driveRootContainer).value);
  return [...dataset];
}

/**
 * Build the quads marking `containerUrl` as a {@link PODDRIVE.DriveRoot} (the
 * marker triple written into the container's own description). Pairs with the
 * type-index registration so a peer that follows the index finds a container
 * that self-identifies as a drive root.
 */
export function buildDriveRootMarker(containerUrl: string): Quad[] {
  const dataset = new Store();
  const root = new TermWrapper(iri(containerUrl), dataset, DataFactory);
  SetFrom.subjectPredicate(root, RDF.type, TermAs.term, TermFrom.itself).add(
    namedNode(PODDRIVE.DriveRoot),
  );
  return [...dataset];
}
