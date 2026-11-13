// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// Step 4: static script analysis. Parses same-origin JavaScript with acorn and finds the HTTP calls
// it would make (fetch, fetch wrappers, XMLHttpRequest, axios, jQuery) whose URL starts with a string
// literal. Records the method, a URL pattern, static headers, the body shape, and CSRF tokens copied
// from a cookie or a meta tag into a header. Nothing is executed.

import type { CsrfRule } from "@jeswr/site-model";
import { parse } from "acorn";
import type { RecordedRequest, ScriptCall } from "./types.js";
import { varName } from "./util.js";

interface N {
  type: string;
  [key: string]: unknown;
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

function isNode(v: unknown): v is N {
  return typeof v === "object" && v !== null && typeof (v as N).type === "string";
}

function children(node: N): N[] {
  const out: N[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) for (const v of value) isNode(v) && out.push(v);
    else if (isNode(value)) out.push(value);
  }
  return out;
}

function walk(node: N, visit: (n: N) => void): void {
  visit(node);
  for (const c of children(node)) walk(c, visit);
}

function contains(node: N, test: (n: N) => boolean): boolean {
  let found = false;
  walk(node, (n) => {
    if (!found && test(n)) found = true;
  });
  return found;
}

const prop = (n: N, key: string): N | undefined => (isNode(n[key]) ? (n[key] as N) : undefined);
const list = (n: N, key: string): N[] => (Array.isArray(n[key]) ? (n[key] as N[]) : []);
const ident = (n: N | undefined): string | undefined =>
  n?.type === "Identifier" ? (n.name as string) : undefined;

function memberName(n: N | undefined): string | undefined {
  if (n?.type !== "MemberExpression") return undefined;
  const p = prop(n, "property");
  if (!n.computed) return ident(p);
  return p?.type === "Literal" && typeof p.value === "string" ? p.value : undefined;
}

function isDocumentCookie(n: N): boolean {
  return (
    n.type === "MemberExpression" &&
    memberName(n) === "cookie" &&
    ident(prop(n, "object")) === "document"
  );
}

function stringLiteral(n: N | undefined): string | undefined {
  if (n?.type === "Literal" && typeof n.value === "string") return n.value;
  if (n?.type === "TemplateLiteral" && list(n, "expressions").length === 0) {
    const q = list(n, "quasis")[0];
    return ((q?.value as { cooked?: string } | undefined)?.cooked ?? "") as string;
  }
  return undefined;
}

type Part = { lit: string } | { hole: string };

interface FnInfo {
  params: string[];
  body: N;
}

interface Env {
  functions: Map<string, FnInfo>;
  objects: Map<string, N>;
  strings: Map<string, string>;
  /** Functions reading document.cookie -> the cookie name they read when it is fixed in their body. */
  cookieReaders: Map<string, string | undefined>;
  /** name -> index of the URL argument and of the options argument. */
  wrappers: Map<string, { url: number; opts?: number }>;
}

function hint(n: N): string {
  if (n.type === "Identifier") return n.name as string;
  if (n.type === "MemberExpression") return memberName(n) ?? "value";
  if (n.type === "CallExpression") {
    const callee = prop(n, "callee");
    const name = ident(callee) ?? memberName(callee);
    const arg = list(n, "arguments")[0];
    if (arg && name && /^(encodeURIComponent|encodeURI|String|escape|Number|parseInt)$/.test(name))
      return hint(arg);
    return name ?? "value";
  }
  return "value";
}

function evalString(n: N | undefined, env: Env): Part[] | undefined {
  if (!n) return undefined;
  const lit = stringLiteral(n);
  if (lit !== undefined) return [{ lit }];
  if (n.type === "TemplateLiteral") {
    const quasis = list(n, "quasis");
    const exprs = list(n, "expressions");
    const parts: Part[] = [];
    quasis.forEach((q, i) => {
      const cooked = (q.value as { cooked?: string }).cooked ?? "";
      if (cooked) parts.push({ lit: cooked });
      const e = exprs[i];
      if (e) parts.push(...(evalString(e, env) ?? [{ hole: hint(e) }]));
    });
    return parts;
  }
  if (n.type === "BinaryExpression" && n.operator === "+") {
    const left = prop(n, "left");
    const right = prop(n, "right");
    const l = evalString(left, env) ?? (left ? [{ hole: hint(left) }] : []);
    const r = evalString(right, env) ?? (right ? [{ hole: hint(right) }] : []);
    return [...l, ...r];
  }
  if (n.type === "Identifier") {
    const v = env.strings.get(n.name as string);
    return v !== undefined ? [{ lit: v }] : [{ hole: n.name as string }];
  }
  if (n.type === "CallExpression") {
    const callee = prop(n, "callee");
    const name = ident(callee);
    const arg = list(n, "arguments")[0];
    if (arg && name && /^(encodeURIComponent|encodeURI|String)$/.test(name)) {
      const inner = evalString(arg, env);
      if (inner?.every((p) => "lit" in p)) return inner;
      return [{ hole: hint(arg) }];
    }
  }
  return [{ hole: hint(n) }];
}

function holeName(raw: string): string {
  if (/sku$/i.test(raw)) return "sku";
  if (/(?:^|[a-z_])id$/i.test(raw) || /Id$/.test(raw) || raw.length <= 2) return "id";
  return varName(raw);
}

/** Turn evaluated parts into a URL pattern; undefined when the URL does not start with a literal. */
function partsToPattern(parts: Part[]): string | undefined {
  const first = parts[0];
  if (!first || !("lit" in first) || first.lit === "") return undefined;
  const tokens: string[] = [];
  let joined = "";
  for (const p of parts) {
    if ("lit" in p) joined += p.lit;
    else {
      joined += `\uE000${tokens.length}\uE000`;
      tokens.push(p.hole);
    }
  }
  const q = joined.indexOf("?");
  const path = q >= 0 ? joined.slice(0, q) : joined;
  const query = q >= 0 ? joined.slice(q + 1) : "";
  const pathOut = path.replace(
    /\uE000(\d+)\uE000/g,
    (_m, i: string) => `{${holeName(tokens[Number(i)] ?? "id")}}`,
  );
  if (!query) return pathOut;
  const pairs = query
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      const key = eq >= 0 ? pair.slice(0, eq) : pair;
      const value = eq >= 0 ? pair.slice(eq + 1) : "";
      const keyName = key.replace(/\uE000\d+\uE000/g, "");
      if (/\uE000\d+\uE000/.test(value)) return `${keyName}={${varName(keyName)}}`;
      return `${keyName}=${value}`;
    });
  return `${pathOut}?${pairs.join("&")}`;
}

interface ObjectView {
  props: Map<string, N>;
}

function evalObject(n: N | undefined, env: Env): ObjectView | undefined {
  if (!n) return undefined;
  if (n.type === "Identifier") {
    const bound = env.objects.get(n.name as string);
    return bound ? evalObject(bound, env) : undefined;
  }
  if (n.type === "ObjectExpression") {
    const props = new Map<string, N>();
    for (const p of list(n, "properties")) {
      if (p.type === "SpreadElement") {
        const inner = evalObject(prop(p, "argument"), env);
        if (inner) for (const [k, v] of inner.props) props.set(k, v);
        continue;
      }
      const key = prop(p, "key");
      const name = p.computed ? stringLiteral(key) : (ident(key) ?? stringLiteral(key));
      const value = prop(p, "value");
      if (name !== undefined && value) props.set(name, value);
    }
    return { props };
  }
  if (n.type === "CallExpression") {
    const callee = prop(n, "callee");
    if (memberName(callee) === "assign" && ident(prop(callee as N, "object")) === "Object") {
      const props = new Map<string, N>();
      for (const arg of list(n, "arguments")) {
        const inner = evalObject(arg, env);
        if (inner) for (const [k, v] of inner.props) props.set(k, v);
      }
      return { props };
    }
  }
  return undefined;
}

function cookieNameFrom(n: N, env: Env): string | undefined {
  if (n.type === "CallExpression") {
    const name = ident(prop(n, "callee"));
    if (name && env.cookieReaders.has(name)) {
      return stringLiteral(list(n, "arguments")[0]) ?? env.cookieReaders.get(name);
    }
  }
  if (!contains(n, isDocumentCookie)) return undefined;
  return literalCookieName(n);
}

/** A cookie name written as a literal (`/csrf=([^;]+)/`, `"csrf="`, `"csrf"`) inside a node. */
function literalCookieName(n: N): string | undefined {
  let found: string | undefined;
  walk(n, (x) => {
    if (found || x.type !== "Literal") return;
    const regex = (x.regex as { pattern?: string } | undefined)?.pattern;
    const src = regex ?? (typeof x.value === "string" ? x.value : undefined);
    const m = src ? /([A-Za-z0-9_.-]+)=/.exec(src) : undefined;
    if (m?.[1]) found = m[1];
    else if (typeof x.value === "string" && /^[A-Za-z0-9_.-]+$/.test(x.value)) found = x.value;
  });
  return found;
}

function metaNameFrom(n: N): string | undefined {
  let found: string | undefined;
  walk(n, (x) => {
    if (found) return;
    const v = typeof x.value === "string" ? x.value : undefined;
    const m = v ? /meta\[name=["']?([^"'\]]+)["']?\]/.exec(v) : undefined;
    if (m?.[1]) found = m[1];
  });
  return found;
}

interface CallShape {
  method?: string;
  headers: Record<string, string>;
  csrf: CsrfRule[];
  bodyKind?: ScriptCall["bodyKind"];
  bodyKeys: string[];
  authScheme?: string;
}

function headerShape(headersNode: N | undefined, env: Env, origin: string, out: CallShape): void {
  const headers = evalObject(headersNode, env);
  if (!headers) return;
  for (const [name, value] of headers.props) {
    const lower = name.toLowerCase();
    if (lower === "authorization") {
      const parts = evalString(value, env);
      const lead = parts?.[0];
      const scheme = lead && "lit" in lead ? /^(\w+)\s/.exec(lead.lit)?.[1] : undefined;
      if (scheme) out.authScheme = scheme;
      continue;
    }
    if (lower === "cookie") continue;
    const lit = stringLiteral(value);
    if (lit !== undefined) {
      out.headers[name] = lit;
      continue;
    }
    const cookie = cookieNameFrom(value, env);
    if (cookie) {
      out.csrf.push({ source: { kind: "cookie", name: cookie }, target: { kind: "header", name } });
      continue;
    }
    const meta = metaNameFrom(value);
    if (meta) {
      out.csrf.push({
        source: { kind: "meta", urlTemplate: `${origin}/`, name: meta },
        target: { kind: "header", name },
      });
    }
  }
}

function bodyShape(body: N | undefined, env: Env, out: CallShape): void {
  if (!body) return;
  if (body.type === "CallExpression") {
    const callee = prop(body, "callee");
    if (memberName(callee) === "stringify" && ident(prop(callee as N, "object")) === "JSON") {
      out.bodyKind = "json";
      out.bodyKeys = [...(evalObject(list(body, "arguments")[0], env)?.props.keys() ?? [])];
      return;
    }
  }
  if (body.type === "NewExpression") {
    const ctor = ident(prop(body, "callee"));
    if (ctor === "URLSearchParams") {
      out.bodyKind = "form";
      out.bodyKeys = [...(evalObject(list(body, "arguments")[0], env)?.props.keys() ?? [])];
      return;
    }
    if (ctor === "FormData") {
      out.bodyKind = "multipart";
      return;
    }
  }
  const obj = evalObject(body, env);
  if (obj) {
    out.bodyKind = out.bodyKind ?? "json";
    out.bodyKeys = [...obj.props.keys()];
    return;
  }
  out.bodyKind = out.bodyKind ?? "text";
}

function optionsShape(opts: N | undefined, env: Env, origin: string, bodyKey = "body"): CallShape {
  const out: CallShape = { headers: {}, csrf: [], bodyKeys: [] };
  const o = evalObject(opts, env);
  if (!o) return out;
  const method = stringLiteral(o.props.get("method") ?? o.props.get("type"));
  if (method) out.method = method.toUpperCase();
  headerShape(o.props.get("headers"), env, origin, out);
  bodyShape(o.props.get(bodyKey), env, out);
  const ct = Object.entries(out.headers).find(([k]) => k.toLowerCase() === "content-type")?.[1];
  if (ct && /json/i.test(ct) && out.bodyKind === "text") out.bodyKind = "json";
  return out;
}

function collectEnv(program: N): Env {
  const env: Env = {
    functions: new Map(),
    objects: new Map(),
    strings: new Map(),
    cookieReaders: new Map(),
    wrappers: new Map(),
  };
  walk(program, (n) => {
    if (n.type === "FunctionDeclaration") {
      const name = ident(prop(n, "id"));
      const body = prop(n, "body");
      if (name && body)
        env.functions.set(name, { params: list(n, "params").map((p) => ident(p) ?? ""), body });
    }
    if (n.type === "VariableDeclaration") {
      for (const d of list(n, "declarations")) d.kind = n.kind;
    }
    if (n.type === "VariableDeclarator") {
      const name = ident(prop(n, "id"));
      const init = prop(n, "init");
      if (!name || !init) return;
      if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
        const body = prop(init, "body");
        if (body)
          env.functions.set(name, {
            params: list(init, "params").map((p) => ident(p) ?? ""),
            body,
          });
      } else if (init.type === "ObjectExpression") env.objects.set(name, init);
      else {
        const lit = stringLiteral(init);
        if (lit !== undefined && n.kind === "const") env.strings.set(name, lit);
      }
    }
  });
  for (const [name, fn] of env.functions) {
    if (contains(fn.body, isDocumentCookie)) {
      env.cookieReaders.set(name, fn.params.length === 0 ? literalCookieName(fn.body) : undefined);
    }
  }
  // Fetch wrappers: functions passing one of their parameters on as fetch's URL. Iterate so
  // wrappers of wrappers resolve too.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, fn] of env.functions) {
      if (env.wrappers.has(name)) continue;
      walk(fn.body, (n) => {
        if (env.wrappers.has(name) || n.type !== "CallExpression") return;
        const target = fetchTarget(prop(n, "callee"), env);
        if (!target) return;
        const args = list(n, "arguments");
        const urlArg = ident(args[target.url]);
        const urlIndex = urlArg ? fn.params.indexOf(urlArg) : -1;
        if (urlIndex < 0) return;
        const optsArg = target.opts !== undefined ? args[target.opts] : undefined;
        let optsIndex: number | undefined;
        if (optsArg) {
          fn.params.forEach((p, i) => {
            if (p && contains(optsArg, (x) => ident(x) === p)) optsIndex = i;
          });
        }
        env.wrappers.set(
          name,
          optsIndex === undefined ? { url: urlIndex } : { url: urlIndex, opts: optsIndex },
        );
        changed = true;
      });
    }
  }
  return env;
}

function fetchTarget(callee: N | undefined, env: Env): { url: number; opts?: number } | undefined {
  const name = ident(callee);
  if (name === "fetch") return { url: 0, opts: 1 };
  if (name && env.wrappers.has(name)) return env.wrappers.get(name);
  if (callee?.type === "MemberExpression" && memberName(callee) === "fetch") {
    const obj = ident(prop(callee, "object"));
    if (obj === "window" || obj === "self" || obj === "globalThis") return { url: 0, opts: 1 };
  }
  return undefined;
}

export interface ScriptAnalysis {
  calls: ScriptCall[];
  error?: string;
}

/** Analyse one script. `scriptUrl` resolves relative URLs; only calls on its origin are kept. */
export const SCRIPT_SIZE_LIMIT = 512 * 1024;

function parseScript(source: string): N {
  const opts = { ecmaVersion: "latest" as const, locations: true, allowHashBang: true };
  try {
    return parse(source, { ...opts, sourceType: "script" }) as unknown as N;
  } catch {
    return parse(source, { ...opts, sourceType: "module" }) as unknown as N;
  }
}

/** Credential literals are evidence only: the contract cannot replay script variables. */
export function scriptCredentialSecrets(source: string): Set<string> {
  const secrets = new Set<string>();
  const sensitive = /csrf|xsrf|token|secret|session|auth|password|api.?key|form.?key/i;
  try {
    if (Buffer.byteLength(source, "utf8") > SCRIPT_SIZE_LIMIT) throw new Error("large script");
    const program = parseScript(source);
    const env = collectEnv(program);
    const remember = (node: N | undefined) => {
      if (!node) return;
      const parts = evalString(node, env);
      if (parts?.every((p) => "lit" in p))
        secrets.add(parts.map((p) => ("lit" in p ? p.lit : "")).join(""));
      // Only value fragments belong to this assignment. Literals inside arbitrary calls or
      // function bodies may be cookie names, selectors, HTTP methods or storage keys.
      for (const part of parts ?? []) if ("lit" in part && part.lit) secrets.add(part.lit);
    };
    walk(program, (node) => {
      const left = prop(node, "left");
      const key = prop(node, "id") ?? prop(node, "key") ?? left;
      const name = ident(key) ?? memberName(key) ?? stringLiteral(key);
      if (name && sensitive.test(name))
        remember(prop(node, "init") ?? prop(node, "right") ?? prop(node, "value"));
    });
  } catch {
    // Parse/size failures must not silently turn obvious credential assignments into constants.
    for (const match of source.matchAll(/([\w$]+)["']?\s*[:=]\s*["']([^"'\r\n]+)["']/g))
      if (sensitive.test(match[1] ?? "")) secrets.add(match[2] ?? "");
  }
  secrets.delete("");
  return secrets;
}

export function analyseScript(source: string, scriptUrl: string): ScriptAnalysis {
  if (source.length > SCRIPT_SIZE_LIMIT || Buffer.byteLength(source, "utf8") > SCRIPT_SIZE_LIMIT)
    return { calls: [], error: "script exceeds analysis size limit" };
  let program: N;
  try {
    program = parseScript(source);
  } catch (err) {
    return { calls: [], error: `could not parse ${scriptUrl}: ${(err as Error).message}` };
  }
  try {
    const origin = new URL(scriptUrl).origin;
    const env = collectEnv(program);
    const calls: ScriptCall[] = [];

    const add = (
      urlNode: N | undefined,
      shape: CallShape,
      defaultMethod: string,
      via: string,
      at: N,
    ) => {
      const pattern = partsToPattern(evalString(urlNode, env) ?? []);
      if (!pattern) return;
      let abs: URL;
      try {
        abs = new URL(
          pattern.replace(/[{}]/g, (c) => (c === "{" ? "%7B" : "%7D")),
          scriptUrl,
        );
      } catch {
        return;
      }
      if (abs.origin !== origin) return;
      const urlPattern = `${abs.origin}${decodeURI(abs.pathname)}${abs.search ? decodeURIComponent(abs.search) : ""}`;
      const call: ScriptCall = {
        scriptUrl,
        method: shape.method ?? defaultMethod,
        urlPattern,
        headers: shape.headers,
        csrf: shape.csrf,
        bodyKeys: shape.bodyKeys,
        via,
        line: ((at.loc as { start?: { line?: number } } | undefined)?.start?.line ?? 0) as number,
      };
      if (shape.bodyKind) call.bodyKind = shape.bodyKind;
      if (shape.authScheme) call.authScheme = shape.authScheme;
      calls.push(call);
    };

    // XMLHttpRequest: x.open(method, url) plus x.setRequestHeader / x.send on the same name.
    const xhrHeaders = new Map<string, N[]>();
    const xhrSends = new Map<string, N>();
    walk(program, (n) => {
      if (n.type !== "CallExpression") return;
      const callee = prop(n, "callee");
      const obj = callee?.type === "MemberExpression" ? ident(prop(callee, "object")) : undefined;
      const m = memberName(callee);
      if (obj && m === "setRequestHeader") xhrHeaders.set(obj, [...(xhrHeaders.get(obj) ?? []), n]);
      if (obj && m === "send" && list(n, "arguments")[0])
        xhrSends.set(obj, list(n, "arguments")[0] as N);
    });

    walk(program, (n) => {
      if (n.type !== "CallExpression") return;
      const callee = prop(n, "callee");
      const args = list(n, "arguments");
      const target = fetchTarget(callee, env);
      if (target) {
        const name = ident(callee);
        const via = name && name !== "fetch" ? `wrapper:${name}` : "fetch";
        add(
          args[target.url],
          optionsShape(target.opts !== undefined ? args[target.opts] : undefined, env, origin),
          "GET",
          via,
          n,
        );
        return;
      }
      const m = memberName(callee);
      const objNode = callee?.type === "MemberExpression" ? prop(callee, "object") : undefined;
      const obj = ident(objNode);
      if (m === "open" && obj) {
        const method = stringLiteral(args[0])?.toUpperCase();
        if (!method || !HTTP_METHODS.has(method)) return;
        const shape: CallShape = { method, headers: {}, csrf: [], bodyKeys: [] };
        for (const h of xhrHeaders.get(obj) ?? []) {
          const [k, v] = list(h, "arguments");
          const key = stringLiteral(k);
          if (key && v) {
            const synthetic: N = {
              type: "ObjectExpression",
              properties: [
                {
                  type: "Property",
                  key: { type: "Literal", value: key },
                  value: v,
                  computed: false,
                },
              ],
            };
            headerShape(synthetic, env, origin, shape);
          }
        }
        bodyShape(xhrSends.get(obj), env, shape);
        add(args[1], shape, method, "xhr", n);
        return;
      }
      if (obj === "axios" && m) {
        const method = m.toUpperCase();
        if (m === "request") {
          const o = evalObject(args[0], env);
          add(o?.props.get("url"), optionsShape(args[0], env, origin, "data"), "GET", "axios", n);
        } else if (["GET", "DELETE", "HEAD"].includes(method)) {
          add(
            args[0],
            { ...optionsShape(args[1], env, origin, "data"), method },
            method,
            "axios",
            n,
          );
        } else if (["POST", "PUT", "PATCH"].includes(method)) {
          const shape = { ...optionsShape(args[2], env, origin, "data"), method };
          bodyShape(args[1], env, shape);
          add(args[0], shape, method, "axios", n);
        }
        return;
      }
      if (ident(callee) === "axios") {
        const o = evalObject(args[0], env);
        if (o)
          add(o.props.get("url"), optionsShape(args[0], env, origin, "data"), "GET", "axios", n);
        else add(args[0], optionsShape(args[1], env, origin, "data"), "GET", "axios", n);
        return;
      }
      if ((obj === "$" || obj === "jQuery") && m) {
        if (m === "ajax") {
          const o = evalObject(args[0], env);
          add(o?.props.get("url"), optionsShape(args[0], env, origin, "data"), "GET", "jquery", n);
        } else if (m === "get" || m === "getJSON")
          add(args[0], { headers: {}, csrf: [], bodyKeys: [] }, "GET", "jquery", n);
        else if (m === "post") {
          const shape: CallShape = { method: "POST", headers: {}, csrf: [], bodyKeys: [] };
          bodyShape(args[1], env, shape);
          if (shape.bodyKind === "json") shape.bodyKind = "form";
          add(args[0], shape, "POST", "jquery", n);
        }
      }
    });
    return { calls };
  } catch {
    return { calls: [], error: "could not analyse script" };
  }
}

/** Analyze each complete external script once; callers report one summary for skipped bundles. */
export function analyseScripts(
  requests: readonly RecordedRequest[],
): ScriptAnalysis & { skipped: number } {
  const seen = new Set<string>();
  const calls: ScriptCall[] = [];
  let skipped = 0;
  for (const request of requests) {
    if (request.resourceType !== "script" || !request.bodySample || seen.has(request.url)) continue;
    seen.add(request.url);
    if (request.bodyTruncated) {
      skipped++;
      continue;
    }
    const result = analyseScript(request.bodySample, request.url);
    if (result.error) skipped++;
    calls.push(...result.calls);
  }
  return { calls, skipped };
}
