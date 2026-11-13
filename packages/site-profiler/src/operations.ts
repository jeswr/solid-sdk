// AUTHORED-BY Claude Opus 5.5
// Turns a labelled endpoint candidate into a contract Operation: parameters mapped onto property
// paths of the RDF action node, the request template, CSRF rules, extraction and provenance.

import type { Extraction, LearnMethod, Operation, Parameter } from "@jeswr/site-model";
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
  if (label.actionType === sab("LoginAction") && VAULT_PARAM.test(p.name)) {
    param = {
      ...base,
      path: [],
      range: xsd("string"),
      required: true,
      description: "Supplied by the credential vault, never by the planner.",
    };
  } else if (p.location === "path" && p.kind !== "text" && /sku/i.test(p.name)) {
    param = { ...base, path: [s("object"), s("sku")], range: xsd("string"), required: true };
  } else if (p.location === "path") {
    param = {
      ...base,
      path: [s("object")],
      range: classForPathVar(c, p.name, extraction),
      required: true,
      description: "The object's identifier (last path segment of its IRI).",
    };
  } else if (SEARCH_PARAM.test(p.name) && (p.location === "query" || p.location === "form")) {
    param = { ...base, path: [s("query")], range: xsd("string"), required: true };
  } else if (/^sku$/i.test(p.name)) {
    param = { ...base, path: [s("object"), s("sku")], range: xsd("string"), required: true };
  } else if (/^(id|product_?id|item_?id)$/i.test(p.name)) {
    param = { ...base, path: [s("object"), s("identifier")], range: xsd("string"), required: true };
  } else if (/^(qty|quantity)$/i.test(p.name)) {
    param = {
      ...base,
      path: [sab("quantity")],
      range: xsd("integer"),
      required: false,
      default: example ?? "1",
    };
  } else if (/^page$/i.test(p.name)) {
    param = { ...base, path: [sab("page")], range: xsd("integer"), required: false, default: "1" };
  } else {
    param = { ...base, path: [sab(p.name)], range: rangeFor(p), required: p.required && !p.hidden };
  }
  if (example !== undefined && example !== "[redacted]" && param.path.length)
    param.example = example;
  if (p.options?.length) {
    param.options = p.options;
    const dflt = p.selected ?? p.options[0];
    if (dflt !== undefined && param.default === undefined) param.default = dflt;
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
