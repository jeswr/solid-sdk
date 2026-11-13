// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Turns a labelled endpoint candidate into a contract Operation: parameters mapped onto property
// paths of the RDF action node, the request template, CSRF rules, extraction and provenance.

import {
  type Extraction,
  endpointItemType,
  type LearnMethod,
  type Operation,
  type Parameter,
} from "@jeswr/site-model";
import { learnedPagination } from "./pagination.js";
import type { CandidateParam, EndpointCandidate, Label } from "./types.js";
import { s, sab, singular, slug, xsd } from "./util.js";

const SEARCH_PARAM = /^(q|query|search|keyword|keywords|term|s|text)$/i;
const VAULT_PARAM = /^(user(name)?|email|login|pass(word)?|pwd)$/i;

function rangeFor(p: CandidateParam): string {
  switch (p.jsonType) {
    case "integer":
      return xsd("integer");
    case "number":
      return xsd("decimal");
    case "boolean":
      return xsd("boolean");
    default:
      break;
  }
  if (p.formType === "number" || p.formType === "range") return xsd("integer");
  if (
    p.examples.length &&
    p.examples.every((e) => /^-?\d+$/.test(e)) &&
    p.kind === undefined &&
    /qty|quantity|page|count|limit|size/i.test(p.name)
  ) {
    return xsd("integer");
  }
  return xsd("string");
}

/** Class of the thing a path id names, from the segment before it or the extraction's item type. */
function classForPathVar(c: EndpointCandidate, name: string, extraction?: Extraction): string {
  const segs = c.urlTemplate.replace(/\{[?&][^}]*\}$/, "").split("/");
  const i = segs.indexOf(`{${name}}`);
  const prev = i > 0 ? (segs[i - 1] ?? "") : "";
  const word = singular(prev.toLowerCase());
  if (/order/.test(word)) return s("Order");
  if (/product|item|sku|article/.test(word)) return s("Product");
  if (/review/.test(word)) return s("Review");
  if (/user|account|profile|person/.test(word)) return s("Person");
  return extraction?.itemType ?? s("Thing");
}

/** Map one candidate parameter onto the action node. */
export function toParameter(
  c: EndpointCandidate,
  p: CandidateParam,
  label: Label,
  extraction?: Extraction,
): Parameter {
  const base = {
    name: p.name,
    location: p.location,
  } as Pick<Parameter, "name" | "location">;
  let param: Parameter;
  const example = p.examples[0];
  if (
    label.actionType === sab("LoginAction") &&
    (VAULT_PARAM.test(
      decodeURIComponent(p.name)
        .replace(/^_+/, "")
        .split(/[[\].]/)
        .filter(Boolean)
        .at(-1) ?? "",
    ) ||
      p.formType === "password")
  ) {
    param = {
      ...base,
      path: [],
      range: xsd("string"),
      required: true,
      description: "Supplied by the credential vault, never by the planner.",
    };
  } else if (p.location === "path" && p.name === "forumName") {
    param = {
      ...base,
      path: [s("object"), s("isPartOf"), s("name")],
      range: xsd("string"),
      required: true,
    };
  } else if (p.location === "path" && p.kind !== "text" && /sku/i.test(p.name)) {
    param = { ...base, path: [s("object"), s("sku")], range: xsd("string"), required: true };
  } else if (p.location === "path" && /\/(?:id|identifier)\/\{/.test(c.urlTemplate)) {
    param = { ...base, path: [s("object"), s("identifier")], range: xsd("string"), required: true };
  } else if (p.location === "path" && c.params.filter((q) => q.location === "path").length > 1) {
    const numeric = c.params.filter((q) => q.location === "path" && q.kind === "numeric");
    const target = numeric.at(-1);
    param = {
      ...base,
      path:
        p === target
          ? [s("object"), s("identifier")]
          : numeric.includes(p)
            ? [s("about"), s("identifier")]
            : [sab(p.name)],
      range: xsd("string"),
      required: true,
    };
  } else if (p.location === "path") {
    param = {
      ...base,
      path: [s("object")],
      range: classForPathVar(c, p.name, extraction),
      required: true,
      description: "The object's identifier (last path segment of its IRI).",
    };
  } else if (
    SEARCH_PARAM.test(p.name) &&
    (p.location === "query" ||
      (p.location === "form" && (p.name !== "text" || label.actionType === s("SearchAction"))))
  ) {
    param = { ...base, path: [s("query")], range: xsd("string"), required: true };
  } else if (/^(title|body|text|forum)$/i.test(p.name) && c.method !== "GET") {
    const props: Record<string, string> = {
      title: "headline",
      body: "text",
      text: "text",
      forum: "isPartOf",
    };
    param = {
      ...base,
      path: p.name === "text" ? [s("text")] : [s("object"), s(props[p.name] ?? p.name)],
      range: xsd("string"),
      required: p.required,
    };
  } else if (/^(name|price)$/i.test(p.name) && c.method !== "GET") {
    param = {
      ...base,
      path: [s("object"), s(p.name.toLowerCase())],
      range: xsd(p.name === "price" ? "decimal" : "string"),
      required: p.required,
    };
  } else if (/^sku$/i.test(p.name)) {
    param = { ...base, path: [s("object"), s("sku")], range: xsd("string"), required: true };
  } else if (/^(id|product_?id|item_?id)$/i.test(p.name)) {
    param = { ...base, path: [s("object"), s("identifier")], range: xsd("string"), required: true };
  } else if (/^(qty|quantity)$/i.test(p.name)) {
    param = {
      ...base,
      path:
        p.name === "quantity" &&
        c.bodyTemplate &&
        endpointItemType(c.urlTemplate)?.itemType === s("Product")
          ? [s("object"), s("inventoryLevel")]
          : [sab("quantity")],
      range: xsd("integer"),
      required: c.bodyTemplate && p.name === "quantity" ? p.required : false,
      ...(c.bodyTemplate && p.name === "quantity" ? {} : { default: example ?? "1" }),
    };
  } else if (/^page$/i.test(p.name)) {
    param = {
      ...base,
      path: [sab("page")],
      range: xsd("integer"),
      required: false,
      ...(example !== undefined ? { default: example } : {}),
    };
  } else {
    // Extra query parameters (filters, limits) stay optional: RFC 6570 drops them when unset.
    const required = p.location !== "query" && p.required && !p.hidden;
    param = { ...base, path: [sab(p.name)], range: rangeFor(p), required };
  }
  if (
    extraction?.format === "json" &&
    extraction.itemPath !== undefined &&
    p.location === "query" &&
    !SEARCH_PARAM.test(p.name)
  ) {
    const decoded = decodeURIComponent(p.name);
    if (example !== undefined) param.default = example;
    if (/page.?size|limit|per.?page/i.test(decoded) && /^\d+$/.test(example ?? ""))
      param.default = String(Math.min(Number(example), 25));
    if (/page.?size|limit|per.?page/i.test(decoded))
      param.description = "Rows per page, at most 25.";
  }
  const pagination = learnedPagination(c, p, extraction);
  if (pagination) param.description = pagination;
  if (example !== undefined && example !== "[redacted]" && param.path.length)
    param.example = example;
  if (p.options?.length) {
    param.options = p.options;
    const dflt = p.selected ?? p.options[0];
    if (dflt !== undefined && param.default === undefined) param.default = dflt;
    param.required = false;
  }
  if (
    ["checkbox", "radio"].includes(p.formType ?? "") &&
    example !== undefined &&
    param.default === undefined
  ) {
    param.default = example;
    param.required = false;
  }
  if (p.hidden && p.examples[0] !== undefined && param.default === undefined) {
    param.default = p.examples[0];
    param.required = false;
  }
  return param;
}

export interface OperationContext {
  modelId: string;
  learnedAt: string;
  derivedFrom: string[];
  method: LearnMethod;
  usedIds: Set<string>;
  extraction?: Extraction;
  sessionCookies: string[];
}

export function operationId(modelId: string, label: string, used: Set<string>): string {
  const base = `${modelId}#${slug(label)}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

/** Build an Operation for a labelled candidate. */
export function buildOperation(
  c: EndpointCandidate,
  label: Label,
  ctx: OperationContext,
): Operation {
  const csrfTargets = new Set(
    c.csrf.filter((r) => r.target.kind !== "header").map((r) => r.target.name),
  );
  const inputs = c.params
    .filter((p) => !csrfTargets.has(p.name))
    .map((p) => toParameter(c, p, label, ctx.extraction));
  const signedIn = c.samples.some((s) => s.cookieNames.some((n) => ctx.sessionCookies.includes(n)));
  const op: Operation = {
    id: operationId(ctx.modelId, label.label, ctx.usedIds),
    actionType: label.actionType,
    label: label.label,
    inputs,
    request: { method: c.method, urlTemplate: c.urlTemplate },
    session: signedIn ? "signed-in" : "none",
    effect: label.effect,
    provenance: {
      derivedFrom: ctx.derivedFrom,
      learnedAt: ctx.learnedAt,
      method: ctx.method,
      confidence: Math.round(label.confidence * 100) / 100,
    },
  };
  if (label.description) op.description = label.description;
  if (c.method !== "GET" && c.contentType) op.request.contentType = c.contentType;
  if (c.method !== "GET" && c.bodyTemplate) op.request.bodyTemplate = c.bodyTemplate;
  if (Object.keys(c.headers).length) op.request.headers = { ...c.headers };
  if (c.csrf.length) op.csrf = c.csrf;
  if (ctx.extraction) op.extraction = ctx.extraction;
  return op;
}
