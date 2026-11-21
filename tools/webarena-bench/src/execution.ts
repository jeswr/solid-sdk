// AUTHORED-BY Claude Opus 5.5
import { createTaskExecutor, type TaskExecutor } from "@jeswr/agent-browser";
import { guardUrl, type InMemorySessions, type Plan, siteOrigin } from "@jeswr/site-executor";
import { type ActionRequest, SCHEMA, type SiteModel } from "@jeswr/site-model";
import type { Transport } from "./types.js";

/** Keep independent origin guards/jars; ambiguous cross-site action types fail visibly. */
export function combineExecutors(executors: TaskExecutor[]): TaskExecutor {
  const first = executors[0];
  if (!first) throw new Error("No site models.");
  const model: SiteModel = {
    ...first.model,
    login: undefined,
    operations: executors.flatMap((e) => e.model.operations),
    flows: executors.flatMap((e) => e.model.flows),
  };
  const owners = new Map<string, TaskExecutor>();
  const choose = (request: ActionRequest): { executor?: TaskExecutor; plan: Plan } => {
    let candidates = executors.map((executor) => ({
      executor,
      plan: executor.planToRequests(request),
    }));
    // An observed object/url identity can select a site without exposing endpoints to the planner.
    const urls = ["object", "url", "target"]
      .flatMap((name) => request.values([`${SCHEMA}${name}`]))
      .filter((v) => /^https?:\/\//.test(v));
    const origins = new Set(urls.map((u) => new URL(u).origin));
    if (origins.size === 1) {
      const local = candidates.filter((c) => origins.has(siteOrigin(c.executor.model.site)));
      if (local.length) candidates = local;
    }
    const matches = candidates.filter((c) => c.plan.status === "planned");
    if (matches.length === 1 && matches[0]) return matches[0];
    if (matches.length > 1)
      return {
        plan: {
          status: "ambiguous",
          requests: [],
          error: "Action matches more than one site; use an observed object IRI.",
        },
      };
    return (
      candidates.find((c) => c.plan.status === "ambiguous") ??
      candidates[0] ?? { plan: { status: "no-path", requests: [] } }
    );
  };
  return {
    model,
    planToRequests: (request) => choose(request).plan,
    approve: (id) => owners.get(id)?.approve?.(id) ?? false,
    reject: (id) => owners.get(id)?.reject?.(id) ?? false,
    redact: (value) => executors.reduce((out, executor) => executor.redact?.(out) ?? out, value),
    async execute(request, options) {
      const choice = options?.approvalId
        ? { executor: owners.get(options.approvalId) }
        : choose(request);
      if (!choice.executor)
        return {
          status: "ambiguous",
          observations: [],
          committed: [],
          requests: 0,
          error: "Action matches multiple sites; use an observed object IRI.",
        };
      const result = await choice.executor.execute(request, options);
      if (result.approval) owners.set(result.approval.id, choice.executor);
      return result;
    },
  };
}

/** Fetch an agent-identified page through the executor's guards, cookie handling and redirects. */
export async function getPage(
  model: SiteModel,
  sessions: InMemorySessions,
  transport: Transport,
  url: string,
  timeoutMs: number,
) {
  const pageUrl = guardUrl(url, siteOrigin(model.site)).href;
  const operation = {
    id: "urn:webarena-bench:page",
    actionType: `${SCHEMA}ViewAction`,
    label: "View identified page",
    inputs: [],
    request: { method: "GET" as const, urlTemplate: pageUrl },
    extraction: { format: "html" as const, itemType: `${SCHEMA}WebPage`, fields: [] },
    effect: "read" as const,
    session: model.login?.length ? ("signed-in" as const) : ("none" as const),
    provenance: {
      derivedFrom: [],
      method: "crawl" as const,
      confidence: 1,
      learnedAt: new Date().toISOString(),
    },
  };
  const executor = createTaskExecutor({
    model: { ...model, login: undefined, operations: [operation], flows: [] },
    sessions,
    fetch: transport,
    maxExecutionMs: Math.max(1, timeoutMs),
  });
  return executor.execute({
    node: "urn:webarena-bench:page-request",
    types: [operation.actionType],
    values: () => [],
  });
}
