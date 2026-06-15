// AUTHORED-BY Claude Opus 4.8
/**
 * Slow end-to-end test: scaffold into a temp dir, `npm install`, then
 * `npx tsc --noEmit` in the scaffolded app. Asserts the generated app typechecks
 * clean, and measures the scaffold-to-tsc-green wall time against the TTFS
 * harness baseline (S1 = 3.89min). Skipped unless RUN_SLOW=1 because it installs
 * the full Next.js dep tree.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scaffold } from "../src/scaffold.ts";

const RUN = process.env["RUN_SLOW"] === "1";
const S1_BASELINE_MIN = 3.89;

describe.skipIf(!RUN)("scaffold -> tsc green (slow)", () => {
  let workDir: string;

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("scaffolded app passes npx tsc --noEmit; reports wall time vs S1", async () => {
    const t0 = Date.now();
    workDir = await mkdtemp(join(tmpdir(), "csa-tsc-"));
    const prevCwd = process.cwd();
    let target: string;
    process.chdir(workDir);
    try {
      const r = await scaffold({ targetDir: "tsc-app", appName: "Tsc App" });
      target = r.targetDir;
    } finally {
      process.chdir(prevCwd);
    }

    const install = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: target,
      stdio: "inherit",
    });
    expect(install.status, "npm install failed").toBe(0);

    const tsc = spawnSync("npx", ["tsc", "--noEmit"], {
      cwd: target,
      encoding: "utf8",
    });
    const wallMin = (Date.now() - t0) / 60_000;
    // eslint-disable-next-line no-console
    console.log(
      `\n[scaffold->tsc] wall=${wallMin.toFixed(2)}min  S1_baseline=${S1_BASELINE_MIN}min  ` +
        `delta=${(wallMin - S1_BASELINE_MIN).toFixed(2)}min  tsc_exit=${tsc.status}`,
    );
    if (tsc.status !== 0) {
      // eslint-disable-next-line no-console
      console.error(tsc.stdout, tsc.stderr);
    }
    expect(tsc.status, "tsc --noEmit reported errors").toBe(0);
  }, 900_000);
});
