#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { globSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// ADR-001 D1, including its 2026-10-25 dependency amendment. This guard
// checks manifest dependencies; source-level import restrictions are separate.
const storageClientDependencies = new Set([
  "@jeswr/storage-capabilities",
  "@jeswr/fetch-rdf",
  "@jeswr/rdf-serialize",
  "@jeswr/guarded-fetch",
  "@solid/object",
  "@rdfjs/wrapper",
  "n3",
]);
const appForbiddenDependencies = [
  "@sparq-org/sparq",
  "@jeswr/storage-client/solid",
  "@jeswr/storage-client/lws",
];

const isPackageOrSubpath = (name, target) => name === target || name.startsWith(`${target}/`);
const layeredPackages = new Set(["@jeswr/storage-client", "@jeswr/pod-auth"]);
const restrictedDependencies = [...layeredPackages, ...appForbiddenDependencies];

// Recognize workspace versions/ranges before package aliases: e.g. 0.1.0 is
// also syntactically a package name, but workspace:0.1.0 targets the key.
const number = "(?:0|[1-9][0-9]*)";
const prerelease = "(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)";
const version = `${number}\\.${number}\\.${number}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?`;
const partial = `(?:${version}|(?:${number}|[xX*])(?:\\.(?:${number}|[xX*])){0,2})`;
const comparator = `(?:[<>]=?|[=~^])?\\s*v?${partial}`;
const range = new RegExp(
  `^(?:v?${partial}\\s+-\\s+v?${partial}|${comparator}(?:\\s+${comparator})*)(?:\\s*\\|\\|\\s*(?:v?${partial}\\s+-\\s+v?${partial}|${comparator}(?:\\s+${comparator})*))*$`,
);

function dependencyTarget(name, spec) {
  if (typeof spec !== "string") return null;
  if (spec.startsWith("workspace:")) {
    const value = spec.slice("workspace:".length).trim();
    if (value === "^" || value === "~" || range.test(value)) return name;
  }
  const alias =
    /^(?:npm|workspace):((?:@[a-z0-9._-]+\/)?[a-z0-9_-][a-z0-9._-]*)(?:@[^@:]+)?$/i.exec(spec);
  if (alias) return alias[1];
  // Versions, ranges and tags address the dependency key. Other protocols,
  // paths and repository shorthands cannot establish the package identity.
  return /^[a-z0-9_*^~<>=][a-z0-9._*+^~<>=| -]*$/i.test(spec) ? name : null;
}

function checkLayers(root) {
  const failures = [];
  const manifests = globSync(
    [
      "packages/*/package.json",
      "apps/*/package.json",
      "apps/*/web/package.json",
      "tools/*/package.json",
    ],
    { cwd: root },
  ).sort();

  for (const path of manifests) {
    const manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
    const isApp = path.startsWith("apps/");
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        const target = dependencyTarget(name, spec);
        const location = `${path} ${field}.${name}${target && target !== name ? ` (alias of ${target})` : ""}`;
        if (target === null) {
          if (
            layeredPackages.has(manifest.name) ||
            restrictedDependencies.some((dep) => isPackageOrSubpath(name, dep))
          ) {
            failures.push(`${location}: unresolvable dependency alias`);
          }
          continue;
        }
        if (isApp && appForbiddenDependencies.some((dep) => isPackageOrSubpath(target, dep))) {
          failures.push(`${location}: apps must use the protocol-neutral SDK surface`);
        }
        if (manifest.name === "@jeswr/storage-client" && !storageClientDependencies.has(target)) {
          failures.push(
            `${location}: storage-client may depend only on ${[...storageClientDependencies].join(", ")}`,
          );
        }
        if (
          manifest.name === "@jeswr/pod-auth" &&
          isPackageOrSubpath(target, "@jeswr/storage-client")
        ) {
          failures.push(`${location}: pod-auth must not depend on storage-client`);
        }
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `SDK layer guard failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }
  console.log(`SDK layer guard passed (${manifests.length} manifests scanned).`);
}

try {
  // --root supports isolated fixture workspaces; normal lint always uses this checkout.
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  checkLayers(resolve(values.root ?? fileURLToPath(new URL("..", import.meta.url))));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
