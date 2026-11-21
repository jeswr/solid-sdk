// AUTHORED-BY Claude Opus 5.5
import type { TaskTrace } from "@jeswr/agent-browser";
import type { SiteModel } from "@jeswr/site-model";
import type { BenchConfig } from "../src/config.js";

export function fixtureConfig(baseUrl = "http://127.0.0.1:7770"): BenchConfig {
  return {
    dataset: "/tmp/fixture-dataset.json",
    modelsDir: "/tmp/fixture-models",
    maxSteps: 6,
    taskTimeoutMs: 10_000,
    maxPages: 4,
    sites: {
      shopping: { baseUrl, login: null },
      shopping_admin: { baseUrl: "http://127.0.0.1:7780/admin", login: null },
      reddit: { baseUrl: "http://127.0.0.1:9999", login: null },
      gitlab: { baseUrl: "http://127.0.0.1:8023", login: null },
    },
  };
}

export function trace(text = "done", outcome: TaskTrace["outcome"] = "answer"): TaskTrace {
  return {
    format: "agent-browser-trace/0.1",
    goal: "Fixture goal",
    outcome,
    text,
    steps: [],
    promptTokensEstimate: 0,
    elapsedMs: 0,
  };
}

export function emptyModel(site = "http://127.0.0.1:7770"): SiteModel {
  return {
    id: "urn:fixture:model",
    site,
    version: "0.1.0",
    generatedAt: "2026-01-01T00:00:00.000Z",
    operations: [],
    flows: [],
  };
}
