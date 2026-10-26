#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import { globSync, readFileSync, realpathSync } from "node:fs";
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

function isNumeric(value) {
  if (!value) return false;
  for (const char of value) {
    if (char < "0" || char > "9") return false;
  }
  return true;
}

function isIdentifier(value, prerelease) {
  if (!value) return false;
  for (const char of value) {
    if (
      !(char >= "0" && char <= "9") &&
      !(char >= "a" && char <= "z") &&
      !(char >= "A" && char <= "Z") &&
      char !== "-"
    ) {
      return false;
    }
  }
  return !(prerelease && value.length > 1 && value.startsWith("0") && isNumeric(value));
}

function isVersion(value) {
  if (value.startsWith("v")) value = value.slice(1);
  const build = value.indexOf("+");
  if (build !== -1) {
    if (
      !value
        .slice(build + 1)
        .split(".")
        .every((part) => isIdentifier(part, false))
    )
      return false;
    value = value.slice(0, build);
  }
  const prerelease = value.indexOf("-");
  if (prerelease !== -1) {
    if (
      !value
        .slice(prerelease + 1)
        .split(".")
        .every((part) => isIdentifier(part, true))
    ) {
      return false;
    }
    value = value.slice(0, prerelease);
  }
  const components = value.split(".");
  if (components.length > 3 || (components.length < 3 && (build !== -1 || prerelease !== -1))) {
    return false;
  }
  let wildcard = false;
  for (const part of components) {
    if (["x", "X", "*"].includes(part)) {
      wildcard = true;
    } else if (wildcard || !isNumeric(part) || (part.length > 1 && part.startsWith("0"))) {
      return false;
    }
  }
  return true;
}

// Parse unions, hyphen ranges and comparator sets in separate passes. Each
// character is visited a bounded number of times, with no backtracking. The
// only regex splits whitespace; version and identifier validation use strings.
function isSemverRange(range) {
  return range.split("||").every((part) => {
    const tokens = part.trim().split(/\s+/);
    if (tokens.length === 3 && tokens[1] === "-") {
      return isVersion(tokens[0]) && isVersion(tokens[2]);
    }
    for (let index = 0; index < tokens.length; index++) {
      let token = tokens[index];
      const operator = [">=", "<=", "~>", ">", "<", "=", "^", "~"].find((prefix) =>
        token.startsWith(prefix),
      );
      if (operator) token = token.slice(operator.length) || tokens[++index];
      if (!token || !isVersion(token)) return false;
    }
    return true;
  });
}

export function isSupportedSpec(spec) {
  if (typeof spec !== "string") return false;
  if (spec === "workspace:^" || spec === "workspace:~") return true;
  const range = spec.startsWith("workspace:") ? spec.slice("workspace:".length) : spec;
  return isSemverRange(range);
}

function checkLayers(root) {
  if (typeof globSync !== "function") {
    throw new Error("SDK layer guard requires node:fs.globSync; use Node.js >=24.");
  }
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

// import.meta.main is unavailable in Node 24.0 and 24.1. Resolve symlinked entry paths too.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // --root supports isolated fixture workspaces; normal lint always uses this checkout.
    const { values } = parseArgs({ options: { root: { type: "string" } } });
    checkLayers(resolve(values.root ?? fileURLToPath(new URL("..", import.meta.url))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
