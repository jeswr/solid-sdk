#!/usr/bin/env node
// AUTHORED-BY Codex GPT-5.6 (Sol)
// AUTHORED-BY Codex GPT-6.1 (Sol)

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

function readJson(root, path, failures) {
  let source;
  try {
    source = readFileSync(join(root, path), "utf8");
  } catch {
    failures.push(`${path}: missing or unreadable file`);
    return null;
  }
  try {
    const value = JSON.parse(source);
    if (value === null || typeof value !== "object") throw new Error("expected an object or array");
    return value;
  } catch {
    failures.push(`${path}: invalid JSON (expected an object or array)`);
    return null;
  }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function checkViteConfig(root, directory, failures) {
  const path = `${directory}/vercel.json`;
  const config = readJson(root, path, failures);
  if (!config) return;

  // Probe both regex sources and Vercel's named catch-all syntax. A rewrite
  // for only /login is not an SPA fallback.
  const hasSpaRewrite =
    Array.isArray(config.rewrites) &&
    config.rewrites.some((rewrite) => {
      if (rewrite?.destination !== "/index.html" || typeof rewrite.source !== "string") {
        return false;
      }
      try {
        const source = rewrite.source.replace(/^\/:[A-Za-z_]\w*(?:\*|\(\.\*\))$/, "/(.*)");
        const pattern = new RegExp(`^${source}$`);
        return ["/", "/deep/link", "/another/nested/page"].every((url) => pattern.test(url));
      } catch {
        return false;
      }
    });
  if (!hasSpaRewrite) failures.push(`${path}: missing SPA rewrite to /index.html`);

  const headers = Array.isArray(config.headers)
    ? config.headers
        .filter((entry) => entry?.source === "/clientid.jsonld" && Array.isArray(entry.headers))
        .flatMap((entry) => entry.headers)
    : [];
  for (const [key, value] of [
    ["Content-Type", "application/ld+json"],
    ["Access-Control-Allow-Origin", "*"],
  ]) {
    if (
      !headers.some(
        (header) =>
          typeof header?.key === "string" &&
          header.key.toLowerCase() === key.toLowerCase() &&
          typeof header.value === "string" &&
          header.value.split(";")[0].trim().toLowerCase() === value,
      )
    ) {
      failures.push(`${path}: /clientid.jsonld headers must include ${key}: ${value}`);
    }
  }
}

function checkBuildEnv(root, app, failures) {
  // Next.js routes can derive their origin from the request instead of a build env.
  if (app.originEnv === undefined) return;
  // Turbo infers NEXT_PUBLIC_* for Next.js, including cache-key inputs.
  if (app.framework === "next" && app.originEnv.startsWith("NEXT_PUBLIC_")) return;
  const path = `${app.rootDirectory}/turbo.json`;
  const config = readJson(root, path, failures);
  if (!config) return;
  if (!Array.isArray(config.extends) || !config.extends.includes("//")) {
    failures.push(`${path}: package-level config must extend //`);
  }
  if (!Array.isArray(config.tasks?.build?.env) || !config.tasks.build.env.includes(app.originEnv)) {
    failures.push(`${path}: tasks.build.env must include ${app.originEnv}`);
  }
}

function checkIgnoreCommand(root, app, failures) {
  const location = `${app.project}: vercelIgnore`;
  if (typeof app.vercelIgnore !== "string" || app.vercelIgnore.length > 256) {
    failures.push(`${location} must be a command of at most 256 characters`);
    return;
  }
  const match = /^node\s+(\S+)\s+(\S+)$/.exec(app.vercelIgnore);
  if (!match || match[2] !== app.package) {
    failures.push(`${location} must run node <script-path> ${app.package}`);
    return;
  }
  const script = resolve(root, app.rootDirectory, match[1]);
  if (script !== resolve(root, "scripts/vercel-ignore-build.mjs") || !existsSync(script)) {
    failures.push(`${location} script path must resolve to scripts/vercel-ignore-build.mjs`);
  }
}

// Drop comments so a mention in a comment can't satisfy a source check (keeps "https://").
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function nextClientIdRouteSource(root, directory) {
  for (const base of ["src/app", "app"]) {
    for (const extension of ["ts", "js", "mjs"]) {
      const path = join(root, directory, base, "clientid.jsonld", `route.${extension}`);
      if (!existsSync(path)) continue;
      const source = stripComments(readFileSync(path, "utf8"));
      if (
        /export\s+(?:(?:async\s+)?function\s+GET\s*\(|const\s+GET\s*=)/.test(source) &&
        ["client_id", "redirect_uris", "application/ld+json"].every((value) =>
          source.includes(value),
        )
      ) {
        return source;
      }
    }
  }
  return null;
}

// Without an origin env, the route must build client_id from the request URL at request time.
function isRequestDerivedRoute(source) {
  return (
    /new\s+URL\(\s*(["'`])\/clientid\.jsonld\1\s*,\s*(?:request|req)\.url\s*,?\s*\)/.test(source) &&
    !/\bdynamic\s*=\s*["'`]force-static["'`]/.test(source)
  );
}

function hasViteClientIdConfig(root, directory, originEnv) {
  const reads = new RegExp(`\\benv(?:\\.${originEnv}\\b|\\[\\s*["'\`]${originEnv}["'\`]\\s*\\])`);
  for (const extension of ["ts", "js", "mjs"]) {
    const path = join(root, directory, `vite.config.${extension}`);
    if (!existsSync(path)) continue;
    const source = stripComments(readFileSync(path, "utf8"));
    // The emitting plugin may live in an imported helper, so check its config inputs.
    if (/["'`][^"'`\n]*clientid\.jsonld["'`]/.test(source) && reads.test(source)) return true;
  }
  return false;
}

function checkClientIdBuild(root, app, manifest, failures) {
  const build = manifest.scripts?.build;
  const hasBuild = typeof build === "string" && build.trim() !== "";
  const hasGenerator = [build, manifest.scripts?.prebuild].some(
    (script) => typeof script === "string" && script.includes("gen-clientid"),
  );
  const routeSource =
    app.framework === "next" && hasBuild && /\bnext\s+build\b/.test(build)
      ? nextClientIdRouteSource(root, app.rootDirectory)
      : null;
  const hasNextRoute =
    routeSource !== null && (app.originEnv !== undefined || isRequestDerivedRoute(routeSource));
  // An explicit --config could select a different file from the one checked here.
  const hasViteConfig =
    app.framework === "vite" &&
    hasBuild &&
    /\bvite\s+build\b/.test(build) &&
    !/\bvite\s+build\b[^&|;]*\s(?:--config|-c)(?:[\s=]|$)/.test(build) &&
    hasViteClientIdConfig(root, app.rootDirectory, app.originEnv);
  const generatesClientId = app.originEnv !== undefined && (hasGenerator || hasViteConfig);
  if (!hasBuild || (!generatesClientId && !hasNextRoute)) {
    failures.push(
      `${app.rootDirectory}/package.json: build/prebuild must generate clientid.jsonld via gen-clientid${
        app.framework === "next"
          ? ` or next build with a clientid.jsonld GET route${
              app.originEnv === undefined ? " deriving client_id from the request URL" : ""
            }`
          : ` or vite build with a Vite config referencing clientid.jsonld and ${app.originEnv}`
      }`,
    );
  }
}

function checkVercelConfig(root) {
  const failures = [];
  const path = "scripts/vercel-apps.json";
  const apps = readJson(root, path, failures);
  if (apps && (!Array.isArray(apps) || apps.length === 0)) {
    failures.push(`${path}: expected a non-empty array of deployments`);
  }
  if (Array.isArray(apps)) {
    for (const [index, app] of apps.entries()) {
      if (
        !app ||
        ["project", "rootDirectory", "package", "framework"].some(
          (key) => typeof app[key] !== "string" || !app[key].trim(),
        ) ||
        !["vite", "next"].includes(app.framework) ||
        // originEnv may be omitted by a Next.js request-derived client ID route or an opt-out.
        (app.originEnv === undefined
          ? app.framework !== "next" && app.clientIdDocument !== false
          : !["APP_ORIGIN", "NEXT_PUBLIC_APP_ORIGIN"].includes(app.originEnv))
      ) {
        failures.push(`${path}[${index}]: invalid deployment entry`);
        continue;
      }
      if (app.clientIdDocument !== undefined && typeof app.clientIdDocument !== "boolean") {
        failures.push(`${path}[${index}]: clientIdDocument must be a boolean`);
        continue;
      }
      const directory = app.rootDirectory;
      if (!isDirectory(join(root, directory))) {
        failures.push(`${app.project}: rootDirectory ${directory} is missing or not a directory`);
        continue;
      }
      const manifest = readJson(root, `${directory}/package.json`, failures);
      if (!manifest) continue;
      if (manifest.name !== app.package) {
        failures.push(`${directory}/package.json: package name must match ${app.package}`);
      }
      if (manifest.private !== true) {
        failures.push(`${directory}/package.json: deployed package must be private`);
      }
      checkIgnoreCommand(root, app, failures);
      if (app.framework === "vite") checkViteConfig(root, directory, failures);
      // Client ID documents are required unless the deployment explicitly opts out.
      if (app.clientIdDocument !== false) {
        checkBuildEnv(root, app, failures);
        checkClientIdBuild(root, app, manifest, failures);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Vercel config guard failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }
  console.log(`Vercel config guard passed (${apps.length} deployments checked).`);
}

// Resolve symlinked CLI paths and support Node 24.0/24.1 without import.meta.main.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { root: { type: "string" } } });
    checkVercelConfig(resolve(values.root ?? fileURLToPath(new URL("..", import.meta.url))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
