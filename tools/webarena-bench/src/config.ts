// AUTHORED-BY Claude Opus 5.5
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { siteOrigin } from "@jeswr/site-executor";
import { SITES, type Site } from "./types.js";

export interface SiteConfig {
  baseUrl: string;
  login: { username: string; password: string } | null;
  /** A site-generic recording, resolved relative to bench.config.json. */
  demonstrations?: string;
}
export interface BenchConfig {
  dataset: string;
  modelsDir: string;
  sites: Record<Site, SiteConfig>;
  maxSteps: number;
  taskTimeoutMs: number;
  maxPages: number;
}

export function isSite(value: unknown): value is Site {
  return typeof value === "string" && SITES.some((s) => s === value);
}
export function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer.`);
  return value;
}

export async function loadConfig(path: string, env = process.env): Promise<BenchConfig> {
  const directory = dirname(resolve(path));
  const raw = JSON.parse(await readFile(path, "utf8"));
  const sites = {} as Record<Site, SiteConfig>;
  for (const site of SITES) {
    const value = raw.sites?.[site];
    if (typeof value?.baseUrl !== "string") throw new Error(`Missing sites.${site}.baseUrl.`);
    siteOrigin(value.baseUrl); // Same policy as the executor: HTTPS or loopback HTTP.
    const url = new URL(value.baseUrl);
    if (url.search || url.hash)
      throw new Error(`sites.${site}.baseUrl cannot have query or fragment.`);
    let login: SiteConfig["login"] = null;
    if (value.login !== null) {
      const username = value.login?.username ?? env[value.login?.usernameEnv];
      const password = value.login?.password ?? env[value.login?.passwordEnv];
      if (typeof username !== "string" || !username || typeof password !== "string" || !password)
        throw new Error(
          `Missing login account for ${site}; configure credentials or explicit login: null.`,
        );
      login = { username, password };
    }
    sites[site] = {
      baseUrl: url.href.replace(/\/$/, ""),
      login,
      ...(value.demonstrations ? { demonstrations: resolve(directory, value.demonstrations) } : {}),
    };
  }
  if (typeof raw.dataset !== "string" || !raw.dataset) throw new Error("dataset path is required.");
  return {
    dataset: resolve(directory, raw.dataset),
    modelsDir: resolve(directory, raw.modelsDir ?? "models"),
    sites,
    maxSteps: positiveInteger(raw.maxSteps ?? 30, "maxSteps"),
    taskTimeoutMs: positiveInteger(raw.taskTimeoutMs ?? 300_000, "taskTimeoutMs"),
    maxPages: positiveInteger(raw.maxPages ?? 40, "maxPages"),
  };
}

/** No credentials in run artifacts. Python needs the original dataset and URL map only. */
export function evaluatorConfig(config: BenchConfig) {
  return {
    test_data_file: config.dataset,
    environments: Object.fromEntries(SITES.map((s) => [s, { urls: [config.sites[s].baseUrl] }])),
    agent_response_file_name: "agent_response.json",
    trace_file_name: "network.har",
    eval_result_file_name: "eval_result.json",
  };
}
