// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import type { Term } from "@jeswr/fetch-rdf";
import { isSafeAbsoluteIri, readLiteral } from "@jeswr/model-runtime";
import { RequiredAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { digestBytes } from "../../core/canonical.js";
import { assertJsonBounds, BoundsError } from "../../core/limits.js";
import { isIsoInstant } from "../../core/schema.js";
import type { Json } from "../../core/types.js";
import { AWP } from "../../profile/vocabulary.js";
import { decodeSnapshotEntry } from "../../wire/store-quads.js";
import { CoreNode, type Field, registerModel } from "../core-node.js";
import { IndexedStore } from "../indexed-store.js";
import { NamedValueNode, readValue, scopedId, writeValue, XSD } from "../named-values.js";
import { STORE_LIMITS } from "./record.js";

export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const SEC = "https://w3id.org/security#";
const RDF_JSON = "http://www.w3.org/1999/02/22-rdf-syntax-ns#JSON";

export function hasUnpairedSurrogate(value: string): boolean {
  return /[\ud800-\udfff]/u.test(value);
}

function jsonLiteral(value: Json) {
  return DataFactory.literal(JSON.stringify(value), DataFactory.namedNode(RDF_JSON));
}

export function storeText(value: string) {
  return hasUnpairedSurrogate(value) ? jsonLiteral(value) : DataFactory.literal(value);
}

export function readStoreText(term: Term): string {
  if (term.termType === "Literal" && !term.language) {
    if (term.datatype.value === XSD + "string") return term.value;
    if (term.datatype.value === RDF_JSON) {
      const value = decodeSnapshotEntry(term.value);
      if (typeof value === "string") return value;
    }
  }
  throw new TypeError("Expected a store string");
}

export function storeIdentifier(value: string) {
  return isSafeAbsoluteIri(value) && !hasUnpairedSurrogate(value)
    ? DataFactory.namedNode(value)
    : storeText(value);
}

export function storeInstant(value: unknown, lexical: boolean) {
  if (typeof value !== "string") throw new TypeError("Expected a date-time string");
  const term = DataFactory.literal(value, DataFactory.namedNode(XSD + "dateTime"));
  try {
    readLiteral(term);
    return term;
  } catch (error) {
    if (!lexical || !isIsoInstant(value)) throw error;
    return storeText(value);
  }
}

function containsUnpairedSurrogate(value: Json): boolean {
  if (typeof value === "string") return hasUnpairedSurrogate(value);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) => hasUnpairedSurrogate(key) || containsUnpairedSurrogate(child),
  );
}

function needsJsonLiteral(value: Json): boolean {
  try {
    assertJsonBounds(value, STORE_LIMITS);
  } catch (error) {
    if (!(error instanceof BoundsError)) throw error;
    return true;
  }
  return containsUnpairedSurrogate(value);
}

export interface StoreField extends Field {
  readonly digest?: string;
  readonly lexical?: boolean;
  /** Keep the protocol's named-value layout when no lexical escape is needed. */
  readonly protocolOpen?: boolean;
}

type Fields = Readonly<Record<string, StoreField>>;
const specifications = new Map<string, Fields>();
export function field(kind: Field["kind"], term: string, optional = false): StoreField {
  return { kind, term: term.includes(":") ? term : AWP + term, optional };
}
export function instant(term: string, optional = false): StoreField {
  return { ...field("time", term, optional), lexical: true };
}
export function exact(term: string, digest: string, optional = false): StoreField {
  return { ...field("text", term, optional), digest: AWP + digest };
}
export function link(kind: "node" | "nodes", term: string, model: string, optional = false): Field {
  return { ...field(kind, term, optional), model };
}
export function enumeration(
  term: string,
  namespace: string,
  values: readonly string[],
  optional = false,
): Field {
  return { ...field("enum", term, optional), prefix: AWP + namespace + "/", values };
}

export function storeModel(name: string, fields: Fields, className = name): void {
  specifications.set(name, fields);
  registerModel(
    name,
    { type: className.includes(":") ? className : AWP + className, fields },
    class extends StoreNode {
      constructor(term: string | Term, dataset: Store) {
        super(term, dataset, name);
      }
    },
  );
}

function putStoredDigests(value: Json, id: string, dataset: Store): void {
  if (value === null || typeof value !== "object") return;
  const owner = Array.isArray(value) ? undefined : value;
  for (const [position, [name, item]] of Object.entries(value).entries()) {
    const exact =
      name === "jws" ||
      name === "jsonld" ||
      name === "delegation" ||
      (name === "bytes" &&
        typeof owner?.digest === "string" &&
        typeof owner.byteLength === "number") ||
      (name === "payload" && owner?.format === "awp-unsigned-json/0.1");
    if (!(typeof item === "string" && exact) && !(item !== null && typeof item === "object"))
      continue;
    const entry = scopedId(id, "entry:" + position);
    if (typeof item === "string") {
      new NamedValueNode(entry, dataset).domainValue = DataFactory.literal(item);
      new StoreNode(entry, dataset, "StateEntry").put(
        AWP + "storedBytesDigest",
        DataFactory.literal(digestBytes(item)),
      );
    } else {
      putStoredDigests(item, scopedId(entry, "value"), dataset);
    }
  }
}

export class StoreNode<T = unknown> extends CoreNode<T> {
  constructor(
    term: string | Term,
    dataset: Store,
    readonly modelName: string,
  ) {
    super(term, dataset);
  }

  term(predicate: string): Term | undefined {
    return this.one(predicate);
  }

  terms(predicate: string): Term[] {
    return this.objects(predicate);
  }

  put(predicate: string, term: Term): void {
    RequiredAs.object(this, predicate, term, TermFrom.itself);
  }

  add(predicate: string, iri: string): void {
    if (!isSafeAbsoluteIri(iri)) throw new TypeError("Expected a named store link");
    this.dataset.addQuad(
      this as never,
      DataFactory.namedNode(predicate),
      DataFactory.namedNode(iri),
    );
  }

  putValue(predicate: string, value: Json): void {
    // These are local, previously admitted values. Use a compact literal when
    // the bounded named-value projection cannot represent the original JSON.
    if (needsJsonLiteral(value)) {
      this.put(predicate, jsonLiteral(value));
      return;
    }
    const id = scopedId(this.id, predicate);
    this.put(predicate, writeValue(value, id, this.dataset, STORE_LIMITS));
    putStoredDigests(value, id, this.dataset);
  }

  valueAt(predicate: string, ownerId = this.id): Json | undefined {
    const term = this.one(predicate);
    if (term?.termType === "Literal" && term.datatype.value === RDF_JSON && !term.language)
      return decodeSnapshotEntry(term.value) as Json;
    return term === undefined
      ? undefined
      : readValue(term, this.dataset, scopedId(ownerId, predicate));
  }

  override setField(name: string, value: unknown): void {
    const descriptor = specifications.get(this.modelName)?.[name];
    if (value !== undefined && descriptor) {
      if (descriptor.kind === "strings") {
        if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
          throw new TypeError("Expected an ordered list of strings");
        this.putValue(descriptor.term, value as string[]);
        return;
      }
      if (descriptor.kind === "open" || descriptor.kind === "value") {
        if (
          descriptor.kind === "open" &&
          (!value || typeof value !== "object" || Array.isArray(value))
        )
          throw new TypeError("Expected an open object");
        if (descriptor.protocolOpen && !containsUnpairedSurrogate(value as Json)) {
          super.setField(name, value);
          return;
        }
        this.putValue(descriptor.term, value as Json);
        return;
      }
      if (descriptor.kind === "time") {
        this.put(descriptor.term, storeInstant(value, descriptor.lexical === true));
        return;
      }
      if (descriptor.kind === "iri" && descriptor.lexical) {
        if (typeof value !== "string") throw new TypeError("Expected a store identifier");
        this.put(descriptor.term, storeIdentifier(value));
        return;
      }
      if (descriptor.digest) {
        if (typeof value !== "string") throw new TypeError("Expected exact bytes as a string");
        this.put(descriptor.digest, DataFactory.literal(digestBytes(value)));
      }
      if (descriptor.kind === "text" && typeof value === "string") {
        this.put(descriptor.term, storeText(value));
        return;
      }
    }
    super.setField(name, value);
  }

  override getField(name: string): unknown {
    const descriptor = specifications.get(this.modelName)?.[name];
    if (
      descriptor?.kind === "strings" ||
      descriptor?.kind === "open" ||
      descriptor?.kind === "value"
    ) {
      if (descriptor.protocolOpen) {
        const term = this.term(descriptor.term);
        if (term?.termType !== "Literal" || term.datatype.value !== RDF_JSON) {
          if (term && (term.termType !== "NamedNode" || term.value !== scopedId(this.id, name)))
            throw new TypeError("Invalid scoped named value");
          return super.getField(name);
        }
      }
      const value = this.valueAt(descriptor.term);
      if (value === undefined && descriptor.optional) return undefined;
      if (value === undefined) throw new TypeError(`Missing ${this.modelName}.${name}`);
      if (
        descriptor.kind === "strings" &&
        (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
      )
        throw new TypeError("Expected an ordered list of strings");
      if (
        descriptor.kind === "open" &&
        (!value || typeof value !== "object" || Array.isArray(value))
      )
        throw new TypeError("Expected an open object");
      return value;
    }
    const term =
      descriptor?.kind === "text" || descriptor?.lexical ? this.term(descriptor.term) : undefined;
    const fallback =
      term?.termType === "Literal" &&
      (descriptor?.kind === "text" ||
        (descriptor?.lexical &&
          (descriptor.kind === "iri" ||
            (descriptor.kind === "time" && term.datatype.value !== XSD + "dateTime"))));
    const value = fallback ? readStoreText(term) : super.getField(name);
    if (fallback && descriptor?.kind === "time" && !isIsoInstant(value as string))
      throw new TypeError("Invalid store timestamp");
    if (
      descriptor?.digest &&
      value !== undefined &&
      (typeof value !== "string" || this.text(descriptor.digest) !== digestBytes(value))
    )
      throw new TypeError("Stored byte digest mismatch");
    return value;
  }

  read(): T {
    if (!this.types.has(this.spec.type)) throw new TypeError(`Expected ${this.spec.type}`);
    return this.toObject();
  }
}

export function inGraph(source: Store, graph: string): IndexedStore {
  const name = DataFactory.namedNode(graph);
  return new IndexedStore(
    [...source].map(({ subject, predicate, object }) =>
      DataFactory.quad(subject, predicate, object, name),
    ),
  );
}

export function graphContents(source: Store, graph: string): Store {
  return new Store(
    source
      .getQuads(null, null, null, DataFactory.namedNode(graph))
      .map(({ subject, predicate, object }) => DataFactory.quad(subject, predicate, object)),
  );
}

export function assertSameGraph(actual: Store, expected: Store): void {
  if (actual.size !== expected.size || [...expected].some((quad) => !actual.has(quad)))
    throw new TypeError("Unexpected or inconsistent store RDF");
}
