// AUTHORED-BY Codex GPT-6.1-Sol

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { syncSkills } from "../scripts/skills-sync.mjs";

const script = fileURLToPath(new URL("../scripts/skills-sync.mjs", import.meta.url));
const temporary = [];
const manifestName = ".solid-skills-manifest.json";

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function put(root, path, content) {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

function skill(name, extra = "") {
  return `---\nname: ${name}\ndescription: Use when testing sync.\n${extra}---\n# Test skill\n`;
}

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "skills-sync-"));
  temporary.push(base);
  const root = join(base, "checkout");
  const home = join(base, "home");
  mkdirSync(home);
  put(root, "skills/alpha/SKILL.md", skill("alpha"));
  put(root, "skills/alpha/references/guide.md", "Original guide\n");
  put(root, "skills/alpha/assets/icon.bin", Buffer.from([0, 1, 255]));
  put(root, "skills/alpha/scripts/check.sh", "#!/bin/sh\nexit 0\n");
  chmodSync(join(root, "skills/alpha/scripts/check.sh"), 0o755);
  mkdirSync(join(root, "skills/alpha/assets/empty"));
  put(root, "skills/internal/SKILL.md", skill("internal", "metadata:\n  internal: true\n"));
  put(root, "packages/widget/SKILL.md", skill("widget"));
  put(root, "packages/widget/package.json", JSON.stringify({ name: "@jeswr/widget" }));
  put(root, "packages/widget/references/api.md", "Package API\n");
  put(root, "packages/widget/src/index.ts", "export {};\n");
  put(root, "packages/widget/dist/index.js", "export {};\n");
  put(root, "packages/widget/node_modules/dependency/index.js", "export {};\n");
  put(root, "packages/no-skill/package.json", JSON.stringify({ name: "@jeswr/no-skill" }));
  put(root, "skills/INDEX.md", "Not an installable skill\n");
  return { base, root, home };
}

function targetDir(home, target = "claude") {
  return join(home, `.${target}`, "skills");
}

function manifest(home, target = "claude") {
  return JSON.parse(readFileSync(join(targetDir(home, target), manifestName), "utf8"));
}

function backups(home, target = "claude") {
  const directory = join(home, `.${target}`, "skills.bak");
  return existsSync(directory) ? readdirSync(directory).map((name) => join(directory, name)) : [];
}

function snapshot(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true }).map((entry) => {
    const path = join(entry.parentPath, entry.name);
    return [
      path,
      entry.isSymbolicLink()
        ? readlinkSync(path)
        : entry.isDirectory()
          ? "directory"
          : readFileSync(path).toString("hex"),
    ];
  });
}

describe("skills sync", () => {
  it("plans both targets by default without writing anything", () => {
    const options = fixture();
    const before = snapshot(options.base);
    expect(syncSkills(options)).toEqual([
      { target: "claude", name: "alpha", action: "add" },
      { target: "claude", name: "widget", action: "add" },
      { target: "codex", name: "alpha", action: "add" },
      { target: "codex", name: "widget", action: "add" },
    ]);
    expect(snapshot(options.base)).toEqual(before);
  });

  it("copies all shared companions and only package skill files; records deterministic source hashes", () => {
    const options = fixture();
    syncSkills({ ...options, apply: true });
    for (const target of ["claude", "codex"]) {
      const directory = targetDir(options.home, target);
      expect(readdirSync(directory).sort()).toEqual([manifestName, "alpha", "widget"]);
      expect(readFileSync(join(directory, "alpha/SKILL.md"), "utf8")).toBe(skill("alpha"));
      expect(readFileSync(join(directory, "alpha/assets/icon.bin"))).toEqual(
        Buffer.from([0, 1, 255]),
      );
      expect(lstatSync(join(directory, "alpha/scripts/check.sh")).mode & 0o111).toBe(0o111);
      expect(lstatSync(join(directory, "alpha/assets/empty")).isDirectory()).toBe(true);
      expect(readdirSync(join(directory, "widget")).sort()).toEqual(["SKILL.md", "references"]);
      expect(readFileSync(join(directory, "widget/references/api.md"), "utf8")).toBe(
        "Package API\n",
      );
      expect(manifest(options.home, target)).toEqual({
        alpha: expect.stringMatching(/^[a-f0-9]{64}$/),
        widget: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(backups(options.home, target)).toEqual([]);
    }
    expect(manifest(options.home)).toEqual(manifest(options.home, "codex"));
    const before = snapshot(options.home);
    expect(syncSkills({ ...options, apply: true })).toEqual([]);
    expect(snapshot(options.home)).toEqual(before);
  });

  it.each(["claude", "codex"])("honours --target %s", (target) => {
    const options = fixture();
    const plan = syncSkills({ ...options, target, apply: true });
    expect(plan.every((entry) => entry.target === target)).toBe(true);
    expect(existsSync(targetDir(options.home, target))).toBe(true);
    expect(existsSync(targetDir(options.home, target === "claude" ? "codex" : "claude"))).toBe(
      false,
    );
  });

  it("uses package names without their scope and detects resulting collisions before writing", () => {
    const options = fixture();
    put(options.root, "packages/widget/package.json", JSON.stringify({ name: "@jeswr/gadget" }));
    expect(syncSkills({ ...options, target: "claude" }).map(({ name }) => name)).toEqual([
      "alpha",
      "gadget",
    ]);
    put(options.root, "skills/gadget/SKILL.md", skill("gadget"));
    expect(() => syncSkills({ ...options, apply: true })).toThrow("duplicate install name");
    expect(readdirSync(options.home)).toEqual([]);
  });

  it("backs up owned updates and hashes companion content, paths, and executable bits", () => {
    const options = { ...fixture(), target: "codex", apply: true };
    syncSkills(options);
    const initialHash = manifest(options.home, "codex").alpha;
    put(options.root, "skills/alpha/references/guide.md", "Updated guide\n");
    const before = snapshot(options.home);
    expect(syncSkills({ ...options, apply: false })).toEqual([
      { target: "codex", name: "alpha", action: "update" },
    ]);
    expect(snapshot(options.home)).toEqual(before);
    syncSkills(options);
    const [backup] = backups(options.home, "codex");
    expect(readFileSync(join(backup, "alpha/references/guide.md"), "utf8")).toBe(
      "Original guide\n",
    );
    expect(
      readFileSync(join(targetDir(options.home, "codex"), "alpha/references/guide.md"), "utf8"),
    ).toBe("Updated guide\n");
    expect(manifest(options.home, "codex").alpha).not.toBe(initialHash);
    for (const change of [
      () => chmodSync(join(options.root, "skills/alpha/scripts/check.sh"), 0o644),
      () => rmSync(join(options.root, "skills/alpha/assets/empty"), { recursive: true }),
      () => put(options.root, "skills/alpha/references/new.md", "Updated guide\n"),
    ]) {
      change();
      expect(syncSkills({ ...options, apply: false })).toEqual([
        { target: "codex", name: "alpha", action: "update" },
      ]);
      syncSkills(options);
    }
    expect(backups(options.home, "codex")).toHaveLength(4);
  });

  it("repairs owned local changes and missing installs while preserving a backup of local edits", () => {
    const options = { ...fixture(), target: "claude", apply: true };
    syncSkills(options);
    put(targetDir(options.home), "alpha/local.md", "Keep this edit\n");
    rmSync(join(targetDir(options.home), "widget"), { recursive: true });
    expect(syncSkills(options)).toEqual([
      { target: "claude", name: "alpha", action: "update" },
      { target: "claude", name: "widget", action: "add" },
    ]);
    expect(readFileSync(join(backups(options.home)[0], "alpha/local.md"), "utf8")).toBe(
      "Keep this edit\n",
    );
  });

  it("skips matching and unrelated foreign skills, including live and dangling symlinks", () => {
    const options = { ...fixture(), target: "claude", apply: true };
    const directory = targetDir(options.home);
    put(directory, "alpha/SKILL.md", "Foreign alpha\n");
    put(options.home, ".agents/skills/widget/SKILL.md", "Foreign widget\n");
    symlinkSync(join(options.home, ".agents/skills/widget"), join(directory, "widget"));
    symlinkSync(join(options.home, ".agents/missing"), join(directory, "dangling"));
    put(directory, "other/SKILL.md", "Other skill\n");
    expect(syncSkills(options)).toEqual([
      { target: "claude", name: "alpha", action: "skip-foreign" },
      { target: "claude", name: "dangling", action: "skip-foreign" },
      { target: "claude", name: "other", action: "skip-foreign" },
      { target: "claude", name: "widget", action: "skip-foreign" },
    ]);
    expect(readFileSync(join(directory, "alpha/SKILL.md"), "utf8")).toBe("Foreign alpha\n");
    expect(lstatSync(join(directory, "widget")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(directory, "dangling")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(directory, manifestName))).toBe(false);
    expect(backups(options.home)).toEqual([]);
  });

  it("adopts only matching foreign skills after backing up directories and symlinks", () => {
    const options = { ...fixture(), target: "claude", adopt: true };
    const directory = targetDir(options.home);
    put(directory, "alpha/SKILL.md", "Foreign alpha\n");
    put(options.home, ".agents/skills/widget/SKILL.md", "Foreign widget\n");
    const external = join(options.home, ".agents/skills/widget");
    symlinkSync(external, join(directory, "widget"));
    put(directory, "other/SKILL.md", "Other skill\n");
    const before = snapshot(options.home);
    expect(syncSkills(options).map(({ action }) => action)).toEqual([
      "update",
      "skip-foreign",
      "update",
    ]);
    expect(snapshot(options.home)).toEqual(before);
    syncSkills({ ...options, apply: true });
    const [backup] = backups(options.home);
    expect(readFileSync(join(backup, "alpha/SKILL.md"), "utf8")).toBe("Foreign alpha\n");
    expect(readlinkSync(join(backup, "widget"))).toBe(external);
    expect(readFileSync(join(external, "SKILL.md"), "utf8")).toBe("Foreign widget\n");
    expect(readFileSync(join(directory, "other/SKILL.md"), "utf8")).toBe("Other skill\n");
    expect(Object.keys(manifest(options.home))).toEqual(["alpha", "widget"]);
  });

  it.each([
    false,
    true,
  ])("keeps relative symlink backup targets intact (dangling: %s)", (dangling) => {
    const options = { ...fixture(), target: "claude", apply: true, adopt: true };
    const directory = targetDir(options.home);
    mkdirSync(directory, { recursive: true });
    const external = join(options.home, ".agents/skills/alpha");
    if (!dangling) put(external, "SKILL.md", "External skill\n");
    symlinkSync("../../.agents/skills/alpha", join(directory, "alpha"));
    syncSkills(options);
    const backup = join(backups(options.home)[0], "alpha");
    expect(readlinkSync(backup)).toBe(external);
    if (dangling) expect(existsSync(external)).toBe(false);
    else expect(readFileSync(join(backup, "SKILL.md"), "utf8")).toBe("External skill\n");
  });

  it("preserves external targets when repairing owned companion symlinks", () => {
    const options = { ...fixture(), target: "claude", apply: true };
    syncSkills(options);
    const guide = join(targetDir(options.home), "alpha/references/guide.md");
    const external = join(options.home, "external-guide.md");
    put(options.home, "external-guide.md", "Keep external content\n");
    rmSync(guide);
    symlinkSync(external, guide);
    syncSkills(options);
    expect(readFileSync(external, "utf8")).toBe("Keep external content\n");
    expect(readlinkSync(join(backups(options.home)[0], "alpha/references/guide.md"))).toBe(
      external,
    );
    expect(readFileSync(guide, "utf8")).toBe("Original guide\n");
  });

  it("removes only stale owned skills, including skills that become internal, and backs them up", () => {
    const options = { ...fixture(), target: "claude", apply: true };
    syncSkills(options);
    rmSync(join(options.root, "skills/alpha"), { recursive: true });
    put(options.root, "packages/widget/SKILL.md", skill("widget", "metadata:\n  internal: true\n"));
    put(targetDir(options.home), "foreign/SKILL.md", "Keep foreign\n");
    const before = snapshot(options.home);
    expect(syncSkills({ ...options, apply: false })).toEqual([
      { target: "claude", name: "alpha", action: "remove" },
      { target: "claude", name: "foreign", action: "skip-foreign" },
      { target: "claude", name: "widget", action: "remove" },
    ]);
    expect(snapshot(options.home)).toEqual(before);
    syncSkills(options);
    expect(readdirSync(targetDir(options.home)).sort()).toEqual([manifestName, "foreign"]);
    expect(manifest(options.home)).toEqual({});
    expect(readdirSync(backups(options.home)[0]).sort()).toEqual(["alpha", "widget"]);
  });

  it("prunes missing stale entries from the manifest", () => {
    const options = { ...fixture(), target: "claude", apply: true };
    syncSkills(options);
    rmSync(join(options.root, "skills/alpha"), { recursive: true });
    rmSync(join(targetDir(options.home), "alpha"), { recursive: true });
    expect(syncSkills(options)).toEqual([{ target: "claude", name: "alpha", action: "remove" }]);
    expect(Object.keys(manifest(options.home))).toEqual(["widget"]);
    expect(backups(options.home)).toEqual([]);
  });

  it("links into the checkout, switches installation modes, and removes links without changing sources", () => {
    const options = { ...fixture(), target: "claude", apply: true, link: true };
    syncSkills(options);
    for (const [name, source] of [
      ["alpha", "skills/alpha"],
      ["widget", "packages/widget"],
    ]) {
      expect(readlinkSync(join(targetDir(options.home), name))).toBe(join(options.root, source));
    }
    expect(syncSkills(options)).toEqual([]);
    put(options.root, "skills/alpha/references/guide.md", "New linked content\n");
    expect(syncSkills(options)).toEqual([{ target: "claude", name: "alpha", action: "update" }]);
    expect(readlinkSync(join(backups(options.home)[0], "alpha"))).toBe(
      join(options.root, "skills/alpha"),
    );
    syncSkills({ ...options, link: false });
    expect(lstatSync(join(targetDir(options.home), "alpha")).isDirectory()).toBe(true);
    syncSkills(options);
    expect(lstatSync(join(targetDir(options.home), "alpha")).isSymbolicLink()).toBe(true);
    put(options.root, "skills/alpha/SKILL.md", skill("alpha", "metadata:\n  internal: true\n"));
    syncSkills(options);
    expect(existsSync(join(targetDir(options.home), "alpha"))).toBe(false);
    expect(readFileSync(join(options.root, "skills/alpha/references/guide.md"), "utf8")).toBe(
      "New linked content\n",
    );
  });

  it.each([
    "[]",
    "null",
    "not JSON",
    `{"../escape":"${"a".repeat(64)}"}`,
    '{"alpha":"not-a-source-hash"}',
  ])("refuses corrupt ownership manifests before applying either target: %s", (content) => {
    const options = fixture();
    put(targetDir(options.home, "codex"), manifestName, content);
    const before = snapshot(options.home);
    expect(() => syncSkills({ ...options, apply: true })).toThrow();
    expect(snapshot(options.home)).toEqual(before);
  });

  it.each([
    ".claude",
    ".claude/skills",
    ".claude/skills.bak",
    ".claude/skills/.solid-skills-manifest.json",
  ])("refuses redirected target, backup, and manifest paths: %s", (path) => {
    const options = fixture();
    const external = join(options.base, "foreign");
    const destination = join(options.home, path);
    mkdirSync(external);
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(external, destination);
    // A replacement is required to exercise the backup path preflight.
    if (path.endsWith("skills.bak")) put(targetDir(options.home), "alpha/SKILL.md", "Foreign\n");
    const before = snapshot(options.base);
    expect(() => syncSkills({ ...options, apply: true, adopt: true })).toThrow();
    expect(snapshot(options.base)).toEqual(before);
  });

  it.each([
    "skills/alpha",
    "skills/alpha/SKILL.md",
    "skills/alpha/references/guide.md",
  ])("refuses symlinked source content: %s", (path) => {
    const options = fixture();
    const destination = join(options.root, path);
    rmSync(destination, { recursive: true });
    symlinkSync(join(options.base, "missing"), destination);
    expect(() => syncSkills({ ...options, apply: true })).toThrow();
    expect(readdirSync(options.home)).toEqual([]);
  });

  it("refuses malformed YAML without exposing its contents", () => {
    const options = fixture();
    put(options.root, "skills/alpha/SKILL.md", "---\nname: [private-fixture-value\n---\n");
    expect(() => syncSkills({ ...options, apply: true })).toThrow(
      "invalid skill frontmatter (contents omitted)",
    );
    expect(readdirSync(options.home)).toEqual([]);
  });

  it.each(["stage", "backup"])("preserves installations after an injected %s failure", (phase) => {
    const options = { ...fixture(), target: "claude", adopt: true, apply: true };
    const foreign = phase === "stage" ? "widget" : "alpha";
    put(targetDir(options.home), `${foreign}/SKILL.md`, "Keep foreign content\n");
    // Inject an I/O failure in an isolated process, including when tests run as root.
    const code = `
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      import assert from "node:assert/strict";
      const phase = ${JSON.stringify(phase)};
      const method = phase === "stage" ? "cpSync" : "mkdirSync";
      const original = fs[method];
      let injected = false;
      fs[method] = (path, ...args) => {
        if (phase === "stage" ? path.endsWith("/packages/widget/SKILL.md")
          : path.includes("/skills.bak/") && path.endsWith("/alpha")) {
          injected = true;
          throw new Error("injected failure");
        }
        return original(path, ...args);
      };
      syncBuiltinESMExports();
      const { syncSkills } = await import(${JSON.stringify(script)});
      assert.throws(() => syncSkills(${JSON.stringify(options)}), /injected failure/);
      assert.equal(injected, true);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
      encoding: "utf8",
      env: { ...process.env, HOME: options.home },
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(readFileSync(join(targetDir(options.home), foreign, "SKILL.md"), "utf8")).toBe(
      "Keep foreign content\n",
    );
    if (phase === "stage") expect(Object.keys(manifest(options.home))).toEqual(["alpha"]);
    else expect(existsSync(join(targetDir(options.home), manifestName))).toBe(false);
    expect(
      readdirSync(targetDir(options.home)).some((name) => name.startsWith(".solid-skills-stage-")),
    ).toBe(false);
    // A subsequent run can finish without treating a completed install as foreign.
    syncSkills(options);
    expect(Object.keys(manifest(options.home))).toEqual(["alpha", "widget"]);
  });
});

describe("skills sync CLI", () => {
  function cli(home, ...args) {
    return spawnSync(process.execPath, [script, "--home", home, ...args], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
  }

  it("prints the default dry-run plan and applies only to an explicit temporary home", () => {
    const { home } = fixture();
    const preview = cli(home, "--target", "codex");
    expect(preview.status).toBe(0);
    expect(preview.stderr).toBe("");
    expect(preview.stdout).toContain("Dry-run skill sync (no writes):");
    expect(preview.stdout).toContain('codex: add "fetch-rdf"');
    expect(preview.stdout).not.toContain("roborev-review");
    expect(preview.stdout).not.toContain("beads-tracking");
    expect(readdirSync(home)).toEqual([]);
    const applied = cli(home, "--target", "codex", "--apply", "--link");
    expect(applied.status).toBe(0);
    expect(applied.stderr).toBe("");
    expect(applied.stdout).toContain("Applied skill sync:");
    expect(lstatSync(join(targetDir(home, "codex"), "fetch-rdf")).isSymbolicLink()).toBe(true);
    expect(existsSync(targetDir(home))).toBe(false);
    expect(cli(home, "--target", "codex", "--link").stdout).toContain("No changes.");
  });

  it.each([
    ["--target", "unknown"],
    ["--unknown", "private-fixture-value"],
    ["--home"],
  ])("rejects invalid arguments without writing or echoing values: %j", (...args) => {
    const { home } = fixture();
    const result = cli(home, ...args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Skill sync failed:");
    expect(result.stderr).not.toContain("private-fixture-value");
    expect(readdirSync(home)).toEqual([]);
  });

  it("shows help and imports without performing a sync", () => {
    const { home } = fixture();
    expect(cli(home, "--help").stdout).toContain("Dry run by default.");
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", `await import(${JSON.stringify(script)})`],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: home },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).toBe("");
    expect(readdirSync(home)).toEqual([]);
  });
});
