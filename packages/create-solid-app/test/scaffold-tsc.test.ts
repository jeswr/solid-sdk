// AUTHORED-BY Claude Opus 4.8
/**
 * Slow end-to-end test: scaffold into a temp dir, `npm install`, then both
 * `npx tsc --noEmit` AND `npx next build` in the scaffolded app. Asserts the
 * generated app typechecks clean and that the full app (including the baked-in
 * @jeswr/app-shell stack — ThemeProvider, the no-flash head script, the
 * AppHeader with ThemeToggle/AccountMenu/FeedbackButton, and the autologin)
 * SSR/RSC-compiles and prerenders. Measures the scaffold-to-green wall time
 * against the TTFS harness baseline (S1 = 3.89min). Skipped unless RUN_SLOW=1
 * because it installs the full Next.js dep tree.
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

  it("scaffolded app passes npx tsc --noEmit AND next build; reports wall time vs S1", async () => {
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
    if (tsc.status !== 0) {
      // eslint-disable-next-line no-console
      console.error(tsc.stdout, tsc.stderr);
    }
    expect(tsc.status, "tsc --noEmit reported errors").toBe(0);

    // ALSO assert the scaffolded app `next build`s — the baked-in @jeswr/app-shell
    // stack (ThemeProvider in providers, the no-flash <head> script, the AppHeader
    // with ThemeToggle/AccountMenu/FeedbackButton) must SSR/RSC-compile and the
    // pages prerender. A bare tsc pass would not catch the RSC-boundary class of
    // failure (e.g. a client-only React.createContext leaking into a server
    // component), which only `next build`'s page-data collection surfaces.
    const build = spawnSync("npx", ["next", "build"], {
      cwd: target,
      encoding: "utf8",
      env: { ...process.env, NEXT_PUBLIC_BUILD_SHA: "test-sha" },
    });
    const wallMin = (Date.now() - t0) / 60_000;
    // eslint-disable-next-line no-console
    console.log(
      `\n[scaffold->build] wall=${wallMin.toFixed(2)}min  S1_baseline=${S1_BASELINE_MIN}min  ` +
        `delta=${(wallMin - S1_BASELINE_MIN).toFixed(2)}min  tsc_exit=${tsc.status}  build_exit=${build.status}`,
    );
    if (build.status !== 0) {
      // eslint-disable-next-line no-console
      console.error(build.stdout, build.stderr);
    }
    expect(build.status, "next build reported errors").toBe(0);
  }, 900_000);
});
