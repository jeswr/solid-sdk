// AUTHORED-BY Claude Opus 5.5
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scriptedPlanner } from "@jeswr/agent-browser";
import { afterEach, describe, expect, it } from "vitest";
import { runBenchmark } from "../src/run.js";
import type { BenchTask, Transport } from "../src/types.js";
import { emptyModel, fixtureConfig } from "./helpers.js";

const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
const task: BenchTask = {
  task_id: 8,
  sites: ["shopping"],
  taskType: "NAVIGATE",
  intent: "Find a fixture page",
  start_urls: ["http://127.0.0.1:7770/"],
};
async function destination() {
  const path = await mkdtemp(join(tmpdir(), "webarena-bounds-"));
  directories.push(path);
  return path;
}

describe("task budgets and failed evidence", () => {
  it("times out a never-resolving planner and produces a failed submission promptly", async () => {
    const out = await destination();
    const config = fixtureConfig();
    config.taskTimeoutMs = 500;
    const began = performance.now();
    const metrics = await runBenchmark({
      config,
      tasks: [task],
      out,
      planner: "codex",
      model: "fixture",
      models: { shopping: emptyModel() },
      transport: async () =>
        new Response("<html>Fixture</html>", { headers: { "Content-Type": "text/html" } }),
      plannerFactory: () => ({ next: () => new Promise(() => {}) }),
    });
    expect(performance.now() - began).toBeLessThan(2000);
    expect(metrics[0]?.outcome).toBe("timeout");
    expect(metrics[0]?.steps).toBe(1);
    expect(JSON.parse(await readFile(join(out, "8/agent_response.json"), "utf8")).status).toBe(
      "UNKNOWN_ERROR",
    );
  });
  it("bounds a never-ending HTTP body and records the attempted request", async () => {
    const out = await destination();
    const config = fixtureConfig();
    config.taskTimeoutMs = 100;
    const transport: Transport = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
          },
        }),
        { headers: { "Content-Type": "text/html" } },
      );
    const metrics = await runBenchmark({
      config,
      tasks: [task],
      out,
      planner: "codex",
      model: "fixture",
      models: { shopping: emptyModel() },
      transport,
      plannerFactory: () => scriptedPlanner([]),
    });
    expect(metrics[0]?.outcome).toBe("timeout");
    const har = JSON.parse(await readFile(join(out, "8/network.har"), "utf8"));
    expect(har.log.entries).toHaveLength(1);
    expect(har.log.entries[0].response.status).toBe(200);
    expect(har.log.entries[0]._capture_error).toBe("Task deadline reached.");
  });
  it("does not navigate to an off-site answer URL", async () => {
    const out = await destination();
    let calls = 0;
    const metrics = await runBenchmark({
      config: fixtureConfig(),
      tasks: [task],
      out,
      planner: "claude",
      model: "fixture",
      models: { shopping: emptyModel() },
      transport: async () => {
        calls++;
        return new Response("Fixture");
      },
      plannerFactory: () =>
        scriptedPlanner([
          { kind: "answer", text: '{"status":"SUCCESS","final_url":"https://attacker.test/"}' },
        ]),
    });
    expect(calls).toBe(1);
    expect(metrics[0]?.outcome).toBe("error");
  });
  it("honors maxSteps for repeated planner failures", async () => {
    const out = await destination();
    const config = fixtureConfig();
    config.maxSteps = 2;
    const metrics = await runBenchmark({
      config,
      tasks: [task],
      out,
      planner: "codex",
      model: "fixture",
      models: { shopping: emptyModel() },
      transport: async () => new Response("Fixture"),
      plannerFactory: () => ({
        async next() {
          throw new Error("scripted planner failure");
        },
      }),
    });
    expect(metrics[0]?.steps).toBe(2);
    expect(metrics[0]?.outcome).toBe("maxSteps");
  });
});
