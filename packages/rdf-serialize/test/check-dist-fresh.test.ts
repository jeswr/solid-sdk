// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Regression tests for scripts/check-dist-fresh.mjs — the artifact-integrity
// gate that keeps the committed `dist/` honest. These pin down the staged/index
// semantics that resolve the two roborev findings:
//   - it MUST NOT false-positive on an UNSTAGED working-tree src edit (Medium);
//   - it MUST catch a STAGED src change with a stale/forgotten staged dist (High);
//   - it MUST pass on a consistent staged tree.
//
// Each case builds a throwaway git repo whose `dist/` is a copy of the real
// committed dist + a tiny synthetic src, then runs the actual script against it.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

/** Run a git command in `cwd`, returning trimmed stdout. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * Run the FIXTURE's copy of check-dist-fresh.mjs (so its `root`, computed from
 * the script's own location, is the fixture — not this repo). Returns the exit
 * status (0 = in sync, 1 = drift) without throwing.
 */
function runCheck(cwd: string): { code: number; output: string } {
  try {
    const out = execFileSync("node", [join(cwd, "scripts", "check-dist-fresh.mjs")], {
      cwd,
      encoding: "utf8",
    });
    return { code: 0, output: out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("check-dist-fresh staged/index semantics", () => {
  let fixture: string;

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), "cdf-fixture-"));

    // A minimal but real ESM/tsc project: package.json (type:module), the two
    // tsconfigs, a trivial src, and node_modules symlinked from this repo so tsc
    // can resolve its toolchain. The script lives under scripts/ as in the repo.
    writeFileSync(
      join(fixture, "package.json"),
      `${JSON.stringify({ name: "fixture", version: "0.0.0", type: "module" }, null, 2)}\n`,
    );
    writeFileSync(
      join(fixture, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "es2022",
            module: "nodenext",
            moduleResolution: "nodenext",
            outDir: "./dist",
            rootDir: "./src",
            strict: true,
            declaration: true,
            declarationMap: true,
            sourceMap: true,
          },
          include: ["src/**/*"],
          exclude: ["node_modules", "dist", "test"],
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(fixture, "tsconfig.build.json"),
      `${JSON.stringify(
        {
          extends: "./tsconfig.json",
          compilerOptions: { declaration: true, declarationMap: true },
          include: ["src/**/*"],
          exclude: ["node_modules", "dist", "test"],
        },
        null,
        2,
      )}\n`,
    );
    cpSync(join(repoRoot, "scripts"), join(fixture, "scripts"), { recursive: true });
    // Symlink the real node_modules so the script's tsc invocation resolves.
    symlinkSync(join(repoRoot, "node_modules"), join(fixture, "node_modules"), "dir");

    git(fixture, "init", "-q");
    git(fixture, "config", "user.email", "test@example.com");
    git(fixture, "config", "user.name", "Test");
  });

  afterEach(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  /** Build dist/ in the fixture from its current src via the real build flags. */
  function build() {
    execFileSync(
      "node",
      [join(repoRoot, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"],
      { cwd: fixture },
    );
  }

  function writeSrc(body: string) {
    writeFileSync(join(fixture, "src", "index.ts"), body);
  }

  it("passes on a consistent committed tree", () => {
    mkdirSync(join(fixture, "src"), { recursive: true });
    writeSrc("export const A = 1;\n");
    build();
    git(fixture, "add", "-A");
    git(fixture, "commit", "-q", "-m", "init", "--no-gpg-sign");

    const { code } = runCheck(fixture);
    expect(code).toBe(0);
  });

  it("does NOT false-positive on an UNSTAGED working-tree src edit (Medium finding)", () => {
    mkdirSync(join(fixture, "src"), { recursive: true });
    writeSrc("export const A = 1;\n");
    build();
    git(fixture, "add", "-A");
    git(fixture, "commit", "-q", "-m", "init", "--no-gpg-sign");

    // Dirty the working tree without staging — the normal "still editing" state.
    writeSrc("export const A = 1;\nexport const B = 2;\n");

    const { code } = runCheck(fixture);
    expect(code).toBe(0); // unstaged edits are ignored; the staged tree is consistent
  });

  it("CATCHES a staged src change with a stale/forgotten staged dist (High finding)", () => {
    mkdirSync(join(fixture, "src"), { recursive: true });
    writeSrc("export const A = 1;\n");
    build();
    git(fixture, "add", "-A");
    git(fixture, "commit", "-q", "-m", "init", "--no-gpg-sign");

    // Stage a src change but do NOT rebuild/stage dist — the exact mistake the
    // High finding warned about: the commit being prepared changes src and
    // forgets dist.
    writeSrc("export const A = 1;\nexport const C = 3;\n");
    git(fixture, "add", "src/index.ts");

    const { code, output } = runCheck(fixture);
    expect(code).toBe(1);
    expect(output).toContain("out of sync");
  });

  it("passes when both src and dist are staged consistently", () => {
    mkdirSync(join(fixture, "src"), { recursive: true });
    writeSrc("export const A = 1;\n");
    build();
    git(fixture, "add", "-A");
    git(fixture, "commit", "-q", "-m", "init", "--no-gpg-sign");

    // Change src AND rebuild AND stage both — the correct workflow.
    writeSrc("export const A = 1;\nexport const D = 4;\n");
    build();
    git(fixture, "add", "-A");

    const { code } = runCheck(fixture);
    expect(code).toBe(0);
  });
});
