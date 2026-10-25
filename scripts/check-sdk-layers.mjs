#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol

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
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      // Check both the declared name and npm alias target so an allowed name
      // cannot disguise a forbidden dependency (e.g. n3: npm:pod-auth@...).
      const names = [name];
      const alias = typeof range === "string" && /^npm:((?:@[^/]+\/)?[^@]+)(?:@|$)/.exec(range);
      if (alias) names.push(alias[1]);

      for (const target of new Set(names)) {
        const location = `${path} dependencies.${name}${target === name ? "" : ` (alias of ${target})`}`;
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
