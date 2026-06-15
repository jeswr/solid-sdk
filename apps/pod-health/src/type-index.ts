// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Solid Type Index — read + write the publicTypeIndex / privateTypeIndex so
// other apps can discover where Pod Health stores its primary class
// (health:HealthRecord). Implemented as @rdfjs/wrapper TermWrapper subclasses
// (no @solid/object wrapper ships for the type index); never hand-built triples.
//
// The type index is the INTEROP surface — it advertises locations of data other
// apps may share, not a grant. A registration is a hint; a reader must still GET
// the resource to learn its actual access (the convention-only contract).

import {
  DatasetWrapper,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { HealthClass, RDF_TYPE, SolidTerm } from "./vocab.js";

/** The location a class is registered at — a single resource or a container. */
export interface RegistrationLocation {
  /** A single resource holding instances of the class (`solid:instance`). */
  instance?: string;
  /** A container listing instances of the class (`solid:instanceContainer`). */
  container?: string;
}

/** One `solid:TypeRegistration` entry within a type-index document. */
export class TypeRegistration extends TermWrapper {
  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The RDF class this entry indexes (`solid:forClass`). */
  get forClass(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SolidTerm.forClass, NamedNodeAs.string);
  }
  set forClass(value: string | undefined) {
    OptionalAs.object(this, SolidTerm.forClass, value, NamedNodeFrom.string);
  }

  /** A single resource holding instances of `forClass` (`solid:instance`). */
  get instance(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SolidTerm.instance, NamedNodeAs.string);
  }
  set instance(value: string | undefined) {
    OptionalAs.object(this, SolidTerm.instance, value, NamedNodeFrom.string);
  }

  /** A container listing instances of `forClass` (`solid:instanceContainer`). */
  get instanceContainer(): string | undefined {
    return OptionalFrom.subjectPredicate(this, SolidTerm.instanceContainer, NamedNodeAs.string);
  }
  set instanceContainer(value: string | undefined) {
    OptionalAs.object(this, SolidTerm.instanceContainer, value, NamedNodeFrom.string);
  }

  /** Stamp this node as a `solid:TypeRegistration` (call once when minting). */
  markRegistration(): void {
    this.types.add(SolidTerm.TypeRegistration);
  }
}

/**
 * A type-index document, wrapped whole. Registrations are sibling subjects in
 * the document (not reachable from the document's own subject), so this is a
 * DatasetWrapper.
 */
export class TypeIndexDataset extends DatasetWrapper {
  /** Live set of the index document's own `rdf:type` IRIs (the `<>` subject). */
  private indexTypes(documentUrl: string): Set<string> {
    const doc = new TermWrapper(documentUrl, this, this.factory);
    return SetFrom.subjectPredicate(doc, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** Every `solid:TypeRegistration` subject in the document. */
  get registrations(): Iterable<TypeRegistration> {
    return this.instancesOf(SolidTerm.TypeRegistration, TypeRegistration);
  }

  /**
   * The location(s) registered for a class IRI. Returns a list because a class
   * may have several registrations (`locate()` is a hint, not a single answer).
   */
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
   * Stamp the document subject as a `solid:TypeIndex` plus the listed/unlisted
   * marker. Call when CREATING an index document (it is absent on the pod).
   */
  markIndexDocument(documentUrl: string, listed: boolean): void {
    const types = this.indexTypes(documentUrl);
    types.add(SolidTerm.TypeIndex);
    types.add(listed ? SolidTerm.ListedDocument : SolidTerm.UnlistedDocument);
  }

  /**
   * Add (or mint) a registration for a class at a location. Mutates the
   * underlying dataset; serialise + conditional-PUT afterwards to persist.
   */
  register(
    documentUrl: string,
    fragment: string,
    classIri: string,
    location: RegistrationLocation,
  ): TypeRegistration {
    const reg = new TypeRegistration(`${documentUrl}${fragment}`, this, this.factory);
    reg.markRegistration();
    reg.forClass = classIri;
    if (location.instance !== undefined) reg.instance = location.instance;
    if (location.container !== undefined) reg.instanceContainer = location.container;
    return reg;
  }

  /**
   * Register Pod Health's primary class — `health:HealthRecord` — pointing at the
   * container the app stores records in. The canonical fragment is
   * `#registration-pod-health-records`.
   */
  registerHealthRecords(documentUrl: string, container: string): TypeRegistration {
    return this.register(
      documentUrl,
      "#registration-pod-health-records",
      HealthClass.HealthRecord,
      {
        container,
      },
    );
  }
}
