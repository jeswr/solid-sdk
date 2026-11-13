// AUTHORED-BY Claude Opus 5.5
// Step 2: endpoint templates. Clusters recorded requests into endpoints, inferring path variables
// (numeric, uuid, sku-like, or ids seen in earlier responses), query parameters and body keys, and
// writes RFC 6570 templates on the site origin. Also turns forms and script calls into candidates
// and merges evidence for the same endpoint.

import type { CsrfRule, LearnMethod } from "@jeswr/site-model";
import { formCsrfRules, isCsrfFieldName } from "./forms.js";
import { descendants, parseHtml } from "./html.js";
import type {
  CandidateParam,
  EndpointCandidate,
  FormInfo,
  ParamKind,
  RecordedRequest,
  ScriptCall,
} from "./types.js";
import {
  isHtmlType,
  isJsonType,
  isStatic,
  singular,
  templateShape,
  tryJson,
  uniq,
  valueKind,
  varName,
} from "./util.js";

type Method = EndpointCandidate["method"];
const METHODS = new Set<Method>(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** Identifier values found in responses: JSON id/sku/slug keys and HTML data-*-id attributes. */
export function collectKnownIds(requests: RecordedRequest[]): Set<string> {
  const ids = new Set<string>();
  const visit = (v: unknown, key = "") => {
    if (Array.isArray(v)) for (const x of v) visit(x, key);
    else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) visit(x, k);
    } else if (
      (typeof v === "string" || typeof v === "number") &&
      /(^id$|Id$|_id$|^sku$|slug|^uuid$)/.test(key)
    ) {
      ids.add(String(v));
    }
  };
  for (const r of requests) {
    if (!r.bodySample) continue;
    if (isJsonType(r.contentType)) visit(tryJson(r.bodySample));
    else if (isHtmlType(r.contentType)) {
      for (const el of descendants(parseHtml(r.bodySample))) {
        for (const [name, value] of Object.entries(el.attribs)) {
          if (/^data-(?:.*-)?(?:id|sku|slug)$/.test(name) && value) ids.add(value);
        }
      }
    }
  }
  return ids;
}

function contentTypeOf(r: RecordedRequest): EndpointCandidate["contentType"] {
  const ct = r.requestHeaders["content-type"] ?? "";
  if (/json/i.test(ct)) return "application/json";
  if (/multipart\/form-data/i.test(ct)) return "multipart/form-data";
  if (/x-www-form-urlencoded/i.test(ct)) return "application/x-www-form-urlencoded";
  if (r.postData && tryJson(r.postData) !== undefined && /^\s*[{[]/.test(r.postData))
    return "application/json";
  if (r.postData) return "application/x-www-form-urlencoded";
  return undefined;
}

function jsonType(v: unknown): CandidateParam["jsonType"] {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "object") return "object";
  return "string";
}

/** The values a request supplies, by location. */
export function requestValues(r: RecordedRequest): {
  query: Array<[string, string]>;
  body: Array<[string, string, CandidateParam["jsonType"]]>;
  bodyLocation?: "body" | "form";
} {
  const url = new URL(r.url);
  const query = Array.from(url.searchParams.entries());
  const body: Array<[string, string, CandidateParam["jsonType"]]> = [];
  const ct = contentTypeOf(r);
  if (!r.postData) return { query, body };
  if (ct === "application/json") {
    const parsed = tryJson(r.postData);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        body.push([
          k,
          typeof v === "object" && v !== null ? JSON.stringify(v) : String(v),
          jsonType(v),
        ]);
      }
    }
    return { query, body, bodyLocation: "body" };
  }
  if (ct === "application/x-www-form-urlencoded") {
    for (const [k, v] of new URLSearchParams(r.postData)) body.push([k, v, "string"]);
    return { query, body, bodyLocation: "form" };
  }
  return { query, body };
}

const KEEP_HEADER = /^x-(?!csrf|xsrf)[a-z0-9-]+$/;

function staticHeaders(samples: RecordedRequest[]): Record<string, string> {
  const out: Record<string, string> = {};
  const first = samples[0];
  if (!first) return out;
  for (const [name, value] of Object.entries(first.requestHeaders)) {
    if (value === "[redacted]") continue;
    const keep = KEEP_HEADER.test(name) || (name === "accept" && /json/i.test(value));
    if (keep && samples.every((s) => s.requestHeaders[name] === value)) out[name] = value;
  }
  return out;
}

function csrfFromSamples(samples: RecordedRequest[]): CsrfRule[] {
  const rules: CsrfRule[] = [];
  for (const s of samples) {
    for (const [header, cookie] of Object.entries(s.headersFromCookies ?? {})) {
      if (
        !rules.some((r) => r.target.kind === "header" && r.target.name.toLowerCase() === header)
      ) {
        rules.push({
          source: { kind: "cookie", name: cookie },
          target: { kind: "header", name: header },
        });
      }
    }
  }
  return rules;
}

function nameVars(
  kinds: Array<{ index: number; kind: ParamKind; prev: string }>,
): Map<number, string> {
  const names = new Map<number, string>();
  const base = (k: ParamKind) => (k === "sku" ? "sku" : "id");
  const counts = new Map<string, number>();
  for (const k of kinds) counts.set(base(k.kind), (counts.get(base(k.kind)) ?? 0) + 1);
  for (const k of kinds) {
    const b = base(k.kind);
    let name = b;
    if ((counts.get(b) ?? 0) > 1 && k.prev) {
      const stem = singular(k.prev).replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) =>
        c ? c.toUpperCase() : "",
      );
      name = `${stem}${b === "sku" ? "Sku" : "Id"}`;
    }
    while ([...names.values()].includes(name)) name = `${name}_`;
    names.set(k.index, varName(name));
  }
  return names;
}

function strongestKind(values: string[], knownIds: ReadonlySet<string>): ParamKind {
  const kinds = values.map((v) => valueKind(v, knownIds));
  if (kinds.every((k) => k === "numeric")) return "numeric";
  if (kinds.every((k) => k === "uuid")) return "uuid";
  if (kinds.every((k) => k === "sku" || k === "numeric")) return "sku";
  return "known-id";
}

/** Cluster requests into endpoint candidates. Static assets, other origins and blocked requests are left out. */
export function clusterRequests(
  requests: RecordedRequest[],
  siteOrigin: string,
  knownIds: ReadonlySet<string> = new Set(),
): EndpointCandidate[] {
  const groups = new Map<string, RecordedRequest[]>();
  const segmentsOf = new Map<RecordedRequest, string[]>();
  for (const r of requests) {
    if (r.blocked || r.resourceType === "replay-anonymous") continue;
    const method = r.method.toUpperCase() as Method;
    if (!METHODS.has(method)) continue;
    let url: URL;
    try {
      url = new URL(r.url);
    } catch {
      continue;
    }
    if (url.origin !== siteOrigin || isStatic(r.url, r.resourceType)) continue;
    const segments = url.pathname.split("/").map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    });
    segmentsOf.set(r, segments);
    const shape = segments
      .map((seg, i) => (i > 0 && seg && valueKind(seg, knownIds) !== "text" ? "{}" : seg))
      .join("/");
    const key = `${method} ${shape}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const out: EndpointCandidate[] = [];
  for (const [key, samples] of groups) {
    const method = key.slice(0, key.indexOf(" ")) as Method;
    const first = samples[0] as RecordedRequest;
    const segs = segmentsOf.get(first) as string[];
    const varPositions: Array<{ index: number; kind: ParamKind; prev: string }> = [];
    segs.forEach((seg, i) => {
      if (i === 0 || !seg || valueKind(seg, knownIds) === "text") return;
      const values = samples.map((s) => segmentsOf.get(s)?.[i] ?? "");
      const prev =
        [...segs.slice(0, i)].reverse().find((x) => x && valueKind(x, knownIds) === "text") ?? "";
      varPositions.push({ index: i, kind: strongestKind(values, knownIds), prev });
    });
    const names = nameVars(varPositions);
    const params: CandidateParam[] = [];
    const path = segs
      .map((seg, i) => {
        const name = names.get(i);
        if (!name) return encodeURIComponent(seg).replace(/%40/g, "@");
        const pos = varPositions.find((v) => v.index === i);
        const p: CandidateParam = {
          name,
          location: "path",
          examples: uniq(samples.map((s) => segmentsOf.get(s)?.[i] ?? "")),
          required: true,
        };
        if (pos) p.kind = pos.kind;
        params.push(p);
        return `{${name}}`;
      })
      .join("/");

    // Query parameters: union across samples; required when every sample has it.
    const queryNames: string[] = [];
    const queryExamples = new Map<string, string[]>();
    const queryCount = new Map<string, number>();
    const bodyNames: string[] = [];
    const bodyExamples = new Map<string, string[]>();
    const bodyTypes = new Map<string, CandidateParam["jsonType"]>();
    const bodyCount = new Map<string, number>();
    let bodyLocation: "body" | "form" | undefined;
    for (const s of samples) {
      const v = requestValues(s);
      for (const [k, val] of uniqPairs(v.query)) {
        if (!queryNames.includes(k)) queryNames.push(k);
        queryExamples.set(k, uniq([...(queryExamples.get(k) ?? []), val]));
        queryCount.set(k, (queryCount.get(k) ?? 0) + 1);
      }
      bodyLocation = bodyLocation ?? v.bodyLocation;
      for (const [k, val, t] of v.body) {
        if (!bodyNames.includes(k)) bodyNames.push(k);
        bodyExamples.set(k, uniq([...(bodyExamples.get(k) ?? []), val]));
        if (!bodyTypes.has(k)) bodyTypes.set(k, t);
        bodyCount.set(k, (bodyCount.get(k) ?? 0) + 1);
      }
    }
    for (const k of queryNames) {
      params.push({
        name: varName(k),
        location: "query",
        examples: queryExamples.get(k) ?? [],
        required: queryCount.get(k) === samples.length,
      });
    }
    for (const k of bodyNames) {
      const p: CandidateParam = {
        name: varName(k),
        location: bodyLocation ?? "body",
        examples: bodyExamples.get(k) ?? [],
        required: bodyCount.get(k) === samples.length,
      };
      const t = bodyTypes.get(k);
      if (t) p.jsonType = t;
      params.push(p);
    }
    const queryVars = params.filter((p) => p.location === "query").map((p) => p.name);
    const urlTemplate = `${siteOrigin}${path}${queryVars.length ? `{?${queryVars.join(",")}}` : ""}`;
    const candidate: EndpointCandidate = {
      key: templateShape(method, urlTemplate),
      method,
      urlTemplate,
      params,
      headers: staticHeaders(samples),
      csrf: csrfFromSamples(samples),
      sources: uniq(samples.map((s) => phaseMethod(s))),
      samples,
      responseKind: responseKind(samples),
    };
    const ct = contentTypeOf(first);
    if (ct) candidate.contentType = ct;
    if (ct === "application/json" && bodyNames.length)
      candidate.bodyTemplate = bodyTemplateFor(first);
    const scheme = samples.find((s) => s.authScheme)?.authScheme;
    if (scheme) candidate.authScheme = scheme;
    out.push(candidate);
  }
  return out;
}

function uniqPairs(pairs: Array<[string, string]>): Array<[string, string]> {
  const seen = new Set<string>();
  return pairs.filter(([k]) => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function phaseMethod(r: RecordedRequest): LearnMethod {
  return r.phase === "demonstration"
    ? "demonstration"
    : r.phase === "probe"
      ? "js-analysis"
      : "crawl";
}

function responseKind(samples: RecordedRequest[]): EndpointCandidate["responseKind"] {
  const types = samples.map((s) => s.contentType).filter(Boolean);
  if (types.some((t) => isJsonType(t))) return "json";
  if (types.some((t) => isHtmlType(t))) return "html";
  return types.length ? "other" : "unknown";
}

/** A JSON body template: top-level values become "{name}" whole-value placeholders. */
export function bodyTemplateFor(r: RecordedRequest): string | undefined {
  const parsed = tryJson(r.postData);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const shaped: Record<string, string> = {};
  for (const k of Object.keys(parsed)) shaped[k] = `{${varName(k)}}`;
  return JSON.stringify(shaped);
}

function bodyTemplateFromKeys(keys: string[]): string {
  const shaped: Record<string, string> = {};
  for (const k of keys) shaped[k] = `{${varName(k)}}`;
  return JSON.stringify(shaped);
}

/** Convert a script call's URL pattern into an RFC 6570 template plus parameters. */
export function candidateFromScriptCall(call: ScriptCall): EndpointCandidate | undefined {
  const method = call.method.toUpperCase() as Method;
  if (!METHODS.has(method)) return undefined;
  const q = call.urlPattern.indexOf("?");
  const pathPart = q >= 0 ? call.urlPattern.slice(0, q) : call.urlPattern;
  const queryPart = q >= 0 ? call.urlPattern.slice(q + 1) : "";
  const params: CandidateParam[] = [];
  for (const m of pathPart.matchAll(/\{([^}]+)\}/g)) {
    const name = m[1] as string;
    params.push({
      name,
      location: "path",
      examples: [],
      required: true,
      kind: name === "sku" ? "sku" : "known-id",
    });
  }
  const literalQuery: string[] = [];
  const queryVars: string[] = [];
  for (const pair of queryPart.split("&").filter(Boolean)) {
    const [k = "", v = ""] = pair.split("=");
    if (/^\{[^}]+\}$/.test(v)) {
      queryVars.push(varName(k));
      params.push({ name: varName(k), location: "query", examples: [], required: true });
    } else literalQuery.push(pair);
  }
  const location = call.bodyKind === "form" || call.bodyKind === "multipart" ? "form" : "body";
  for (const k of call.bodyKeys)
    params.push({ name: varName(k), location, examples: [], required: true });
  const base = `${pathPart}${literalQuery.length ? `?${literalQuery.join("&")}` : ""}`;
  const urlTemplate = `${base}${queryVars.length ? `{${literalQuery.length ? "&" : "?"}${queryVars.join(",")}}` : ""}`;
  const candidate: EndpointCandidate = {
    key: templateShape(method, urlTemplate),
    method,
    urlTemplate,
    params,
    headers: Object.fromEntries(
      Object.entries(call.headers).filter(
        ([k]) => KEEP_HEADER.test(k.toLowerCase()) || /^accept$/i.test(k),
      ),
    ),
    csrf: call.csrf,
    sources: ["js-analysis"],
    samples: [],
    responseKind: "unknown",
    script: call,
  };
  if (call.bodyKind === "json") {
    candidate.contentType = "application/json";
    if (call.bodyKeys.length) candidate.bodyTemplate = bodyTemplateFromKeys(call.bodyKeys);
  } else if (call.bodyKind === "form") candidate.contentType = "application/x-www-form-urlencoded";
  else if (call.bodyKind === "multipart") candidate.contentType = "multipart/form-data";
  if (call.authScheme) candidate.authScheme = call.authScheme;
  return candidate;
}

/** A form as an endpoint candidate. `pageTemplate` is the URL template of the page holding the form. */
export function candidateFromForm(form: FormInfo, pageTemplate: string): EndpointCandidate {
  const action = new URL(form.action);
  const fixedQuery = form.method === "POST" ? action.search : "";
  const params: CandidateParam[] = form.fields
    .filter((f) => !(f.hidden && isCsrfFieldName(f.name)))
    .map((f) => {
      const p: CandidateParam = {
        name: varName(f.name),
        location: form.method === "GET" ? "query" : "form",
        examples: f.value ? [f.value] : [],
        required: f.required,
        formType: f.type,
      };
      if (f.options) p.options = f.options;
      if (f.selected !== undefined) p.selected = f.selected;
      if (f.hidden) p.hidden = true;
      return p;
    });
  const queryVars = form.method === "GET" ? params.map((p) => p.name) : [];
  const urlTemplate = `${action.origin}${action.pathname}${fixedQuery}${queryVars.length ? `{?${queryVars.join(",")}}` : ""}`;
  return {
    key: templateShape(form.method, urlTemplate),
    method: form.method,
    urlTemplate,
    params,
    contentType: form.method === "POST" ? form.enctype : undefined,
    headers: {},
    csrf: formCsrfRules(form, pageTemplate),
    sources: ["form"],
    samples: [],
    responseKind: "unknown",
    form,
  } as EndpointCandidate;
}

function mergeParams(into: CandidateParam[], from: CandidateParam[]): CandidateParam[] {
  const out = into.map((p) => ({ ...p }));
  const pathFrom = from.filter((p) => p.location === "path");
  const pathInto = out.filter((p) => p.location === "path");
  for (const p of from) {
    if (p.location === "path") continue;
    const existing = out.find((x) => x.name === p.name && x.location === p.location);
    if (existing) {
      existing.examples = uniq([...existing.examples, ...p.examples]);
      if (p.options) existing.options = p.options;
      if (p.selected !== undefined) existing.selected = p.selected;
      if (p.formType) existing.formType = p.formType;
      if (p.hidden) existing.hidden = true;
      if (p.jsonType && !existing.jsonType) existing.jsonType = p.jsonType;
    } else out.push({ ...p, required: false });
  }
  // Path variables pair up by position; the first candidate's names win.
  pathInto.forEach((p, i) => {
    const q = pathFrom[i];
    if (q) p.examples = uniq([...p.examples, ...q.examples]);
  });
  return out;
}

function mergeCsrf(a: CsrfRule[], b: CsrfRule[]): CsrfRule[] {
  const out = [...a];
  for (const r of b) {
    const dup = out.some(
      (x) =>
        x.target.kind === r.target.kind &&
        x.target.name.toLowerCase() === r.target.name.toLowerCase(),
    );
    if (!dup) out.push(r);
  }
  return out;
}

/**
 * Merge candidates that describe the same endpoint (same method and template shape). Recorded
 * evidence comes first so observed names win over guessed ones.
 */
export function mergeCandidates(candidates: EndpointCandidate[]): EndpointCandidate[] {
  const byKey = new Map<string, EndpointCandidate>();
  const rank = (c: EndpointCandidate) => (c.samples.length ? 0 : c.form ? 1 : 2);
  for (const c of [...candidates].sort((a, b) => rank(a) - rank(b))) {
    const existing = byKey.get(c.key);
    if (!existing) {
      byKey.set(c.key, { ...c, params: c.params.map((p) => ({ ...p })), sources: [...c.sources] });
      continue;
    }
    existing.params = mergeParams(existing.params, c.params);
    existing.sources = uniq([...existing.sources, ...c.sources]);
    existing.samples = [...existing.samples, ...c.samples];
    existing.csrf = mergeCsrf(existing.csrf, c.csrf);
    existing.headers = { ...c.headers, ...existing.headers };
    if (!existing.form && c.form) existing.form = c.form;
    if (!existing.script && c.script) existing.script = c.script;
    if (!existing.contentType && c.contentType) existing.contentType = c.contentType;
    if (!existing.bodyTemplate && c.bodyTemplate) existing.bodyTemplate = c.bodyTemplate;
    if (!existing.authScheme && c.authScheme) existing.authScheme = c.authScheme;
    if (existing.responseKind === "unknown") existing.responseKind = c.responseKind;
    // Query variables learned from other evidence join the template.
    const queryVars = existing.params.filter((p) => p.location === "query").map((p) => p.name);
    const base = existing.urlTemplate.replace(/\{\?[^}]*\}$/, "");
    if (!/\{&[^}]*\}$/.test(existing.urlTemplate)) {
      existing.urlTemplate = `${base}${queryVars.length ? `{?${queryVars.join(",")}}` : ""}`;
    }
  }
  return [...byKey.values()];
}

/** Values a request supplies for each of a candidate's parameters, or undefined when it does not match. */
export function matchRequest(
  candidate: EndpointCandidate,
  r: RecordedRequest,
): Record<string, string> | undefined {
  if (r.method.toUpperCase() !== candidate.method) return undefined;
  const pathTemplate = candidate.urlTemplate.replace(/\{[?&][^}]*\}$/, "").replace(/\?.*$/, "");
  const url = new URL(r.url);
  const tSegs = new URL(pathTemplate.replace(/\{([^}]+)\}/g, "%7B$1%7D")).pathname.split("/");
  const rSegs = url.pathname.split("/");
  if (
    tSegs.length !== rSegs.length ||
    new URL(pathTemplate.replace(/\{[^}]+\}/g, "x")).origin !== url.origin
  ) {
    return undefined;
  }
  const values: Record<string, string> = {};
  for (let i = 0; i < tSegs.length; i++) {
    const t = decodeURIComponent(tSegs[i] ?? "");
    const v = decodeURIComponent(rSegs[i] ?? "");
    const m = /^\{([^}]+)\}$/.exec(t);
    if (m?.[1]) values[m[1]] = v;
    else if (t !== v) return undefined;
  }
  const rv = requestValues(r);
  for (const [k, v] of rv.query) if (values[varName(k)] === undefined) values[varName(k)] = v;
  for (const [k, v] of rv.body) if (values[varName(k)] === undefined) values[varName(k)] = v;
  return values;
}

/** The URL template of the candidate that served a page, else the page URL itself. */
export function templateForPage(candidates: EndpointCandidate[], pageUrl: string): string {
  const stripped = pageUrl.replace(/[?#].*$/, "");
  for (const c of candidates) {
    if (c.method !== "GET") continue;
    if (c.samples.some((s) => s.url.replace(/[?#].*$/, "") === stripped)) {
      return c.urlTemplate.replace(/\{[?&][^}]*\}$/, "");
    }
  }
  return stripped;
}
