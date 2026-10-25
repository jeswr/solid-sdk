// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import type { Term } from "@rdfjs/types";
import {
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  SetFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { httpIri, nonEmpty } from "./validation";
import { canonicalize, NS, readPredicates, S, TYPE } from "./vocab";

export { DataFactory, Store } from "n3";

export async function parseMusic(
  body: string,
  url: string,
  contentType = "text/turtle",
): Promise<Store> {
  return new Store([...(await parseRdf(body, contentType, { baseIRI: url }))]);
}

export function serializeMusic(dataset: Store): Promise<string> {
  return serialize([...dataset], { prefixes: { schema: S, media: NS.MEDIA } });
}

/** Typed, alias-aware accessors shared by the ported Pod Music entities. */
export class MusicNode extends TermWrapper {
  constructor(term: string | Term | TermWrapper, dataset: Store) {
    super(
      typeof term === "string" ? DataFactory.namedNode(term) : (term as Term),
      dataset,
      DataFactory,
    );
  }

  objects(...predicates: string[]): TermWrapper[] {
    return predicates.flatMap((predicate) =>
      readPredicates(predicate).flatMap((alias) => [
        ...SetFrom.subjectPredicate(this, alias, TermAs.is, TermFrom.instance),
      ]),
    );
  }

  strings(...predicates: string[]): string[] {
    return this.objects(...predicates)
      .filter((term) => term.termType === "Literal" && term.value.trim().length > 0)
      .map((term) => term.value);
  }

  iris(...predicates: string[]): string[] {
    return this.objects(...predicates)
      .filter((term) => term.termType === "NamedNode")
      .map(NamedNodeAs.string);
  }

  get types(): Set<string> {
    return new Set(this.iris(TYPE).map(canonicalize));
  }

  stamp(...classes: string[]): this {
    httpIri(this.value);
    const types = SetFrom.subjectPredicate(this, TYPE, NamedNodeAs.string, NamedNodeFrom.string);
    for (const type of classes) types.add(type);
    return this;
  }

  get title(): string {
    return (
      this.strings(
        `${S}name`,
        `${NS.DCT}title`,
        `${NS.DC}title`,
        `${NS.FOAF}name`,
        `${NS.RDFS}label`,
      )[0] ?? "Untitled"
    );
  }
  set title(value: string) {
    this.writeString(`${S}name`, nonEmpty(value));
  }

  writeString(predicate: string, value: string | undefined): void {
    OptionalAs.object(this, predicate, value, LiteralFrom.string);
  }

  writeIri(predicate: string, value: string | undefined): void {
    OptionalAs.object(
      this,
      predicate,
      value === undefined ? undefined : httpIri(value),
      NamedNodeFrom.string,
    );
  }

  /** Clear aliases only for the field explicitly being edited. */
  clear(predicate: string): void {
    for (const alias of readPredicates(predicate)) {
      SetFrom.subjectPredicate(this, alias, TermAs.is, TermFrom.instance).clear();
    }
  }
}
