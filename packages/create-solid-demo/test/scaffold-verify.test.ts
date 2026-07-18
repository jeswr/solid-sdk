// AUTHORED-BY Claude Fable 5
/**
 * Acceptance §6 sm-76 item 3 (the create-solid-app scaffold-tsc pattern, slow —
 * RUN_SLOW=1): scaffold → pnpm install → the GENERATED repo's own `pnpm lint`,
 * `pnpm typecheck`, `pnpm test` run green, including the generated-app test that
 * asserts the sample pod-guard route 401s an anonymous request.
 *
 * FRAMEWORK DEP RESOLUTION: the @jeswr framework packages are NOT yet on npm
 * (their publish is a separately gated step). Exactly like the design's
 * packed-tarball mechanism, this test `pnpm pack`s the workspace packages (plus
 * their transitive `workspace:` deps) and pins them via `pnpm.overrides`
 * `file:` entries in the generated root package.json — a REAL install of real
 * tarballs, not a faked registry. A true npm-registry install stays blocked on
 * the framework npm publish; docs/deploy.md in the generated repo says so.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { scaffold } from "../src/scaffold.js";
import type { DemoSpec } from "../src/walkthrough.js";

const RUN = process.env["RUN_SLOW"] === "1";
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(pkgRoot, "..", "..");

/** The framework packages the generated repo consumes directly. */
const FRAMEWORK_ROOTS = [
  "@jeswr/solid-showcase",
  "@jeswr/solid-showcase-kit",
  "@jeswr/solid-pod-guard",
  "@jeswr/synthetic-rdf",
  "@jeswr/solid-seed",
];

function packageDir(name: string): string {
  return join(workspaceRoot, "packages", name.replace(/^@jeswr\//, ""));
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  expect(
    result.status,
    `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
  ).toBe(0);
  return result.stdout;
}

/** Roots + transitive `workspace:` deps, dependency-closed. */
async function workspaceClosure(roots: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    const manifest = JSON.parse(await readFile(join(packageDir(name), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    for (const [dep, range] of Object.entries(manifest.dependencies ?? {})) {
      if (range.startsWith("workspace:")) queue.push(dep);
    }
  }
  return [...seen];
}

const spec: DemoSpec = {
  apps: [
    { name: "Traveller Vault", role: "personal data custodian", slug: "vault" },
    { name: "Permit Desk", role: "day-permit issuer", slug: "permits" },
  ],
  convener: "Meridian Trails Collective",
  modelledOn: { permits: "Ridgeway Range Authority" },
  negations: ["Nothing here is an offer of guided travel."],
  useCase: "trails",
};

let workDir: string;

afterAll(async () => {
  if (workDir !== undefined) await rm(workDir, { force: true, recursive: true });
});

describe.skipIf(!RUN)("scaffold → generated repo gates green (slow, RUN_SLOW=1)", () => {
  it("pnpm lint/typecheck/test pass inside the generated repo; pod-guard 401 test runs", async () => {
    workDir = await mkdtemp(join(tmpdir(), "csd-verify-"));

    // 1. Build + pack the framework closure into local tarballs.
    const closure = await workspaceClosure(FRAMEWORK_ROOTS);
    const tarballs = new Map<string, string>();
    for (const name of closure) {
      run("pnpm", ["--filter", `${name}...`, "run", "build"], workspaceRoot);
    }
    for (const name of closure) {
      const out = run("pnpm", ["pack", "--pack-destination", workDir], packageDir(name));
      const lines = out.split("\n").filter((line) => line.trim().length > 0);
      tarballs.set(name, (lines[lines.length - 1] as string).trim());
    }

    // 2. Scaffold, then pin the framework deps to the packed tarballs.
    const result = await scaffold({ spec, targetDir: join(workDir, "verify-demo") });
    const rootManifestPath = join(result.targetDir, "package.json");
    const rootManifest = JSON.parse(await readFile(rootManifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    rootManifest["pnpm"] = {
      overrides: Object.fromEntries(
        [...tarballs.entries()].map(([name, path]) => [name, `file:${path}`]),
      ),
    };
    await writeFile(rootManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`, "utf8");

    // 3. The generated repo's own gates.
    run("pnpm", ["install"], result.targetDir);
    run("pnpm", ["lint"], result.targetDir);
    run("pnpm", ["typecheck"], result.targetDir);
    run("pnpm", ["test"], result.targetDir);

    // 4. The sample pod-guard route's 401 gate demonstrably ran (non-vacuous):
    // the verbose reporter names each test, so the anonymous-401 case must appear.
    const vaultTest = run(
      "pnpm",
      ["--filter", "@trails/app-vault", "run", "test", "--reporter=verbose"],
      result.targetDir,
    );
    expect(vaultTest).toContain("anonymous request is 401");
    expect(vaultTest).toContain("fails closed with 503");
  }, 1_500_000);
});
