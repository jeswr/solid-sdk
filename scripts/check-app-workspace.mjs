#!/usr/bin/env node
// AUTHORED-BY Codex GPT-5

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appsDir = join(repoRoot, "apps");
const packagesDir = join(repoRoot, "packages");
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const forbiddenLockfiles = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "npm-shrinkwrap.json",
];

const readManifest = (path) => JSON.parse(readFileSync(path, "utf8"));
const childDirectories = (path) =>
  readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const workspacePackageNames = new Set(
  childDirectories(packagesDir)
    .map((directory) => readManifest(join(packagesDir, directory, "package.json")))
    .map((manifest) => manifest.name),
);

const failures = [];
for (const slug of childDirectories(appsDir)) {
  const appDir = join(appsDir, slug);
  const rootManifestPath = join(appDir, "package.json");
  if (!existsSync(rootManifestPath)) {
    failures.push(`apps/${slug} has no root package.json`);
    continue;
  }

  const rootManifest = readManifest(rootManifestPath);
  const expectedName = slug === "app-store" ? "@jeswr/app-store" : `@jeswr/app-${slug}`;
  if (rootManifest.name !== expectedName) {
    failures.push(
      `apps/${slug}/package.json name is ${rootManifest.name ?? "missing"}; expected ${expectedName}`,
    );
  }

  const manifestPaths = [rootManifestPath];
  const webManifestPath = join(appDir, "web", "package.json");
  if (existsSync(webManifestPath)) manifestPaths.push(webManifestPath);

  for (const manifestPath of manifestPaths) {
    const manifest = readManifest(manifestPath);
    const relativePath = manifestPath.slice(repoRoot.length + 1);
    if (manifest.private !== true) failures.push(`${relativePath} must set private: true`);

    for (const field of dependencyFields) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (workspacePackageNames.has(name) && range !== "workspace:*") {
          failures.push(`${relativePath} ${field}.${name} must be workspace:*, found ${range}`);
        }
      }
    }
  }

  for (const relativeDirectory of ["", "web"]) {
    for (const lockfile of forbiddenLockfiles) {
      const relativePath = join("apps", slug, relativeDirectory, lockfile);
      if (existsSync(join(repoRoot, relativePath))) {
        failures.push(`${relativePath} is forbidden; use the root pnpm lockfile`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(
    `App workspace guard failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
  );
  process.exit(1);
}

console.log("App workspace guard passed.");
