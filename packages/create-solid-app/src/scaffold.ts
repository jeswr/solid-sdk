// AUTHORED-BY Claude Opus 4.8
/**
 * scaffold.ts — copy the proven app-builder template into a target dir, with
 * name substitution (package.json `name`, generated README title).
 *
 * TEMPLATE SOURCE-OF-TRUTH SEAM (spec D5): `resolveTemplateDir()` is the single
 * place that locates the template. Today it resolves a workspace-relative path
 * (integrations/app-builder/template). A packaged build would instead embed the
 * template under the published package (e.g. `dist/template/`) or fetch a pinned
 * tarball — swap only this function. Nothing else in the CLI knows where the
 * template physically lives.
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Directories that must NEVER be copied from the template (build artefacts and
 * installed deps would make the scaffold huge and stale).
 *
 * NOTE: `package-lock.json` is deliberately NOT skipped. Shipping the template's
 * committed lockfile turns the scaffolded app's first install into a
 * resolution-free one — the dominant TTFS install cost is npm's metadata
 * resolution over a cold dependency graph, and a shipped lockfile removes it
 * (measured ~13.9s → ~7.3s warm; see dx/ttfs-benchmark.md). The CLI installs
 * with `npm install --prefer-offline --no-audit --no-fund` (not `npm ci`) so a
 * lockfile generated on a different platform/arch (the well-known cross-platform
 * optional-native-dep drift, e.g. `@emnapi`) is reconciled gracefully instead of
 * hard-failing the scaffold.
 */
const SKIP_ENTRIES = new Set(["node_modules", ".next", "tsconfig.tsbuildinfo"]);

/**
 * The single seam for "where does the template live" (spec decision D5).
 *
 * - Workspace mode (this prototype): walk up from the compiled file to the repo
 *   root and use `integrations/app-builder/template`.
 * - Packaged mode (future): a bundled `template/` shipped beside the CLI would be
 *   found first; this prototype checks for it so the packaging seam is real, not
 *   hypothetical.
 */
export function resolveTemplateDir(): string {
  // Packaged layout: <pkg>/dist/template OR <pkg>/template.
  const bundled = [resolve(here, "..", "template"), resolve(here, "..", "..", "template")];
  for (const candidate of bundled) {
    if (existsSync(join(candidate, "package.json"))) return candidate;
  }
  // Workspace layout: dx/create-solid-app/{src,dist} -> repo root.
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "integrations", "app-builder", "template");
    if (existsSync(join(candidate, "package.json"))) return candidate;
    dir = dirname(dir);
  }
  throw new Error(
    "Could not locate the app-builder template. Expected " +
      "integrations/app-builder/template (workspace) or a bundled template/ (packaged).",
  );
}

export interface ScaffoldOptions {
  /** Target directory name / path (relative to cwd or absolute). */
  targetDir: string;
  /** Project name used in package.json `name` + README title. */
  appName: string;
  /** Override template location (tests). Defaults to resolveTemplateDir(). */
  templateDir?: string;
}

export interface ScaffoldResult {
  targetDir: string;
  appName: string;
  templateDir: string;
  /** Files written, relative to targetDir, sorted. */
  files: string[];
}

/** npm package names must be lowercase, url-safe, no spaces. */
export function toPackageName(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return cleaned.length > 0 ? cleaned : "solid-app";
}

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (base === dir && SKIP_ENTRIES.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full, base)));
    } else {
      out.push(full.slice(base.length + 1));
    }
  }
  return out;
}

const README = (appName: string) =>
  `# ${appName}

A Solid web app scaffolded by **create-solid-app** (prototype): Next.js (App
Router) + shadcn/ui + Tailwind, wired to a local Community Solid Server with a
seeded test account.

## Quickstart

\`\`\`sh
nvm use            # Node 22+ (CSS oidc-provider wants an LTS runtime)
npm install
npm run dev        # boots in-memory CSS + seeds accounts + prints logins, then next dev
\`\`\`

Open http://localhost:3200 and log in with the WebID printed by \`npm run dev\`
(e.g. http://localhost:3000/alice/profile/card#me — no password needed for the
seeded local pod).

## House rules (baked in)

- Frontend: Next.js + shadcn/ui + Tailwind. No hand-rolled UI.
- Auth: \`@solid/reactive-authentication\`, mounted client-side, explicit
  \`registerGlobally()\`. Never \`@inrupt/*\`.
- All RDF through the object mapper: \`@solid/object\` + \`@rdfjs/wrapper\`, fetch
  via \`@jeswr/fetch-rdf\`. Never inline \`rdf-parse\` / regex Turtle.
- Local dev pod: in-memory CSS, seeded with \`foaf:name\` + \`pim:storage\`.

See \`AGENTS.md\` for the agent-extension guide and the bundled house-rule stack.

## Scripts

| Script | Does |
|---|---|
| \`npm run dev\` | in-memory CSS + seed + \`next dev\` on :3200 |
| \`npm run build\` | \`next build\` |
| \`npm run test\` | Vitest (data layer, injected fetch) |
| \`npm run typecheck\` | \`tsc --noEmit\` |
`;

/**
 * Copy the template into `targetDir`, then apply substitutions:
 *  - package.json `name` -> toPackageName(appName)
 *  - generate README.md with the app title (template ships none)
 */
export async function scaffold(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  const templateDir = opts.templateDir ?? resolveTemplateDir();
  const targetDir = resolve(process.cwd(), opts.targetDir);

  if (existsSync(targetDir)) {
    const entries = await readdir(targetDir).catch(() => []);
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${targetDir}`);
    }
  }
  await mkdir(targetDir, { recursive: true });

  // Copy everything except build/dep artefacts.
  for (const entry of await readdir(templateDir, { withFileTypes: true })) {
    if (SKIP_ENTRIES.has(entry.name)) continue;
    await cp(join(templateDir, entry.name), join(targetDir, entry.name), {
      recursive: true,
    });
  }

  // Substitution 1: package.json name.
  const pkgPath = join(targetDir, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
  pkg["name"] = toPackageName(opts.appName);
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

  // Substitution 2: generate the project README (template ships none).
  await writeFile(join(targetDir, "README.md"), README(opts.appName), "utf8");

  const files = (await walk(targetDir)).sort();
  return { targetDir, appName: opts.appName, templateDir, files };
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}
