// AUTHORED-BY Codex (GPT-6.1 Sol)
import { termsEqual } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import {
  DatasetWrapper,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { NS, RDF_TYPE } from "./vocab.js";

const SOLID = NS.SOLID;
const PREFERENCES_FILE = "http://www.w3.org/ns/pim/space#preferencesFile";
// Generator gap: blank-node subjects and simultaneous singleton/set views of one
// predicate cannot be projected. These generic Type Index views stay typed here.
/** One `solid:TypeRegistration` entry in a type-index document. */
export class TypeRegistration extends TermWrapper {
  get forClasses(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SOLID}forClass`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get instances(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SOLID}instance`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get instanceContainers(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SOLID}instanceContainer`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get forClass(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}forClass`, NamedNodeAs.string);
  }
  set forClass(v: string | undefined) {
    OptionalAs.object(this, `${SOLID}forClass`, v, NamedNodeFrom.string);
  }
  get instance(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}instance`, NamedNodeAs.string);
  }
  set instance(v: string | undefined) {
    OptionalAs.object(this, `${SOLID}instance`, v, NamedNodeFrom.string);
  }
  get instanceContainer(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}instanceContainer`, NamedNodeAs.string);
  }
  set instanceContainer(v: string | undefined) {
    OptionalAs.object(this, `${SOLID}instanceContainer`, v, NamedNodeFrom.string);
  }
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  markRegistration(): void {
    this.types.add(`${SOLID}TypeRegistration`);
  }
}

/** A located registration: where data for a class lives. */
export interface RegisteredLocation {
  forClass: string;
  instance?: string | undefined;
  container?: string | undefined;
}

/** A type-index document, wrapped whole. */
export class TypeIndexDataset extends DatasetWrapper {
  get registrations(): Iterable<TypeRegistration> {
    return this.instancesOf(`${SOLID}TypeRegistration`, TypeRegistration);
  }
  all(): RegisteredLocation[] {
    const out: RegisteredLocation[] = [];
    for (const reg of this.registrations) {
      const instances = [...reg.instances];
      const containers = [...reg.instanceContainers];
      for (const forClass of reg.forClasses) {
        for (const instance of instances) out.push({ forClass, instance, container: undefined });
        for (const container of containers) out.push({ forClass, instance: undefined, container });
        if (!instances.length && !containers.length)
          out.push({ forClass, instance: undefined, container: undefined });
      }
    }
    return out;
  }
  locate(classIri: string): RegisteredLocation[] {
    return this.all().filter((l) => termsEqual(l.forClass, classIri));
  }
}

/** The two type-index links advertised on a WebID profile (either may be absent). */
export interface TypeIndexLinks {
  publicIndex?: string | undefined;
  privateIndex?: string | undefined;
}

/** The WebID subject's type-index links, readable AND (privateIndex) writable. */
export class ProfileTypeIndexAnchor extends TermWrapper {
  get publicIndexes(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SOLID}publicTypeIndex`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get privateIndexes(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SOLID}privateTypeIndex`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  /** pim: and space: name the same vocabulary; either prefix resolves here. */
  get preferencesFiles(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      PREFERENCES_FILE,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get extendedProfiles(): string[] {
    return [
      ...SetFrom.subjectPredicate(
        this,
        "http://www.w3.org/2000/01/rdf-schema#seeAlso",
        NamedNodeAs.string,
        NamedNodeFrom.string,
      ),
      ...SetFrom.subjectPredicate(
        this,
        "http://xmlns.com/foaf/0.1/isPrimaryTopicOf",
        NamedNodeAs.string,
        NamedNodeFrom.string,
      ),
    ];
  }
  get publicIndex(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}publicTypeIndex`, NamedNodeAs.string);
  }
  get privateIndex(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}privateTypeIndex`, NamedNodeAs.string);
  }
  set privateIndex(v: string | undefined) {
    OptionalAs.object(this, `${SOLID}privateTypeIndex`, v, NamedNodeFrom.string);
  }
}

/** The type-index document's own subject — used when minting a fresh index. */
export class TypeIndexDocument extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
  markUnlistedIndex(): void {
    this.types.add(`${SOLID}TypeIndex`);
    this.types.add(`${SOLID}UnlistedDocument`);
  }
}

/** Read both `solid:*TypeIndex` links off the WebID subject of a profile dataset. */
export function typeIndexLinks(webId: string, profile: DatasetCore): TypeIndexLinks {
  const subject = new ProfileTypeIndexAnchor(webId, profile, DataFactory);
  return { publicIndex: subject.publicIndex, privateIndex: subject.privateIndex };
}
