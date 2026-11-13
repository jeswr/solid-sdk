// AUTHORED-BY Claude Opus 5.5
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scriptedPlanner, type TaskTrace } from "@jeswr/agent-browser";
import { writeSiteModel } from "@jeswr/site-model";
import { type RunningShop, startShop } from "@jeswr/test-shop";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { evaluateBenchmark } from "../src/evaluate.js";
import type { HarEntry } from "../src/har.js";
import { runBenchmark } from "../src/run.js";
import type { BenchTask } from "../src/types.js";
import { fixtureConfig } from "./helpers.js";
import { transport } from "./memory-shop.js";
import { checkReference } from "./reference-check.js";
import { action, login, shopModel } from "./shop-model.js";

vi.mock("node:http", async () => ({
  createServer: (await import("./memory-shop.js")).createMemoryServer,
}));

let shop: RunningShop;
let directory: string;
beforeAll(async () => {
  shop = await startShop();
  directory = await mkdtemp(join(tmpdir(), "webarena-shop-"));
});
afterAll(async () => {
  await shop?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("test-shop -> fixture model -> semantic runner -> submission -> evaluation summary", () => {
  it("runs retrieve/mutate/navigate with real login, actual HTTP evidence and every approval", async () => {
    const model = shopModel(shop.url);
    const config = fixtureConfig(shop.url);
    config.sites.shopping.login = login;
    config.modelsDir = directory;
    await writeFile(join(directory, "shopping.ttl"), await writeSiteModel(model));
    config.taskTimeoutMs = 20_000;
    const tasks: BenchTask[] = [
      {
        task_id: 0,
        sites: ["shopping"],
        taskType: "RETRIEVE",
        intent: "Find the Trail Runner sneakers",
        start_urls: [shop.url],
      },
      {
        task_id: 1,
        sites: ["shopping"],
        taskType: "MUTATE",
        intent: "Add Trail Runner sneakers to the basket, then remove them",
        start_urls: [shop.url],
      },
      {
        task_id: 2,
        sites: ["shopping"],
        taskType: "NAVIGATE",
        intent: "Show the Trail Runner sneakers page",
        start_urls: [shop.url],
      },
    ];
    const out = join(directory, "submission");
    const metrics = await runBenchmark({
      config,
      tasks,
      out,
      planner: "claude",
      model: "scripted-fixture",
      transport,
      plannerFactory(task) {
        if (task.taskType === "MUTATE")
          return scriptedPlanner([
            async () => ({ kind: "act", turtle: await action("AddToCartAction", "SNK-TRAIL-01") }),
            async () => ({ kind: "act", turtle: await action("DeleteAction", "SNK-TRAIL-01") }),
            () => {
              expect(shop.state.carts.get(login.username)).toEqual([]);
              return { kind: "answer", text: '{"status":"SUCCESS","retrieved_data":null}' };
            },
          ]);
        let step = 0;
        return {
          async next(input) {
            expect(input.goal).toBe(task.intent);
            expect(JSON.stringify(input)).not.toContain(login.password);
            expect(JSON.stringify(input)).not.toContain("<html");
            if (step++ === 0) return { kind: "act", turtle: await action("SearchAction") };
            expect(input.history.at(-1)?.status).toBe("done");
            const observed = input.history.at(-1)?.observations ?? "";
            expect(observed).toContain("Trail Runner sneakers");
            return {
              kind: "answer",
              text:
                task.taskType === "RETRIEVE"
                  ? '["Trail Runner sneakers"]'
                  : JSON.stringify({ status: "SUCCESS", final_url: `${shop.url}/product/104` }),
            };
          },
        };
      },
    });
    expect(metrics.map((m) => m.outcome)).toEqual(["answer", "answer", "answer"]);
    expect(shop.state.carts.get(login.username)).toEqual([]);
    expect(
      shop.state.requests.filter((r) => r.url === "/api/cart/items" && r.method === "POST"),
    ).toHaveLength(1);
    expect(
      shop.state.requests.filter(
        (r) => r.url === "/api/cart/items/SNK-TRAIL-01" && r.method === "DELETE",
      ),
    ).toHaveLength(1);
    for (const task of tasks) {
      const files = await readdir(join(out, String(task.task_id)));
      expect(files).toEqual(
        expect.arrayContaining([
          "agent_response.json",
          "network.har",
          "run_config.json",
          "metrics.json",
          "approvals.json",
          "agent_trace.json",
        ]),
      );
      const response = JSON.parse(
        await readFile(join(out, String(task.task_id), "agent_response.json"), "utf8"),
      );
      expect(response).toMatchObject({ task_type: task.taskType, status: "SUCCESS" });
      const har = JSON.parse(
        await readFile(join(out, String(task.task_id), "network.har"), "utf8"),
      );
      expect(har.log.entries.length).toBeGreaterThan(2);
      expect(JSON.stringify(har)).not.toContain(login.password);
      // Every HAR event corresponds to a request handled by test-shop, including login/redirects.
      for (const entry of har.log.entries as HarEntry[]) {
        const url = new URL(entry.request.url);
        expect(
          shop.state.requests.some(
            (r) =>
              r.method === entry.request.method &&
              r.url === `${url.pathname}${url.search}` &&
              r.status === entry.response.status,
          ),
        ).toBe(true);
      }
    }
    const approvals = JSON.parse(await readFile(join(out, "1/approvals.json"), "utf8"));
    const trace: TaskTrace = JSON.parse(await readFile(join(out, "1/agent_trace.json"), "utf8"));
    expect(approvals).toHaveLength(2);
    expect(trace.steps.flatMap((s) => s.approvals ?? [])).toHaveLength(2);
    const navigation = JSON.parse(await readFile(join(out, "2/network.har"), "utf8"));
    const last = navigation.log.entries.at(-1);
    expect(last.request).toMatchObject({ method: "GET", url: `${shop.url}/product/104` });
    expect(last.request.headers).toContainEqual({ name: "accept", value: "text/html" });
    expect(last.response.status).toBe(200);
    expect((await checkReference(out)).validated_submissions).toBe(3);
    // Test only the process boundary here: full Python evaluator requires its separate environment.
    const rows = await evaluateBenchmark(out, "fixture-python", async (python, args) => {
      expect(python).toBe("fixture-python");
      expect(args).toEqual(["-m", "webarena_verified", "eval-tasks", "--output-dir", out]);
      for (const task of tasks)
        await writeFile(
          join(out, String(task.task_id), "eval_result.json"),
          JSON.stringify({ task_id: task.task_id, status: "SUCCESS", score: 1 }),
        );
    });
    expect(rows.find((r) => r.site === "ALL" && r.taskType === "ALL")).toMatchObject({
      tasks: 3,
      successes: 3,
      successRate: 1,
    });
    expect(await readFile(join(out, "summary.md"), "utf8")).toContain("Mean prompt tokens");
    // A prior task cannot be silently overwritten or reuse an earlier evaluation result.
    await expect(
      runBenchmark({
        config,
        tasks: [tasks[0] as BenchTask],
        out,
        planner: "claude",
        model: "fixture",
        models: { shopping: model },
        plannerFactory: () => scriptedPlanner([]),
      }),
    ).rejects.toThrow("EEXIST");
  });
});
