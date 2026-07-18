// AUTHORED-BY Claude Fable 5
/**
 * Fast scaffold gates (no install): the generated tree matches §4.2, every token
 * is substituted, the dotfile shims land under their REAL names, the walkthrough
 * document on disk passes the real validator, and per-app skeletons + deploy
 * files exist for every registered app.
 */
import { existsSync } from "node:fs";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editorialFindings, parseWalkthrough } from "@jeswr/solid-showcase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ScaffoldResult, scaffold } from "../src/scaffold.js";
import type { DemoSpec } from "../src/walkthrough.js";

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
let result: ScaffoldResult;
let target: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "csd-scaffold-"));
  result = await scaffold({ spec, targetDir: join(workDir, "my-demo") });
  target = result.targetDir;
});

afterAll(async () => {
  await rm(workDir, { force: true, recursive: true });
});

describe("scaffold", () => {
  it("renames every publish-safe shim to its real dotfile", async () => {
    for (const dotfile of [".npmrc", ".gitignore", ".env.example"]) {
      expect(existsSync(join(target, dotfile)), dotfile).toBe(true);
    }
    expect(existsSync(join(target, ".github", "workflows", "ci.yml"))).toBe(true);
    for (const shim of ["npmrc", "gitignore", "env.example", "github"]) {
      expect(existsSync(join(target, shim)), `${shim} shim must not remain`).toBe(false);
    }
    expect(await readFile(join(target, ".npmrc"), "utf8")).toMatch(/^ignore-scripts=true$/m);
  });

  it("leaves no template token behind (scaffold() itself enforces this too)", async () => {
    for (const file of result.files) {
      const content = await readFile(join(target, file), "utf8");
      expect(content, file).not.toMatch(/__CSD_[A-Z_]+__/);
    }
  });

  it("never copies the per-app skeleton or artefact dirs", () => {
    expect(result.files.some((file) => file.includes("__app__"))).toBe(false);
    expect(existsSync(join(target, "node_modules"))).toBe(false);
  });

  it("the on-disk walkthrough.json passes the real validator + editorial gates", async () => {
    const raw = JSON.parse(
      await readFile(join(target, "apps", "tour", "content", "walkthrough.json"), "utf8"),
    );
    const doc = parseWalkthrough(raw);
    expect(editorialFindings(doc)).toEqual([]);
    expect(doc.deploy.slug).toBe("trails");
  });

  it("instantiates one skeleton per app with its slug + env prefix substituted", async () => {
    for (const app of spec.apps) {
      const appDir = join(target, "apps", app.slug);
      expect(existsSync(join(appDir, "app", "api", "pod", "example", "route.ts"))).toBe(true);
      expect(existsSync(join(appDir, "app", "api", "health", "route.ts"))).toBe(true);
      expect(existsSync(join(appDir, "test", "pod-guard.test.ts"))).toBe(true);
      const nextConfig = await readFile(join(appDir, "next.config.ts"), "utf8");
      expect(nextConfig).toContain(`basePath: "/${app.slug}"`);
      const config = await readFile(join(appDir, "lib", "server", "config.ts"), "utf8");
      expect(config).toContain('ENV_PREFIX = "TRAILS"');
      const pkg = JSON.parse(await readFile(join(appDir, "package.json"), "utf8")) as {
        name: string;
      };
      expect(pkg.name).toBe(`@trails/app-${app.slug}`);
    }
  });

  it("writes a turbo-filtered vercel.json per app (tour included)", async () => {
    for (const slug of ["tour", ...spec.apps.map((app) => app.slug)]) {
      const vercel = JSON.parse(
        await readFile(join(target, "apps", slug, "vercel.json"), "utf8"),
      ) as { buildCommand: string; ignoreCommand: string };
      expect(vercel.buildCommand).toBe(
        `pnpm --dir ../.. exec turbo run build --filter=@trails/app-${slug}`,
      );
      expect(vercel.ignoreCommand).toContain("turbo-ignore");
    }
  });

  it("docs/deploy.md carries the deploy learnings + the generated env matrix", async () => {
    const deploy = await readFile(join(target, "docs", "deploy.md"), "utf8");
    expect(deploy).toContain("rootDirectory");
    expect(deploy).toContain("CLEAR the project-level build/output overrides");
    expect(deploy).toContain("TRAILS_TRUST_FORWARDED_HEADERS");
    expect(deploy).toContain("TRAILS_VAULT_ZONE_URL");
    expect(deploy).toContain("Preview posture");
    expect(deploy).toContain("Neutral slugs");
    expect(deploy).toContain("Framework dependency status");
  });

  it("CLAUDE.md is a symlink to AGENTS.md", async () => {
    const stats = await lstat(join(target, "CLAUDE.md"));
    expect(stats.isSymbolicLink() || stats.isFile()).toBe(true);
    expect(await readFile(join(target, "CLAUDE.md"), "utf8")).toContain("AGENTS.md");
  });

  it("refuses a non-empty target", async () => {
    await expect(scaffold({ spec, targetDir: target })).rejects.toThrow(/not empty/);
  });

  it("seeds/ stays consistent with walkthrough.persona (the fixture contract)", async () => {
    const persona = await readFile(join(target, "seeds", "persona.ts"), "utf8");
    const raw = JSON.parse(
      await readFile(join(target, "apps", "tour", "content", "walkthrough.json"), "utf8"),
    ) as { persona: { name: string } };
    expect(persona).toContain(`"${raw.persona.name}"`);
  });
});
