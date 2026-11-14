// AUTHORED-BY Codex GPT-6
/** Complete wrappers for classes rejected by closed generator admission. No cached objects. */
import type { Term } from "@jeswr/fetch-rdf";
import { RequiredAs, TermAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory, type Store } from "n3";
import { digestOf } from "../core/canonical.js";
import type { Json, JsonObject } from "../core/types.js";
import { AWP } from "../profile/vocabulary.js";
import { IndexedStore } from "./indexed-store.js";
import { NamedValuesNode, readValue, SCHEMA, scopedId, writeValue, XSD } from "./named-values.js";
import { RdfNode } from "./nodes.js";

export interface Field {
  readonly term: string;
  readonly kind:
    | "iri"
    | "text"
    | "time"
    | "integer"
    | "boolean"
    | "open"
    | "value"
    | "strings"
    | "node"
    | "nodes"
    | "enum"
    | "id"
    | "constant";
  readonly optional?: boolean;
  readonly model?: string;
  readonly prefix?: string;
  readonly values?: readonly string[];
  readonly constant?: string;
}
export interface ModelSpec {
  readonly type: string;
  readonly fields: Readonly<Record<string, Field>>;
}
export type ViewConstructor<T = unknown> = new (term: string | Term, dataset: Store) => CoreNode<T>;
const models = new Map<string, { spec: ModelSpec; View: ViewConstructor }>();
export function registerModel(name: string, spec: ModelSpec, View: ViewConstructor): void {
  models.set(name, { spec, View });
}
export function modelSpec(name: string): ModelSpec {
  const model = models.get(name);
  if (!model) throw new TypeError(`Unknown core model ${name}`);
  return model.spec;
}
export function makeNode<T>(
  name: string,
  object: T,
  id?: string,
  dataset: Store = new IndexedStore(),
): CoreNode<T> {
  const model = models.get(name);
  if (!model) throw new TypeError(`Unknown core model ${name}`);
  const source = object as Record<string, unknown>;
  const ownId = Object.entries(model.spec.fields).find(([, field]) => field.kind === "id")?.[0];
  const root = ownId
    ? (source[ownId] as string)
    : (id ?? scopedId("urn:awp:" + name, digestOf(object)));
  const node = new model.View(root, dataset) as CoreNode<T>;
  node.types.add(model.spec.type);
  node.writeObject(object);
  return node;
}

export abstract class CoreNode<T> extends RdfNode {
  abstract readonly modelName: string;
  protected get spec(): ModelSpec {
    return modelSpec(this.modelName);
  }
  /** A live protocol-field facade over this wrapper, never a fromNode snapshot.
   * Enumeration and JSON serialization are explicit projections at host/store boundaries.
   */
  get live(): T {
    const fields = Object.keys(this.spec.fields);
    return new Proxy(this, {
      ownKeys: () => fields.filter((key) => this.getField(key) !== undefined),
      getOwnPropertyDescriptor: (_target, key) =>
        typeof key === "string" && fields.includes(key) && this.getField(key) !== undefined
          ? { enumerable: true, configurable: true }
          : undefined,
      has: (_target, key) =>
        typeof key === "string" && fields.includes(key) && this.getField(key) !== undefined,
      get: (_target, key) => {
        if (key === "toJSON") return undefined;
        if (typeof key === "string" && fields.includes(key)) {
          const value = this.getField(key);
          return value instanceof CoreNode
            ? value.live
            : value instanceof NamedValuesNode
              ? value.live
              : Array.isArray(value)
                ? value.map((item) => (item instanceof CoreNode ? item.live : item))
                : value;
        }
        const value = Reflect.get(this, key, this);
        return typeof value === "function" ? value.bind(this) : value;
      },
      set: (_target, key, value) => {
        if (typeof key !== "string" || !fields.includes(key))
          throw new TypeError("Unknown model field");
        this.setField(key, value);
        return true;
      },
    }) as unknown as T;
  }
  getField(name: string): unknown {
    const field = Object.hasOwn(this.spec.fields, name) ? this.spec.fields[name] : undefined;
    if (!field) throw new TypeError(`Unknown ${this.modelName} field ${name}`);
    if (field.kind === "id") return this.id;
    if (field.kind === "constant") return field.constant;
    if (field.kind === "nodes") {
      const nodes = this.objects(field.term).map((t) => this.view(this.linkModel(field), t));
      nodes.sort((a, b) => a.position - b.position);
      for (let i = 0; i < nodes.length; i++)
        if (nodes[i]?.position !== i) throw new TypeError("Invalid collection position");
      return nodes.length || this.present(field.term) ? nodes : undefined;
    }
    if (field.kind === "strings") {
      const terms = this.objects(field.term);
      if (terms.length && terms.every((term) => term.termType === "Literal")) {
        if (terms.some((term) => term.datatype.value !== XSD + "string" || term.language))
          throw new TypeError("Expected string list");
        return terms.map((term) => term.value);
      }
    }
    const term = this.one(field.term);
    if (!term) {
      if (field.optional) return undefined;
      throw new TypeError(`Missing ${this.modelName}.${name}`);
    }
    switch (field.kind) {
      case "node":
        return this.view(this.linkModel(field), term);
      case "open":
        return new NamedValuesNode(term, this.dataset);
      case "value":
        return readValue(term, this.dataset);
      case "strings": {
        if (term.termType === "Literal") return this.objects(field.term).map((t) => t.value);
        const value = new NamedValuesNode(term, this.dataset).toValue();
        if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
          throw new TypeError("Expected string list");
        return value;
      }
      case "iri":
        return this.iri(field.term);
      case "enum": {
        const iri = this.iri(field.term);
        const value = iri?.startsWith(field.prefix!) ? iri.slice(field.prefix!.length) : undefined;
        if (value === undefined || !field.values?.includes(value))
          throw new TypeError(`Unknown ${name}`);
        return value;
      }
      case "text":
        return this.text(field.term);
      case "time":
        return this.timeLexical(field.term);
      case "integer": {
        const value = Number(this.text(field.term, XSD + "integer"));
        if (!Number.isSafeInteger(value)) throw new TypeError("Expected safe integer");
        return value;
      }
      case "boolean": {
        const value = this.text(field.term, XSD + "boolean");
        if (!["true", "false", "1", "0"].includes(value!)) throw new TypeError("Expected boolean");
        return value === "true" || value === "1";
      }
    }
  }
  setField(name: string, value: unknown): void {
    const field = Object.hasOwn(this.spec.fields, name) ? this.spec.fields[name] : undefined;
    if (!field) throw new TypeError(`Unknown ${this.modelName} field ${name}`);
    if (field.kind === "id") {
      if (value !== this.id) throw new TypeError("A node's identity cannot be changed");
      return;
    }
    if (field.kind === "constant") {
      if (value !== field.constant) throw new TypeError("Invalid model discriminator");
      return;
    }
    if (value === undefined) {
      if (!field.optional) throw new TypeError(`Missing ${name}`);
      this.dataset.deleteMatches(
        this as never,
        DataFactory.namedNode(field.term),
        undefined,
        undefined,
      );
      this.dataset.removeQuad(
        DataFactory.quad(
          this as never,
          DataFactory.namedNode(AWP + "presentFields"),
          DataFactory.namedNode(field.term),
        ),
      );
      return;
    }
    if (field.kind === "nodes") {
      if (!Array.isArray(value)) throw new TypeError("Expected node collection");
      this.dataset.deleteMatches(
        this as never,
        DataFactory.namedNode(field.term),
        undefined,
        undefined,
      );
      this.markPresent(field.term);
      // Materialise real signed evidence before unsigned presentations, regardless
      // of their list position. Positions still preserve the exact original order.
      const items = [...value.entries()];
      if (field.model === "EvidenceItem")
        items.sort(
          ([, a], [, b]) =>
            Number(/^[[{]/.test(String(a.value))) - Number(/^[[{]/.test(String(b.value))),
        );
      for (const [i, item] of items) {
        const node =
          item instanceof CoreNode
            ? item
            : makeNode(
                this.linkModel(field),
                item,
                scopedId(this.id, name + ":" + i),
                this.dataset,
              );
        this.sameDataset(node);
        node.position = i;
        this.dataset.addQuad(this as never, DataFactory.namedNode(field.term), node as never);
      }
      return;
    }
    let term: Term;
    if (field.kind === "node") {
      const node =
        value instanceof CoreNode
          ? value
          : makeNode(this.linkModel(field), value, scopedId(this.id, name), this.dataset);
      this.sameDataset(node);
      term = TermAs.term(node);
    } else if (field.kind === "open") {
      const node =
        value instanceof NamedValuesNode
          ? value
          : NamedValuesNode.from(value as JsonObject, scopedId(this.id, name), this.dataset);
      this.sameDataset(node);
      if (!node.isObject) throw new TypeError("Expected named object values");
      term = TermAs.term(node);
    } else if (field.kind === "value" || field.kind === "strings") {
      term =
        field.kind === "value" && typeof value === "string"
          ? DataFactory.literal(value)
          : writeValue(value as Json, scopedId(this.id, name), this.dataset);
    } else if (field.kind === "iri") {
      this.setIri(field.term, value as string);
      return;
    } else if (field.kind === "enum") {
      if (!field.values?.includes(value as string)) throw new TypeError(`Unknown ${name}`);
      this.setIri(field.term, field.prefix + String(value));
      return;
    } else {
      const type =
        field.kind === "time" ? "dateTime" : field.kind === "text" ? "string" : field.kind;
      if (field.kind === "integer" && !Number.isSafeInteger(value))
        throw new TypeError("Expected safe integer");
      if (field.kind === "boolean" && typeof value !== "boolean")
        throw new TypeError("Expected boolean");
      if ((field.kind === "text" || field.kind === "time") && typeof value !== "string")
        throw new TypeError("Expected string");
      term = DataFactory.literal(String(value), DataFactory.namedNode(XSD + type));
    }
    RequiredAs.object(this, field.term, term, TermFrom.itself);
  }
  private linkModel(field: Field): string {
    if (field.model !== "$body") return field.model!;
    const kind = this.getField("kind") as string;
    return kind[0]!.toUpperCase() + kind.slice(1) + "Body";
  }
  private sameDataset(node: RdfNode): void {
    if (node.dataset !== this.dataset)
      throw new TypeError("Linked nodes must belong to the same dataset");
  }
  private view(name: string, term: Term): CoreNode<unknown> {
    if (term.termType !== "NamedNode" && term.termType !== "BlankNode")
      throw new TypeError("Expected linked node");
    const model = models.get(name);
    if (!model) throw new TypeError(`Unknown model ${name}`);
    return new model.View(term, this.dataset);
  }
  private present(term: string): boolean {
    return this.objects(AWP + "presentFields").some((t) => t.value === term);
  }
  private markPresent(term: string): void {
    this.dataset.addQuad(
      this as never,
      DataFactory.namedNode(AWP + "presentFields"),
      DataFactory.namedNode(term),
    );
  }
  get position(): number {
    const value = this.text(SCHEMA + "position", XSD + "integer");
    return value === undefined ? 0 : Number(value);
  }
  set position(value: number) {
    RequiredAs.object(this, SCHEMA + "position", String(value), (v) =>
      DataFactory.literal(v, DataFactory.namedNode(XSD + "integer")),
    );
  }
  writeObject(object: T): void {
    const source = object as Record<string, unknown>;
    for (const key of Object.keys(source))
      if (!Object.hasOwn(this.spec.fields, key))
        throw new TypeError(`Unknown ${this.modelName}.${key}`);
    for (const name of Object.keys(this.spec.fields)) this.setField(name, source[name]);
  }
  toObject(): T {
    const output: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(this.spec.fields)) {
      const value = this.getField(name);
      if (value === undefined && field.optional) continue;
      output[name] =
        value instanceof CoreNode
          ? value.toObject()
          : value instanceof NamedValuesNode
            ? value.toObject()
            : Array.isArray(value)
              ? value.map((item) => (item instanceof CoreNode ? item.toObject() : item))
              : value;
    }
    return output as T;
  }
}
