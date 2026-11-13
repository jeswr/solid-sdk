// AUTHORED-BY Claude Opus 5.5
// The executor: match an ActionRequest to a flow or operation, ask the gate, then
// run the site's own HTTP calls with the user's session and lift the responses
// back into RDF observations.
//
// Security invariants (see README):
// - every request URL, CSRF page and redirect target is on the model's origin;
// - nothing is sent before the gate allows it; an approval is single-use and bound
//   to a digest of the exact resolved inputs;
// - results and errors never carry cookies, session headers or CSRF tokens.

import type {
  ActionRequest,
  EffectClass,
  Flow,
  Observation,
  Operation,
  SiteModel,
} from "@jeswr/site-model";
import {
  applyCsrfToken,
  bodyInit,
  bodyText,
  type CompiledRequest,
  compileOperation,
  isForbiddenHeader,
} from "./compile.js";
import {
  applySetCookies,
  type Cookie,
  cookieHeader,
  cookiesFor,
  type SessionBundle,
  type SessionProvider,
} from "./cookies.js";
import { attribute, jsonPointer, metaContent, parseHtml, selectElement } from "./dom.js";
import { type ExtractedItem, ExtractionError, emptyTurtle, extract } from "./extract.js";
import {
  type ApprovalRequest,
  approvalDigest,
  createApprovalGate,
  type Gate,
  type GateRequest,
  moneyFields,
  summarise,
} from "./gate.js";
import { effectiveEffect, matchRequest, type Target } from "./match.js";
import { describeUrl, guardUrl, OriginError, siteOrigin } from "./origin.js";
import { expandTemplate, UriTemplateError } from "./uri-template.js";
import { BindingError, expandIri, idFromIri, isClassRange } from "./values.js";

export type ExecutionStatus =
  | "done"
  | "needs-approval"
  | "denied"
  | "no-path"
  | "ambiguous"
  | "error";

export type ErrorKind =
  | "origin"
  | "binding"
  | "csrf"
  | "http"
  | "network"
  | "extraction"
  | "limit"
  | "no-session"
  | "gate";

export interface ExecutionResult {
  status: ExecutionStatus;
  target?: Target;
  observations: Observation[];
  approval?: ApprovalRequest;
  error?: string;
  errorKind?: ErrorKind;
  /** Labels of the tied candidates when status is 'ambiguous'. */
  candidates?: string[];
  /** HTTP requests sent (operations, CSRF pages and redirects). */
  requests: number;
}

export interface ExecutorOptions {
  model: SiteModel;
  sessions: SessionProvider;
  /** Default: reads allowed, everything else asks (createApprovalGate()). */
  gate?: Gate;
  fetch?: typeof fetch;
  now?: () => Date;
  persona?: string;
  /** Upper bound on HTTP requests per execute() call. Default 25. */
  maxRequests?: number;
  /** Upper bound on redirects followed per request. Default 5. */
  maxRedirects?: number;
  /** Upper bound on a response body. Default 5 MiB. */
  maxResponseBytes?: number;
}

export interface PlannedRequest {
  operation: string;
  label: string;
  method: string;
  url: string;
  /** Static headers only; credentials are never part of a plan. */
  headers: Record<string, string>;
  body?: string;
  /** True when the user's session (cookies, vault headers) would be attached. */
  session: boolean;
  /** CSRF rules that would apply, described (tokens are fetched only when executing). */
  csrf: string[];
}

export interface Plan {
  status: "planned" | "no-path" | "ambiguous" | "error";
  target?: Target;
  effect?: EffectClass;
  summary?: string;
  requests: PlannedRequest[];
  candidates?: string[];
  error?: string;
}

export interface Executor {
  readonly model: SiteModel;
  execute(request: ActionRequest, opts?: { approvalId?: string }): Promise<ExecutionResult>;
  /** Dry run: the compiled requests without sending anything, credentials redacted. */
  planToRequests(request: ActionRequest): Plan;
}

class CsrfError extends Error {
  override name = "CsrfError";
}
class HttpError extends Error {
  override name = "HttpError";
}
class NetworkError extends Error {
  override name = "NetworkError";
}
class LimitError extends Error {
  override name = "LimitError";
}
class SessionError extends Error {
  override name = "SessionError";
}

function errorKind(error: unknown): ErrorKind {
  if (error instanceof OriginError) return "origin";
  if (error instanceof BindingError || error instanceof UriTemplateError) return "binding";
  if (error instanceof CsrfError) return "csrf";
  if (error instanceof HttpError) return "http";
  if (error instanceof ExtractionError) return "extraction";
  if (error instanceof LimitError) return "limit";
  if (error instanceof SessionError) return "no-session";
  return "network";
}

/** A flow's step references `$input.x`, `$stepN.<property>` or a literal. */
const STEP_REF = /^\$step(\d+)\.(.+)$/;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MIN_SECRET_LENGTH = 6;
const REDACTED = "[redacted]";

interface RunContext {
  jar: Cookie[];
  /** Session headers sent with each request (Cookie/Host-like entries removed). */
  headers: Record<string, string>;
  /** The vault's headers exactly as stored, written back unchanged with cookie updates. */
  storedHeaders?: Record<string, string>;
  requests: number;
  secrets: Set<string>;
}

interface Response0 {
  status: number;
  url: URL;
  body: string;
}

function describeRule(rule: NonNullable<Operation["csrf"]>[number]): string {
  const src = rule.source;
  const from =
    src.kind === "cookie"
      ? `cookie ${src.name}`
      : src.kind === "html"
        ? `html ${src.selector}@${src.attribute} of ${src.urlTemplate}`
        : src.kind === "meta"
          ? `meta ${src.name} of ${src.urlTemplate}`
          : `json ${src.pointer} of ${src.urlTemplate}`;
  return `${rule.target.kind} ${rule.target.name} <- ${from}`;
}

export function createExecutor(options: ExecutorOptions): Executor {
  const { model, sessions } = options;
  const origin = siteOrigin(model.site);
  const gate = options.gate ?? createApprovalGate();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const persona = options.persona;
  const maxRequests = options.maxRequests ?? 25;
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBytes = options.maxResponseBytes ?? 5 * 1024 * 1024;
  /** Approvals this executor handed out: id -> digest. Claimed (removed) on use. */
  const issued = new Map<string, string>();
  const operations = new Map(model.operations.map((op) => [op.id, op]));

  function addSecrets(ctx: RunContext): void {
    for (const c of ctx.jar) if (c.value.length >= MIN_SECRET_LENGTH) ctx.secrets.add(c.value);
    for (const v of Object.values(ctx.headers)) {
      if (v.length >= MIN_SECRET_LENGTH) ctx.secrets.add(v);
      const token = v.split(/\s+/).at(-1);
      if (token && token.length >= MIN_SECRET_LENGTH) ctx.secrets.add(token);
    }
  }

  function redactWith(ctx: RunContext): (text: string) => string {
    return (text) => {
      let out = text;
      const secrets = [...ctx.secrets].sort((a, b) => b.length - a.length);
      for (const s of secrets) {
        if (out.includes(s)) out = out.split(s).join(REDACTED);
        const encoded = encodeURIComponent(s);
        if (encoded !== s && out.includes(encoded)) out = out.split(encoded).join(REDACTED);
      }
      return out;
    };
  }

  async function readBody(res: Response): Promise<string> {
    if (!res.body) return "";
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new LimitError(
          `response from ${describeUrl(res.url || origin)} exceeds ${maxBytes} bytes`,
        );
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  async function storeCookies(ctx: RunContext, res: Response, url: URL): Promise<void> {
    const setCookies =
      typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    if (setCookies.length === 0) return;
    const { jar, changed } = applySetCookies(ctx.jar, setCookies, url, now());
    if (!changed) return;
    ctx.jar = jar;
    addSecrets(ctx);
    const bundle: SessionBundle = {
      cookies: jar,
      ...(ctx.storedHeaders ? { headers: { ...ctx.storedHeaders } } : {}),
    };
    await sessions.update(origin, persona, bundle);
  }

  async function send(
    ctx: RunContext,
    method: string,
    startUrl: URL,
    headers: Record<string, string>,
    body: CompiledRequest["body"],
    accept: string | undefined,
  ): Promise<Response0> {
    let url = guardUrl(startUrl.href, origin);
    let currentMethod = method;
    let currentBody = body;
    const currentHeaders = { ...headers };
    for (let redirects = 0; ; redirects++) {
      if (ctx.requests >= maxRequests)
        throw new LimitError(`request limit of ${maxRequests} reached`);
      ctx.requests++;
      const h = new Headers();
      for (const [k, v] of Object.entries(currentHeaders)) h.set(k, v);
      for (const [k, v] of Object.entries(ctx.headers)) {
        const lower = k.toLowerCase();
        if (lower === "cookie" || lower === "host" || lower === "content-length") continue;
        h.set(k, v);
      }
      if (accept && !h.has("accept")) h.set("accept", accept);
      const cookies = cookiesFor(ctx.jar, url, now());
      if (cookies.length > 0) h.set("cookie", cookieHeader(cookies));
      let res: Response;
      try {
        res = await fetchImpl(url.href, {
          method: currentMethod,
          headers: h,
          redirect: "manual",
          ...(currentBody !== undefined ? { body: bodyInit(currentBody) } : {}),
        });
      } catch {
        throw new NetworkError(`${currentMethod} ${describeUrl(url)} failed (network error)`);
      }
      await storeCookies(ctx, res, url);
      const location = res.headers.get("location");
      if (REDIRECT_STATUSES.has(res.status) && location !== null) {
        await res.body?.cancel();
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          throw new OriginError("redirect Location is not a valid URL");
        }
        next = guardUrl(next.href, origin);
        if (currentMethod !== "GET" && (res.status === 307 || res.status === 308)) {
          throw new HttpError(
            `${currentMethod} ${describeUrl(url)} answered ${res.status}; a redirect that re-sends the body is not followed`,
          );
        }
        if (redirects + 1 > maxRedirects)
          throw new LimitError(`more than ${maxRedirects} redirects`);
        if (currentMethod !== "GET") {
          currentMethod = "GET";
          currentBody = undefined;
          delete currentHeaders["content-type"];
        }
        url = next;
        continue;
      }
      return { status: res.status, url, body: await readBody(res) };
    }
  }

  async function csrfToken(
    ctx: RunContext,
    compiled: CompiledRequest,
    rule: NonNullable<Operation["csrf"]>[number],
    values: Record<string, string>,
  ): Promise<string> {
    const { source } = rule;
    let token: string | undefined;
    if (source.kind === "cookie") {
      token = cookiesFor(ctx.jar, compiled.url, now()).find((c) => c.name === source.name)?.value;
      if (token === undefined)
        throw new CsrfError(`CSRF cookie "${source.name}" is not in the session`);
    } else {
      let pageUrl: URL;
      try {
        pageUrl = guardUrl(expandTemplate(source.urlTemplate, values), origin);
      } catch (e) {
        if (e instanceof UriTemplateError)
          throw new BindingError(`invalid CSRF URL template: ${e.message}`);
        throw e;
      }
      const accept = source.kind === "json" ? "application/json" : "text/html";
      const res = await send(ctx, "GET", pageUrl, {}, undefined, accept);
      if (res.status >= 400)
        throw new CsrfError(`CSRF page ${describeUrl(res.url)} answered ${res.status}`);
      if (source.kind === "json") {
        let doc: unknown;
        try {
          doc = JSON.parse(res.body);
        } catch {
          throw new CsrfError(`CSRF source ${describeUrl(res.url)} is not JSON`);
        }
        const v = jsonPointer(doc, source.pointer);
        token = typeof v === "string" || typeof v === "number" ? String(v) : undefined;
      } else if (source.kind === "meta") {
        token = metaContent(parseHtml(res.body), source.name);
      } else {
        const el = selectElement(source.selector, parseHtml(res.body));
        token = el ? attribute(el, source.attribute) : undefined;
      }
      if (token === undefined || token === "") {
        throw new CsrfError(`CSRF token not found on ${describeUrl(res.url)}`);
      }
    }
    ctx.secrets.add(token);
    return token;
  }

  async function runOperation(
    ctx: RunContext,
    operation: Operation,
    values: Record<string, string>,
  ): Promise<{ observation: Observation; items: ExtractedItem[] }> {
    const compiled = compileOperation(operation, values, origin);
    for (const rule of compiled.csrf) {
      applyCsrfToken(compiled, rule, await csrfToken(ctx, compiled, rule, values));
    }
    const accept =
      operation.extraction?.format === "json"
        ? "application/json"
        : operation.extraction?.format === "html"
          ? "text/html"
          : undefined;
    const res = await send(
      ctx,
      compiled.method,
      compiled.url,
      compiled.headers,
      compiled.body,
      accept,
    );
    if (res.status >= 400) {
      throw new HttpError(`${operation.label}: ${describeUrl(res.url)} answered ${res.status}`);
    }
    if (!operation.extraction) {
      return {
        observation: {
          operation: operation.id,
          status: res.status,
          turtle: await emptyTurtle(),
          itemCount: 0,
        },
        items: [],
      };
    }
    const out = await extract(operation.extraction, res.body, {
      baseUrl: res.url.href,
      redact: redactWith(ctx),
    });
    return {
      observation: {
        operation: operation.id,
        status: res.status,
        turtle: out.turtle,
        itemCount: out.items.length,
      },
      items: out.items,
    };
  }

  function stepValues(
    flow: Flow,
    index: number,
    operation: Operation,
    inputs: Record<string, string>,
    stepItems: ExtractedItem[][],
    placeholders?: Set<string>,
  ): Record<string, string> {
    const step = flow.steps[index] as Flow["steps"][number];
    const values: Record<string, string> = {};
    for (const [name, spec] of Object.entries(step.bind)) {
      const param = operation.inputs.find((p) => p.name === name);
      if (!param) continue;
      if (spec.startsWith("$input.")) {
        const v = inputs[spec.slice("$input.".length)];
        if (v !== undefined) values[name] = v;
        continue;
      }
      const m = STEP_REF.exec(spec);
      if (!m) {
        values[name] = spec;
        continue;
      }
      const n = Number(m[1]);
      if (n >= index)
        throw new BindingError(
          `step ${index} binds "${name}" from step ${n}, which has not run yet`,
        );
      if (placeholders) {
        values[name] = spec;
        placeholders.add(name);
        continue;
      }
      const prop = m[2] === "@id" ? "@id" : expandIri(m[2] as string);
      const first = stepItems[n]?.[0];
      const v = prop === "@id" ? first?.iri : first?.values.get(prop)?.[0];
      if (v === undefined) {
        if (param.required) {
          throw new BindingError(`step ${index} needs ${prop} from step ${n}, which returned none`);
        }
        continue;
      }
      // A class-ranged parameter bound to an item IRI takes the id from it, as for request values.
      values[name] = isClassRange(param.range) && /^https?:\/\//.test(v) ? idFromIri(v) : v;
    }
    return values;
  }

  function flowOperations(flow: Flow): Operation[] {
    return flow.steps.map((step, i) => {
      const op = operations.get(step.operation);
      if (!op)
        throw new BindingError(`flow step ${i} references unknown operation ${step.operation}`);
      return op;
    });
  }

  async function execute(
    request: ActionRequest,
    opts: { approvalId?: string } = {},
  ): Promise<ExecutionResult> {
    const match = matchRequest(model, request);
    if (match.kind === "no-path") return { status: "no-path", observations: [], requests: 0 };
    if (match.kind === "ambiguous") {
      return { status: "ambiguous", observations: [], candidates: match.candidates, requests: 0 };
    }
    const { target, flow, operation, inputs } = match;
    const ctx: RunContext = { jar: [], headers: {}, requests: 0, secrets: new Set() };
    const observations: Observation[] = [];
    const fail = (error: unknown, prefix = ""): ExecutionResult => {
      const message = error instanceof Error ? error.message : "unexpected failure";
      return {
        status: "error",
        target,
        observations,
        error: redactWith(ctx)(`${prefix}${message}`),
        errorKind: errorKind(error),
        requests: ctx.requests,
      };
    };
    let steps: Operation[];
    try {
      steps = flow ? flowOperations(flow) : [operation as Operation];
    } catch (e) {
      return fail(e);
    }
    const effect = effectiveEffect(model, flow, operation);
    const money = moneyFields(request);
    const digest = approvalDigest({
      site: origin,
      modelVersion: model.version,
      target,
      effect,
      inputs,
      ...money,
      ...(persona !== undefined ? { persona } : {}),
    });

    // Load the session before the gate, so a missing sign-in does not use up an approval.
    let bundle: SessionBundle | undefined;
    try {
      bundle = await sessions.get(origin, persona);
    } catch {
      return fail(new SessionError("session store unavailable"));
    }
    ctx.jar = bundle?.cookies.map((c) => ({ ...c })) ?? [];
    ctx.headers = { ...(bundle?.headers ?? {}) };
    if (bundle?.headers) ctx.storedHeaders = { ...bundle.headers };
    for (const k of Object.keys(ctx.headers))
      if (isForbiddenHeader(k) && k.toLowerCase() !== "authorization") delete ctx.headers[k];
    addSecrets(ctx);
    const signedIn = ctx.jar.length > 0 || Object.keys(ctx.headers).length > 0;
    if (!signedIn && steps.some((op) => op.session === "signed-in")) {
      return fail(new SessionError(`not signed in to ${new URL(origin).host}`));
    }

    // Claim the approval synchronously, so two concurrent retries cannot both use it.
    let claimed: string | undefined;
    if (opts.approvalId !== undefined && issued.get(opts.approvalId) === digest) {
      claimed = opts.approvalId;
      issued.delete(claimed);
    }
    const gateRequest: GateRequest = {
      site: origin,
      target,
      effect,
      inputs: { ...inputs },
      ...money,
      summary: summarise(request, target, origin, money),
      digest,
      ...(claimed !== undefined ? { approvalId: claimed } : {}),
    };
    let decision: Awaited<ReturnType<Gate["authorize"]>>;
    try {
      decision = await gate.authorize(gateRequest);
    } catch {
      if (claimed !== undefined) issued.set(claimed, digest);
      return {
        status: "error",
        target,
        observations,
        error: "the approval gate failed",
        errorKind: "gate",
        requests: 0,
      };
    }
    if (decision.kind === "deny") {
      return { status: "denied", target, observations, error: decision.reason, requests: 0 };
    }
    if (decision.kind === "ask") {
      const prior = issued.get(decision.approval.id);
      if (prior !== undefined && prior !== digest) {
        return {
          status: "error",
          target,
          observations,
          error: "the gate reused an approval id for a different request",
          errorKind: "gate",
          requests: 0,
        };
      }
      issued.set(decision.approval.id, digest);
      // The binding fields are the executor's, whatever the gate echoed.
      const approval: ApprovalRequest = {
        ...decision.approval,
        effect,
        site: origin,
        target: { ...target },
        inputs: { ...inputs },
        digest,
        ...money,
      };
      return { status: "needs-approval", target, observations, approval, requests: 0 };
    }

    try {
      if (operation) {
        const { observation } = await runOperation(ctx, operation, inputs);
        observations.push(observation);
      } else {
        const f = flow as Flow;
        const stepItems: ExtractedItem[][] = [];
        for (let i = 0; i < steps.length; i++) {
          const op = steps[i] as Operation;
          try {
            const values = stepValues(f, i, op, inputs, stepItems);
            const { observation, items } = await runOperation(ctx, op, values);
            observations.push(observation);
            stepItems.push(items);
          } catch (e) {
            return fail(e, `step ${i} (${op.label}) failed: `);
          }
        }
      }
    } catch (e) {
      return fail(e);
    }
    return { status: "done", target, observations, requests: ctx.requests };
  }

  function planToRequests(request: ActionRequest): Plan {
    const match = matchRequest(model, request);
    if (match.kind === "no-path") return { status: "no-path", requests: [] };
    if (match.kind === "ambiguous")
      return { status: "ambiguous", requests: [], candidates: match.candidates };
    const { target, flow, operation, inputs } = match;
    const requests: PlannedRequest[] = [];
    const plan = (
      op: Operation,
      values: Record<string, string>,
      placeholders?: Set<string>,
    ): void => {
      const compiled = compileOperation(op, values, origin, placeholders ? { placeholders } : {});
      const body = bodyText(compiled.body);
      requests.push({
        operation: op.id,
        label: op.label,
        method: compiled.method,
        url: compiled.url.href,
        headers: { ...compiled.headers },
        ...(body !== undefined ? { body } : {}),
        session: op.session === "signed-in",
        csrf: compiled.csrf.map(describeRule),
      });
    };
    try {
      const effect = effectiveEffect(model, flow, operation);
      const money = moneyFields(request);
      if (operation) {
        plan(operation, inputs);
      } else {
        const f = flow as Flow;
        flowOperations(f).forEach((op, i) => {
          const placeholders = new Set<string>();
          plan(op, stepValues(f, i, op, inputs, [], placeholders), placeholders);
        });
      }
      return {
        status: "planned",
        target,
        effect,
        summary: summarise(request, target, origin, money),
        requests,
      };
    } catch (e) {
      return {
        status: "error",
        target,
        requests,
        error: e instanceof Error ? e.message : "unexpected failure",
      };
    }
  }

  return { model, execute, planToRequests };
}

/** Standalone dry run over a model (no session, no gate, nothing sent). */
export function planToRequests(model: SiteModel, request: ActionRequest): Plan {
  return createExecutor({
    model,
    sessions: { get: async () => undefined, update: async () => {} },
  }).planToRequests(request);
}
