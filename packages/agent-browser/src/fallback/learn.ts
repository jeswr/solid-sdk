// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers

import { createExecutor, type ExecutorOptions, type SessionProvider } from "@jeswr/site-executor";
import {
  type ActionRequest,
  type Observation,
  type Operation,
  readSiteModel,
  SAB,
  SCHEMA,
  type SiteModel,
  validateSiteModel,
  writeSiteModel,
} from "@jeswr/site-model";
import {
  buildOperation,
  discoverCredentialSources,
  discoverSessionTokens,
  type EndpointCandidate,
  heuristicLabeller,
  type Labeller,
  matchRequest,
  parseForms,
  proposeExtraction,
  type RecordedRequest,
} from "@jeswr/site-profiler";
import { randomUUID } from "crypto";
import type { BrowserDriver } from "./driver.js";
import { fallbackRedactor } from "./redact.js";
import { wireCandidates } from "./wire.js";

const sensitive =
  /pass(word|wd)?|pwd|secret|token|csrf|xsrf|session|api.?key|authorization|form.?key/i;

/** Host-internal raw evidence -> credential-free template candidates. Never return raw traffic. */
export function candidatesFromTrace(
  trace: RecordedRequest[],
  origin: string,
  cookies: { name: string; value: string }[],
  approved: ReadonlySet<number>,
  redact: (value: string) => string,
): EndpointCandidate[] {
  const safe = trace.filter(
    (r) =>
      !r.blocked &&
      new URL(r.url).origin === origin &&
      (r.method === "GET" || approved.has(r.seq)) &&
      r.status !== undefined &&
      r.status >= 200 &&
      r.status < 400,
  );
  const pages = safe
    .filter(
      (r) =>
        r.method === "GET" && /html/i.test(r.contentType ?? "") && r.bodySample && !r.bodyTruncated,
    )
    .map((r) => ({ url: r.url, html: r.bodySample as string }));
  const credentials = discoverCredentialSources(pages, cookies);
  const tokens = new Map([...discoverSessionTokens(pages, cookies, safe), ...credentials.tokens]);
  // Recognised session URL tokens are slotted by the profiler before any redaction.
  const forms = pages
    .flatMap((p) => parseForms(p.html, p.url))
    .filter((f) => new URL(f.action).origin === origin);
  const merged = wireCandidates(safe, origin, forms, tokens);
  const secrets = [
    ...credentials.secrets,
    ...tokens.keys(),
    ...cookies.map((c) => c.value),
    ...forms.flatMap((f) =>
      f.fields
        .filter((p) => sensitive.test(p.name) || p.type === "password")
        .map((p) => p.value ?? ""),
    ),
  ].filter(Boolean);
  const redactSecrets = fallbackRedactor(new Set(secrets));
  const clean = (value: string) => redactSecrets(redact(value));
  return merged
    .filter((c) => c.samples.length)
    .map((c) => {
      if (c.method === "GET" && c.samples.some((r) => approved.has(r.seq)))
        c.sources.push("fallback");
      // Cookie-mapped/session headers and secret examples must never enter a model.
      c.headers = Object.fromEntries(
        Object.entries(c.headers).filter(([k, v]) => !sensitive.test(k) && clean(v) === v),
      );
      c.params = c.params.map((p) => ({
        ...p,
        examples: sensitive.test(p.name) ? [] : p.examples.filter((v) => clean(v) === v),
      }));
      const walk = (value: unknown): unknown => {
        if (typeof value === "string") return clean(value);
        if (Array.isArray(value)) return value.map(walk);
        if (value !== null && typeof value === "object")
          return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
        return value;
      };
      return walk(c) as EndpointCandidate;
    });
}

export interface LearningResult {
  model: SiteModel;
  proposed: Operation[];
  rejected: { candidate: string; reason: string }[];
  observations: Observation[];
}
export interface LearnFallbackOptions {
  model: SiteModel;
  driver: Pick<BrowserDriver, "candidates">;
  request: ActionRequest;
  sessions: SessionProvider;
  persona?: string;
  transport?: ExecutorOptions["fetch"];
  labeller?: Labeller;
  now?: () => Date;
}

/** Only completed fallback runs call this. Writes are demonstrated; reads are executor-verified. */
export async function learnFallback(options: LearnFallbackOptions): Promise<LearningResult> {
  const { model, driver } = options;
  const proposed: Operation[] = [];
  const rejected: LearningResult["rejected"] = [];
  const observations: Observation[] = [];
  const now = (options.now ?? (() => new Date()))().toISOString();
  const runId = `urn:uuid:${randomUUID()}`;
  const ids = new Set([...model.operations, ...model.flows].map((o) => o.id));
  const objectTypes = options.request.values([
    `${SCHEMA}object`,
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
  ]);
  const wantsRead = options.request.types.some((t) =>
    [`${SCHEMA}ViewAction`, `${SCHEMA}SearchAction`].includes(t),
  );
  let readLearned = false;
  const candidates = (await driver.candidates()).sort(
    (a, b) => Math.max(...b.samples.map((r) => r.seq)) - Math.max(...a.samples.map((r) => r.seq)),
  );
  for (const candidate of candidates) {
    const reject = (reason: string) =>
      rejected.push({ candidate: `${candidate.method} candidate`, reason });
    try {
      const write = candidate.method !== "GET" || candidate.sources.includes("fallback");
      if (!write && (!wantsRead || readLearned)) {
        reject(
          wantsRead
            ? "Earlier navigation read; final verified read already selected."
            : "Navigation read for a write request.",
        );
        continue;
      }
      if (
        candidate.form?.hasPassword ||
        candidate.params.some(
          (p) => sensitive.test(p.name) && !candidate.csrf.some((r) => r.target.name === p.name),
        )
      ) {
        reject("Credential-bearing candidate.");
        continue;
      }
      // Never retain redacted URL constants: an unsupported or one-off session token fails closed.
      if (candidate.urlTemplate.includes("[redacted]")) {
        reject("Unresolved session material in URL.");
        continue;
      }
      if (
        candidate.params.some((p) =>
          ["constructor", "__proto__", "prototype"].includes(decodeURIComponent(p.name)),
        )
      ) {
        reject("Reserved parameter name.");
        continue;
      }
      if (
        candidate.csrf.some(
          (r) => r.source.kind !== "cookie" && r.source.urlTemplate.includes("[redacted]"),
        )
      ) {
        reject("Unresolved session source URL.");
        continue;
      }
      const label = await (options.labeller ?? heuristicLabeller).label(candidate);
      if (label.skip) {
        reject("Labeller skipped candidate.");
        continue;
      }
      if (!write && options.request.types.includes(`${SCHEMA}SearchAction`)) {
        label.actionType = `${SCHEMA}SearchAction`;
        label.label = label.label.replace(/^View /, "Search ");
      }
      if (write) {
        // One approved concrete browser write is the only write evidence admitted by candidates().
        const requested = options.request.types.find(
          (t) =>
            t.startsWith(SCHEMA) &&
            /Action$/.test(t) &&
            ![`${SCHEMA}ViewAction`, `${SCHEMA}SearchAction`].includes(t),
        );
        if (requested) {
          label.actionType = requested;
          label.label = `${requested.slice(SCHEMA.length).replace(/Action$/, "")} ${label.label.replace(/^\S+\s*/, "")}`;
        }
        label.effect = "irreversible-write";
      }
      const extraction = write ? undefined : proposeExtraction(candidate);
      if (
        !write &&
        (!extraction || (objectTypes.length && !objectTypes.includes(extraction.itemType)))
      ) {
        reject("No extraction for the requested item type.");
        continue;
      }
      if (extraction) {
        // Human prose is untrusted even when it appears under schema:name.
        for (const field of extraction.fields)
          if (
            !field.datatype &&
            ![`${SCHEMA}identifier`, `${SCHEMA}orderNumber`, `${SCHEMA}priceCurrency`].includes(
              field.property,
            )
          )
            field.untrusted = true;
      }
      const operation = buildOperation(
        candidate,
        { ...label, confidence: Math.min(label.confidence, 0.35) },
        {
          modelId: model.id,
          learnedAt: now,
          derivedFrom: [runId],
          method: "fallback",
          usedIds: ids,
          extraction,
          sessionCookies: [...new Set(candidate.samples.flatMap((r) => r.cookieNames))],
        },
      );
      for (const input of operation.inputs) {
        // Demonstrated personal values are runtime inputs, never model constants/examples.
        if (write) {
          delete input.example;
          if (!input.options) delete input.default;
          const parameter = candidate.params.find((p) => p.name === input.name);
          if (parameter?.required && !parameter.hidden && !input.options) input.required = true;
        }
      }
      // No redacted or credential-bearing constant/default can become executable code.
      if (JSON.stringify(operation).includes("[redacted]")) {
        reject("Unresolved session material in proposed operation.");
        continue;
      }
      if (
        model.operations.some(
          (o) =>
            o.request.method === operation.request.method &&
            o.request.urlTemplate === operation.request.urlTemplate &&
            o.actionType === operation.actionType,
        )
      ) {
        reject("Operation already present.");
        continue;
      }
      if (
        validateSiteModel({ ...model, operations: [...model.operations, ...proposed, operation] })
          .length
      ) {
        reject("Invalid proposed operation.");
        continue;
      }
      // Shared model validation is necessary but executor construction has stricter checks.
      createExecutor({
        model: { ...model, operations: [...model.operations, ...proposed, operation] },
        sessions: options.sessions,
        persona: options.persona,
        fetch: options.transport,
      });
      if (!write) {
        const values = matchRequest(candidate, candidate.samples.at(-1) as RecordedRequest) ?? {};
        const request: ActionRequest = {
          node: "urn:sab:fallback:verify",
          types: [operation.actionType],
          values: (path) =>
            path.length === 1 && path[0] === `${SAB}operation`
              ? [operation.id]
              : operation.inputs
                  .filter((p) => JSON.stringify(p.path) === JSON.stringify(path))
                  .flatMap((p) => (values[p.name] !== undefined ? [values[p.name] as string] : [])),
        };
        // A one-operation executor can only replay this GET. No browser APIRequestContext replay.
        const verifier = createExecutor({
          model: { ...model, operations: [operation], flows: [], login: undefined },
          sessions: options.sessions,
          persona: options.persona,
          fetch: options.transport,
        });
        const result = await verifier.execute(request);
        if (result.status !== "done" || !result.observations.some((o) => o.itemCount > 0)) {
          reject("Executor replay did not extract an item.");
          continue;
        }
        operation.provenance.lastVerified = now;
        operation.provenance.attempts = 1;
        operation.provenance.successes = 1;
        observations.push(...result.observations);
        readLearned = true;
      }
      proposed.push(operation);
    } catch {
      reject("Candidate could not be safely verified.");
    }
  }
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(model.version);
  const updated = {
    ...model,
    version:
      proposed.length && version
        ? `${version[1]}.${version[2]}.${Number(version[3]) + 1}`
        : model.version,
    operations: [...model.operations, ...proposed],
    generatedAt: proposed.length ? now : model.generatedAt,
  };
  // Round-trip enforces the complete serialization contract as well as validation.
  const result = readSiteModel(await writeSiteModel(updated));
  if (validateSiteModel(result).length) throw new Error("Invalid fallback model.");
  return { model: result, proposed, rejected, observations };
}
