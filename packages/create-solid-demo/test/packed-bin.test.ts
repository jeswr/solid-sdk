// AUTHORED-BY Claude Fable 5
/**
 * Acceptance §6 sm-76 item 1: the PUBLISHED bin is compiled JavaScript, proven
 * end-to-end — explicit build → `npm pack` → install the tarball into a temp
 * consumer → execute the bin THROUGH THE `.bin` SHIM (the npx path) → scaffold
 * for real. Also proves the tarball ships the dotfile-rename shims and none of
 * the literal dotfiles npm pack strips.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  expect(
    result.status,
    `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
  ).toBe(0);
  return result.stdout;
}

let workDir: string;
let tarball: string;
let consumer: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "csd-pack-"));
  consumer = join(workDir, "consumer");
  await mkdir(consumer);
  // The EXPLICIT packaging build (never a prepack hook — ignore-scripts=true would
  // silently drop a hook-built dist from the tarball).
  run("node", ["scripts/build.mjs"], pkgRoot);
  const packOut = run("npm", ["pack", "--pack-destination", workDir], pkgRoot).trim();
  const lines = packOut.split("\n").filter((line) => line.trim().length > 0);
  tarball = join(workDir, (lines[lines.length - 1] as string).trim());
  expect(existsSync(tarball)).toBe(true);
});

afterAll(async () => {
  await rm(workDir, { force: true, recursive: true });
});

describe("packed bin (compiled JS through a real install)", () => {
  it("the tarball ships dist/bin.mjs + the template shims, and no literal dotfiles", () => {
    const listing = run("tar", ["-tzf", tarball], workDir).split("\n");
    for (const required of [
      "package/dist/bin.mjs",
      "package/template/package.json",
      "package/template/npmrc",
      "package/template/gitignore",
      "package/template/env.example",
      "package/template/github/workflows/ci.yml",
      "package/SKILL.md",
      "package/LICENSE",
    ]) {
      expect(listing, required).toContain(required);
    }
    for (const stripped of [
      "package/template/.npmrc",
      "package/template/.gitignore",
      "package/template/.env.example",
      "package/src/bin.ts",
      "package/bin.ts",
    ]) {
      expect(listing, `${stripped} must not ship`).not.toContain(stripped);
    }
    const manifest = JSON.parse(
      run("tar", ["-xzOf", tarball, "package/package.json"], workDir),
    ) as { bin: Record<string, string> };
    expect(manifest.bin["create-solid-demo"]).toBe("./dist/bin.mjs");
  });

  it("installs into a temp consumer and executes via the .bin shim (the npx path)", async () => {
    run("npm", ["init", "-y"], consumer);
    run("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball], consumer);
    const shim = join(consumer, "node_modules", ".bin", "create-solid-demo");
    expect(existsSync(shim)).toBe(true);
    const help = run(shim, ["--help"], consumer);
    expect(help).toContain("create-solid-demo");
    expect(help).toContain("--use-case");
  });

  it("scaffolds for real from the INSTALLED package (dotfiles renamed, doc valid)", () => {
    const shim = join(consumer, "node_modules", ".bin", "create-solid-demo");
    run(
      shim,
      [
        "packed-demo",
        "--use-case",
        "trails",
        "--convener",
        "Meridian Trails Collective",
        "--negation",
        "Nothing here is an offer of guided travel.",
        "--app",
        "vault:Traveller Vault:personal data custodian",
        "--no-install",
      ],
      consumer,
    );
    const target = join(consumer, "packed-demo");
    for (const expected of [
      ".npmrc",
      ".gitignore",
      ".env.example",
      join(".github", "workflows", "ci.yml"),
      join("apps", "tour", "content", "walkthrough.json"),
      join("apps", "vault", "app", "api", "pod", "example", "route.ts"),
      join("docs", "deploy.md"),
    ]) {
      expect(existsSync(join(target, expected)), expected).toBe(true);
    }
  });
});
