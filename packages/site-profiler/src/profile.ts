// AUTHORED-BY Claude Opus 5.5
// profileSite: learn a site once and return its SiteModel. Runs the steps in order (login, crawl,
// script analysis and probes, demonstrations, templates, forms, extraction, labelling, flows,
// verification) and keeps the learning rule: writes enter the model only from demonstrations.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Extraction, LearnMethod, LoginRoute, Operation, SiteModel } from "@jeswr/site-model";
import type { Browser } from "playwright";
import { crawl } from "./crawl.js";
import { buildFlow, type DemoStep, runDemonstration } from "./demonstrations.js";
import { applyExtraction, proposeHtmlExtraction, proposeJsonExtraction } from "./extraction.js";
import { parseForms } from "./forms.js";
import { heuristicLabeller, isLoginCandidate } from "./labeller.js";
import { type LoginObservation, performLogin, probeCandidates, refreshInfo } from "./login.js";
import { buildOperation } from "./operations.js";
import { Recorder } from "./recorder.js";
import { analyseScript } from "./scripts.js";
import {
  candidateFromForm,
  candidateFromScriptCall,
  clusterRequests,
  collectKnownIds,
  matchRequest,
  mergeCandidates,
  templateForPage,
} from "./templates.js";
import type {
  EndpointCandidate,
  Label,
  ProfileOptions,
  ProfileResult,
  RecordedRequest,
  ScriptCall,
} from "./types.js";
import {
  expandTemplate,
  isHtmlType,
  isJsonType,
  isStatic,
  normaliseUrl,
  s,
  sab,
  uniq,
  valueKind,
} from "./util.js";
import { findProbeUrl, playwrightReplayer, verifyOperations } from "./verify.js";

const FALLBACK_CHROMIUM = ["/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"];

/** Launch headless Chromium; SAB_CHROMIUM_PATH overrides the executable. */
export async function launchChromium(): Promise<Browser> {
  const { chromium } = await import("playwright");
  const override = process.env.SAB_CHROMIUM_PATH;
  if (override)
    return chromium.launch({ headless: true, executablePath: override, args: ["--no-sandbox"] });
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const fallback = FALLBACK_CHROMIUM.find((p) => existsSync(p));
    if (!fallback) throw err;
    return chromium.launch({ headless: true, executablePath: fallback, args: ["--no-sandbox"] });
  }
}

/** Best extraction over a candidate's response samples: the one that yields the most filled items. */
export function proposeExtraction(c: EndpointCandidate): Extraction | undefined {
  let best: { ex: Extraction; score: number } | undefined;
  for (const sample of c.samples) {
    const body = sample.bodySample;
    if (!body || sample.bodyTruncated || (sample.status ?? 0) >= 400) continue;
    let ex: Extraction | undefined;
    if (isJsonType(sample.contentType)) ex = proposeJsonExtraction(body);
    else if (isHtmlType(sample.contentType)) ex = proposeHtmlExtraction(body);
    if (!ex) continue;
    const items = applyExtraction(ex, body, sample.url).filter((i) => Object.keys(i).length);
    const score = items.length * 10 + ex.fields.length;
    if (!best || score > best.score) best = { ex, score };
  }
  return best?.ex;
}

function probeValues(
  c: EndpointCandidate,
  word: string,
  knownIds: Set<string>,
): Record<string, string> | undefined {
  const values: Record<string, string> = {};
  for (const p of c.params) {
    if (p.location === "path") {
      const want = p.kind === "sku" ? "sku" : "numeric";
      const id = [...knownIds].find((v) => valueKind(v) === want);
      if (!id) return undefined;
      values[p.name] = id;
    } else if (p.location === "query") {
      values[p.name] = /^(page|p)$/i.test(p.name) ? "1" : word;
    }
  }
  return values;
}

function learnMethod(c: EndpointCandidate): LearnMethod {
  if (c.method !== "GET") return "demonstration";
  if (c.sources.includes("crawl")) return c.sources.includes("form") ? "form" : "crawl";
  if (c.sources.includes("js-analysis")) return "js-analysis";
  return "demonstration";
}

function specificity(c: EndpointCandidate): number {
  return c.urlTemplate.replace(/\{[^}]*\}/g, "").length;
}

export async function profileSite(options: ProfileOptions): Promise<ProfileResult> {
  const now = options.now ?? (() => new Date());
  const startUrl = normaliseUrl(options.startUrl);
  if (!startUrl) throw new Error(`Bad start URL: ${options.startUrl}`);
  const origin = new URL(startUrl).origin;
  const modelId = options.modelId ?? `urn:sab:model:${new URL(startUrl).host}`;
  const learnedAt = now().toISOString();
  const runId = `urn:uuid:${randomUUID()}`;
  const labeller = options.labeller ?? heuristicLabeller;
  const warnings: string[] = [];

  const browser = options.browser ?? (await launchChromium());
  const context = await browser.newContext({ serviceWorkers: "block" });
  const recorder = new Recorder(origin);
  await recorder.attach(context);
  try {
    // 8a. Sign in first (user-authorised), so the crawl also sees signed-in pages.
    let login: LoginObservation | undefined;
    if (options.login) {
      login = await performLogin(context, recorder, startUrl, options.login);
      if (!login.success) warnings.push(`login: ${login.error ?? "failed"}`);
    }

    // 1. Crawl.
    const crawled = await crawl(context, recorder, { startUrl, maxPages: options.maxPages ?? 40 });
    warnings.push(...crawled.warnings);

    // 4. Scripts.
    const scriptCalls: ScriptCall[] = [];
    const scriptUrls = new Set<string>();
    for (const r of recorder.trace) {
      if (r.resourceType !== "script" || !r.bodySample || scriptUrls.has(r.url)) continue;
      scriptUrls.add(r.url);
      const analysis = analyseScript(r.bodySample, r.url);
      if (analysis.error) warnings.push(`scripts: ${analysis.error}`);
      scriptCalls.push(...analysis.calls);
    }
    const scriptCandidates = scriptCalls
      .map(candidateFromScriptCall)
      .filter((c): c is EndpointCandidate => c !== undefined);

    // Probe reads the scripts would make but the crawl never triggered (GET only).
    let knownIds = collectKnownIds(recorder.trace);
    const seenKeys = new Set(clusterRequests(recorder.trace, origin, knownIds).map((c) => c.key));
    const prober = playwrightReplayer(context, recorder, "probe");
    const probed = new Set<string>();
    for (const c of scriptCandidates) {
      if (c.method !== "GET" || seenKeys.has(c.key) || probed.has(c.key)) continue;
      probed.add(c.key);
      if (c.authScheme) {
        warnings.push(`probe: ${c.urlTemplate} needs a ${c.authScheme} token; not probed`);
        continue;
      }
      const values = probeValues(c, crawled.sampleWord, knownIds);
      if (!values) {
        warnings.push(`probe: no sample values for ${c.urlTemplate}`);
        continue;
      }
      await prober
        .get(expandTemplate(c.urlTemplate, values), { signedIn: true })
        .catch((err: Error) => {
          warnings.push(`probe: ${c.urlTemplate} failed: ${err.message}`);
        });
    }

    // 7a. Demonstrations.
    const demoRuns: Array<{
      name: string;
      description?: string;
      runId: string;
      requests: RecordedRequest[];
    }> = [];
    for (const demo of options.demonstrations ?? []) {
      const res = await runDemonstration(context, recorder, demo);
      if (res.error) warnings.push(res.error);
      const run: (typeof demoRuns)[number] = {
        name: demo.name,
        runId: `urn:uuid:${randomUUID()}`,
        requests: res.requests,
      };
      if (demo.description) run.description = demo.description;
      demoRuns.push(run);
    }
    const blockedWrites = recorder.trace.filter((r) => r.blocked);
    for (const r of blockedWrites)
      warnings.push(`guard: blocked ${r.method} ${r.url} during ${r.phase}`);

    // 2 + 3. Templates and forms; merge with script evidence.
    knownIds = collectKnownIds(recorder.trace);
    const clusters = clusterRequests(recorder.trace, origin, knownIds);
    const formCandidates: EndpointCandidate[] = [];
    const formPages: Array<{ url: string; html: string }> = crawled.pages.map((p) => ({
      url: p.finalUrl,
      html: p.html,
    }));
    for (const r of recorder.trace) {
      if (
        r.phase === "demonstration" &&
        r.resourceType === "document" &&
        r.bodySample &&
        isHtmlType(r.contentType)
      ) {
        formPages.push({ url: r.url, html: r.bodySample });
      }
    }
    if (login?.form)
      formCandidates.push(
        candidateFromForm(login.form, templateForPage(clusters, login.form.pageUrl)),
      );
    for (const page of formPages) {
      for (const form of parseForms(page.html, page.url)) {
        if (new URL(form.action).origin !== origin) continue;
        formCandidates.push(candidateFromForm(form, templateForPage(clusters, page.url)));
      }
    }
    const candidates = mergeCandidates([...clusters, ...formCandidates, ...scriptCandidates]);

    // 5 + 6. Extraction proposals and labels; decide what enters the model.
    const usedIds = new Set<string>();
    const operations: Operation[] = [];
    const opCandidate = new Map<string, EndpointCandidate>();
    const loginOps: Array<{ op: Operation; candidate: EndpointCandidate }> = [];
    const sessionCookies = login?.sessionCookies ?? [];
    for (const c of candidates) {
      const label: Label = await labeller.label(c);
      if (label.skip) continue;
      const demoRunIds = uniq(
        c.samples
          .filter((x) => x.phase === "demonstration")
          .map((x) => demoRuns.find((d) => d.name === x.demonstration)?.runId)
          .filter((x): x is string => x !== undefined),
      );
      const isLogin = label.actionType === sab("LoginAction") || isLoginCandidate(c);
      if (isLogin) {
        const fromLogin = c.form && login?.form && c.form.action === login.form.action;
        if (!fromLogin && !c.script) continue;
        const op = buildOperation(c, label, {
          modelId,
          learnedAt,
          derivedFrom: [runId],
          method: fromLogin ? "form" : "js-analysis",
          usedIds,
          sessionCookies: [],
        });
        if (!fromLogin) op.provenance.confidence = Math.min(op.provenance.confidence, 0.5);
        operations.push(op);
        opCandidate.set(op.id, c);
        loginOps.push({ op, candidate: c });
        continue;
      }
      if (c.method !== "GET") {
        if (!demoRunIds.length) {
          const from = c.sources.join(", ");
          warnings.push(
            `write ${c.method} ${c.urlTemplate} (${from}) left out: writes are learned only from demonstrations`,
          );
          continue;
        }
      } else if (!c.samples.some((x) => x.status !== undefined && x.status < 400)) {
        continue;
      }
      const extraction = c.method === "GET" ? proposeExtraction(c) : undefined;
      if (c.method === "GET" && !extraction && c.params.length === 0 && c.responseKind === "html")
        continue;
      const method = learnMethod(c);
      const op = buildOperation(c, label, {
        modelId,
        learnedAt,
        derivedFrom: method === "demonstration" ? demoRunIds : [runId],
        method,
        usedIds,
        sessionCookies,
        ...(extraction ? { extraction } : {}),
      });
      operations.push(op);
      opCandidate.set(op.id, c);
    }

    // 9. Verify reads.
    const verifier = playwrightReplayer(context, recorder, "verify");
    let verifiedOps = operations;
    if (options.verify !== false) {
      const v = await verifyOperations(operations, {
        replayer: verifier,
        now,
        haveSession: Boolean(login?.success),
      });
      verifiedOps = v.operations;
      warnings.push(...v.warnings);
    }
    const byId = new Map(verifiedOps.map((op) => [op.id, op]));

    // 7b. Flows from demonstrations.
    const flows = [];
    const matchable = [...opCandidate.entries()]
      .filter(([id]) => byId.has(id))
      .sort(([, a], [, b]) => specificity(b) - specificity(a));
    for (const run of demoRuns) {
      const steps: DemoStep[] = [];
      for (const r of run.requests) {
        if (r.blocked || isStatic(r.url, r.resourceType) || r.status === undefined) continue;
        for (const [id, c] of matchable) {
          const values = matchRequest(c, r);
          if (!values) continue;
          steps.push({ request: r, operation: byId.get(id) as Operation, values });
          break;
        }
      }
      const built = buildFlow(run, steps, {
        modelId,
        learnedAt,
        derivedFrom: [run.runId],
        usedIds,
      });
      warnings.push(...built.warnings);
      if (built.flow) flows.push(built.flow);
    }

    // 8b. Login routes.
    const loginRoutes: LoginRoute[] = [];
    for (const { op, candidate } of loginOps) {
      if (!byId.has(op.id)) continue;
      if (candidate.form && login?.success) {
        const route: LoginRoute = { method: "password", operation: op.id };
        if (login.sessionCookies.length) route.sessionCookies = login.sessionCookies;
        const pageUrls = crawled.pages.map((p) => p.finalUrl);
        const probe = await findProbeUrl(probeCandidates(login, pageUrls), verifier);
        if (probe) route.probeUrl = probe;
        loginRoutes.push(route);
      } else if (!candidate.form) {
        const route: LoginRoute = { method: "password", operation: op.id };
        const refresh = refreshInfo(candidates);
        if (refresh) route.refresh = refresh;
        loginRoutes.push(route);
      }
    }

    const model: SiteModel = {
      id: modelId,
      site: origin,
      version: options.version ?? "0.1.0",
      generatedAt: learnedAt,
      operations: verifiedOps,
      flows,
    };
    if (loginRoutes.length) model.login = loginRoutes;
    if (!verifiedOps.some((op) => op.actionType === s("SearchAction")))
      warnings.push("no search operation learned");
    return { model, trace: recorder.trace, warnings };
  } finally {
    await context.close().catch(() => undefined);
    if (!options.browser) await browser.close().catch(() => undefined);
  }
}
