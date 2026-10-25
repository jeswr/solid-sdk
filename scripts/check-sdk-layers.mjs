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

// Allow semver range syntax only: versions/partials, wildcards, comparators,
// conjunctions, hyphen ranges and unions. No dependency resolution is needed.
const number = "(?:0|[1-9][0-9]*)";
const prerelease = "(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)";
const qualifier = `(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?`;
const component = `(?:${number}|[xX*])`;
const partial = `${component}(?:\\.${component}(?:\\.${component}${qualifier})?)?`;
const comparator = `(?:[<>]=?|[=^]|~>?)?\\s*v?${partial}`;
const rangePart = `(?:v?${partial}\\s+-\\s+v?${partial}|${comparator}(?:\\s+${comparator})*)`;
const semverRange = new RegExp(`^${rangePart}(?:\\s*\\|\\|\\s*${rangePart})*$`);

function isSupportedSpec(spec) {
  if (typeof spec !== "string") return false;
  if (spec === "workspace:^" || spec === "workspace:~") return true;
  const range = spec.startsWith("workspace:") ? spec.slice("workspace:".length) : spec;
  return semverRange.test(range.trim());
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
        const location = `${path} ${field}.${name}`;
        const isRestricted =
          layeredPackages.has(manifest.name) ||
          restrictedDependencies.some((dep) => isPackageOrSubpath(name, dep));
        if (!isRestricted) continue;
        if (!isSupportedSpec(spec)) {
          failures.push(`${location}: unsupported dependency spec for a layered package`);
        }
        if (isApp && appForbiddenDependencies.some((dep) => isPackageOrSubpath(name, dep))) {
          failures.push(`${location}: apps must use the protocol-neutral SDK surface`);
        }
        if (manifest.name === "@jeswr/storage-client" && !storageClientDependencies.has(name)) {
          failures.push(
            `${location}: storage-client may depend only on ${[...storageClientDependencies].join(", ")}`,
          );
        }
        if (
          manifest.name === "@jeswr/pod-auth" &&
          isPackageOrSubpath(name, "@jeswr/storage-client")
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
