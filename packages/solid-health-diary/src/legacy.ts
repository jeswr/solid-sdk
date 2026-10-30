// AUTHORED-BY Codex GPT-6.1-Sol

import {
  type ITermAsValueMapping,
  type ITermFromValueMapping,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
  type TermWrapper,
} from "@rdfjs/wrapper";
import { RDF_TYPE, vocabularyAliases } from "./vocab.js";

/** Read both spellings through the existing typed mappers; never rewrite pod data. */
export const AliasOptionalFrom = {
  subjectPredicate<T>(
    anchor: TermWrapper,
    predicate: string,
    mapper: ITermAsValueMapping<T>,
  ): T | undefined {
    for (const iri of vocabularyAliases(predicate)) {
      const value = OptionalFrom.subjectPredicate(anchor, iri, mapper);
      if (value !== undefined) return value;
    }
    return undefined;
  },
};

/** Replacing a scalar removes its legacy spelling and writes only the canonical one. */
export const AliasOptionalAs = {
  object<T>(
    anchor: TermWrapper,
    predicate: string,
    value: T | undefined,
    mapper: ITermFromValueMapping<T>,
  ): void {
    for (const iri of vocabularyAliases(predicate).slice(1)) {
      OptionalAs.object(anchor, iri, undefined, mapper);
    }
    OptionalAs.object(anchor, predicate, value, mapper);
  },
};

/** A live union of typed sets. Additions always go to the canonical predicate. */
class AliasSet<T> extends Set<T> {
  constructor(private readonly sets: Set<T>[]) {
    super();
  }
  private snapshot(): Set<T> {
    return new Set(this.sets.flatMap((set) => [...set]));
  }
  override get size(): number {
    return this.snapshot().size;
  }
  override has(value: T): boolean {
    return this.sets.some((set) => set.has(value));
  }
  override add(value: T): this {
    this.sets[0]?.add(value);
    return this;
  }
  override delete(value: T): boolean {
    let deleted = false;
    for (const set of this.sets) deleted = set.delete(value) || deleted;
    return deleted;
  }
  override clear(): void {
    for (const set of this.sets) set.clear();
  }
  override values(): SetIterator<T> {
    return this.snapshot().values();
  }
  override keys(): SetIterator<T> {
    return this.values();
  }
  override entries(): SetIterator<[T, T]> {
    return this.snapshot().entries();
  }
  override [Symbol.iterator](): SetIterator<T> {
    return this.values();
  }
  override forEach(callback: (value: T, key: T, set: Set<T>) => void, thisArg?: unknown): void {
    for (const value of this) callback.call(thisArg, value, value, this);
  }
}

export const AliasSetFrom = {
  subjectPredicate<T>(
    anchor: TermWrapper,
    predicate: string,
    termAs: ITermAsValueMapping<T>,
    termFrom: ITermFromValueMapping<T>,
  ): Set<T> {
    const sets = vocabularyAliases(predicate).map((iri) =>
      SetFrom.subjectPredicate(anchor, iri, termAs, termFrom),
    );
    return sets.length === 1 ? (sets[0] as Set<T>) : new AliasSet(sets);
  },
};

export function hasType(anchor: TermWrapper, type: string): boolean {
  const types = SetFrom.subjectPredicate(
    anchor,
    RDF_TYPE,
    NamedNodeAs.string,
    NamedNodeFrom.string,
  );
  return vocabularyAliases(type).some((iri) => types.has(iri));
}
