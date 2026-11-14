// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// profileSite: learn a site once and return its SiteModel. Runs the steps in order (login, crawl,
// script analysis and probes, demonstrations, templates, forms, extraction, labelling, flows,
// verification) and keeps the learning rule: writes enter the model only from demonstrations.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { registerCookieSecrets, type SecretCookie, secretRedactor } from "@jeswr/site-executor";
import type { Extraction, LearnMethod, LoginRoute, Operation, SiteModel } from "@jeswr/site-model";
import type { Browser } from "playwright";
import { crawl, navigationLinks } from "./crawl.js";
import { buildFlow, type DemoStep, runDemonstration } from "./demonstrations.js";
import { emptyListProbe } from "./empty-list-probe.js";
import { applyExtraction, proposeHtmlExtraction, proposeJsonExtraction } from "./extraction.js";
import { addFilterInputs } from "./filters.js";
import { isCsrfFieldName, parseForms } from "./forms.js";
import { attr, parseHtml, selectAll } from "./html.js";
import { htmlRecordExtractions } from "./html-records.js";
import { learnIdentityLinks } from "./identity-links.js";
import { heuristicLabeller, isLoginCandidate } from "./labeller.js";
import { type LoginObservation, performLogin, probeCandidates, refreshInfo } from "./login.js";
import { addNavigationInputs } from "./navigation-inputs.js";
import { buildOperation } from "./operations.js";
import { Recorder } from "./recorder.js";
import { analyseScripts } from "./scripts.js";
import { learnFilterSelections } from "./selection.js";
import { discoverCredentialSources, discoverSessionTokens, redactTrace } from "./session-tokens.js";
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
} from "./types.js";
import {
  expandTemplate,
  isDangerousLink,
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
import { learnDemonstratedForm } from "./write-learning.js";
import { learnWriteResponses } from "./write-responses.js";

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
    if (isJsonType(sample.contentType)) ex = proposeJsonExtraction(body, c.urlTemplate);
    else if (isHtmlType(sample.contentType)) ex = proposeHtmlExtraction(body, sample.url);
    if (!ex) continue;
    const items = applyExtraction(ex, body, sample.url).filter((i) => Object.keys(i).length);
    const score = items.length * 10 + ex.fields.length;
    if (!best || score > best.score) best = { ex, score };
  }
  return best?.ex;
}

export function probeValues(
  c: EndpointCandidate,
  word: string,
  knownIds: Set<string>,
): Record<string, string> | undefined {
  const values: Record<string, string> = {};
  for (const p of c.params) {
    const example = p.examples[0] ?? p.selected;
    if (example !== undefined) {
      values[p.name] = example;
      continue;
    }
    if (p.location === "path") {
      const want = p.kind === "sku" ? "sku" : "numeric";
      const id = [...knownIds].find((v) => valueKind(v) === want);
      if (!id) return undefined;
      values[p.name] = id;
    } else if (p.location === "query") {
      if (/^(page|p)$/i.test(p.name)) values[p.name] = "1";
      else if (/^(q|query|search|keyword|keywords|term|s|text)$/i.test(p.name))
        values[p.name] = word;
      else if (p.required) return undefined;
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
  const cookieSecrets = new Set<string>();
  const loginCookieNames = new Set<string>();
  let cookieModel: Pick<SiteModel, "login" | "operations"> | undefined;
  const retainedCookies = new Map<string, SecretCookie>();
  const cookieContext = () => ({ loginCookieNames: [...loginCookieNames], model: cookieModel });
  const reregisterCookies = () => {
    for (const cookie of retainedCookies.values())
      registerCookieSecrets(cookieSecrets, cookie, cookieContext());
  };
  const recorder = new Recorder(origin, (cookie, loginResponse) => {
    retainedCookies.set(JSON.stringify([cookie.name, cookie.value, cookie.httpOnly]), cookie);
    if (loginResponse && !loginCookieNames.has(cookie.name)) {
      loginCookieNames.add(cookie.name);
      reregisterCookies();
    }
    registerCookieSecrets(cookieSecrets, cookie, cookieContext());
  });
  await recorder.attach(context);
  const maxProfileMs = options.maxProfileMs ?? 180_000;
  if (
    !Number.isSafeInteger(maxProfileMs) ||
    maxProfileMs < 1 ||
    !Number.isSafeInteger(options.maxPages ?? 40) ||
    (options.maxPages ?? 40) < 1 ||
    [options.navigationTimeoutMs ?? 15000, options.networkIdleTimeoutMs ?? 5000].some(
      (v) => !Number.isSafeInteger(v) || v < 1,
    )
  ) {
    await context.close();
    if (!options.browser) await browser.close();
    throw new Error("Profile time and page budgets must be positive integers");
  }
  context.setDefaultTimeout(Math.min(15_000, maxProfileMs));
  context.setDefaultNavigationTimeout(
    Math.min(options.navigationTimeoutMs ?? 15_000, maxProfileMs),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Profile time limit exceeded")), maxProfileMs);
  });
  const learn = async (): Promise<ProfileResult> => {
    const readCookies = async () => {
      const cookies = await context.cookies();
      recorder.rememberCookies(cookies);
      return cookies;
    };
    // 8a. Sign in first (user-authorised), so the crawl also sees signed-in pages.
    let login: LoginObservation | undefined;
    if (options.login) {
      login = await performLogin(context, recorder, startUrl, options.login);
      for (const name of login.sessionCookies) loginCookieNames.add(name);
      reregisterCookies();
      await readCookies();
      if (!login.success) warnings.push(`login: ${login.error ?? "failed"}`);
    }

    // 1. Crawl.
    const crawled = await crawl(context, recorder, {
      startUrl,
      maxPages: options.maxPages ?? 40,
      navigationTimeoutMs: options.navigationTimeoutMs ?? 15_000,
      networkIdleTimeoutMs: options.networkIdleTimeoutMs ?? 5_000,
      maxCrawlMs: Math.min(maxProfileMs, 120_000),
    });
    let tokens = discoverSessionTokens(
      crawled.pages.map((p) => ({ url: p.finalUrl, html: p.html })),
      await readCookies(),
      recorder.trace,
      cookieContext(),
    );
    warnings.push(...crawled.warnings);

    // 4. Scripts.
    const scripts = analyseScripts(recorder.trace);
    if (scripts.skipped)
      warnings.push(
        `scripts: skipped ${scripts.skipped} oversized, truncated or unparseable scripts`,
      );
    const scriptCandidates = scripts.calls
      .map(candidateFromScriptCall)
      .filter((c): c is EndpointCandidate => c !== undefined);

    // Probe reads the scripts would make but the crawl never triggered (GET only).
    let knownIds = collectKnownIds(recorder.trace);
    const seenKeys = new Set(
      clusterRequests(recorder.trace, origin, knownIds, tokens).map((c) => c.key),
    );
    const prober = playwrightReplayer(context, recorder, "probe");
    const probed = new Set<string>();
    for (const c of scriptCandidates) {
      if (
        probed.size >= 30 ||
        c.method !== "GET" ||
        isDangerousLink(c.urlTemplate) ||
        seenKeys.has(c.key) ||
        probed.has(c.key)
      )
        continue;
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

    // A user's saved search may return zero rows. Clear only its ordinary search on
    // the witnessed GET, preserving dispatch/session fields and never saving preferences.
    const emptyProbes = new Set<string>();
    for (const sample of recorder.trace.slice()) {
      const url = emptyListProbe(sample);
      if (!url || emptyProbes.size >= 8 || emptyProbes.has(url)) continue;
      emptyProbes.add(url);
      await prober
        .get(url, {
          signedIn: true,
          headers: Object.fromEntries(
            Object.entries(sample.requestHeaders).filter(([name]) =>
              /^x-requested-with$|^accept$/i.test(name),
            ),
          ),
        })
        .catch(() => undefined);
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

    tokens = discoverSessionTokens(
      [
        ...crawled.pages.map((p) => ({ url: p.finalUrl, html: p.html })),
        ...recorder.trace
          .filter((r) => r.phase === "demonstration" && r.bodySample && isHtmlType(r.contentType))
          .map((r) => ({ url: r.url, html: r.bodySample ?? "" })),
      ],
      await readCookies(),
      recorder.trace,
      cookieContext(),
    );
    for (const r of recorder.trace)
      if (r.postDataTruncated || r.postDataUnsupported)
        warnings.push(
          `write body omitted (${r.postDataTruncated ? "size limit" : "unsupported form"}); not used to learn an operation`,
        );

    // 2 + 3. Templates and forms; merge with script evidence.
    knownIds = collectKnownIds(recorder.trace);
    const clusters = clusterRequests(recorder.trace, origin, knownIds, tokens);
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
    // Redirect aliases are witnessed GET routes to the same form, useful when a
    // canonical URL appends an item-specific display slug after its identity.
    for (const r of recorder.trace) {
      if (r.method !== "GET" || !r.redirectedTo || ![301, 302, 303].includes(r.status ?? 0))
        continue;
      const destination = formPages.find((p) => p.url === r.redirectedTo);
      if (destination) formPages.push({ url: r.url, html: destination.html });
    }
    if (login?.form)
      formCandidates.push(
        candidateFromForm(login.form, templateForPage(clusters, login.form.pageUrl)),
      );
    for (const page of formPages) {
      for (const form of parseForms(page.html, page.url)) {
        if (
          new URL(form.action).origin !== origin ||
          (form.method === "GET" && form.fields.every((f) => f.hidden))
        )
          continue;
        const candidate = candidateFromForm(form, templateForPage(clusters, page.url));
        const observed = clusters.find((c) =>
          matchRequest(c, {
            method: form.method,
            url: form.action,
            requestHeaders: {},
          } as RecordedRequest),
        );
        if (observed) {
          candidate.key = observed.key;
          candidate.urlTemplate = observed.urlTemplate;
          candidate.params.unshift(...observed.params.filter((p) => p.location === "path"));
        }
        formCandidates.push(candidate);
      }
    }
    const candidates = mergeCandidates([...clusters, ...formCandidates, ...scriptCandidates])
      .map((c) => addFilterInputs(c, formPages))
      .map((c) => addNavigationInputs(c, formPages))
      .map((c) => learnDemonstratedForm(c, formPages));

    // 5 + 6. Extraction proposals and labels; decide what enters the model.
    const usedIds = new Set<string>();
    const operations: Operation[] = [];
    const opCandidate = new Map<string, EndpointCandidate>();
    const loginOps: Array<{ op: Operation; candidate: EndpointCandidate }> = [];
    const sessionCookies = login?.sessionCookies ?? [];
    // A JSON list with an observed search input supports both browsing and searching.
    // The view variant drops both the search input and its optional URL slot.
    const readableCandidates = candidates.flatMap((c) =>
      c.method === "GET" &&
      c.responseKind === "json" &&
      c.params.some((p) => /^(q|query|search|keyword|keywords|term|s|text)$/i.test(p.name)) &&
      proposeExtraction(c)?.itemPath !== undefined
        ? [
            c,
            {
              ...c,
              urlTemplate: c.urlTemplate.replace(
                /\{([?&])([^}]+)\}/g,
                (_match, operator: string, variables: string) => {
                  const retained = variables
                    .split(",")
                    .filter(
                      (name) => !/^(q|query|search|keyword|keywords|term|s|text)$/i.test(name),
                    );
                  return retained.length ? `{${operator}${retained.join(",")}}` : "";
                },
              ),
              params: c.params.filter(
                (p) => !/^(q|query|search|keyword|keywords|term|s|text)$/i.test(p.name),
              ),
            },
          ]
        : [c],
    );
    for (const c of readableCandidates) {
      if (c.unsupported) {
        warnings.push(`write omitted: ${c.unsupported}`);
        continue;
      }
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
        if (
          !c.samples.some(
            (r) =>
              r.phase === "demonstration" &&
              !r.blocked &&
              r.status !== undefined &&
              r.status >= 200 &&
              r.status < 400,
          )
        ) {
          if (demoRunIds.length) continue;
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
      if (c.method === "GET" && c.responseKind === "json" && !extraction) continue;
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
      // The contract has one extraction per operation. Additional record classes get
      // their own read, preserving the same observed request and verification path.
      if (extraction?.format === "html") {
        const seenTypes = new Set([extraction.itemType]);
        for (const sample of c.samples) {
          if (!sample.bodySample || sample.bodyTruncated || sample.status !== 200) continue;
          for (const extra of htmlRecordExtractions(sample.bodySample, sample.url)) {
            if (seenTypes.has(extra.itemType)) continue;
            seenTypes.add(extra.itemType);
            const view = buildOperation(
              c,
              { ...label, label: `${label.label} ${extra.itemType?.split("/").at(-1)}` },
              {
                modelId,
                learnedAt,
                derivedFrom: [runId],
                method,
                usedIds,
                sessionCookies,
                extraction: extra,
              },
            );
            operations.push(view);
            opCandidate.set(view.id, c);
          }
        }
      }
    }

    learnIdentityLinks(operations, recorder.trace, origin);
    cookieModel = { operations };
    reregisterCookies();

    // 9. Verify reads.
    const verifier = playwrightReplayer(context, recorder, "verify");
    let verifiedOps = operations;
    if (options.verify !== false) {
      const v = await verifyOperations(operations, {
        replayer: verifier,
        now,
        haveSession: Boolean(login?.success),
        recordedRequests: recorder.trace.slice(),
      });
      verifiedOps = v.operations;
      warnings.push(...v.warnings);
    }
    const byId = new Map(verifiedOps.map((op) => [op.id, op]));

    // 7b. Selection witnesses and their explicit resolver flows survive RDF round trips.
    const selected = learnFilterSelections(verifiedOps, modelId, usedIds);
    warnings.push(...selected.warnings);
    const flows = [...selected.selections.values()].map((selection) => selection.flow);
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
          // A page often repeats a read (for example a total refetched after an option changes);
          // a read immediately repeated by the same operation is superseded, so keep the latest.
          const prev = steps.at(-1);
          if (prev?.operation.id === id && prev.operation.effect === "read") steps.pop();
          steps.push({ request: r, operation: byId.get(id) as Operation, values });
          break;
        }
      }
      const built = buildFlow(run, steps, {
        modelId,
        learnedAt,
        derivedFrom: [run.runId],
        usedIds,
        selections: selected.selections,
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
        const pageUrls = [
          ...crawled.pages.map((p) => p.finalUrl),
          ...crawled.pages.flatMap((page) =>
            navigationLinks(page.html).flatMap(([href, label]) => {
              try {
                const url = new URL(href, page.finalUrl);
                return url.origin === origin && !url.search && !isDangerousLink(url.href, label)
                  ? [url.href]
                  : [];
              } catch {
                return [];
              }
            }),
          ),
        ];
        const verifiedSignedInReads = verifiedOps
          .filter(
            (read) =>
              read.effect === "read" &&
              read.session === "signed-in" &&
              read.request.method === "GET" &&
              (read.provenance.successes ?? 0) > 0 &&
              !/[{?]/.test(read.request.urlTemplate),
          )
          .map((read) => read.request.urlTemplate);
        const probe = await findProbeUrl(
          probeCandidates(login, pageUrls, verifiedSignedInReads),
          verifier,
        );
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
    cookieModel = model;
    reregisterCookies();
    if (!verifiedOps.some((op) => op.actionType === s("SearchAction")))
      warnings.push("no search operation learned");
    const tokenFields = [
      ...formPages.flatMap((page) => parseForms(page.html, page.url)),
      ...(login?.form ? [login.form] : []),
    ].flatMap((f) =>
      f.fields.filter((p) => p.hidden && isCsrfFieldName(p.name)).map((p) => p.value ?? ""),
    );
    const secrets = [
      ...tokens.keys(),
      ...discoverCredentialSources(formPages, await readCookies(), recorder.trace, cookieContext())
        .secrets,
      ...cookieSecrets,
      ...candidates.flatMap((candidate) =>
        candidate.csrf.flatMap(({ source }) => {
          if (source.kind !== "html" && source.kind !== "meta") return [];
          return formPages.flatMap((page) => {
            const doc = parseHtml(page.html);
            const selector = source.kind === "html" ? source.selector : "meta[name]";
            return selectAll(doc, selector).flatMap((el) => {
              if (source.kind === "meta" && attr(el, "name") !== source.name) return [];
              const value = attr(el, source.kind === "html" ? source.attribute : "content");
              return value ? [value] : [];
            });
          });
        }),
      ),
      ...tokenFields,
      ...(options.login ? [options.login.password] : []),
    ];
    // Demonstration cleanup can remove the landing resource before read verification.
    // Its recorded response and learned read still supply the witnessed response policy.
    const writeResponses = learnWriteResponses(operations, recorder.trace, origin, verifiedOps);
    const redact = secretRedactor(new Set(secrets));
    for (const [id, policy] of Object.entries(writeResponses)) {
      const encoded = JSON.stringify(policy);
      if (redact(encoded) !== encoded) delete writeResponses[id];
    }
    return {
      model,
      writeResponses,
      trace: redactTrace(recorder.trace, secrets),
      warnings: redactTraceStrings(warnings, secrets),
    };
  };
  try {
    return await Promise.race([learn(), timeout]);
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => undefined);
    if (!options.browser) await browser.close().catch(() => undefined);
  }
}

function redactTraceStrings(values: string[], secrets: string[]): string[] {
  return values.map(secretRedactor(new Set(secrets)));
}
