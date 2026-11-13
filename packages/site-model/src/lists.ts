// AUTHORED-BY Claude Opus 5.5
/**
 * The two parameter properties the generator cannot project (see README "Generator gaps"):
 * sab:valuePath (a predicate IRI, or an RDF list of predicate IRIs, as in a SHACL sequence
 * path) and sab:option (an RDF list of strings). Read and written through @rdfjs/wrapper.
 */
import type { DataFactory, DatasetCore, Term } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { SiteModelError } from "./errors.js";
import { RDF_NIL, SAB_OPTION, SAB_VALUE_PATH } from "./vocab.js";

/** A parameter node viewed through its list-valued properties. */
export class ParameterLists extends TermWrapper {
  constructor(term: string | Term, dataset: DatasetCore, factory: DataFactory) {
    super(term as Term, dataset, factory);
  }

  /** The value path: [] when absent, [iri] for a predicate, the members of a list otherwise. */
  get valuePath(): string[] {
    const object = this.single(SAB_VALUE_PATH);
    if (object === undefined) return [];
    if (object.termType === "NamedNode" && object.value !== RDF_NIL) return [object.value];
    return this.list(SAB_VALUE_PATH, NamedNodeAs.string, NamedNodeFrom.string, "value path");
  }

  set valuePath(path: string[]) {
    if (path.length === 0) OptionalAs.object(this, SAB_VALUE_PATH, undefined, NamedNodeFrom.string);
    else if (path.length === 1)
      OptionalAs.object(this, SAB_VALUE_PATH, path[0], NamedNodeFrom.string);
    else this.writeList(SAB_VALUE_PATH, path, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** The allowed values, or undefined when the parameter has none. */
  get options(): string[] | undefined {
    if (this.single(SAB_OPTION) === undefined) return undefined;
    return this.list(SAB_OPTION, LiteralAs.string, LiteralFrom.string, "options");
  }

  set options(options: string[] | undefined) {
    if (options === undefined) OptionalAs.object(this, SAB_OPTION, undefined, LiteralFrom.string);
    else this.writeList(SAB_OPTION, options, LiteralAs.string, LiteralFrom.string);
  }

  private single(predicate: string): Term | undefined {
    const objects = [...this.dataset.match(this as Term, this.factory.namedNode(predicate))];
    if (objects.length > 1) {
      throw new SiteModelError(`<${this.value}> has ${objects.length} values for <${predicate}>`);
    }
    return objects[0]?.object;
  }

  private list(
    predicate: string,
    as: (term: TermWrapper) => string,
    from: (value: string, factory: DataFactory) => Term,
    what: string,
  ): string[] {
    try {
      const list = OptionalFrom.subjectPredicate(
        this,
        predicate,
        TermAs.list(this, predicate, as, from),
      );
      return [...(list ?? [])];
    } catch (cause) {
      throw new SiteModelError(`<${this.value}> has a malformed ${what} list`, { cause });
    }
  }

  private writeList(
    predicate: string,
    values: string[],
    as: (term: TermWrapper) => string,
    from: (value: string, factory: DataFactory) => Term,
  ): void {
    OptionalAs.object(this, predicate, this.factory.namedNode(RDF_NIL), TermFrom.itself);
    const list = OptionalFrom.subjectPredicate(
      this,
      predicate,
      TermAs.list(this, predicate, as, from),
    );
    list?.push(...values);
  }
}
