// AUTHORED-BY Codex GPT-6.1-Sol
// Opt-in writes ONLY to products this test creates. No model/planner CLI or evaluator.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createExecutorFetch,
  createTaskExecutor,
  loginWithPassword,
  runTask,
  scriptedPlanner,
} from "@jeswr/agent-browser";
import { InMemorySessions } from "@jeswr/site-executor";
import { type Operation, readSiteModel, type SiteModel, writeSiteModel } from "@jeswr/site-model";
import { launchChromium, profileSite } from "@jeswr/site-profiler";
import { DataFactory, Parser, Writer } from "n3";
import { expect, it } from "vitest";
import {
  deleteOwnProduct,
  type ProductFixture,
  productDemonstration,
  productFixture,
} from "./support/admin-product.js";
import { liveTransport } from "./support/live-transport.js";

const s = "https://schema.org/",
  sab = "https://jeswr.org/ns/site-action#";
const { blankNode, namedNode, literal } = DataFactory;
function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing live acceptance value");
  return value;
}
async function action(
  op: Pick<Operation, "id" | "actionType" | "inputs">,
  values: Record<string, string>,
) {
  const root = blankNode();
  const writer = new Writer();
  writer.addQuad(
    root,
    namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
    namedNode(op.actionType),
  );
  writer.addQuad(root, namedNode(`${sab}operation`), literal(op.id));
  const nodes = new Map<string, ReturnType<typeof blankNode>>([["", root]]);
  for (const param of op.inputs) {
    const value = values[param.name];
    if (value === undefined || !param.path.length) continue;
    let node = root;
    param.path.forEach((property, index) => {
      if (index === param.path.length - 1)
        writer.addQuad(node, namedNode(property), literal(value));
      else {
        const key = param.path.slice(0, index + 1).join(" ");
        let child = nodes.get(key);
        if (!child) {
          child = blankNode();
          nodes.set(key, child);
          writer.addQuad(node, namedNode(property), child);
        }
        node = child;
      }
    });
  }
  return new Promise<string>((resolve, reject) =>
    writer.end((err, text) => (err ? reject(err) : resolve(text))),
  );
}
const values = (item: ProductFixture, price = item.price, id?: string) => ({
  name: item.name,
  sku: item.sku,
  price,
  quantity: item.quantity,
  search: item.sku,
  ...(id ? { id } : {}),
});
function operation(model: SiteModel, type: string, route: RegExp) {
  const op = model.operations.find(
    (o) => o.actionType === s + type && route.test(o.request.urlTemplate),
  );
  expect(op, `${type} ${route}`).toBeDefined();
  return requireValue(op);
}
it.skipIf(!process.env.SAB_LIVE_SITE_URL)(
  "learns product writes, names approval targets and refuses a two-product search before deleting one by SKU",
  async () => {
    const startUrl = requireValue(process.env.SAB_LIVE_SITE_URL);
    const origin = new URL(startUrl).origin;
    const credentials = {
      username: process.env.SAB_LIVE_USERNAME ?? "admin",
      password: process.env.SAB_LIVE_PASSWORD ?? "admin1234",
    };
    const demonstrated = productFixture();
    const learned = await profileSite({
      startUrl,
      login: credentials,
      maxPages: 16,
      maxProfileMs: 240000,
      demonstrations: [productDemonstration(origin, demonstrated)],
    });
    expect(learned.warnings.filter((w) => /demonstration .* failed/.test(w))).toEqual([]);
    const model = readSiteModel(await writeSiteModel(learned.model));
    if (process.env.SAB_LIVE_OUTPUT_DIR) {
      await mkdir(process.env.SAB_LIVE_OUTPUT_DIR, { recursive: true, mode: 0o700 });
      await writeFile(
        join(process.env.SAB_LIVE_OUTPUT_DIR, "writes-learning.json"),
        JSON.stringify(
          {
            model,
            trace: learned.trace,
            writeResponses: learned.writeResponses,
            warnings: learned.warnings,
            demonstrated,
            redirects: learned.trace
              .filter(
                (r) =>
                  r.phase === "demonstration" && (r.redirectedTo || r.redirectedFrom !== undefined),
              )
              .map((r) => ({
                seq: r.seq,
                method: r.method,
                url: r.url,
                status: r.status,
                redirectedTo: r.redirectedTo,
                redirectedFrom: r.redirectedFrom,
                bodyTruncated: r.bodyTruncated,
                responsePageError: r.responsePageError,
                contentType: r.contentType,
                bodySample: r.bodySample,
              })),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
    const create = operation(model, "CreateAction", /\/save\/type\//);
    const update = operation(model, "UpdateAction", /\/save\/id\//);
    const remove = operation(model, "DeleteAction", /massDelete/);
    const removeSelection = requireValue(
      model.flows.find((flow) => flow.steps.length === 2 && flow.steps[1]?.operation === remove.id),
    );
    // This opt-in fixture declares the resolver's exact wire scope. Grid transport
    // defaults (isAjax/keywordUpdated) are not selector exemptions in the executor.
    const resolveStep = requireValue(removeSelection.steps[0]);
    const originalRead = requireValue(
      model.operations.find((op) => op.id === resolveStep.operation),
    );
    const resolver = structuredClone(originalRead);
    resolver.id += "-write-scope";
    const scope = new URL(originalRead.request.urlTemplate.replace(/\{[^}]*\}/g, ""));
    scope.search = new URLSearchParams(remove.request.bodyTemplate).toString();
    resolver.request.urlTemplate = scope.href.replace(/%7B([^%]+)%7D/gi, "{$1}");
    resolver.inputs = originalRead.inputs.filter((p) =>
      resolver.request.urlTemplate.includes(`{${p.name}}`),
    );
    resolveStep.operation = resolver.id;
    resolveStep.bind = Object.fromEntries(
      resolver.inputs.map((p) => [p.name, requireValue(resolveStep.bind[p.name])]),
    );
    model.operations.push(resolver);
    const search = operation(model, "SearchAction", /namespace=product_listing/);
    for (const op of [create, update, remove]) {
      expect(op.effect).toBe("irreversible-write");
      expect(op.provenance.method).toBe("demonstration");
      expect(op.csrf?.some((r) => r.target.kind === "form" && r.target.name === "form_key")).toBe(
        true,
      );
    }
    expect(create.inputs.map((p) => p.name).sort()).toEqual(["name", "price", "quantity", "sku"]);
    const sessions = new InMemorySessions();
    const calls: Array<{ method: string; path: string }> = [];
    const transport = liveTransport(origin, calls);
    await loginWithPassword(
      model,
      createExecutorFetch({ model, sessions, fetch: transport }),
      credentials,
    );
    calls.length = 0;
    const executor = createTaskExecutor({
      model,
      sessions,
      fetch: transport,
      writeResponses: learned.writeResponses,
    });
    const item = productFixture();
    const similar = { ...productFixture(), name: `${item.name} Similar` };
    let id: string | undefined;
    let similarId: string | undefined;
    const approvals: Array<{ summary: string; decision: string; calls: number; posts: number }> =
      [];
    const posts = () => calls.filter((c) => c.method === "POST");
    const createTurtle = await action(create, values(item));
    const readTurtle = await action(search, { search: item.sku });
    const decisionQueue = [
      "deny",
      "approve",
      "approve",
      "deny",
      "approve",
      "deny",
      "approve",
    ] as const;
    const last = (history: Array<{ status: string; observations: string }>) => history.at(-1);
    const inspectPrice = (text: string, expected: string) => {
      const facts = new Parser().parse(text);
      expect(
        facts.some((q) => q.predicate.value === `${s}sku` && q.object.value === item.sku),
      ).toBe(true);
      expect(
        facts.some(
          (q) =>
            q.predicate.value === `${s}price` && q.object.value.replace(/[^\d.]/g, "") === expected,
        ),
      ).toBe(true);
    };
    try {
      const trace = await runTask({
        goal: `Create, edit and delete ${item.name}`,
        model,
        executor,
        maxSteps: 20,
        approver: async (approval) => {
          expect(approval.summary).toContain("127.0.0.1:7780");
          expect(approval.summary).toContain(item.name);
          const decision = requireValue(decisionQueue[approvals.length]);
          approvals.push({
            summary: approval.summary,
            decision,
            calls: calls.length,
            posts: posts().length,
          });
          return decision;
        },
        planner: scriptedPlanner([
          { kind: "act", turtle: createTurtle },
          (input) => {
            expect(last(input.history)?.status).toBe("denied");
            expect(calls).toHaveLength(0);
            return { kind: "act", turtle: createTurtle };
          },
          (input) => {
            expect(last(input.history)?.status).toBe("done");
            expect(posts()).toHaveLength(1);
            const facts = new Parser().parse(requireValue(last(input.history)).observations);
            id = facts.find((q) => q.predicate.value === `${s}identifier`)?.object.value;
            expect(id).toMatch(/^\d+$/);
            return { kind: "act", turtle: createTurtle };
          },
          async (input) => {
            expect(last(input.history)?.status).toBe("repeat-blocked");
            expect(posts()).toHaveLength(1);
            return { kind: "act", turtle: await action(create, values(similar)) };
          },
          (input) => {
            expect(last(input.history)?.status).toBe("done");
            expect(posts()).toHaveLength(2);
            const facts = new Parser().parse(requireValue(last(input.history)).observations);
            similarId = facts.find((q) => q.predicate.value === `${s}identifier`)?.object.value;
            expect(similarId).toMatch(/^\d+$/);
            return { kind: "act", turtle: readTurtle };
          },
          async (input) => {
            inspectPrice(requireValue(last(input.history)).observations, "12.34");
            return { kind: "act", turtle: await action(update, values(item, "23.45", id)) };
          },
          async (input) => {
            expect(last(input.history)?.status).toBe("denied");
            expect(calls).toHaveLength(requireValue(approvals.at(-1)).calls);
            return { kind: "act", turtle: await action(update, values(item, "23.45", id)) };
          },
          (input) => {
            expect(last(input.history)?.status).toBe("done");
            expect(posts()).toHaveLength(3);
            return { kind: "act", turtle: readTurtle };
          },
          async (input) => {
            inspectPrice(requireValue(last(input.history)).observations, "23.45");
            return { kind: "act", turtle: await action(removeSelection, { search: item.name }) };
          },
          async (input) => {
            expect(last(input.history)?.status).toBe("refused");
            expect(last(input.history)).toMatchObject({
              error: expect.stringContaining("more than one item"),
            });
            expect(posts()).toHaveLength(3);
            expect(approvals).toHaveLength(5);
            return { kind: "act", turtle: await action(removeSelection, { search: item.sku }) };
          },
          async (input) => {
            expect(last(input.history)?.status).toBe("denied");
            expect(calls).toHaveLength(requireValue(approvals.at(-1)).calls);
            expect(requireValue(approvals.at(-1)).summary).toContain(`Delete "${item.name}`);
            return { kind: "act", turtle: await action(removeSelection, { search: item.sku }) };
          },
          (input) => {
            expect(last(input.history)?.status).toBe("done");
            expect(last(input.history)?.observations).toContain("sab:Completed");
            expect(last(input.history)?.observations).not.toContain("schema:result");
            expect(posts()).toHaveLength(4);
            return { kind: "act", turtle: readTurtle };
          },
          async (input) => {
            expect(last(input.history)?.status).toBe("done");
            const facts = new Parser().parse(requireValue(last(input.history)).observations);
            expect(
              facts.some((q) => q.predicate.value === `${s}sku` && q.object.value === item.sku),
            ).toBe(false);
            expect(facts.find((q) => q.predicate.value === `${s}numberOfItems`)?.object.value).toBe(
              "0",
            );
            return { kind: "act", turtle: await action(search, { search: similar.sku }) };
          },
          (input) => {
            expect(last(input.history)?.status).toBe("done");
            const facts = new Parser().parse(requireValue(last(input.history)).observations);
            expect(
              facts.some((q) => q.predicate.value === `${s}sku` && q.object.value === similar.sku),
            ).toBe(true);
            expect(
              facts.some(
                (q) => q.predicate.value === `${s}name` && q.object.value === similar.name,
              ),
            ).toBe(true);
            expect(facts.find((q) => q.predicate.value === `${s}numberOfItems`)?.object.value).toBe(
              "1",
            );
            return {
              kind: "answer",
              text: "Deleted the intended product by SKU; its similarly named neighbour remains.",
            };
          },
        ]),
      });
      if (process.env.SAB_LIVE_OUTPUT_DIR)
        await writeFile(
          join(process.env.SAB_LIVE_OUTPUT_DIR, "writes-debug.json"),
          JSON.stringify({ approvals, calls, trace }, null, 2),
          { mode: 0o600 },
        );
      console.log(
        "LIVE STATUSES",
        trace.steps.map((step) => ({ status: step.status, error: step.error })),
      );
      expect(trace.outcome).toBe("answer");
      expect(approvals).toHaveLength(7);
      expect(posts().map((c) => c.path)).toEqual([
        expect.stringContaining("/save/type/"),
        expect.stringContaining("/save/type/"),
        expect.stringContaining(`/save/id/${id}/`),
        expect.stringContaining("/massDelete"),
      ]);
      console.log(
        "LEARNED WRITES",
        [create, update, remove].map((o) => ({
          label: o.label,
          method: o.request.method,
          urlTemplate: o.request.urlTemplate,
          inputs: o.inputs,
          csrf: o.csrf,
          effect: o.effect,
        })),
      );
      console.log("APPROVALS", approvals);
      console.log("WRITE ACCEPTANCE", {
        posts: posts(),
        statuses: trace.steps.map((t) => t.status),
        id,
      });
      if (process.env.SAB_LIVE_OUTPUT_DIR) {
        const dir = process.env.SAB_LIVE_OUTPUT_DIR;
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await writeFile(join(dir, "writes-model.ttl"), await writeSiteModel(model), {
          mode: 0o600,
        });
        await writeFile(
          join(dir, "writes-acceptance.json"),
          JSON.stringify({ approvals, calls, trace, warnings: learned.warnings }, null, 2),
          { mode: 0o600 },
        );
      }
    } finally {
      // Best effort through the normal browser UI, with only this task's session and own SKU.
      const browser = await launchChromium();
      try {
        const context = await browser.newContext();
        const bundle = await sessions.get(origin);
        await context.addCookies(
          (bundle?.cookies ?? []).map((c) => ({ ...c, expires: c.expires ?? -1 })),
        );
        await deleteOwnProduct(
          await context.newPage(),
          origin,
          item,
          id ? `${origin}/admin/catalog/product/edit/id/${id}/` : undefined,
        );
        await deleteOwnProduct(
          await context.newPage(),
          origin,
          similar,
          similarId ? `${origin}/admin/catalog/product/edit/id/${similarId}/` : undefined,
        );
      } finally {
        await browser.close();
      }
    }
  },
  360000,
);
