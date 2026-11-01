// AUTHORED-BY Claude Opus 5.5

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  commitMetaKey,
  decide,
  minIntervalMs,
  statusContext,
} from "../scripts/vercel-production.mjs";

const now = Date.parse("2026-11-01T12:00:00Z");
const head = "h".repeat(40);
const old = "o".repeat(40);
const minutes = (count) => count * 60 * 1000;

function deployment(state, commit, ageMs, own = true) {
  return {
    uid: `dpl_${state}_${ageMs}`,
    state,
    created: now - ageMs,
    meta: own ? { [commitMetaKey]: commit } : { githubCommitSha: commit },
  };
}

// Production serves `serving` unless a test passes its own production target.
function plan(
  deployments,
  { serving = deployments.find((d) => d.state === "READY"), ...options } = {},
) {
  return decide({
    head,
    production: serving ?? null,
    deployments,
    now,
    inputsChanged: () => true,
    ...options,
  });
}

describe("vercel-production plan", () => {
  it("deploys when production lags main and the window is open", () => {
    const decision = plan([deployment("READY", old, minIntervalMs + minutes(1))]);
    expect(decision.deploy).toBe(true);
    expect(decision.reason).toContain(old);
  });

  it("deploys a first time when nothing is in production", () => {
    expect(plan([]).deploy).toBe(true);
  });

  it("holds a lagging main inside the two-hour window and names when it reopens", () => {
    const decision = plan([deployment("READY", old, minutes(30))]);
    expect(decision.deploy).toBe(false);
    expect(decision.reason).toContain("2026-11-01T13:30:00.000Z");
  });

  it("deploys the accumulated main once the window reopens, however long main was quiet", () => {
    for (const age of [minIntervalMs, minutes(60 * 24), minutes(60 * 24 * 9)]) {
      expect(plan([deployment("READY", old, age)]).deploy).toBe(true);
    }
  });

  it("skips when production already serves main", () => {
    const decision = plan([deployment("READY", head, minIntervalMs * 3)]);
    expect(decision.deploy).toBe(false);
    expect(decision.reason).toContain("already serves");
  });

  it("trusts the production target over the newest READY deployment", () => {
    const staged = deployment("READY", head, minIntervalMs * 3);
    const live = deployment("READY", old, minIntervalMs * 4);
    expect(plan([staged, live], { serving: live }).deploy).toBe(true);
    expect(plan([staged, live], { serving: staged }).deploy).toBe(false);
  });

  it("recognises git-created production deployments by their GitHub commit", () => {
    expect(plan([deployment("READY", head, minutes(5), false)]).deploy).toBe(false);
  });

  it("skips while a deployment is in flight, even when forced", () => {
    for (const state of ["BUILDING", "INITIALIZING", "QUEUED"]) {
      const deployments = [
        deployment(state, head, minutes(1)),
        deployment("READY", old, minIntervalMs * 2),
      ];
      for (const force of [false, true]) {
        const decision = plan(deployments, { force });
        expect(decision).toMatchObject({ deploy: false });
        expect(decision.reason).toContain(state);
      }
    }
  });

  it("skips when no suite build input changed since the live commit", () => {
    const seen = [];
    const decision = plan([deployment("READY", old, minIntervalMs * 2)], {
      inputsChanged: (base) => {
        seen.push(base);
        return false;
      },
    });
    expect(seen).toEqual([old]);
    expect(decision.deploy).toBe(false);
    expect(decision.reason).toContain("no suite build inputs changed");
  });

  it("retries a failed Vercel deployment of main once the window has passed", () => {
    const live = deployment("READY", old, minIntervalMs * 10);
    const recent = [deployment("ERROR", head, minutes(30)), live];
    expect(plan(recent, { serving: live }).reason).toContain("retrying after");
    expect(plan(recent, { serving: live }).deploy).toBe(false);
    const stale = [deployment("ERROR", head, minIntervalMs * 3), live];
    expect(plan(stale, { serving: live }).deploy).toBe(true);
  });

  it("waits a window after a runner-side failure recorded as a commit status", () => {
    const live = deployment("READY", old, minIntervalMs * 10);
    expect(plan([live], { headFailedAt: now - minutes(20) }).deploy).toBe(false);
    expect(plan([live], { headFailedAt: now - minIntervalMs }).deploy).toBe(true);
  });

  it("throttles on workflow deployments only, never on cancelled git-created records", () => {
    const live = deployment("READY", old, minIntervalMs + minutes(5));
    const deployments = [deployment("CANCELED", head, minutes(1), false), live];
    expect(plan(deployments, { serving: live }).deploy).toBe(true);
    deployments.push(deployment("ERROR", "e".repeat(40), minutes(10)));
    expect(plan(deployments, { serving: live }).deploy).toBe(false);
  });

  it("lets a forced run redeploy the live commit and skip the window and failure checks", () => {
    const live = deployment("READY", head, minutes(10));
    const deployments = [deployment("ERROR", head, minutes(5)), live];
    const decision = plan(deployments, {
      serving: live,
      force: true,
      headFailedAt: now - minutes(1),
      inputsChanged: () => false,
    });
    expect(decision.deploy).toBe(true);
    expect(decision.reason).toMatch(/^forced: /);
  });
});

const workflow = readFileSync(
  new URL("../.github/workflows/vercel-production.yml", import.meta.url),
  "utf8",
);

describe("vercel-production workflow", () => {
  it("runs on main pushes, on a half-hourly schedule and by hand", () => {
    expect(workflow).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
    expect(workflow).toMatch(/^ {4}- cron: '13,43 \* \* \* \*'$/m);
    expect(workflow).toContain("  workflow_dispatch:");
    expect(workflow).toContain("    if: github.ref == 'refs/heads/main'");
  });

  it("queues runs without cancelling and grants only read and status permissions", () => {
    const permissions = /^permissions:\n((?: {2}.*\n)+)/m.exec(workflow)?.[1] ?? "";
    expect(permissions.replace(/^ {2}#.*\n/gm, "")).toBe("  contents: read\n  statuses: write\n");
    expect(workflow).toMatch(/^ {2}cancel-in-progress: false$/m);
  });

  it("deploys the newest main with the commit recorded for the next plan", () => {
    expect(workflow).toMatch(/ref: main\n {10}fetch-depth: 0/);
    expect(workflow).toContain(`--meta "${commitMetaKey}=$SHA"`);
    expect(workflow).toMatch(/VERCEL_CLI: vercel@\d+\.\d+\.\d+$/m);
  });

  it("records failed deployments under the status context the plan reads", () => {
    expect(workflow).toContain("if: failure() && steps.plan.outputs.deploy == 'true'");
    expect(workflow).toContain(`-f context=${statusContext}`);
  });

  it("keeps the token out of the build step", () => {
    const build = /- name: Build\n((?: {8}.*\n)+)/.exec(workflow)?.[1];
    expect(build).toBeDefined();
    expect(build).not.toContain("VERCEL_TOKEN");
  });
});
