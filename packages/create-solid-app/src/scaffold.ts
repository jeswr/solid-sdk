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
import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATA_MODEL, findDataModel } from "./data-models.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Template files shipped under a NON-dotfile name that must be renamed to their
 * real dotfile name in the generated app.
 *
 * THE PUBLISH-SAFE-DOTFILE GOTCHA: `npm publish` STRIPS certain dotfiles from the
 * tarball — most importantly `.npmrc` (it can hold registry auth tokens) and a
 * nested `.gitignore` (npm always drops a nested `.gitignore`). Additionally, the
 * CLI package's OWN root `.gitignore` carries a `.env.*` secrets rule that
 * `npm pack` honours, which silently excludes `template/.env.example` too. A
 * literal `template/.npmrc` / `template/.gitignore` / `template/.env.example`
 * would therefore never reach a scaffolded app. The fix (the same one
 * create-next-app uses for `gitignore` -> `.gitignore`) is to ship each file
 * under a non-dotfile name in the template and rename it during scaffold.
 * Verified via `npm pack`: the literal dotfiles are dropped; the shims survive.
 *
 *  - `npmrc` -> `.npmrc`: supply-chain hardening (`ignore-scripts=true`), matching
 *    the suite-wide rule, so every scaffolded app is hardened out of the box.
 *  - `gitignore` -> `.gitignore`: the scaffolded app's VCS-ignore rules (deps,
 *    `.next`, env files, build output) — npm always strips a nested `.gitignore`.
 *  - `env.example` -> `.env.example`: the scaffolded app's env documentation
 *    (which the user copies to `.env.local`) — excluded by the CLI's own root
 *    `.env.*` rule during pack.
 */
const DOTFILE_RENAMES: ReadonlyArray<readonly [from: string, to: string]> = [
  ["npmrc", ".npmrc"],
  ["gitignore", ".gitignore"],
  ["env.example", ".env.example"],
];

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
  /**
   * GitHub repo (`owner/repo`) the baked-in @jeswr/app-shell FeedbackButton files
   * issues against. Optional — when omitted the scaffolded app keeps the
   * `your-org/your-repo` placeholder (which the user edits in
   * `lib/app-shell-config.ts`). When given it is substituted in at scaffold time.
   */
  repo?: string;
  /**
   * The data model to bind in the generated starter page (the "pick a data model
   * → bound component" path). One of the {@link DATA_MODELS} keys
   * (`task` / `contact` / `bookmark` / `profile` / `collection` / `solid-view`).
   * Defaults to `solid-view` — the resolve-by-type composer that reads the
   * resource's `rdf:type` and mounts the right element itself (so the default
   * works for any resource). A specific key swaps the bound element in
   * `components/solid/PodDataView.tsx` for that model's element.
   */
  dataModel?: string;
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

## Declarative data-bound components (\`@jeswr/solid-components\`)

The starter page renders your pod data with **declarative Web Components** from
[\`@jeswr/solid-components\`](https://github.com/jeswr/solid-components) — a few
lines of markup bind a URL + the auth fetch seam, and the component reads the
graph, picks the typed view, and renders it. **No hand-rolled LDP listing or RDF
parsing in app code.**

\`components/solid/PodDataView.tsx\` is the worked example. The default uses
\`<solid-view>\` — the resolve-by-type composer: point it at a resource and it reads
the \`rdf:type\`, resolves the matching element, and mounts it (falling back to a
plain container listing). You can swap in a specific element directly:

\`\`\`tsx
// task list (wf:Task) — .fetch is the authed seam, set via a ref
<jeswr-task-list ref={seamRef} src={tasksContainerUrl} />
// or: <jeswr-contact-list>, <jeswr-bookmark-list>, <jeswr-profile-card>, <jeswr-collection>
\`\`\`

These elements are **READ-ONLY** today; the edit/write path (an editable SHACL
form + edit-mode elements) is the package's Phase 2.

You can also pick the bound model **at scaffold time**:

\`\`\`sh
create-solid-app my-app --data-model task   # emits <jeswr-task-list> in the starter
# models: solid-view (default) | task | contact | bookmark | profile | collection
\`\`\`

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
 * Validate + normalise a `--repo` value to a bare `owner/repo`. Accepts the
 * plain form, a full GitHub URL, or a `.git` suffix; returns `undefined` (leave
 * the placeholder) for anything that is not a recognisable owner/repo, so a
 * fat-fingered value never bakes a broken FeedbackButton target.
 */
export function normalizeRepo(raw?: string): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim();
  if (s.length === 0) return undefined;
  // Strip a github URL wrapper + a trailing .git, keeping just `owner/repo`.
  // Order matters: strip trailing slashes FIRST, then `.git`, so a value like
  // `https://github.com/owner/repo.git/` normalises to `owner/repo` (not
  // `owner/repo.git`) — `.git` must be stripped after the slash, since the `$`
  // anchor would otherwise miss it behind a trailing slash.
  s = s
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  // Exactly two non-empty, GitHub-name-safe segments.
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(s) ? s : undefined;
}

/**
 * Rewrite the `__CSA_APP_NAME__` / `__CSA_REPO__` placeholder tokens in the
 * scaffolded `lib/app-shell-config.ts`. The template's runtime fallbacks keep
 * any UN-substituted token harmless, so we only replace a token when we have a
 * value — APP_NAME is always known (the display name); REPO only when `--repo`
 * was passed. The config file is plain source the user can edit afterwards.
 */
async function substituteAppShellConfig(
  targetDir: string,
  values: { appName: string; repo?: string },
): Promise<void> {
  const configPath = join(targetDir, "lib", "app-shell-config.ts");
  if (!existsSync(configPath)) return; // template without the config — nothing to do.
  let src = await readFile(configPath, "utf8");
  // Substitute inside the string literals only (the tokens are quoted in the
  // template). `appName` is escaped for a JS double-quoted string; `repo` is
  // already validated to a safe `owner/repo` charset by normalizeRepo.
  src = src.replaceAll("__CSA_APP_NAME__", jsStringEscape(values.appName));
  if (values.repo) src = src.replaceAll("__CSA_REPO__", values.repo);
  await writeFile(configPath, src, "utf8");
}

/** Escape a value for embedding inside a double-quoted JS/TS string literal. */
function jsStringEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/**
 * Sentinel-delimited regions in `components/solid/PodDataView.tsx` that the
 * data-model substitution rewrites. The template SHIPS the default `<solid-view>`
 * (the resolve-by-type composer), so a verbatim copy / the default model needs no
 * rewrite. A specific `--data-model` swaps the bound element + its card
 * description for the chosen model's element. The sentinels are JSX block
 * comments, so the file always compiles whether or not a swap happens.
 */
const DATA_VIEW_EL_BEGIN = "{/* CSA:DATA-VIEW-EL:BEGIN";
const DATA_VIEW_EL_END = "{/* CSA:DATA-VIEW-EL:END */}";
const DATA_VIEW_DESC_BEGIN = "{/* CSA:DATA-VIEW-DESC:BEGIN";
const DATA_VIEW_DESC_END = "{/* CSA:DATA-VIEW-DESC:END */}";

/**
 * Replace the text BETWEEN a begin-comment line and the end-comment marker with
 * `replacement`, preserving the begin/end sentinels (so a re-run / a later tool
 * can find them again). Returns the source unchanged if either sentinel is
 * absent — defensive, so a template edit that drops a sentinel degrades to "no
 * swap" rather than throwing. The begin sentinel is a comment whose line runs to
 * the next newline; we splice after that newline up to the end marker.
 */
function replaceSentinelRegion(
  src: string,
  beginSentinel: string,
  endSentinel: string,
  replacement: string,
): string {
  const beginIdx = src.indexOf(beginSentinel);
  const endIdx = src.indexOf(endSentinel);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return src;
  // Keep the begin-comment LINE intact (splice from the newline after it), and
  // keep the end sentinel. Indent the replacement to the begin line's indent.
  const beginLineEnd = src.indexOf("\n", beginIdx);
  if (beginLineEnd === -1 || beginLineEnd > endIdx) return src;
  const indent = src.slice(src.lastIndexOf("\n", beginIdx) + 1, beginIdx);
  return src.slice(0, beginLineEnd + 1) + `${indent}${replacement}\n` + src.slice(endIdx);
}

/**
 * Swap the bound data element + its description in the scaffolded
 * `components/solid/PodDataView.tsx` for the chosen `--data-model`. The DEFAULT
 * (`solid-view`, the resolve-by-type composer) is what the template already
 * ships, so it is a no-op — only a specific model rewrites the sentinel regions.
 * An unknown key is treated as the default (the caller validates first; this is
 * belt-and-braces so a bad value never produces a broken file).
 */
async function substituteDataModel(targetDir: string, dataModel: string): Promise<void> {
  const entry = findDataModel(dataModel);
  // Default / unknown → leave the template's <solid-view> verbatim.
  if (!entry || entry.key === DEFAULT_DATA_MODEL) return;
  const viewPath = join(targetDir, "components", "solid", "PodDataView.tsx");
  if (!existsSync(viewPath)) return; // a template without the example — nothing to do.
  let src = await readFile(viewPath, "utf8");
  // The bound element: same `ref`/`src`/`part` seam, just the chosen tag. The
  // tag is from the committed catalog (never user input), so no escaping needed.
  src = replaceSentinelRegion(
    src,
    DATA_VIEW_EL_BEGIN,
    DATA_VIEW_EL_END,
    `<${entry.tag} ref={seamRef} src={storage} part="data-view" />`,
  );
  // The card description: the catalog's plain-text line. Escape any JSX-significant
  // characters so untrusted-looking punctuation (`<`, `>`, `{`, `}`) can never break
  // the JSX (the catalog is trusted, but this keeps the emitted file robust).
  src = replaceSentinelRegion(
    src,
    DATA_VIEW_DESC_BEGIN,
    DATA_VIEW_DESC_END,
    jsxTextEscape(entry.description),
  );
  await writeFile(viewPath, src, "utf8");
}

/** Escape text for safe embedding as JSX text content (no element/expression breakout). */
function jsxTextEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\{/g, "&#123;")
    .replace(/\}/g, "&#125;");
}

/**
 * Copy the template into `targetDir`, then apply substitutions:
 *  - package.json `name` -> toPackageName(appName)
 *  - generate README.md with the app title (template ships none)
 *  - bake the app-shell FeedbackButton config (APP_NAME + optional repo)
 *  - swap the data-bound starter element for the chosen `--data-model`
 *    (default `solid-view`, the resolve-by-type composer)
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

  // Substitution 3: bake the per-app @jeswr/app-shell FeedbackButton config —
  // the human APP_NAME (the display name, not the package name) and, when a
  // `--repo owner/repo` was given, the repo issues are filed against. The
  // template ships `__CSA_*__` placeholders that fall back to safe defaults when
  // NOT substituted (so the verbatim template still builds), so we only rewrite
  // the tokens we actually have a value for — a missing repo leaves the
  // `your-org/your-repo` placeholder for the user to edit.
  await substituteAppShellConfig(targetDir, {
    appName: opts.appName,
    repo: normalizeRepo(opts.repo),
  });

  // Substitution 4: the "pick a data model → bound component" path. Swap the
  // declarative data element + its description in the starter PodDataView for the
  // chosen `--data-model` (task / contact / bookmark / profile / collection).
  // The DEFAULT (`solid-view`, the resolve-by-type composer) is what the template
  // ships, so it is a no-op — only a specific model rewrites the sentinel regions.
  await substituteDataModel(targetDir, opts.dataModel ?? DEFAULT_DATA_MODEL);

  // Substitution 5: rename the publish-safe non-dotfile shims to their real
  // dotfile names (e.g. `npmrc` -> `.npmrc`). These ship under a non-dotfile name
  // because npm strips the real dotfile from a published tarball — see
  // DOTFILE_RENAMES. Done after the verbatim copy so the generated app ends up
  // with the actual dotfile.
  for (const [from, to] of DOTFILE_RENAMES) {
    const fromPath = join(targetDir, from);
    if (existsSync(fromPath)) {
      await rename(fromPath, join(targetDir, to));
    }
  }

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
