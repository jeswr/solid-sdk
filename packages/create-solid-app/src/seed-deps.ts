// AUTHORED-BY Claude Opus 4.8
/**
 * seed-deps.ts — on-demand resolution of the `--seed-pod` runtime dependencies.
 *
 * WHY THIS EXISTS (the load-bearing constraint):
 *   `--seed-pod` needs `@solid/community-server` (to boot a local pod) and `jose`
 *   (to mint the client-credentials DPoP proof) at RUNTIME. `@solid/community-server`
 *   is HEAVY (a full Solid server + Components.js dep graph). Making it a hard
 *   `dependency` of create-solid-app would force EVERY `npx create-solid-app` — the
 *   overwhelming common case, which never touches `--seed-pod` — to download it.
 *   That is unacceptable for a scaffolder whose whole point is a fast first run.
 *
 *   So these two are NOT runtime `dependencies` of the published package. They stay
 *   `devDependencies` — present for the dev checkout's gate + the RUN_SLOW seed-pod
 *   tests, but npm does NOT install a dependency's devDependencies, so a downstream
 *   `npx create-solid-app` never carries them. This module is the bridge: it RESOLVES
 *   the deps when `--seed-pod` actually runs, auto-installing them on demand into a
 *   writable per-user cache the first time, so `--seed-pod` works from an installed
 *   package WITHOUT taxing the base scaffold.
 *
 * Resolution order for each dep:
 *   1. Already resolvable from the CLI's own module graph (the dev checkout's
 *      node_modules, or a user who installed these deps alongside the CLI) — use it.
 *   2. Already present in the per-user seed-deps cache (a previous --seed-pod run) — use it.
 *      The cache dir is keyed by a hash of `SEED_DEP_SPECS` (see {@link seedDepsCacheDir}
 *      / {@link seedDepsSpecHash}), so a CLI upgrade that BUMPS a spec lands in a fresh
 *      dir — the stale versions of an older spec set are never silently reused.
 *   3. Otherwise `npm install` them into the cache (one-time, with a clear message),
 *      then resolve from there.
 *
 * If the on-demand install fails (offline, registry down), we throw an ACTIONABLE
 * error telling the user exactly what to install — never a silent or misleading
 * success.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The versions installed on demand. Kept in lockstep with the CLI's own
 * `devDependencies` so the dev checkout (which resolves them locally) and the
 * on-demand path (a published-package `--seed-pod` run) agree on versions.
 */
export const SEED_DEP_SPECS = {
  "@solid/community-server": "8.0.0-alpha.3",
  jose: "^6.2.3",
} as const;

/**
 * A short, stable hash of the CURRENT {@link SEED_DEP_SPECS}. It keys the cache
 * dir so a CLI upgrade that bumps a spec (e.g. a new CSS / jose version) lands in
 * a FRESH dir — the stale cached versions are never silently reused. The hash is
 * over the canonical `name@range` set (sorted, so key order can't change it).
 *
 * WHY a hash and not "read installed versions + reinstall on mismatch": the
 * resolve step (`tryResolve`) only proves a module is *resolvable*, not that its
 * version satisfies the spec — so a stale cache would pass the resolve check and
 * be reused. Hashing the spec set into the path makes a spec change a cache MISS
 * structurally (a different dir), with zero version-parsing/semver logic to get
 * wrong, and old dirs simply become inert (harmless, GC-able) on disk.
 */
export function seedDepsSpecHash(specs: Readonly<Record<string, string>> = SEED_DEP_SPECS): string {
  const canonical = Object.entries(specs)
    .map(([name, range]) => `${name}@${range}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

/**
 * Per-user cache the on-demand seed-pod deps are installed into (writable, unlike
 * an npx cache). Keyed by {@link seedDepsSpecHash} so a spec/version bump uses a
 * fresh dir rather than reusing stale cached versions. The
 * `CREATE_SOLID_APP_SEED_DEPS_DIR` override is treated as the BASE and is
 * spec-keyed too, so the same guarantee holds under the override.
 */
export function seedDepsCacheDir(): string {
  const base =
    process.env["CREATE_SOLID_APP_SEED_DEPS_DIR"] ??
    join(homedir(), ".cache", "create-solid-app", "seed-deps");
  return join(base, seedDepsSpecHash());
}

/** A `require` rooted at this module (the CLI's own graph). */
const cliRequire = createRequire(import.meta.url);

/** A `require` rooted in the cache dir (resolves packages installed there). */
function cacheRequire(): NodeJS.Require {
  // createRequire needs a file path that lives inside the dir whose node_modules
  // we want to resolve against; the file need not exist.
  return createRequire(join(seedDepsCacheDir(), "noop.cjs"));
}

/** Try to resolve a request from the CLI graph first, then the seed-deps cache. */
function tryResolve(request: string): string | undefined {
  for (const req of [cliRequire, cacheRequire()]) {
    try {
      return req.resolve(request);
    } catch {
      // try next resolver
    }
  }
  return undefined;
}

/**
 * Install the seed-pod deps into the per-user cache (idempotent). Writes a minimal
 * package.json so npm has a project to install into, then installs the pinned specs.
 * Throws an actionable error on failure.
 */
function installSeedDeps(): void {
  const dir = seedDepsCacheDir();
  mkdirSync(dir, { recursive: true });
  const pkgJsonPath = join(dir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    writeFileSync(
      pkgJsonPath,
      `${JSON.stringify(
        {
          name: "create-solid-app-seed-deps",
          private: true,
          description: "On-demand cache for create-solid-app --seed-pod runtime deps.",
        },
        null,
        2,
      )}\n`,
    );
  }

  const specs = Object.entries(SEED_DEP_SPECS).map(([name, range]) => `${name}@${range}`);
  process.stderr.write(
    `• --seed-pod: installing local dev-pod dependencies (one-time, ~once):\n` +
      `    ${specs.join(" ")}\n` +
      `    into ${dir}\n`,
  );
  const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline", ...specs], {
    cwd: dir,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    throw new Error(
      `--seed-pod could not install its runtime dependencies (${specs.join(", ")}).\n` +
        `Install them manually and retry, e.g.:\n` +
        `    npm install ${specs.join(" ")}\n` +
        `(create-solid-app keeps @solid/community-server OUT of the default install — it is only ` +
        `needed for --seed-pod — so the base scaffold stays fast.)`,
    );
  }
}

export interface SeedDeps {
  /** Absolute path to the CSS server entry point (`bin/server.js`). */
  cssBin: string;
  /** Resolved `jose` module (DPoP proof signing). */
  jose: typeof import("jose");
}

/**
 * Resolve (auto-installing on demand) the `--seed-pod` runtime deps. Idempotent:
 * a second call is a no-op once the cache is warm.
 */
export async function ensureSeedDeps(): Promise<SeedDeps> {
  const cssRequest = "@solid/community-server/bin/server.js";
  // Also honour a sibling integration that already installed CSS (workspace fallback).
  const workspaceCss = join(
    process.cwd(),
    "integrations/wix-solid/node_modules/@solid/community-server/bin/server.js",
  );

  let cssBin = tryResolve(cssRequest) ?? (existsSync(workspaceCss) ? workspaceCss : undefined);
  let josePath = tryResolve("jose");

  if (!cssBin || !josePath) {
    installSeedDeps();
    cssBin = tryResolve(cssRequest) ?? cssBin;
    josePath = tryResolve("jose") ?? josePath;
  }

  if (!cssBin) {
    throw new Error(
      "@solid/community-server is still not resolvable after the on-demand install. " +
        `Install it manually: npm install @solid/community-server@${SEED_DEP_SPECS["@solid/community-server"]}`,
    );
  }
  if (!josePath) {
    throw new Error(
      "jose is still not resolvable after the on-demand install. " +
        `Install it manually: npm install jose@${SEED_DEP_SPECS.jose}`,
    );
  }

  // Import jose by its resolved file URL so it works whether it lives in the CLI
  // graph or the per-user cache (a bare `import("jose")` would only see the former).
  const jose = (await import(pathToFileURL(josePath).href)) as typeof import("jose");
  return { cssBin, jose };
}
