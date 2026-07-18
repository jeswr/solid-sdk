// AUTHORED-BY Claude Fable 5
/**
 * scaffold.ts — materialise the generated monorepo (§4.2): copy the bundled
 * template, instantiate one app skeleton per registered app, substitute tokens,
 * write the starter walkthrough.json + per-app vercel.json + docs/deploy.md env
 * matrix, and rename the publish-safe dotfile shims.
 *
 * THE PUBLISH-SAFE-DOTFILE GOTCHA (inherited from create-solid-app): `npm publish`
 * strips certain dotfiles from the tarball — `.npmrc` (registry-auth hygiene), any
 * nested `.gitignore`, `.env*`-matched files — and `.github` is kept out of the
 * template for the same shim symmetry. Each ships under a NON-dotfile name
 * (`npmrc`, `gitignore`, `env.example`, `github/`) and is renamed here, at
 * scaffold time. `scripts/build.mjs` guards both halves at build time.
 *
 * TEMPLATE SOURCE-OF-TRUTH SEAM: `resolveTemplateDir()` is the only place that
 * locates the template — `template/` sits beside `dist/` in the published package
 * and beside `src/` in the workspace, so one relative probe serves both.
 */
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { toTitleWords, toWords } from "./names.js";
import { buildWalkthrough, type DemoSpec, envMatrixRows, envPrefixFor } from "./walkthrough.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Shim → real dotfile renames applied to the scaffolded tree (see module header). */
export const DOTFILE_RENAMES: ReadonlyArray<readonly [from: string, to: string]> = [
  ["npmrc", ".npmrc"],
  ["gitignore", ".gitignore"],
  ["env.example", ".env.example"],
  ["github", ".github"],
];

/** Never copied from the template (artefacts would make the scaffold huge and stale). */
const SKIP_ENTRIES = new Set(["node_modules", ".next", ".turbo", "dist", "tsconfig.tsbuildinfo"]);

/** The per-app skeleton directory instantiated once per registered app. */
const APP_SKELETON = "__app__";

export function resolveTemplateDir(): string {
  // Published layout: <pkg>/dist/bin.mjs → <pkg>/template.
  // Workspace layout: <pkg>/src/scaffold.ts → <pkg>/template.
  const candidate = resolve(here, "..", "template");
  if (existsSync(join(candidate, "package.json"))) return candidate;
  throw new Error(`Could not locate the bundled template/ (expected at ${candidate}).`);
}

export interface ScaffoldOptions {
  /** Target directory (relative to cwd or absolute). Must be empty or absent. */
  targetDir: string;
  spec: DemoSpec;
  /** Override the template location (tests only). */
  templateDir?: string;
}

export interface ScaffoldResult {
  targetDir: string;
  /** Files written, relative to targetDir, sorted. */
  files: string[];
}

async function copyTree(from: string, to: string, skipDirs: ReadonlySet<string>): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (SKIP_ENTRIES.has(entry.name)) continue;
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
    const source = join(from, entry.name);
    const destination = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyTree(source, destination, skipDirs);
    } else {
      await cp(source, destination);
    }
  }
}

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

/** Apply `replacements` to every file under `dir` (the template is all-text). */
async function substituteTree(
  dir: string,
  replacements: ReadonlyArray<readonly [token: string, value: string]>,
): Promise<void> {
  for (const relative of await walk(dir)) {
    const path = join(dir, relative);
    const original = await readFile(path, "utf8");
    let next = original;
    for (const [token, value] of replacements) {
      next = next.replaceAll(token, value);
    }
    if (next !== original) await writeFile(path, next, "utf8");
  }
}

const README = (spec: DemoSpec): string => {
  const title = toTitleWords(spec.useCase);
  const appList = spec.apps
    .map((app) => `| \`apps/${app.slug}\` | ${app.name} | ${app.role} |`)
    .join("\n");
  return `# ${title} Walkthrough

A multistakeholder pod-data walkthrough scaffolded by **create-solid-demo**: a
pnpm + Turborepo monorepo whose tour shell renders entirely from ONE JSON
document, with a skeleton app per ecosystem seat.

> Concept demonstration by ${spec.convener}. All data is simulated — no surface
> in this repo may present itself as a real service.

## Layout

| Path | App | Role |
|---|---|---|
| \`apps/tour\` | ${title} Walkthrough (shell) | walkthrough shell |
${appList}

Plus \`packages/data-model\` (SHACL shapes + vocab stub), \`seeds/\` (deterministic
persona seeding via @jeswr/synthetic-rdf + @jeswr/solid-seed), \`e2e/\` (Playwright
disclaimer + axe gates), and \`scripts/\` (IRI + insignia lints).

## The single edit surface

\`apps/tour/content/walkthrough.json\` drives the WHOLE tour — landing copy,
ecosystem map, launcher, chapters, themes, honesty panels, deploy wiring. Edit it,
run \`pnpm test\`, and the site follows. The schema and the editorial gates are
enforced by \`parseWalkthrough\` / \`editorialFindings\` from @jeswr/solid-showcase.

## Quickstart

\`\`\`sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @${spec.useCase}/app-tour dev     # the shell on :3000
\`\`\`

> **Framework dependency status:** the @jeswr framework packages
> (solid-showcase, solid-showcase-kit, solid-pod-guard, synthetic-rdf,
> solid-seed) are pending their npm publish. Until they land on the registry,
> point them at packed tarballs or git pins via \`pnpm.overrides\` — see
> docs/deploy.md § Framework dependency status.

## Seed

\`pnpm run seed\` generates the deterministic demo persona (seeds/persona.ts —
keep it in sync with \`walkthrough.persona\`) and writes it to the pod named by
\`${envPrefixFor(spec)}_SEED_POD_URL\` / \`${envPrefixFor(spec)}_SEED_WEBID\`.

## Deploy

One Vercel project per app from this single repo — read \`docs/deploy.md\` before
creating any project; it carries the env matrix and the hard-won gotchas
(rootDirectory, cleared overrides, forwarded-headers trust, preview posture,
neutral slugs).
`;
};

/** The per-app vercel.json (mirrors @jeswr/solid-showcase/next appVercelJson). */
function vercelJson(useCase: string, appSlug: string): string {
  return `${JSON.stringify(
    {
      // biome-ignore lint/style/useNamingConvention: fixed vercel.json wire field
      $schema: "https://openapi.vercel.sh/vercel.json",
      buildCommand: `pnpm --dir ../.. exec turbo run build --filter=@${useCase}/app-${appSlug}`,
      framework: "nextjs",
      ignoreCommand: "npx turbo-ignore --fallback=HEAD^1",
    },
    null,
    2,
  )}\n`;
}

function envMatrixMarkdown(spec: DemoSpec): string {
  const rows = envMatrixRows(spec)
    .map((row) => `| \`${row.name}\` | ${row.project} | \`${row.value}\` | ${row.purpose} |`)
    .join("\n");
  return `| Variable | Vercel project(s) | Value | Purpose |\n|---|---|---|---|\n${rows}`;
}

export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const templateDir = options.templateDir ?? resolveTemplateDir();
  const targetDir = resolve(process.cwd(), options.targetDir);
  const { spec } = options;
  if (spec.apps.length === 0) throw new Error("at least one --app registration is required");

  if (existsSync(targetDir)) {
    const entries = await readdir(targetDir).catch(() => []);
    if (entries.length > 0) throw new Error(`Target directory is not empty: ${targetDir}`);
  }
  await mkdir(targetDir, { recursive: true });

  // 1. Copy the template, leaving the per-app skeleton behind.
  await copyTree(templateDir, targetDir, new Set([APP_SKELETON]));

  // 2. Instantiate one skeleton per registered app.
  const skeletonDir = join(templateDir, "apps", APP_SKELETON);
  for (const app of spec.apps) {
    await copyTree(skeletonDir, join(targetDir, "apps", app.slug), new Set());
    await substituteTree(join(targetDir, "apps", app.slug), [["__CSD_APP_SLUG__", app.slug]]);
  }

  // 3. Workspace-wide token substitution.
  await substituteTree(targetDir, [
    ["__CSD_SLUG__", spec.useCase],
    ["__CSD_TITLE__", toTitleWords(spec.useCase)],
    ["__CSD_ENV_PREFIX__", envPrefixFor(spec)],
    ["__CSD_USE_CASE_WORDS__", toWords(spec.useCase)],
    ["__CSD_ENV_MATRIX__", envMatrixMarkdown(spec)],
  ]);

  // 4. THE document (single edit surface) + per-app deploy files + README.
  const document = buildWalkthrough(spec);
  await mkdir(join(targetDir, "apps", "tour", "content"), { recursive: true });
  await writeFile(
    join(targetDir, "apps", "tour", "content", "walkthrough.json"),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(targetDir, "apps", "tour", "vercel.json"), vercelJson(spec.useCase, "tour"));
  for (const app of spec.apps) {
    await writeFile(
      join(targetDir, "apps", app.slug, "vercel.json"),
      vercelJson(spec.useCase, app.slug),
    );
  }
  await writeFile(join(targetDir, "README.md"), README(spec), "utf8");

  // 5. Rename the publish-safe shims to their real dotfile names.
  for (const [from, to] of DOTFILE_RENAMES) {
    const fromPath = join(targetDir, from);
    if (existsSync(fromPath)) {
      // A stale real dotfile would make rename() nest instead of replace — clear it.
      await rm(join(targetDir, to), { force: true, recursive: true });
      await rename(fromPath, join(targetDir, to));
    }
  }

  // 6. CLAUDE.md is a symlink to AGENTS.md (house convention). Symlinks cannot
  // ship in an npm tarball, so it is created here; fall back to a copy where
  // symlinks are unavailable (e.g. unprivileged Windows).
  try {
    await symlink("AGENTS.md", join(targetDir, "CLAUDE.md"));
  } catch {
    await cp(join(targetDir, "AGENTS.md"), join(targetDir, "CLAUDE.md"));
  }

  const files = (await walk(targetDir)).sort();
  // Fail loudly if any token survived — a broken template must never scaffold silently.
  for (const file of files) {
    const content = await readFile(join(targetDir, file), "utf8");
    const match = /__CSD_[A-Z_]+__/.exec(content);
    if (match !== null) {
      throw new Error(`unsubstituted template token ${match[0]} in ${file}`);
    }
  }
  if (files.some((file) => file.split(sep).includes(APP_SKELETON))) {
    throw new Error("the per-app skeleton (__app__) leaked into the scaffold");
  }
  return { files, targetDir };
}
