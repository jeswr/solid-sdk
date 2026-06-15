// AUTHORED-BY Claude Opus 4.8
/**
 * Solid Type Index read + write for Pod Mail.
 *
 * The Type Index is how a pod owner advertises *where in the pod a given RDF
 * class is stored*, so independent apps discover each other's data. Pod Mail
 * registers its primary class (`schema:EmailMessage`) against the mail root
 * container so other apps can find the user's mail.
 *
 * No `@solid/object` wrapper ships for the type index, so we implement it
 * through `@rdfjs/wrapper` `TermWrapper`/`DatasetWrapper` subclasses — never
 * inline quads, never string-concatenated Turtle. (Worked shape: the
 * solid-type-index skill.)
 */
import {
  DatasetWrapper,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { Classes, RDF, SOLID } from "./vocab.js";

/** One `solid:TypeRegistration` entry. */
export class TypeRegistration extends TermWrapper {
  /** The RDF class this entry indexes (an IRI). */
  get forClass(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}forClass`, NamedNodeAs.string);
  }
  set forClass(value: string | undefined) {
    OptionalAs.object(this, `${SOLID}forClass`, value, NamedNodeFrom.string);
  }

  /** A single resource holding instances of `forClass`. */
  get instance(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}instance`, NamedNodeAs.string);
  }
  set instance(value: string | undefined) {
    OptionalAs.object(this, `${SOLID}instance`, value, NamedNodeFrom.string);
  }

  /** A container listing instances of `forClass`. */
  get instanceContainer(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}instanceContainer`, NamedNodeAs.string);
  }
  set instanceContainer(value: string | undefined) {
    OptionalAs.object(this, `${SOLID}instanceContainer`, value, NamedNodeFrom.string);
  }

  /** Stamp the entry as a `solid:TypeRegistration` (call once when minting). */
  markRegistration(): void {
    this.types.add(`${SOLID}TypeRegistration`);
  }

  /** Live set of `rdf:type` IRIs. */
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, `${RDF}type`, NamedNodeAs.string, NamedNodeFrom.string);
  }
}

/** A type-index document, wrapped whole. */
export class TypeIndexDataset extends DatasetWrapper {
  /** Every `solid:TypeRegistration` subject in the document. */
  get registrations(): Iterable<TypeRegistration> {
    return this.instancesOf(`${SOLID}TypeRegistration`, TypeRegistration);
  }

  /** Find the location(s) registered for a class IRI. */
  locate(classIri: string): { instance?: string; container?: string }[] {
    const out: { instance?: string; container?: string }[] = [];
    for (const reg of this.registrations) {
      if (reg.forClass === classIri) {
        const entry: { instance?: string; container?: string } = {};
        if (reg.instance !== undefined) entry.instance = reg.instance;
        if (reg.instanceContainer !== undefined) entry.container = reg.instanceContainer;
        out.push(entry);
      }
    }
    return out;
  }

  /** Whether a registration for the class already exists. */
  hasRegistrationFor(classIri: string): boolean {
    for (const reg of this.registrations) {
      if (reg.forClass === classIri) return true;
    }
    return false;
  }

  /**
   * Add a registration. Serialise + conditional PUT afterwards to persist.
   * A registration uses `instance` (one resource) OR `instanceContainer`
   * (a container) — supply exactly one.
   */
  register(
    indexUrl: string,
    fragment: string,
    classIri: string,
    location: { instance?: string; container?: string },
  ): TypeRegistration {
    if ((location.instance === undefined) === (location.container === undefined)) {
      throw new Error(
        "register() requires exactly one of { instance, container } — a TypeRegistration uses solid:instance OR solid:instanceContainer, not both or neither.",
      );
    }
    const reg = new TypeRegistration(indexUrl + fragment, this, this.factory);
    reg.markRegistration();
    reg.forClass = classIri;
    if (location.instance !== undefined) reg.instance = location.instance;
    if (location.container !== undefined) reg.instanceContainer = location.container;
    return reg;
  }

  /**
   * Register Pod Mail's primary class (`schema:EmailMessage`) against its mail
   * root container. Idempotent: a no-op (returns the existing entry) if a
   * registration for the class already exists.
   */
  registerMail(indexUrl: string, mailContainer: string): TypeRegistration {
    for (const reg of this.registrations) {
      if (reg.forClass === Classes.EmailMessage) return reg;
    }
    return this.register(indexUrl, "#registration-pod-mail", Classes.EmailMessage, {
      container: mailContainer,
    });
  }
}
