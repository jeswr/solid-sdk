#!/usr/bin/env node
// AUTHORED-BY Codex GPT-5.6 (Sol)

import { spawnSync } from "node:child_process";
import { globSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const nonBuildPaths =
  /^(?:[^/]+\.md|(?:decisions|skills|docs|\.github|\.claude)\/.*|\.roborev\.toml|LICENSE[^/]*)$/;

function workspacePackages(root) {
  const config = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const block = /^packages:\s*\n((?:[ \t]+[^\n]*(?:\n|$)|\n)*)/m.exec(config)?.[1];
  if (!block) throw new Error("missing pnpm workspace packages list");
  const patterns = [];
  for (const line of block.trimEnd().split("\n")) {
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const match = /^\s*-\s*(?:"([^"]+)"|'([^']+)'|([^#\s]+))\s*(?:#.*)?$/.exec(line);
    if (!match) throw new Error("unsupported pnpm workspace package glob");
    patterns.push(match[1] ?? match[2] ?? match[3]);
  }
  const included = patterns.filter((pattern) => !pattern.startsWith("!"));
  if (included.length === 0) throw new Error("empty pnpm workspace packages list");
  const excluded = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => `${pattern.slice(1)}/package.json`);
  const paths = globSync(
    included.map((pattern) => `${pattern}/package.json`),
    { cwd: root, exclude: excluded },
  );
  const packages = new Map();
  for (const path of new Set(paths)) {
    const manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
    if (typeof manifest.name !== "string" || !manifest.name) {
      throw new Error(`${path} has no package name`);
    }
    if (packages.has(manifest.name))
      throw new Error(`duplicate workspace package ${manifest.name}`);
    packages.set(manifest.name, { directory: dirname(path), manifest });
  }
  return packages;
}

function dependencyClosure(packages, name) {
  const closure = new Map();
  const pending = [name];
  while (pending.length > 0) {
    const dependency = pending.pop();
    if (closure.has(dependency)) continue;
    const project = packages.get(dependency);
    if (!project) throw new Error(`unknown workspace package ${dependency}`);
    closure.set(dependency, project);
    // Nested web apps compile their parent workspace's src/ through Vite aliases.
    // Include that source owner and its dependencies even without a manifest edge.
    for (const [ancestorName, ancestor] of packages) {
      if (project.directory.startsWith(`${ancestor.directory}/`)) pending.push(ancestorName);
    }
    for (const field of dependencyFields) {
      const dependencies = project.manifest[field] ?? {};
      if (typeof dependencies !== "object" || Array.isArray(dependencies)) {
        throw new Error(`${dependency} has invalid ${field}`);
      }
      for (const [target, spec] of Object.entries(dependencies)) {
        if (typeof spec !== "string")
          throw new Error(`${dependency} has an invalid dependency spec`);
        if (spec.startsWith("workspace:")) pending.push(target);
      }
    }
  }
  return closure;
}

// No package manager or installed dependencies are available at the ignored-build step.
function ignoreBuild(root, name) {
  if (!name) throw new Error("usage: vercel-ignore-build.mjs <package-name>");
  const packages = workspacePackages(root);
  const closure = dependencyClosure(packages, name);
  const directories = [
    ...new Set([...closure.values()].map((project) => project.directory)),
  ].sort();
  const git = (args) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const previous = process.env.VERCEL_GIT_PREVIOUS_SHA;
  if (!previous) throw new Error("VERCEL_GIT_PREVIOUS_SHA is unset");
  const commit = git(["rev-parse", "--verify", "--end-of-options", `${previous}^{commit}`]);
  if (commit.error || commit.status !== 0) {
    throw new Error("VERCEL_GIT_PREVIOUS_SHA is unavailable in this clone");
  }
  const base = commit.stdout.trim();
  const ancestor = git(["merge-base", "--is-ancestor", base, "HEAD"]);
  if (ancestor.error || ancestor.status !== 0) {
    throw new Error("VERCEL_GIT_PREVIOUS_SHA is not a known ancestor of HEAD");
  }
  // NUL delimiters preserve unusual filenames; disabling renames includes both paths.
  const result = git(["diff", "--name-only", "--no-renames", "-z", base, "HEAD", "--"]);
  if (result.error) throw new Error(`git diff failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`git diff failed for base ${base} (exit ${result.status})`);
  }
  const workspaceDirectories = [...packages.values()].map((project) => project.directory);
  const unchanged = !result.stdout
    .split("\0")
    .filter(Boolean)
    .some((path) => {
      if (directories.some((directory) => path.startsWith(`${directory}/`))) return true;
      if (workspaceDirectories.some((directory) => path.startsWith(`${directory}/`))) return false;
      // Unknown root inputs affect every app unless explicitly documented as harmless.
      return !nonBuildPaths.test(path);
    });
  console.log(
    `${unchanged ? "Skip build" : "Build"}: ${name} build inputs ${unchanged ? "unchanged" : "changed"} since ${base}.`,
  );
  return unchanged ? 0 : 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("usage: vercel-ignore-build.mjs <package-name>");
    process.exitCode = ignoreBuild(
      resolve(fileURLToPath(new URL("..", import.meta.url))),
      process.argv[2],
    );
  } catch (error) {
    console.log(`Build: ${String(error.message).replace(/\s+/g, " ")}.`);
    process.exitCode = 1;
  }
}
