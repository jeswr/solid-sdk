#!/usr/bin/env node
// AUTHORED-BY Claude Opus 5.5
//
// Production deploys of the suite to Vercel, throttled for the Hobby plan's 100 deployments a
// day. `plan` decides whether the current checkout (main) should be deployed now; the
// vercel-production workflow runs it on every push to main and on a half-hourly schedule, so
// a burst of merges produces one deployment per window and the newest main is always picked up
// once the window reopens. `disconnect-git` unlinks the Git integration from every project in
// scripts/vercel-apps.json, because each linked project otherwise records a (counted)
// deployment for every push, even when the build is skipped.

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const api = "https://api.vercel.com";
export const minIntervalMs = 2 * 60 * 60 * 1000;
// Marks deployments this workflow created, so git-created records never hold the window shut.
export const commitMetaKey = "suiteCommitSha";
const suitePackage = "@jeswr/app-suite";
const inFlightStates = new Set(["BUILDING", "INITIALIZING", "QUEUED"]);

const stateOf = (deployment) => deployment.state ?? deployment.readyState;
const createdOf = (deployment) => deployment.created ?? deployment.createdAt ?? 0;
const idOf = (deployment) => deployment.uid ?? deployment.id;
const commitOf = (deployment) => {
  const meta = deployment.meta ?? {};
  return meta[commitMetaKey] ?? meta.githubCommitSha ?? meta.gitCommitSha ?? null;
};

/**
 * Pure deploy decision.
 * @param {object} input
 * @param {string} input.head commit main points at
 * @param {object[]} input.deployments the project's recent production deployments
 * @param {number} input.now epoch milliseconds
 * @param {(base: string) => boolean} input.inputsChanged whether suite build inputs changed since base
 * @param {boolean} [input.force] skip the window, unchanged-input and failed-commit checks
 * @param {number} [input.interval] minimum milliseconds between workflow deployments
 */
export function decide({
  head,
  deployments,
  now,
  inputsChanged,
  force = false,
  interval = minIntervalMs,
}) {
  const sorted = [...deployments].sort((a, b) => createdOf(b) - createdOf(a));
  const inFlight = sorted.find((deployment) => inFlightStates.has(stateOf(deployment)));
  if (inFlight) {
    return { deploy: false, reason: `deployment ${idOf(inFlight)} is still ${stateOf(inFlight)}` };
  }
  const live = sorted.find((deployment) => stateOf(deployment) === "READY");
  const liveCommit = live ? commitOf(live) : null;
  if (liveCommit === head) return { deploy: false, reason: `production already serves ${head}` };
  const own = sorted.find((deployment) => deployment.meta?.[commitMetaKey]);
  if (!force) {
    if (liveCommit && !inputsChanged(liveCommit)) {
      return { deploy: false, reason: `no suite build inputs changed since ${liveCommit}` };
    }
    // A broken main would otherwise spend a deployment every window until someone fixes it.
    if (own && commitOf(own) === head && stateOf(own) === "ERROR") {
      return {
        deploy: false,
        reason: `the last deployment of ${head} failed; waiting for a new commit or a forced run`,
      };
    }
    if (own && now - createdOf(own) < interval) {
      const next = new Date(createdOf(own) + interval).toISOString();
      return {
        deploy: false,
        reason: `last workflow deployment was ${Math.round((now - createdOf(own)) / 60000)} min ago; next window opens ${next}`,
      };
    }
  }
  return {
    deploy: true,
    reason: liveCommit
      ? `${force ? "forced: " : ""}deploying ${head} (production serves ${liveCommit})`
      : `${force ? "forced: " : ""}deploying ${head} (no ready production deployment found)`,
  };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function vercel(path, { method = "GET", query = {} } = {}) {
  const url = new URL(path, api);
  url.searchParams.set("teamId", requireEnv("VERCEL_ORG_ID"));
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${requireEnv("VERCEL_TOKEN")}` },
  });
  const body = await response.text();
  return { status: response.status, ok: response.ok, body: body ? JSON.parse(body) : null };
}

async function productionDeployments(projectId) {
  const list = async (query) => {
    const result = await vercel("/v6/deployments", {
      query: { projectId, target: "production", ...query },
    });
    if (!result.ok) throw new Error(`listing deployments failed with HTTP ${result.status}`);
    return result.body?.deployments ?? [];
  };
  // Separate queries keep the newest ready and in-flight records in view behind any run of
  // cancelled git-created records.
  const [recent, ready, inFlight] = await Promise.all([
    list({ limit: 100 }),
    list({ limit: 1, state: "READY" }),
    list({ limit: 5, state: [...inFlightStates].join(",") }),
  ]);
  const byId = new Map();
  for (const deployment of [...recent, ...ready, ...inFlight])
    byId.set(idOf(deployment), deployment);
  return [...byId.values()];
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout.trim();
}

// Reuses the Vercel ignored-build script: exit 0 means the suite's build inputs are unchanged.
function suiteInputsChanged(root, base) {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/vercel-ignore-build.mjs"), suitePackage],
    { cwd: root, encoding: "utf8", env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: base } },
  );
  process.stdout.write(result.stdout ?? "");
  return result.status !== 0;
}

function output(values) {
  const file = process.env.GITHUB_OUTPUT;
  const lines = Object.entries(values).map(
    ([key, value]) => `${key}=${String(value).replace(/\n/g, " ")}`,
  );
  if (file) appendFileSync(file, `${lines.join("\n")}\n`);
  else console.log(lines.join("\n"));
}

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

async function plan(root) {
  if (!process.env.VERCEL_TOKEN) {
    const reason = "VERCEL_TOKEN secret is not set; nothing deployed";
    console.log(`::warning::${reason}`);
    summary(`Vercel production: ${reason}.`);
    output({ deploy: false, reason });
    return;
  }
  const head = git(root, ["rev-parse", "HEAD"]);
  const decision = decide({
    head,
    deployments: await productionDeployments(requireEnv("VERCEL_PROJECT_ID")),
    now: Date.now(),
    inputsChanged: (base) => suiteInputsChanged(root, base),
    force: process.env.FORCE === "true",
  });
  console.log(`${decision.deploy ? "Deploy" : "Skip"}: ${decision.reason}`);
  summary(`Vercel production: ${decision.deploy ? "deploy" : "skip"} (${decision.reason}).`);
  output({ deploy: decision.deploy, reason: decision.reason, sha: head });
}

async function disconnectGit(root) {
  const apps = JSON.parse(readFileSync(join(root, "scripts/vercel-apps.json"), "utf8"));
  let failed = false;
  for (const { project } of apps) {
    const result = await vercel(`/v9/projects/${encodeURIComponent(project)}/link`, {
      method: "DELETE",
    });
    // A project that is already unlinked has nothing to remove.
    const unlinked = result.ok || result.status === 404;
    console.log(`${project}: ${result.ok ? "git disconnected" : `HTTP ${result.status}`}`);
    if (!unlinked) failed = true;
  }
  if (failed) throw new Error("some projects could not be disconnected");
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const commands = { plan, "disconnect-git": disconnectGit };
  const command = commands[process.argv[2]];
  if (!command || process.argv.length !== 3) {
    console.error("usage: vercel-production.mjs plan|disconnect-git");
    process.exitCode = 2;
  } else {
    command(root).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
