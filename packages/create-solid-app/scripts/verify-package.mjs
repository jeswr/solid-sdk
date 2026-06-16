// AUTHORED-BY Claude Opus 4.8
/**
 * verify-package.mjs — the standalone package's `build` gate.
 *
 * There is no compile/emit step: `bin.ts` runs via Node 24's native TypeScript
 * type-stripping (no `dist/`). So "build" here means "is this package actually
 * shippable" — i.e. the things `npm publish` + a downstream `npx create-solid-app`
 * depend on are present and self-consistent:
 *
 *   1. The bundled template/ exists with a package.json (the scaffold's only
 *      source-of-truth; resolveTemplateDir() probes `<pkg>/template` first).
 *   2. The template ships its committed lockfile (resolution-free first install —
 *      see src/scaffold.ts SKIP_ENTRIES) and is free of the build/dep artefacts
 *      the scaffold also refuses to copy (node_modules/.next/tsbuildinfo).
 *   3. package.json `files` includes everything `npx` needs (bin, src, template).
 *
 * Typechecking is the separate `typecheck` gate (`tsc --noEmit`); the full local
 * gate runs lint + typecheck + test + build.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fail = (msg) => {
  process.stderr.write(`✗ build/verify: ${msg}\n`);
  process.exit(1);
};

const templateDir = join(pkgRoot, "template");
if (!existsSync(join(templateDir, "package.json"))) {
  fail("bundled template/ is missing or has no package.json (the scaffold needs it).");
}

// The template must ship its lockfile for a resolution-free first install.
const templateLockPath = join(templateDir, "package-lock.json");
if (!existsSync(templateLockPath)) {
  fail("template/package-lock.json missing — first scaffold install would be slow/cold.");
}

// The shipped lockfile must be IN SYNC with template/package.json — every
// declared dependency must be present in the lockfile. A scaffold copies this
// lockfile and the README promises `npm install`/`npm ci` works keyless, so an
// out-of-sync lockfile (e.g. a new dep added to package.json but the lockfile
// not regenerated) would make a generated app fail to install. This catches that
// at build time rather than at a user's first scaffold.
const templatePkg = JSON.parse(readFileSync(join(templateDir, "package.json"), "utf8"));
const templateLock = JSON.parse(readFileSync(templateLockPath, "utf8"));
const lockPackages = templateLock.packages ?? {};
const declaredDeps = {
  ...(templatePkg.dependencies ?? {}),
  ...(templatePkg.devDependencies ?? {}),
};
const missingFromLock = Object.keys(declaredDeps).filter(
  (dep) => !(`node_modules/${dep}` in lockPackages),
);
if (missingFromLock.length > 0) {
  fail(
    `template/package-lock.json is out of sync with template/package.json — ` +
      `missing: ${missingFromLock.join(", ")}. Regenerate the template lockfile ` +
      `(npm install --package-lock-only in template/).`,
  );
}
// The root lockfile entry must agree with package.json on the SAME deps spec, so
// a hand-edited package.json can't drift from a stale lockfile root.
const lockRootDeps = lockPackages[""]?.dependencies ?? {};
for (const [dep, spec] of Object.entries(templatePkg.dependencies ?? {})) {
  if (lockRootDeps[dep] !== spec) {
    fail(
      `template/package-lock.json root dependency "${dep}" is "${lockRootDeps[dep]}" ` +
        `but package.json declares "${spec}" — regenerate the template lockfile.`,
    );
  }
}

// Build/dep artefacts must never be bundled (huge + stale).
for (const artefact of ["node_modules", ".next", "tsconfig.tsbuildinfo"]) {
  if (existsSync(join(templateDir, artefact))) {
    fail(`template/${artefact} must not be bundled (artefact leak).`);
  }
}

// `files` must carry everything `npx create-solid-app` resolves at runtime.
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));
for (const required of ["bin.ts", "src", "template"]) {
  if (!(pkg.files ?? []).includes(required)) {
    fail(`package.json "files" is missing "${required}" — it would not ship to npm.`);
  }
}

process.stdout.write("✔ build/verify: package is shippable (template bundled, files complete)\n");
