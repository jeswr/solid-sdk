// AUTHORED-BY Claude Opus 5.5
// Lifting an HTTP response into RDF with an Extraction rule. Third-party free text
// (FieldRule.untrusted) is never emitted as a plain literal: it becomes
// `[ a sab:UntrustedText ; rdf:value "..." ]`, so the planner can tell site data
// written by strangers (reviews, descriptions) apart from facts.

import type { Extraction, FieldRule } from "@jeswr/site-model";
import { SAB, SCHEMA } from "@jeswr/site-model";
import type { AnyNode, Element } from "domhandler";
import { DataFactory, type Quad_Object, Writer } from "n3";
import { attribute, elementText, jsonPointer, parseHtml, selectElements } from "./dom.js";
import { expandIri, RDF, XSD } from "./values.js";

const { namedNode, literal, blankNode } = DataFactory;

export class ExtractionError extends Error {
  override name = "ExtractionError";
}

/** One extracted item, kept structured so flow steps can bind `$stepN.<property>`. */
export interface ExtractedItem {
  /** IRI of the item, when the extraction names one. */
  iri?: string;
  values: Map<string, string[]>;
}

interface RawValue {
  lexical: string;
  /** Inferred datatype for JSON numbers/booleans when the rule names none. */
  inferred?: string;
}

export interface ExtractOptions {
  /** Absolute URL the response came from (base for relative IRIs). */
  baseUrl: string;
  /** Replace secrets in emitted text. */
  redact: (text: string) => string;
  maxItems?: number;
  maxValueLength?: number;
}

export interface ExtractOutput {
  items: ExtractedItem[];
  turtle: string;
}

export const PREFIXES = { schema: SCHEMA, sab: SAB, rdf: RDF, xsd: XSD } as const;

function jsonRaw(value: unknown): RawValue[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((v) => (Array.isArray(v) ? [] : jsonRaw(v)));
  if (typeof value === "string") return [{ lexical: value }];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return [];
    return [
      {
        lexical: String(value),
        inferred: Number.isInteger(value) ? `${XSD}integer` : `${XSD}decimal`,
      },
    ];
  }
  if (typeof value === "boolean") return [{ lexical: String(value), inferred: `${XSD}boolean` }];
  return [];
}

const SELF_SELECTORS = new Set(["", ".", ":scope"]);

function htmlRaw(item: AnyNode, rule: FieldRule): RawValue[] {
  const els: AnyNode[] = SELF_SELECTORS.has(rule.path.trim())
    ? [item]
    : selectElements(rule.path, item);
  const out: RawValue[] = [];
  for (const el of els) {
    const v = rule.attribute ? attribute(el as Element, rule.attribute) : elementText(el);
    if (v !== undefined && v.trim() !== "") out.push({ lexical: rule.attribute ? v.trim() : v });
  }
  return out;
}

function resolveIri(value: string, base: string): string | undefined {
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function findIdRule(extraction: Extraction): FieldRule | undefined {
  if (!extraction.idField) return undefined;
  const wanted = expandIri(extraction.idField);
  return (
    extraction.fields.find((f) => expandIri(f.property) === wanted) ??
    extraction.fields.find((f) => f.path === extraction.idField)
  );
}

/** Items of a response as (rule -> raw values) lookups. */
function rawItems(
  extraction: Extraction,
  body: string,
): { read: (rule: FieldRule) => RawValue[] }[] {
  if (extraction.format === "json") {
    let doc: unknown;
    try {
      doc = JSON.parse(body);
    } catch {
      throw new ExtractionError("response is not valid JSON");
    }
    const root = extraction.itemPath ? jsonPointer(doc, extraction.itemPath) : doc;
    if (root === undefined) return [];
    const items = Array.isArray(root) ? root : [root];
    return items.map((item) => ({
      read: (rule: FieldRule) => {
        try {
          return jsonRaw(jsonPointer(item, rule.path));
        } catch {
          return [];
        }
      },
    }));
  }
  const doc = parseHtml(body);
  const items: AnyNode[] = extraction.itemPath ? selectElements(extraction.itemPath, doc) : [doc];
  return items.map((item) => ({ read: (rule: FieldRule) => htmlRaw(item, rule) }));
}

function writeTurtle(writer: Writer): Promise<string> {
  return new Promise((resolve, reject) => {
    writer.end((error, result) => (error ? reject(error) : resolve(result)));
  });
}

/** Turtle for an empty graph (prefixes only), used for operations without an Extraction. */
export function emptyTurtle(): Promise<string> {
  return writeTurtle(new Writer({ prefixes: { ...PREFIXES } }));
}

export async function extract(
  extraction: Extraction,
  body: string,
  options: ExtractOptions,
): Promise<ExtractOutput> {
  const maxItems = options.maxItems ?? 200;
  const maxLen = options.maxValueLength ?? 4000;
  const cap = (s: string) => (s.length > maxLen ? `${s.slice(0, maxLen)}…` : s);
  const redact = (s: string) => options.redact(cap(s));
  const writer = new Writer({ prefixes: { ...PREFIXES } });
  const idRule = findIdRule(extraction);
  const itemType = namedNode(expandIri(extraction.itemType));
  const items: ExtractedItem[] = [];
  const raws = rawItems(extraction, body).slice(0, maxItems);
  raws.forEach((raw, index) => {
    const item: ExtractedItem = { values: new Map() };
    let subject: ReturnType<typeof namedNode> | ReturnType<typeof blankNode> = blankNode(
      `item${index}`,
    );
    if (idRule) {
      const idValue = raw.read(idRule)[0];
      const iri = idValue ? resolveIri(idValue.lexical, options.baseUrl) : undefined;
      if (iri !== undefined && options.redact(iri) === iri) {
        item.iri = iri;
        subject = namedNode(iri);
      }
    }
    writer.addQuad(subject, namedNode(`${RDF}type`), itemType);
    for (const rule of extraction.fields) {
      const property = expandIri(rule.property);
      const values = raw.read(rule);
      if (values.length === 0) continue;
      const list = item.values.get(property) ?? [];
      for (const v of values) {
        list.push(v.lexical);
        let object: Quad_Object;
        if (rule.datatype === "iri") {
          const iri = resolveIri(v.lexical, options.baseUrl);
          if (iri === undefined) continue;
          object = options.redact(iri) === iri ? namedNode(iri) : literal(redact(iri));
        } else {
          const datatype = rule.datatype ?? v.inferred;
          const text = redact(v.lexical);
          object =
            datatype && !rule.untrusted
              ? literal(text, namedNode(expandIri(datatype)))
              : literal(text);
        }
        if (rule.untrusted && object.termType === "Literal") {
          writer.addQuad(
            subject,
            namedNode(property),
            writer.blank([
              { predicate: namedNode(`${RDF}type`), object: namedNode(`${SAB}UntrustedText`) },
              { predicate: namedNode(`${RDF}value`), object },
            ]),
          );
        } else {
          writer.addQuad(subject, namedNode(property), object);
        }
      }
      item.values.set(property, list);
    }
    items.push(item);
  });
  return { items, turtle: await writeTurtle(writer) };
}
