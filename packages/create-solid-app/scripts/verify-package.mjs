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
if (!existsSync(join(templateDir, "package-lock.json"))) {
  fail("template/package-lock.json missing — first scaffold install would be slow/cold.");
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
