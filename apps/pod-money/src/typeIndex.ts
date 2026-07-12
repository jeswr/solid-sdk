// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Solid Type Index — read + register so other apps can discover where Pod Money
// stores its primary class (fin:Transaction). Pattern follows the
// solid-type-index skill (compile-verified against @rdfjs/wrapper 0.34.0).
//
// No @solid/object wrapper ships for the type index, so we implement read+write
// through our own TermWrapper subclasses — never inline quads, never
// string-concatenated Turtle.

import {
  DatasetWrapper,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { RDF_TYPE, SolidTerm } from "./vocab.js";

/** A single location a class is registered at. */
export interface RegistrationLocation {
  /** A single resource holding instances (`solid:instance`). */
  instance?: string;
  /** A container listing instances (`solid:instanceContainer`). */
  container?: string;
}

/** One `solid:TypeRegistration` entry. */
export class TypeRegistration extends TermWrapper {
  /** The RDF class this entry indexes (an IRI). */
  get forClass(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SolidTerm.forClass, NamedNodeAs.string);
  }
  set forClass(value: string | undefined) {
    OptionalAs.object(this, SolidTerm.forClass, value, NamedNodeFrom.string);
  }

  /** A single resource holding instances of `forClass`. */
  get instance(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SolidTerm.instance, NamedNodeAs.string);
  }
  set instance(value: string | undefined) {
    OptionalAs.object(this, SolidTerm.instance, value, NamedNodeFrom.string);
  }

  /** A container listing instances of `forClass`. */
  get instanceContainer(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SolidTerm.instanceContainer, NamedNodeAs.string);
  }
  set instanceContainer(value: string | undefined) {
    OptionalAs.object(this, SolidTerm.instanceContainer, value, NamedNodeFrom.string);
  }

  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Stamp the entry as a TypeRegistration (call once when minting). */
  markRegistration(): void {
    this.types.add(SolidTerm.TypeRegistration);
  }
}

/** A type-index document, wrapped whole. */
export class TypeIndexDataset extends DatasetWrapper {
  /** Every `solid:TypeRegistration` subject in the document. */
  get registrations(): Iterable<TypeRegistration> {
    return this.instancesOf(SolidTerm.TypeRegistration, TypeRegistration);
  }

  /** The location(s) registered for a class IRI. */
  locate(classIri: string): RegistrationLocation[] {
    const out: RegistrationLocation[] = [];
    for (const reg of this.registrations) {
      if (reg.forClass === classIri) {
        const loc: RegistrationLocation = {};
        if (reg.instance !== undefined) loc.instance = reg.instance;
        if (reg.instanceContainer !== undefined) loc.container = reg.instanceContainer;
        out.push(loc);
      }
    }
    return out;
  }

  /**
   * Mark this document as a type index. `kind` selects the public-vs-private
   * extra type per the spec (ListedDocument / UnlistedDocument).
   */
  markIndex(documentIri: string, kind: "public" | "private"): void {
    const doc = new TypeRegistration(documentIri, this, this.factory);
    doc.types.add(SolidTerm.TypeIndex);
    doc.types.add(kind === "public" ? SolidTerm.ListedDocument : SolidTerm.UnlistedDocument);
  }

  /**
   * Add a registration for `classIri` at `location`. Idempotent: if an
   * equivalent registration (same class + same single location) already exists,
   * it is reused rather than duplicated. Serialise + conditional PUT afterwards
   * to persist.
   */
  register(
    indexUrl: string,
    fragment: string,
    classIri: string,
    location: RegistrationLocation,
  ): TypeRegistration {
    for (const reg of this.registrations) {
      if (
        reg.forClass === classIri &&
        reg.instance === location.instance &&
        reg.instanceContainer === location.container
      ) {
        return reg;
      }
    }
    const reg = new TypeRegistration(indexUrl + fragment, this, this.factory);
    reg.markRegistration();
    reg.forClass = classIri;
    if (location.instance !== undefined) reg.instance = location.instance;
    if (location.container !== undefined) reg.instanceContainer = location.container;
    return reg;
  }
}
