// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// Compiling one operation plus resolved parameter values into a concrete HTTP
// request: URL template expansion, JSON / form bodies, static headers. Values are
// inserted structurally (URL encoding, JSON values, form fields), never spliced
// into raw text, and the final URL passes the origin guard.

import { createHash } from "node:crypto";
import type { CsrfRule, Operation, Parameter } from "@jeswr/site-model";
import { canonicalJson } from "./gate.js";
import { guardUrl } from "./origin.js";
import {
  encodeValue,
  expandTemplate,
  parseTemplate,
  templateVariables,
  UriTemplateError,
} from "./uri-template.js";
import { BindingError, canonicalValue, jsonValue, validateValue } from "./values.js";

export type CompiledBody =
  | { kind: "json"; value: unknown }
  | { kind: "form"; fields: [string, string][] }
  | { kind: "multipart"; fields: [string, string][] };

export interface CompiledRequest {
  operation: string;
  method: Operation["request"]["method"];
  url: URL;
  /** Lower-cased header names. Never credentials: the session layer adds those at send time. */
  headers: Record<string, string>;
  body?: CompiledBody;
  csrf: CsrfRule[];
  /** Local contract convention: an unbound whole path slot named by a query CSRF target. */
  pathTokens?: {
    template: string;
    values: Record<string, string>;
    origin: string;
    names: string[];
  };
}

/** Headers a site model may never set: credentials and transport framing belong to the executor. */
const FORBIDDEN_HEADERS = new Set([
  "cookie",
  "cookie2",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "origin",
  "referer",
]);

export function isForbiddenHeader(name: string): boolean {
  const n = name.toLowerCase();
  return FORBIDDEN_HEADERS.has(n) || n.startsWith("proxy-") || n.startsWith("sec-");
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: header values must not carry control characters
const HEADER_UNSAFE = /[\u0000-\u0008\u000a-\u001f\u007f]/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function checkHeaderValue(name: string, value: string): void {
  if (!HEADER_NAME.test(name)) throw new BindingError(`invalid header name "${name}"`);
  if (HEADER_UNSAFE.test(value))
    throw new BindingError(`header "${name}" value contains control characters`);
}

export interface CompileOptions {
  /** Parameter names whose value is a dry-run placeholder (skip type checks, keep as text). */
  placeholders?: ReadonlySet<string>;
}

const SENTINEL = "\u0000sab-var:";
const BARE_PLACEHOLDER = /^\{([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}/;
const WHOLE_PLACEHOLDER = /^\{([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}$/;
const INNER_PLACEHOLDER = /\{([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}/g;

/** Replace bare (unquoted) `{var}` placeholders with sentinel strings so the template parses as JSON. */
function protectBarePlaceholders(template: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < template.length; i++) {
    const ch = template.charAt(i);
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += template.charAt(i + 1);
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "{") {
      const m = BARE_PLACEHOLDER.exec(template.slice(i));
      if (m) {
        out += JSON.stringify(`${SENTINEL}${m[1]}`);
        i += m[0].length - 1;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

const DROP = Symbol("drop");

/** Fill a JSON body template. Whole-value placeholders keep JSON types; absent optional values drop the member. */
export function fillJsonTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
  params: ReadonlyMap<string, Parameter>,
  placeholders: ReadonlySet<string> = new Set(),
): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(protectBarePlaceholders(template));
  } catch {
    throw new BindingError("body template is not valid JSON");
  }
  const whole = (name: string): unknown => {
    const v = Object.hasOwn(values, name) ? values[name] : undefined;
    if (v === undefined) return DROP;
    return placeholders.has(name) ? v : jsonValue(params.get(name), v);
  };
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      if (node.startsWith(SENTINEL)) return whole(node.slice(SENTINEL.length));
      const m = WHOLE_PLACEHOLDER.exec(node);
      if (m) return whole(m[1] as string);
      return node.replace(INNER_PLACEHOLDER, (_all, name: string) =>
        Object.hasOwn(values, name) ? (values[name] as string) : "",
      );
    }
    if (Array.isArray(node)) return node.map(walk).filter((v) => v !== DROP);
    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        const w = walk(v);
        if (w !== DROP) out[k] = w;
      }
      return out;
    }
    return node;
  };
  const result = walk(parsed);
  return result === DROP ? null : result;
}

function fillFormTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): [string, string][] {
  const fields: [string, string][] = [];
  for (const [k, v] of new URLSearchParams(template)) {
    const m = WHOLE_PLACEHOLDER.exec(v);
    if (m) {
      const value = Object.hasOwn(values, m[1] as string) ? values[m[1] as string] : undefined;
      if (value !== undefined) fields.push([k, value]);
      continue;
    }
    fields.push([
      k,
      v.replace(INNER_PLACEHOLDER, (_all, name: string) =>
        Object.hasOwn(values, name) ? (values[name] as string) : "",
      ),
    ]);
  }
  return fields;
}

/** Append name=value to the query with RFC 6570 encoding, leaving the existing query untouched. */
function appendQuery(url: URL, name: string, value: string): void {
  const pair = `${encodeValue(name, false)}=${encodeValue(value, false)}`;
  url.search = url.search.length > 1 ? `${url.search}&${pair}` : `?${pair}`;
}

/** Expand an endpoint without allowing values to change its modeled route. */
export function endpointUrl(
  template: string,
  values: Readonly<Record<string, string>>,
  origin: string,
): URL {
  const expanded = expandTemplate(template, values);
  const url = guardUrl(expanded, origin);
  // Check values used before the template's query/fragment. A reserved expansion
  // may not inject route separators, and even encoded dot segments are refused.
  for (const part of parseTemplate(template)) {
    if (typeof part === "string") {
      if (/[?#]/.test(part)) break;
      continue;
    }
    if (["?", "&", "#"].includes(part.operator)) break;
    for (const spec of part.vars) {
      const value = values[spec.name];
      if (value === undefined) continue;
      let decoded =
        spec.prefix === undefined ? value : Array.from(value).slice(0, spec.prefix).join("");
      for (let i = 0; i < 32; i++) {
        const next = decoded.replace(/%([0-9a-f]{2})/gi, (_m, h: string) =>
          String.fromCharCode(Number.parseInt(h, 16)),
        );
        if (next === decoded) break;
        if (i === 31) throw new BindingError("endpoint parameter is excessively encoded");
        decoded = next;
      }
      if (decoded.split(/[\\/]/).some((segment) => segment === "." || segment === ".."))
        throw new BindingError("endpoint parameter contains a dot segment");
      if (part.operator === "+" && /[/?#\\]/.test(decoded))
        throw new BindingError("endpoint parameter changes the modeled route structure");
    }
  }
  const rawPath = /^(?:https?:\/\/[^/?#]+)?([^?#]*)/.exec(expanded)?.[1] || "/";
  if (rawPath !== url.pathname)
    throw new BindingError("URL normalization changes the modeled route");
  return url;
}

/** Compile an operation with resolved values. Throws BindingError / OriginError. */
export function compileOperation(
  operation: Operation,
  values: Readonly<Record<string, string>>,
  origin: string,
  options: CompileOptions = {},
): CompiledRequest {
  const placeholders = options.placeholders ?? new Set<string>();
  const params = new Map(operation.inputs.map((p) => [p.name, p]));
  const present: Record<string, string> = {};
  for (const param of operation.inputs) {
    const v = Object.hasOwn(values, param.name) ? values[param.name] : param.default;
    if (v === undefined) {
      if (param.required) throw new BindingError(`missing required value for "${param.name}"`);
      continue;
    }
    if (!placeholders.has(param.name)) validateValue(param, v);
    present[param.name] = placeholders.has(param.name) ? v : canonicalValue(param, v);
  }
  const { request } = operation;
  let templateVars: string[];
  try {
    templateVars = templateVariables(request.urlTemplate);
  } catch (e) {
    if (e instanceof UriTemplateError) throw new BindingError(`invalid URL template: ${e.message}`);
    throw e;
  }
  const pathTemplate = request.urlTemplate.split(/[?#]|\{[?&]/)[0] ?? "";
  const pathVariables = templateVariables(pathTemplate);
  const occurrences = parseTemplate(request.urlTemplate).flatMap((part) =>
    typeof part === "string" ? [] : part.vars.map((v) => v.name),
  );
  const pathTokenNames = (operation.csrf ?? [])
    .filter((r) => r.target.kind === "query" && pathVariables.includes(r.target.name))
    .map((r) => r.target.name);
  if (new Set(pathTokenNames).size !== pathTokenNames.length)
    throw new BindingError("duplicate path token target");
  const pending = { ...present };
  for (const name of pathTokenNames) {
    if (
      params.has(name) ||
      occurrences.filter((v) => v === name).length !== 1 ||
      pathTemplate.split("/").filter((segment) => segment === `{${name}}`).length !== 1
    )
      throw new BindingError("path token must occupy one unbound whole segment");
    pending[name] = `sab-pending-token-${name}`;
  }
  const url = endpointUrl(request.urlTemplate, pending, origin);
  for (const param of operation.inputs) {
    if (
      param.location === "query" &&
      !templateVars.includes(param.name) &&
      present[param.name] !== undefined
    ) {
      appendQuery(url, param.name, present[param.name] as string);
    }
  }
  // Defence in depth: the URL is re-checked after every change.
  guardUrl(url.href, origin);

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    if (isForbiddenHeader(name)) continue;
    checkHeaderValue(name, value);
    headers[name.toLowerCase()] = value;
  }
  for (const param of operation.inputs) {
    if (param.location !== "header" || present[param.name] === undefined) continue;
    if (isForbiddenHeader(param.name))
      throw new BindingError(`parameter "${param.name}" names a forbidden header`);
    checkHeaderValue(param.name, present[param.name] as string);
    headers[param.name.toLowerCase()] = present[param.name] as string;
  }

  const compiled: CompiledRequest = {
    operation: operation.id,
    method: request.method,
    url,
    headers,
    csrf: operation.csrf ?? [],
  };
  if (pathTokenNames.length)
    compiled.pathTokens = {
      template: request.urlTemplate,
      values: pending,
      origin,
      names: pathTokenNames,
    };
  if (request.method === "GET") return compiled;

  const bodyParams = operation.inputs.filter(
    (p) => (p.location === "body" || p.location === "form") && present[p.name] !== undefined,
  );
  const contentType =
    request.contentType ??
    (request.bodyTemplate !== undefined || bodyParams.some((p) => p.location === "body")
      ? "application/json"
      : bodyParams.length > 0
        ? "application/x-www-form-urlencoded"
        : undefined);
  if (contentType === "application/json") {
    const value =
      request.bodyTemplate !== undefined
        ? fillJsonTemplate(request.bodyTemplate, present, params, placeholders)
        : Object.fromEntries(
            bodyParams.map((p) => [
              p.name,
              placeholders.has(p.name) ? present[p.name] : jsonValue(p, present[p.name] as string),
            ]),
          );
    compiled.body = { kind: "json", value };
    compiled.headers["content-type"] = "application/json";
  } else if (
    contentType === "application/x-www-form-urlencoded" ||
    contentType === "multipart/form-data"
  ) {
    const fields =
      request.bodyTemplate !== undefined
        ? fillFormTemplate(request.bodyTemplate, present)
        : bodyParams.map((p): [string, string] => [
            decodeURIComponent(p.name),
            present[p.name] as string,
          ]);
    if (contentType === "multipart/form-data") {
      compiled.body = { kind: "multipart", fields };
      delete compiled.headers["content-type"]; // fetch sets the boundary
    } else {
      compiled.body = { kind: "form", fields };
      compiled.headers["content-type"] = "application/x-www-form-urlencoded";
    }
  }
  return compiled;
}

/** Apply one CSRF token to a compiled request (header, form field or query parameter). */
export function applyCsrfToken(compiled: CompiledRequest, rule: CsrfRule, token: string): void {
  const { target } = rule;
  if (target.kind === "header") {
    if (isForbiddenHeader(target.name))
      throw new BindingError(`CSRF target names a forbidden header`);
    checkHeaderValue(target.name, token);
    compiled.headers[target.name.toLowerCase()] = token;
  } else if (target.kind === "query") {
    const path = compiled.pathTokens;
    if (path?.names.includes(target.name)) {
      // Reject route separators even when nested percent-encoded; never let a token change routing.
      let decoded = token;
      for (let i = 0; i < 32; i++) {
        const next = decoded.replace(/%([0-9a-f]{2})/gi, (_m, h: string) =>
          String.fromCharCode(Number.parseInt(h, 16)),
        );
        if (next === decoded) break;
        if (i === 31) throw new BindingError("path token is excessively encoded");
        decoded = next;
      }
      if (/[\\/?#]/.test(decoded) || decoded === "." || decoded === "..")
        throw new BindingError("path token changes the modeled route");
      path.values[target.name] = token;
      const next = endpointUrl(path.template, path.values, path.origin);
      // Preserve query-token decoration already applied by other rules.
      compiled.url.pathname = next.pathname;
      guardUrl(compiled.url.href, path.origin);
    } else appendQuery(compiled.url, target.name, token);
  } else if (compiled.body?.kind === "json") {
    const value = compiled.body.value;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BindingError("CSRF form target needs a JSON object body");
    }
    (value as Record<string, unknown>)[target.name] = token;
  } else {
    if (!compiled.body) {
      compiled.body = { kind: "form", fields: [] };
      compiled.headers["content-type"] = "application/x-www-form-urlencoded";
    }
    const fields = compiled.body.fields.filter(([k]) => k !== target.name);
    fields.push([target.name, token]);
    compiled.body.fields = fields;
  }
}

/** Text form of a compiled body (dry runs and the send path). */
export function bodyText(body: CompiledBody | undefined): string | undefined {
  if (!body) return undefined;
  if (body.kind === "json") return JSON.stringify(body.value);
  return new URLSearchParams(body.fields).toString();
}

export function bodyInit(body: CompiledBody | undefined): string | FormData | undefined {
  if (!body) return undefined;
  if (body.kind === "multipart") {
    const form = new FormData();
    for (const [k, v] of body.fields) form.append(k, v);
    return form;
  }
  return bodyText(body);
}

/** The effective request before session/CSRF decoration; unused inputs never enter it. */
export function requestFingerprint(compiled: CompiledRequest): string {
  const url = new URL(compiled.url.href);
  url.hash = "";
  const query = [...url.searchParams].sort(([ak, av], [bk, bv]) =>
    ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0,
  );
  url.search = new URLSearchParams(query).toString();
  const body =
    compiled.body?.kind === "json"
      ? { kind: "json", value: compiled.body.value }
      : compiled.body
        ? {
            kind: compiled.body.kind,
            fields: [...compiled.body.fields].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
          }
        : undefined;
  return createHash("sha256")
    .update(canonicalJson({ method: compiled.method.toUpperCase(), url: url.href, body }))
    .digest("hex");
}
