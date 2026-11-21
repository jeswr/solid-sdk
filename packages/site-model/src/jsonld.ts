// AUTHORED-BY Claude Opus 5.5
/**
 * A synchronous reader for the compact JSON-LD subset planners emit for action requests:
 *
 * - `@context`: the schema.org context URL (http or https, with or without a trailing slash;
 *   treated offline as `{"@vocab": "https://schema.org/"}`), inline objects with `@vocab`,
 *   `@base`, `@language`, `@version` and term definitions (an IRI string, or an object with
 *   `@id` and an optional `@type` of `@id`, `@vocab` or a datatype IRI), arrays and null;
 * - node objects with `@id`, `@type`, nested `@context`, properties, nested node objects,
 *   arrays, and value objects with `@value` plus `@type` or `@language`;
 * - a top-level array or `@graph`.
 *
 * Anything else (remote contexts, `@list`, `@reverse`, `@included`, containers, ...) throws a
 * SiteModelError rather than being silently dropped: a dropped constraint on an action could
 * widen what the executor does. Full JSON-LD needs the asynchronous parseRdf of
 * @jeswr/fetch-rdf.
 */
import type { BlankNode, NamedNode, Quad, Quad_Object, Quad_Subject } from "@rdfjs/types";
import { DataFactory } from "n3";
import { SiteModelError } from "./errors.js";
import { SCHEMA } from "./types.js";
import { RDF_TYPE, XSD } from "./vocab.js";

const { namedNode, blankNode, literal, quad } = DataFactory;

const SCHEMA_CONTEXTS = new Set([
  "https://schema.org",
  "https://schema.org/",
  "http://schema.org",
  "http://schema.org/",
]);
const MAX_DEPTH = 64;
const MAX_QUADS = 100_000;
const ABSOLUTE_IRI = /^[A-Za-z][A-Za-z0-9+.-]*:/;

interface TermDefinition {
  id: string;
  type?: string;
}

interface Context {
  vocab?: string;
  base?: string;
  language?: string;
  terms: Map<string, TermDefinition>;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function fail(message: string): never {
  throw new SiteModelError(`unsupported JSON-LD: ${message}`);
}

function isObject(value: Json): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class Reader {
  readonly quads: Quad[] = [];
  private blanks = 0;
  private readonly labels = new Map<string, BlankNode>();

  constructor(private readonly documentBase: string | undefined) {}

  context(ctx: Context, value: Json): Context {
    if (value === null)
      return { terms: new Map(), ...(this.documentBase ? { base: this.documentBase } : {}) };
    if (Array.isArray(value))
      return value.reduce<Context>((acc, item) => this.context(acc, item), ctx);
    if (typeof value === "string") {
      if (!SCHEMA_CONTEXTS.has(value)) fail(`remote context <${value}> (only schema.org is known)`);
      return { ...ctx, terms: new Map(ctx.terms), vocab: SCHEMA };
    }
    if (!isObject(value)) fail("a context must be a string, an object, an array or null");
    const next: Context = { ...ctx, terms: new Map(ctx.terms) };
    for (const [key, def] of Object.entries(value)) {
      if (key === "@vocab") {
        if (def === null) delete next.vocab;
        else if (typeof def === "string") next.vocab = this.iri(next, def, true);
        else fail("@vocab must be a string");
      } else if (key === "@base") {
        if (def === null) delete next.base;
        else if (typeof def === "string") next.base = this.iri(next, def, false);
        else fail("@base must be a string");
      } else if (key === "@language") {
        if (def === null) delete next.language;
        else if (typeof def === "string") next.language = def;
        else fail("@language must be a string");
      } else if (key === "@version") {
        if (def !== 1.1) fail("@version must be 1.1");
      } else if (key.startsWith("@")) {
        fail(`context keyword ${key}`);
      } else if (def === null) {
        next.terms.delete(key);
      } else if (typeof def === "string") {
        next.terms.set(key, { id: this.iri(next, def, true) });
      } else if (isObject(def)) {
        const term: TermDefinition = { id: "" };
        for (const [k, v] of Object.entries(def)) {
          if (k === "@id" && typeof v === "string") term.id = this.iri(next, v, true);
          else if (k === "@type" && typeof v === "string")
            term.type = v === "@id" || v === "@vocab" ? v : this.iri(next, v, true);
          else fail(`term definition key ${k} for "${key}"`);
        }
        if (term.id === "") term.id = this.iri(next, key, true);
        next.terms.set(key, term);
      } else {
        fail(`term definition for "${key}"`);
      }
    }
    return next;
  }

  /** Expand a (vocab-relative or document-relative) IRI; `_:` labels return as-is. */
  iri(ctx: Context, value: string, vocabRelative: boolean): string {
    if (value.startsWith("_:")) return value;
    if (vocabRelative) {
      const term = ctx.terms.get(value);
      if (term) return term.id;
    }
    const colon = value.indexOf(":");
    if (colon > 0) {
      const prefix = ctx.terms.get(value.slice(0, colon));
      const suffix = value.slice(colon + 1);
      if (prefix && !suffix.startsWith("//")) return prefix.id + suffix;
    }
    if (ABSOLUTE_IRI.test(value)) return value;
    if (vocabRelative && ctx.vocab !== undefined) return ctx.vocab + value;
    if (!vocabRelative && ctx.base !== undefined) return new URL(value, ctx.base).href;
    return fail(`cannot expand "${value}" without ${vocabRelative ? "@vocab" : "a base IRI"}`);
  }

  node(ctx: Context, value: { [key: string]: Json }, depth: number): Quad_Subject {
    if (depth > MAX_DEPTH) fail("nesting is too deep");
    const local = value["@context"] === undefined ? ctx : this.context(ctx, value["@context"]);
    const id = value["@id"];
    if (id !== undefined && typeof id !== "string") fail("@id must be a string");
    const subject = id === undefined ? this.fresh() : this.ref(this.iri(local, id, false));
    for (const [key, raw] of Object.entries(value)) {
      if (key === "@context" || key === "@id") continue;
      if (key === "@type") {
        for (const type of Array.isArray(raw) ? raw : [raw]) {
          if (typeof type !== "string") fail("@type values must be strings");
          this.add(subject, namedNode(RDF_TYPE), this.ref(this.iri(local, type, true)));
        }
        continue;
      }
      if (key.startsWith("@")) fail(`keyword ${key}`);
      const predicate = this.iri(local, key, true);
      if (predicate.startsWith("_:")) fail(`property "${key}" expands to a blank node`);
      const definition = local.terms.get(key);
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        const object = this.value(local, item, definition, depth + 1);
        if (object !== undefined) this.add(subject, namedNode(predicate), object);
      }
    }
    return subject;
  }

  private value(
    ctx: Context,
    item: Json,
    definition: TermDefinition | undefined,
    depth: number,
  ): Quad_Object | undefined {
    if (item === null) return undefined;
    if (Array.isArray(item)) fail("nested arrays (lists) are not supported");
    if (isObject(item)) {
      if (!("@value" in item)) return this.node(ctx, item, depth);
      return this.valueObject(ctx, item);
    }
    const type = definition?.type;
    if (typeof item === "string") {
      if (type === "@id") return this.ref(this.iri(ctx, item, false));
      if (type === "@vocab") return this.ref(this.iri(ctx, item, true));
      if (type !== undefined) return literal(item, namedNode(type));
      return ctx.language === undefined ? literal(item) : literal(item, ctx.language);
    }
    if (type !== undefined && type !== "@id" && type !== "@vocab") {
      return literal(String(item), namedNode(type));
    }
    if (typeof item === "boolean") return literal(String(item), namedNode(`${XSD}boolean`));
    return literal(
      String(item),
      namedNode(Number.isInteger(item) ? `${XSD}integer` : `${XSD}double`),
    );
  }

  private valueObject(ctx: Context, item: { [key: string]: Json }): Quad_Object {
    const raw = item["@value"] as Json;
    if (raw === null || isObject(raw) || Array.isArray(raw)) fail("@value must be a scalar");
    for (const key of Object.keys(item)) {
      if (!["@value", "@type", "@language"].includes(key)) fail(`value object key ${key}`);
    }
    const type = item["@type"];
    const language = item["@language"];
    if (type !== undefined && language !== undefined) fail("@type and @language together");
    if (typeof language === "string") return literal(String(raw), language);
    if (typeof type === "string") return literal(String(raw), namedNode(this.iri(ctx, type, true)));
    if (type !== undefined || language !== undefined) fail("@type and @language must be strings");
    return this.value(ctx, raw, undefined, 0) as Quad_Object;
  }

  private fresh(): BlankNode {
    this.blanks += 1;
    return blankNode(`j${this.blanks}`);
  }

  private ref(iri: string): NamedNode | BlankNode {
    if (!iri.startsWith("_:")) return namedNode(iri);
    let node = this.labels.get(iri);
    if (node === undefined) {
      node = blankNode(`l${this.labels.size}`);
      this.labels.set(iri, node);
    }
    return node;
  }

  private add(subject: Quad_Subject, predicate: NamedNode, object: Quad_Object): void {
    if (this.quads.length >= MAX_QUADS) fail("too many statements");
    this.quads.push(quad(subject, predicate, object));
  }
}

/** Convert a JSON-LD document in the supported subset to quads (default graph only). */
export function jsonLdToQuads(text: string, options: { baseIRI?: string } = {}): Quad[] {
  let document: Json;
  try {
    document = JSON.parse(text) as Json;
  } catch (cause) {
    throw new SiteModelError("the JSON-LD document is not valid JSON", { cause });
  }
  const reader = new Reader(options.baseIRI);
  const root: Context = {
    terms: new Map(),
    ...(options.baseIRI === undefined ? {} : { base: options.baseIRI }),
  };
  const top = (ctx: Context, value: Json): void => {
    if (Array.isArray(value)) {
      for (const item of value) top(ctx, item);
      return;
    }
    if (!isObject(value)) fail("top-level values must be node objects");
    const keys = Object.keys(value);
    if ("@graph" in value && keys.every((key) => key === "@graph" || key === "@context")) {
      const local = value["@context"] === undefined ? ctx : reader.context(ctx, value["@context"]);
      top(local, value["@graph"] ?? null);
      return;
    }
    if ("@graph" in value) fail("@graph alongside node properties (named graphs)");
    reader.node(ctx, value, 0);
  };
  top(root, document);
  return reader.quads;
}
