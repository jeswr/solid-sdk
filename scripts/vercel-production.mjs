#!/usr/bin/env node
// AUTHORED-BY Claude Opus 5.5
//
// Production deploys of the suite to Vercel, throttled for the Hobby plan's 100 deployments a
// day. `plan` decides whether the current checkout (main) should be deployed now; the
// vercel-production workflow runs it on every push to main and on a half-hourly schedule, so
// a burst of merges produces one deployment per window and the newest main is always picked up
// once the window reopens. Before deciding, `plan` unlinks the Git integration from every
// project in scripts/vercel-apps.json that is still linked, because a linked project records a
// (counted) deployment for every push, even when the build is skipped.

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const vercelApi = "https://api.vercel.com";
const githubApi = "https://api.github.com";
export const minIntervalMs = 2 * 60 * 60 * 1000;
// Marks deployments this workflow created, so git-created records never hold the window shut.
export const commitMetaKey = "suiteCommitSha";
// Commit status the workflow sets when a planned deployment fails before or after upload.
export const statusContext = "vercel-production";
const suitePackage = "@jeswr/app-suite";
const inFlightStates = new Set(["BUILDING", "INITIALIZING", "QUEUED"]);

const stateOf = (deployment) => deployment.state ?? deployment.readyState;
const createdOf = (deployment) => deployment.created ?? deployment.createdAt ?? 0;
const idOf = (deployment) => deployment.uid ?? deployment.id;
const commitOf = (deployment) => {
  const meta = deployment?.meta ?? {};
  return meta[commitMetaKey] ?? meta.githubCommitSha ?? meta.gitCommitSha ?? null;
};
const minutesAgo = (now, then) => Math.round((now - then) / 60000);

/**
 * Pure deploy decision.
 * @param {object} input
 * @param {string} input.head commit main points at
 * @param {object | null} input.production the deployment production currently serves
 * @param {object[]} input.deployments the project's recent production deployments
 * @param {number | null} [input.headFailedAt] when a workflow run last failed to deploy head
 * @param {number} input.now epoch milliseconds
 * @param {(base: string) => boolean} input.inputsChanged whether suite build inputs changed since base
 * @param {boolean} [input.force] deploy now unless a deployment is already in flight
 * @param {number} [input.interval] minimum milliseconds between attempts
 */
export function decide({
  head,
  production,
  deployments,
  headFailedAt = null,
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
  const liveCommit = commitOf(production);
  if (!force) {
    if (liveCommit === head) return { deploy: false, reason: `production already serves ${head}` };
    if (liveCommit && !inputsChanged(liveCommit)) {
      return { deploy: false, reason: `no suite build inputs changed since ${liveCommit}` };
    }
    // A failed commit is retried once per window, so a broken main costs at most 12 a day.
    const failures = sorted
      .filter((deployment) => commitOf(deployment) === head && stateOf(deployment) === "ERROR")
      .map(createdOf);
    if (headFailedAt) failures.push(headFailedAt);
    const lastFailure = Math.max(0, ...failures);
    if (now - lastFailure < interval) {
      return {
        deploy: false,
        reason: `deploying ${head} failed ${minutesAgo(now, lastFailure)} min ago; retrying after ${new Date(lastFailure + interval).toISOString()}`,
      };
    }
    const own = sorted.find((deployment) => deployment.meta?.[commitMetaKey]);
    if (own && now - createdOf(own) < interval) {
      return {
        deploy: false,
        reason: `last workflow deployment was ${minutesAgo(now, createdOf(own))} min ago; next window opens ${new Date(createdOf(own) + interval).toISOString()}`,
      };
    }
  }
  const serving = liveCommit
    ? `production serves ${liveCommit}`
    : "production commit unknown or none";
  return { deploy: true, reason: `${force ? "forced: " : ""}deploying ${head} (${serving})` };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function request(base, path, { method = "GET", query = {}, token }) {
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}` } });
  const body = await response.text();
  return { status: response.status, ok: response.ok, body: body ? JSON.parse(body) : null };
}

function vercel(path, { method, query = {} } = {}) {
  return request(vercelApi, path, {
    method,
    query: { teamId: requireEnv("VERCEL_ORG_ID"), ...query },
    token: requireEnv("VERCEL_TOKEN"),
  });
}

async function vercelOk(path, options) {
  const result = await vercel(path, options);
  if (!result.ok)
    throw new Error(`Vercel ${options?.method ?? "GET"} ${path} returned HTTP ${result.status}`);
  return result.body;
}

// Idempotent: only projects that are still linked are touched.
async function ensureUnlinked(root) {
  const apps = JSON.parse(readFileSync(join(root, "scripts/vercel-apps.json"), "utf8"));
  for (const { project } of apps) {
    const path = `/v9/projects/${encodeURIComponent(project)}`;
    const details = await vercelOk(path);
    if (!details?.link) continue;
    await vercelOk(`${path}/link`, { method: "DELETE" });
    console.log(`${project}: disconnected from Git`);
  }
}

// The deployment production serves, which need not be the newest READY one.
async function servingDeployment(projectId) {
  const project = await vercelOk(`/v9/projects/${encodeURIComponent(projectId)}`);
  const target = project?.targets?.production;
  if (!target?.id) return null;
  if (commitOf(target)) return target;
  return vercelOk(`/v13/deployments/${encodeURIComponent(target.id)}`);
}

async function productionDeployments(projectId) {
  const list = async (query) =>
    (await vercelOk("/v6/deployments", { query: { projectId, target: "production", ...query } }))
      ?.deployments ?? [];
  // A separate in-flight query keeps builds in view behind a run of cancelled records.
  const [recent, inFlight] = await Promise.all([
    list({ limit: 100 }),
    list({ limit: 5, state: [...inFlightStates].join(",") }),
  ]);
  const byId = new Map();
  for (const deployment of [...recent, ...inFlight]) byId.set(idOf(deployment), deployment);
  return [...byId.values()];
}

// Runner-side build failures leave no Vercel record, so the workflow records them as statuses.
async function headFailedAt(head) {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) return null;
  const result = await request(githubApi, `/repos/${repository}/commits/${head}/statuses`, {
    query: { per_page: 100 },
    token,
  });
  if (!result.ok) throw new Error(`GitHub commit statuses returned HTTP ${result.status}`);
  const times = (result.body ?? [])
    .filter(
      (status) => status.context === statusContext && ["failure", "error"].includes(status.state),
    )
    .map((status) => Date.parse(status.created_at))
    .filter(Number.isFinite);
  return times.length > 0 ? Math.max(...times) : null;
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout.trim();
}

// Repository scripts never need the credentials.
function childEnv() {
  const { VERCEL_TOKEN: _vercel, GITHUB_TOKEN: _github, ...env } = process.env;
  return env;
}

// Reuses the Vercel ignored-build script: exit 0 means the suite's build inputs are unchanged.
function suiteInputsChanged(root, base) {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/vercel-ignore-build.mjs"), suitePackage],
    { cwd: root, encoding: "utf8", env: { ...childEnv(), VERCEL_GIT_PREVIOUS_SHA: base } },
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
  await ensureUnlinked(root);
  const head = git(root, ["rev-parse", "HEAD"]);
  const projectId = requireEnv("VERCEL_PROJECT_ID");
  const [production, deployments, failedAt] = await Promise.all([
    servingDeployment(projectId),
    productionDeployments(projectId),
    headFailedAt(head),
  ]);
  const decision = decide({
    head,
    production,
    deployments,
    headFailedAt: failedAt,
    now: Date.now(),
    inputsChanged: (base) => suiteInputsChanged(root, base),
    force: process.env.FORCE === "true",
  });
  console.log(`${decision.deploy ? "Deploy" : "Skip"}: ${decision.reason}`);
  summary(`Vercel production: ${decision.deploy ? "deploy" : "skip"} (${decision.reason}).`);
  output({ deploy: decision.deploy, reason: decision.reason, sha: head });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  if (process.argv[2] !== "plan" || process.argv.length !== 3) {
    console.error("usage: vercel-production.mjs plan");
    process.exitCode = 2;
  } else {
    plan(root).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
