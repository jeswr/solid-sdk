// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// Bounded, structured extraction. Render only with the complete secret set;
// keep original lexical values so redaction always precedes truncation.
import type { Extraction, FieldRule } from "@jeswr/site-model";
import { endpointItemType, SAB, SCHEMA } from "@jeswr/site-model";
import type { AnyNode, Element } from "domhandler";
import { DataFactory, type Quad_Object, Writer } from "n3";
import { displayDateTime, displayDecimal } from "./display-values.js";
import { attribute, elementText, jsonPointer, parseHtml, selectElements } from "./dom.js";
import { expandIri, RDF, XSD } from "./values.js";

const { namedNode, literal, blankNode } = DataFactory;
export class ExtractionError extends Error {
  override name = "ExtractionError";
}
export interface ExtractedItem {
  iri?: string;
  values: Map<string, string[]>;
  /** RDF kinds survive response bindings, even into scalar write parameters. */
  terms?: Map<string, Quad_Object[]>;
}
interface RawValue {
  lexical: string;
  inferred?: string;
  display?: string;
  displayDatatype?: string;
}
export interface ExtractOptions {
  baseUrl: string;
  redact: (text: string) => string;
  maxItems?: number;
  maxValueLength?: number;
  maxValuesPerField?: number;
  maxTotalValues?: number;
  maxQuads?: number;
  maxOutputBytes?: number;
}
export interface ExtractOutput {
  items: ExtractedItem[];
  /** Observed root count, never inferred from page size. */
  total?: number;
  turtle: string;
  truncation: { items: boolean; values: boolean };
  /** Re-render retained structured values with newly discovered secrets. */
  render: (redact: (text: string) => string, suppressSamples?: boolean) => Promise<string>;
}
export const PREFIXES = { schema: SCHEMA, sab: SAB, rdf: RDF, xsd: XSD } as const;
/** JSON.parse's source context preserves decimal lexicals and exposes exponent spellings. */
class JsonNumber {
  constructor(readonly lexical: string) {}
}
function jsonRaw(value: unknown, max: number): RawValue[] {
  const out: RawValue[] = [];
  const add = (v: unknown): void => {
    if (v instanceof JsonNumber) {
      if (!Number.isFinite(Number(v.lexical))) return;
      if (out.length >= max) throw new ExtractionError("per-field value limit exceeded");
      out.push({
        lexical: v.lexical,
        inferred:
          XSD + (/e/i.test(v.lexical) ? "double" : v.lexical.includes(".") ? "decimal" : "integer"),
      });
      return;
    }
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return;
    if (typeof v === "number" && !Number.isFinite(v)) return;
    if (out.length >= max) throw new ExtractionError("per-field value limit exceeded");
    out.push({
      lexical: String(v),
      ...(typeof v === "number"
        ? { inferred: XSD + (Number.isInteger(v) ? "integer" : "decimal") }
        : typeof v === "boolean"
          ? { inferred: `${XSD}boolean` }
          : {}),
    });
  };
  if (Array.isArray(value)) {
    for (const v of value) add(v);
  } else add(value);
  return out;
}
const SELF = new Set(["", ".", ":scope"]);
function htmlRaw(item: AnyNode, rule: FieldRule, max: number): RawValue[] {
  const els = SELF.has(rule.path.trim()) ? [item] : selectElements(rule.path, item, max + 1);
  if (els.length > max) throw new ExtractionError("per-field value limit exceeded");
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
    return /^https?:$/.test(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function findIdRule(extraction: Extraction): FieldRule | undefined {
  if (!extraction.idField) return undefined;
  const wanted = expandIri(extraction.idField);
  const rule =
    extraction.fields.find((f) => expandIri(f.property) === wanted) ??
    extraction.fields.find((f) => f.path === extraction.idField);
  return rule?.untrusted ? undefined : rule;
}
function rawItems(
  extraction: Extraction,
  body: string,
  maxItems: number,
  maxField: number,
  truncation: ExtractOutput["truncation"],
  account: (rule: FieldRule | undefined, count: number) => void,
  onTotal: (value: unknown, count: number) => void,
): Map<FieldRule, RawValue[]>[] {
  let roots: unknown[];
  if (extraction.format === "json") {
    let doc: unknown;
    try {
      doc = JSON.parse(body, (_key, value: unknown, context?: { source?: string }) =>
        typeof value === "number" && context?.source ? new JsonNumber(context.source) : value,
      );
    } catch {
      throw new ExtractionError("response is not valid JSON");
    }
    const root = extraction.itemPath ? jsonPointer(doc, extraction.itemPath) : doc;
    if (extraction.totalPath !== undefined)
      onTotal(
        (() => {
          const value = jsonPointer(doc, extraction.totalPath as string);
          return value instanceof JsonNumber ? Number(value.lexical) : value;
        })(),
        Array.isArray(root) ? root.length : root === undefined ? 0 : 1,
      );
    truncation.items =
      truncation.items ||
      (Array.isArray(root) ? root.length > maxItems : root !== undefined && maxItems === 0);
    roots =
      root === undefined
        ? []
        : Array.isArray(root)
          ? root.slice(0, maxItems)
          : [root].slice(0, maxItems);
  } else {
    const doc = parseHtml(body);
    roots = extraction.itemPath ? selectElements(extraction.itemPath, doc, maxItems + 1) : [doc];
    if (extraction.totalPath !== undefined) {
      const totals = selectElements(extraction.totalPath, doc, 2);
      if (totals.length !== 1) throw new ExtractionError("total selector must match one value");
      const value = elementText(totals[0] as AnyNode).trim();
      onTotal(/^\d+$/.test(value) ? Number(value) : value, roots.length);
    }
    truncation.items = truncation.items || roots.length > maxItems;
    roots = roots.slice(0, maxItems);
  }
  return roots.map((item) => {
    account(undefined, 1);
    return new Map(
      extraction.fields.map((rule) => {
        let values: RawValue[];
        if (extraction.format === "html") values = htmlRaw(item as AnyNode, rule, maxField);
        else {
          let value: unknown;
          try {
            value = jsonPointer(item, rule.path);
          } catch {
            value = undefined;
          }
          values = jsonRaw(value, maxField);
        }
        account(rule, values.length);
        return [rule, values];
      }),
    );
  });
}
function writeTurtle(writer: Writer): Promise<string> {
  return new Promise((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}
export function emptyTurtle(): Promise<string> {
  return writeTurtle(new Writer({ prefixes: { ...PREFIXES } }));
}

export async function extract(
  extraction: Extraction,
  body: string,
  options: ExtractOptions,
): Promise<ExtractOutput> {
  const maxItems = options.maxItems ?? 200,
    maxLen = options.maxValueLength ?? 4000;
  const maxField = options.maxValuesPerField ?? 100,
    maxValues = options.maxTotalValues ?? 1000;
  const maxQuads = options.maxQuads ?? 3000,
    maxBytes = options.maxOutputBytes ?? 1024 * 1024;
  for (const limit of [maxItems, maxLen, maxField, maxValues, maxQuads, maxBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new ExtractionError("invalid extraction limit");
  }
  // Account while reading fields, rather than building all field arrays first.
  let valueCount = 0,
    quadCount = 0;
  const truncation = { items: false, values: false };
  let total: number | undefined;
  const retained = rawItems(
    extraction,
    body,
    maxItems,
    maxField,
    truncation,
    (rule, count) => {
      if (!rule) quadCount += count;
      else {
        valueCount += count;
        quadCount += count * (rule.untrusted ? 3 : 1);
      }
      if (valueCount > maxValues) throw new ExtractionError("total value limit exceeded");
      if (quadCount > maxQuads) throw new ExtractionError("quad limit exceeded");
    },
    (value, count) => {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < count || value < 0)
        throw new ExtractionError("invalid list total");
      total = value;
      if (value > count) truncation.items = true;
    },
  );
  const extraType =
    extraction.itemType === `${SCHEMA}Thing`
      ? endpointItemType(options.baseUrl)?.additionalType
      : undefined;
  quadCount +=
    (total === undefined ? 0 : 2 + (truncation.items ? 1 : 0)) + (extraType ? retained.length : 0);
  if (quadCount > maxQuads) throw new ExtractionError("quad limit exceeded");
  if (extraction.itemPath !== undefined)
    for (const raw of retained) {
      const currencies = new Set(
        [...raw]
          .filter(
            ([rule]) => !rule.untrusted && expandIri(rule.property) === `${SCHEMA}priceCurrency`,
          )
          .flatMap(([, values]) => values.map((v) => v.lexical))
          .filter((v) => /^[A-Z]{3}$/.test(v)),
      );
      for (const [rule, values] of raw) {
        if (rule.untrusted) continue;
        const property = expandIri(rule.property);
        for (const value of values) {
          if (options.redact(value.lexical) !== value.lexical) continue;
          if (
            currencies.size === 1 &&
            [`${SCHEMA}price`, `${SCHEMA}totalPrice`].includes(property)
          ) {
            const display = displayDecimal(value.lexical);
            if (display !== undefined) {
              value.display = display;
              value.displayDatatype = `${XSD}decimal`;
            }
          } else if (
            [`${SCHEMA}dateCreated`, `${SCHEMA}dateModified`, `${SCHEMA}datePublished`].includes(
              property,
            )
          ) {
            const display = displayDateTime(value.lexical);
            if (display !== undefined) {
              value.display = display;
              value.displayDatatype = `${XSD}dateTime`;
            }
          }
        }
      }
    }
  const idRule = findIdRule(extraction);
  for (const raw of retained)
    for (const values of raw.values())
      if (values.some((v) => v.lexical.length > maxLen)) truncation.values = true;
  const items = retained.map((raw) => {
    const item: ExtractedItem = { values: new Map(), terms: new Map() };
    const id = idRule ? raw.get(idRule)?.[0]?.lexical : undefined;
    const iri = id === undefined ? undefined : resolveIri(id, options.baseUrl);
    if (iri && options.redact(iri) === iri) item.iri = iri;
    for (const [rule, values] of raw) {
      // Untrusted prose is never a fact source for a subsequent operation.
      if (rule.untrusted || values.length === 0) continue;
      const prop = expandIri(rule.property);
      const terms = values.flatMap<Quad_Object>((v) => {
        if (rule.datatype === "iri") {
          const iri = resolveIri(v.lexical, options.baseUrl);
          return iri ? [namedNode(iri)] : [];
        }
        const lexical =
          v.displayDatatype === `${XSD}dateTime` ? (v.display ?? v.lexical) : v.lexical;
        const datatype =
          v.displayDatatype === `${XSD}dateTime`
            ? v.displayDatatype
            : (rule.datatype ?? v.inferred);
        return [datatype ? literal(lexical, namedNode(expandIri(datatype))) : literal(lexical)];
      });
      item.terms?.set(prop, [...(item.terms.get(prop) ?? []), ...terms]);
      item.values.set(prop, [...(item.values.get(prop) ?? []), ...terms.map((v) => v.value)]);
    }
    return item;
  });
  const render = async (
    redactor: (text: string) => string,
    suppressSamples = false,
  ): Promise<string> => {
    const redact = (value: string): string => {
      const s = redactor(value);
      if (s.length > maxLen) truncation.values = true;
      return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
    };
    // n3 writes incrementally into this bounded sink. Do not first allocate an
    // unbounded Turtle string and only then check its length.
    const chunks: string[] = [];
    let bytes = 0;
    let renderedQuads = 0;
    const writer = new Writer(
      {
        write(chunk: string, _encoding?: unknown, callback?: () => void) {
          bytes += Buffer.byteLength(chunk);
          if (bytes <= maxBytes) chunks.push(chunk);
          callback?.();
          return bytes <= maxBytes;
        },
        end(callback?: () => void) {
          callback?.();
        },
      },
      { prefixes: { ...PREFIXES } },
    );
    const addQuad = (
      subject: ReturnType<typeof namedNode> | ReturnType<typeof blankNode>,
      predicate: ReturnType<typeof namedNode>,
      object: Quad_Object,
    ): void => {
      if (++renderedQuads > maxQuads) throw new ExtractionError("quad limit exceeded");
      writer.addQuad(subject, predicate, object);
      if (bytes > maxBytes) throw new ExtractionError("output byte limit exceeded");
    };
    if (total !== undefined) {
      const list = blankNode("list");
      addQuad(list, namedNode(`${RDF}type`), namedNode(`${SCHEMA}ItemList`));
      if (redactor(String(total)) === String(total))
        addQuad(
          list,
          namedNode(`${SCHEMA}numberOfItems`),
          literal(String(total), namedNode(`${XSD}integer`)),
        );
      if (truncation.items)
        addQuad(list, namedNode(`${SAB}partial`), literal("true", namedNode(`${XSD}boolean`)));
    }
    retained.forEach((raw, index) => {
      const id = idRule ? raw.get(idRule)?.[0]?.lexical : undefined;
      const iri = id === undefined ? undefined : resolveIri(id, options.baseUrl);
      const subject = iri && redactor(iri) === iri ? namedNode(iri) : blankNode(`item${index}`);
      addQuad(subject, namedNode(`${RDF}type`), namedNode(expandIri(extraction.itemType)));
      if (extraType)
        addQuad(subject, namedNode(`${SCHEMA}additionalType`), literal(redact(extraType)));
      if (suppressSamples && [...raw].some(([rule, values]) => rule.untrusted && values.length))
        addQuad(
          subject,
          namedNode(`${SAB}samplesSuppressed`),
          literal("true", namedNode(`${XSD}boolean`)),
        );
      for (const [rule, values] of raw) {
        if (suppressSamples && rule.untrusted) continue;
        for (const v of values) {
          let object: Quad_Object;
          if (rule.untrusted) object = literal(redact(v.lexical));
          else if (rule.datatype === "iri") {
            const value = resolveIri(v.lexical, options.baseUrl);
            if (!value) continue;
            object =
              redactor(value) === value && value.length <= maxLen
                ? namedNode(value)
                : literal(redact(value));
          } else if (
            v.display !== undefined &&
            redactor(v.lexical) === v.lexical &&
            redactor(v.display) === v.display
          )
            object = literal(redact(v.display), namedNode(v.displayDatatype ?? `${XSD}string`));
          else if (v.display !== undefined) object = literal(redact(v.lexical));
          else
            object =
              rule.datatype || v.inferred
                ? literal(
                    redact(v.lexical),
                    namedNode(expandIri(rule.datatype ?? v.inferred ?? "")),
                  )
                : literal(redact(v.lexical));
          if (rule.untrusted) {
            const node = blankNode();
            addQuad(subject, namedNode(expandIri(rule.property)), node);
            addQuad(node, namedNode(`${RDF}type`), namedNode(`${SAB}UntrustedText`));
            addQuad(node, namedNode(`${RDF}value`), object);
          } else addQuad(subject, namedNode(expandIri(rule.property)), object);
        }
      }
    });
    await writeTurtle(writer);
    if (bytes > maxBytes) throw new ExtractionError("output byte limit exceeded");
    return chunks.join("");
  };
  return {
    items,
    turtle: await render(options.redact),
    truncation,
    render,
    ...(total === undefined ? {} : { total }),
  };
}
