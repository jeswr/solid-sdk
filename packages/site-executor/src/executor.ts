// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
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
  endpointUrl,
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
import {
  type ExtractedItem,
  ExtractionError,
  type ExtractOutput,
  emptyTurtle,
  extract,
} from "./extract.js";
import {
  type ApprovalRequest,
  approvalDigest,
  createApprovalGate,
  type Gate,
  type GateRequest,
  moneyFields,
  summarise,
} from "./gate.js";
import { effectiveEffect, matchRequest, maxEffect, normaliseEffect, type Target } from "./match.js";
import { addAmounts, resolvedMoney } from "./money.js";
import { describeUrl, guardUrl, OriginError, siteOrigin } from "./origin.js";
import { secretRedactor } from "./secrets.js";
import { UriTemplateError } from "./uri-template.js";
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
  /** Absolute deadline per execute() call, including body reads. Default 30 seconds. */
  maxExecutionMs?: number;
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
const STEP_INDEX_KEY = "$step";
const STEP_REF = /^\$step(\d+)\.(.+)$/;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface RunContext {
  jar: Cookie[];
  /** Session headers sent with each request (Cookie/Host-like entries removed). */
  headers: Record<string, string>;
  /** The vault's headers exactly as stored, written back unchanged with cookie updates. */
  storedHeaders?: Record<string, string>;
  requests: number;
  secrets: Set<string>;
  controller: AbortController;
  deadline: number;
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

function validatedModel(source: SiteModel): SiteModel {
  const model = structuredClone(source);
  const ids = new Set<string>();
  for (const target of [...model.operations, ...model.flows]) {
    if (!target.id || ids.has(target.id)) throw new BindingError("duplicate or empty model id");
    ids.add(target.id);
    const names = new Set<string>();
    for (const input of target.inputs) {
      if (
        !input.name ||
        names.has(input.name) ||
        ["__proto__", "constructor", "prototype"].includes(input.name)
      )
        throw new BindingError("duplicate or unsafe parameter name");
      names.add(input.name);
    }
  }
  const operations = new Set(model.operations.map((op) => op.id));
  for (const flow of model.flows) {
    if (!flow.steps.length) throw new BindingError("empty flow");
    for (const [index, step] of flow.steps.entries()) {
      if (!operations.has(step.operation))
        throw new BindingError("flow references unknown operation");
      for (const spec of Object.values(step.bind)) {
        const ref = STEP_REF.exec(spec);
        if (ref && Number(ref[1]) >= index)
          throw new BindingError("flow binds a step which has not run yet");
      }
    }
  }
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object") {
      Object.freeze(value);
      for (const child of Object.values(value)) freeze(child);
    }
  };
  freeze(model);
  return model;
}
interface ObservationRecord {
  operation: string;
  status: number;
  output?: ExtractOutput;
}
interface Progress {
  index: number;
  observations: ObservationRecord[];
  stepItems: ExtractedItem[][];
  secrets: Set<string>;
  requests: number;
  spent: string;
  currency?: string;
}
interface Pending {
  key: string;
  digest: string;
  progress: Progress;
}

export function createExecutor(options: ExecutorOptions): Executor {
  const model = validatedModel(options.model);
  const { sessions } = options;
  const origin = siteOrigin(model.site);
  const gate = options.gate ?? createApprovalGate();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const persona = options.persona;
  const maxRequests = options.maxRequests ?? 25;
  const maxRedirects = options.maxRedirects ?? 5;
  const maxBytes = options.maxResponseBytes ?? 5 * 1024 * 1024;
  const maxExecutionMs = options.maxExecutionMs ?? 30_000;
  for (const limit of [maxRequests, maxRedirects, maxBytes]) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new BindingError("invalid executor limit");
  }
  if (!Number.isSafeInteger(maxExecutionMs) || maxExecutionMs < 1 || maxExecutionMs > 2_147_483_647)
    throw new BindingError("invalid execution deadline");
  const issued = new Map<string, Pending>();
  const operations = new Map(model.operations.map((op) => [op.id, op]));

  function addSecrets(ctx: RunContext): void {
    for (const c of ctx.jar) if (c.value.length > 0) ctx.secrets.add(c.value);
    for (const v of Object.values(ctx.headers)) {
      if (v.length > 0) ctx.secrets.add(v);
      const token = v.split(/\s+/).at(-1);
      if (token) ctx.secrets.add(token);
    }
  }

  function redactWith(ctx: RunContext): (text: string) => string {
    return secretRedactor(ctx.secrets);
  }

  function checkDeadline(ctx: RunContext): void {
    if (performance.now() >= ctx.deadline) ctx.controller.abort();
    if (ctx.controller.signal.aborted) throw new LimitError("execution deadline exceeded");
  }
  async function budget<T>(ctx: RunContext, promise: Promise<T>): Promise<T> {
    checkDeadline(ctx);
    const signal = ctx.controller.signal;
    let abort: () => void = () => {};
    const expired = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new LimitError("execution deadline exceeded"));
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([promise, expired]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  async function readBody(ctx: RunContext, res: Response): Promise<string> {
    if (!res.body) return "";
    const reader = res.body.getReader();
    const cancel = (): void => {
      void reader.cancel().catch(() => {});
    };
    ctx.controller.signal.addEventListener("abort", cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await budget(ctx, reader.read());
        checkDeadline(ctx);
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new LimitError("response byte limit exceeded");
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString("utf8");
    } catch (error) {
      cancel();
      throw error;
    } finally {
      ctx.controller.signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
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
    await budget(ctx, sessions.update(origin, persona, bundle));
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
      checkDeadline(ctx);
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
        res = await budget(
          ctx,
          fetchImpl(url.href, {
            signal: ctx.controller.signal,
            method: currentMethod,
            headers: h,
            redirect: "manual",
            ...(currentBody !== undefined ? { body: bodyInit(currentBody) } : {}),
          }),
        );
      } catch {
        checkDeadline(ctx);
        throw new NetworkError(`${currentMethod} ${describeUrl(url)} failed (network error)`);
      }
      await storeCookies(ctx, res, url);
      const location = res.headers.get("location");
      if (REDIRECT_STATUSES.has(res.status) && location !== null) {
        if (res.body) await budget(ctx, res.body.cancel());
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
      return { status: res.status, url, body: await readBody(ctx, res) };
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
        pageUrl = endpointUrl(source.urlTemplate, values, origin);
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
    compiled: CompiledRequest,
  ): Promise<{ observation: ObservationRecord; items: ExtractedItem[] }> {
    for (const rule of compiled.csrf) {
      // A token must never replace an already approved effectful value.
      const name = rule.target.name;
      const collision =
        rule.target.kind === "header"
          ? Object.hasOwn(compiled.headers, name.toLowerCase())
          : rule.target.kind === "query"
            ? compiled.url.searchParams.has(name)
            : compiled.body?.kind === "json"
              ? compiled.body.value !== null &&
                typeof compiled.body.value === "object" &&
                Object.hasOwn(compiled.body.value, name)
              : compiled.body?.fields.some(([key]) => key === name);
      if (collision) throw new BindingError("CSRF target would overwrite an approved input");
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
        output: out,
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
    // A planner implementation may return mutable arrays: snapshot each lookup.
    const original = request;
    const lookups = new Map<string, string[]>();
    request = {
      node: original.node,
      types: [...original.types],
      values(path) {
        const key = JSON.stringify(path);
        if (!lookups.has(key)) lookups.set(key, [...original.values(path)]);
        return [...(lookups.get(key) ?? [])];
      },
    };
    const ctx: RunContext = {
      jar: [],
      headers: {},
      requests: 0,
      secrets: new Set(),
      controller: new AbortController(),
      deadline: performance.now() + maxExecutionMs,
    };
    let target: Target | undefined;
    let progress: Progress = {
      index: 0,
      observations: [],
      stepItems: [],
      secrets: ctx.secrets,
      requests: 0,
      spent: "0",
    };
    const observations = async (): Promise<Observation[]> =>
      Promise.all(
        progress.observations.map(async (record) => ({
          operation: record.operation,
          status: record.status,
          turtle: record.output ? await record.output.render(redactWith(ctx)) : await emptyTurtle(),
          itemCount: record.output?.items.length ?? 0,
        })),
      );
    const finish = async (
      result: Omit<ExecutionResult, "observations" | "requests">,
    ): Promise<ExecutionResult> => {
      try {
        return {
          ...result,
          ...(target ? { target } : {}),
          observations: await observations(),
          requests: ctx.requests,
          ...(result.error ? { error: redactWith(ctx)(result.error) } : {}),
        };
      } catch {
        return {
          status: "error",
          ...(target ? { target } : {}),
          observations: [],
          requests: ctx.requests,
          error: "observation output limit exceeded",
          errorKind: "extraction",
        };
      }
    };
    const fail = (error: unknown, prefix = ""): Promise<ExecutionResult> =>
      finish({
        status: "error",
        error: prefix + (error instanceof Error ? error.message : "unexpected failure"),
        errorKind: errorKind(error),
      });
    const timer = setTimeout(() => ctx.controller.abort(), maxExecutionMs);
    let claimed: string | undefined;
    let pending: Pending | undefined;
    try {
      const match = matchRequest(model, request);
      if (match.kind === "no-path") return await finish({ status: "no-path" });
      if (match.kind === "ambiguous")
        return await finish({ status: "ambiguous", candidates: match.candidates });
      const { flow, operation, inputs } = match;
      target = match.target;
      const steps = flow ? flowOperations(flow) : [operation as Operation];
      const claims = moneyFields(request);
      const key = approvalDigest({
        site: origin,
        modelVersion: model.version,
        target,
        effect: effectiveEffect(model, flow, operation, steps),
        inputs,
        ...claims,
        ...(persona !== undefined ? { persona } : {}),
      });
      // Claim before the first await; a continuation can never run concurrently.
      if (opts.approvalId !== undefined && issued.get(opts.approvalId)?.key === key) {
        claimed = opts.approvalId;
        pending = issued.get(claimed);
        issued.delete(claimed);
        progress = pending?.progress ?? progress;
        ctx.secrets = progress.secrets;
        ctx.requests = progress.requests;
      }
      let bundle: SessionBundle | undefined;
      try {
        bundle = await budget(ctx, sessions.get(origin, persona));
      } catch (error) {
        if (error instanceof LimitError) throw error;
        throw new SessionError("session store unavailable");
      }
      ctx.jar = bundle?.cookies.map((c) => ({ ...c })) ?? [];
      ctx.headers = { ...(bundle?.headers ?? {}) };
      if (bundle?.headers) ctx.storedHeaders = { ...bundle.headers };
      addSecrets(ctx);
      for (const k of Object.keys(ctx.headers))
        if (isForbiddenHeader(k) && k.toLowerCase() !== "authorization") delete ctx.headers[k];
      const signedIn = ctx.jar.length > 0 || Object.keys(ctx.headers).length > 0;
      if (!signedIn && steps.some((op) => op.session === "signed-in"))
        throw new SessionError(`not signed in to ${new URL(origin).host}`);
      for (let i = progress.index; i < steps.length; i++) {
        const op = steps[i] as Operation;
        try {
          checkDeadline(ctx);
          const values = flow ? stepValues(flow, i, op, inputs, progress.stepItems) : inputs;
          const resolved = Object.fromEntries(
            op.inputs.flatMap((p) => {
              const v = values[p.name] ?? p.default;
              return v === undefined ? [] : [[p.name, v]];
            }),
          );
          const compiled = compileOperation(op, resolved, origin);
          const sources: Record<string, string[]> = {};
          if (flow)
            for (const [name, spec] of Object.entries(flow.steps[i]?.bind ?? {})) {
              if (spec.startsWith("$input."))
                sources[name] = flow.inputs.find((p) => p.name === spec.slice(7))?.path ?? [];
              else {
                const ref = STEP_REF.exec(spec);
                if (ref) sources[name] = [expandIri(ref[2] ?? "")];
              }
            }
          const money = resolvedMoney(request, op, resolved, sources, compiled);
          // The host's spending limit sees the cumulative charge in this flow.
          const payment = normaliseEffect(op.effect) === "payment";
          if (payment && progress.currency !== undefined && progress.currency !== money.currency)
            throw new BindingError("flow payments use different currencies");
          const total = payment ? addAmounts(progress.spent, money.amount as string) : undefined;
          const authorizedMoney = total !== undefined ? { ...money, amount: total } : money;
          const effect =
            normaliseEffect(op.effect) === "read"
              ? "read"
              : maxEffect(
                  op.effect,
                  flow ? effectiveEffect(model, flow, undefined, steps) : op.effect,
                );
          const gateInputs = flow
            ? {
                ...inputs,
                ...Object.fromEntries(
                  Object.entries(inputs).map(([name, value]) => [`$input.${name}`, value]),
                ),
                ...resolved,
                [STEP_INDEX_KEY]: String(i),
              }
            : { ...resolved };
          const digest = approvalDigest({
            site: origin,
            modelVersion: model.version,
            target,
            effect,
            inputs: gateInputs,
            ...authorizedMoney,
            ...(persona !== undefined ? { persona } : {}),
            binding: {
              key,
              index: i,
              operation: op,
              url: compiled.url.href,
              headers: compiled.headers,
              body: compiled.body,
              session: approvalDigest({
                site: origin,
                modelVersion: model.version,
                target,
                effect,
                inputs: {},
                binding: { cookies: ctx.jar, headers: ctx.headers },
              }),
            },
          });
          const approvalId =
            claimed !== undefined && pending?.digest === digest ? claimed : undefined;
          const gateRequest: GateRequest = {
            site: origin,
            target,
            effect,
            inputs: gateInputs,
            ...authorizedMoney,
            summary: summarise(request, target, origin, authorizedMoney),
            digest,
            ...(approvalId !== undefined ? { approvalId } : {}),
          };
          let decision: Awaited<ReturnType<Gate["authorize"]>>;
          try {
            decision = await budget(ctx, gate.authorize(structuredClone(gateRequest)));
          } catch (error) {
            if (claimed && pending) issued.set(claimed, pending);
            if (error instanceof LimitError) throw error;
            return await finish({
              status: "error",
              error: "the approval gate failed",
              errorKind: "gate",
            });
          }
          checkDeadline(ctx);
          if (decision.kind === "deny")
            return await finish({ status: "denied", error: decision.reason });
          if (decision.kind === "ask") {
            const prior = issued.get(decision.approval.id);
            if (prior && prior.digest !== digest)
              return await finish({
                status: "error",
                error: "the gate reused an approval id for a different request",
                errorKind: "gate",
              });
            // No credentials may appear in a gate's returned display or fields.
            if (
              [
                ...Object.values(gateInputs),
                decision.approval.id,
                authorizedMoney.amount ?? "",
                authorizedMoney.currency ?? "",
              ].some((value) => redactWith(ctx)(value) !== value)
            )
              throw new BindingError("secret value cannot be exposed for approval");
            progress.index = i;
            progress.requests = ctx.requests;
            issued.set(decision.approval.id, { key, digest, progress });
            const approval: ApprovalRequest = {
              id: decision.approval.id,
              effect,
              site: origin,
              target: { ...target },
              inputs: { ...gateInputs },
              digest,
              summary: redactWith(ctx)(gateRequest.summary),
              ...authorizedMoney,
            };
            return await finish({ status: "needs-approval", approval });
          }
          if (decision.kind !== "allow")
            return await finish({
              status: "error",
              error: "invalid approval gate decision",
              errorKind: "gate",
            });
          claimed = undefined;
          pending = undefined;
          const out = await runOperation(ctx, op, resolved, compiled);
          checkDeadline(ctx);
          progress.observations.push(out.observation);
          progress.stepItems.push(out.items);
          progress.index = i + 1;
          if (payment) {
            progress.spent = total as string;
            progress.currency = money.currency;
          }
        } catch (error) {
          return await fail(error, flow ? `step ${i} (${op.label}) failed: ` : "");
        }
      }
      return await finish({ status: "done" });
    } catch (error) {
      return await fail(error);
    } finally {
      clearTimeout(timer);
      ctx.controller.abort();
    }
  }

  function planToRequests(request: ActionRequest): Plan {
    let match: ReturnType<typeof matchRequest>;
    try {
      match = matchRequest(model, request);
    } catch (error) {
      return {
        status: "error",
        requests: [],
        error: error instanceof Error ? error.message : "invalid request",
      };
    }
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
