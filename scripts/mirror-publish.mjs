#!/usr/bin/env node
// AUTHORED-BY Claude Fable 5
/**
 * mirror-publish.mjs — publish one workspace package's BUILT output to its per-package
 * read-only mirror repo (ADR decisions/0001 §4.4).
 *
 * Why this exists: the monorepo does not commit dist/, but every consumer installs
 * `github:jeswr/<pkg>#<sha>` under ignore-scripts=true and needs a committed dist. The
 * original per-package repos therefore become script-published MIRRORS carrying
 * { package.json (rewritten), dist/, README.md, LICENSE } plus any OTHER literal entry
 * the manifest's `files` array ships (subpath-exported TTL etc.) — nothing else. Old
 * shas keep resolving forever; new shas appear only via this script.
 *
 * CONTRACT
 *   node scripts/mirror-publish.mjs <package-dir-name> [flags]
 *
 *   Default is a DRY RUN: build + assemble + print the full plan (target repo, file
 *   manifest, rewritten package.json, commit message). Nothing is cloned, committed or
 *   pushed without --execute.
 *
 *   Flags:
 *     --execute                 actually clone the mirror, commit, and push to its main
 *     --dep-sha <name>=<sha>    mirror sha for a NON-inlined workspace: dep (repeatable).
 *                               Publishing runs in topological order, so a dep's mirror
 *                               sha exists before its dependents publish.
 *     --skip-rebuild-check      skip the determinism byte-compare (build twice, dists
 *                               must be identical). Only for debugging; never in anger.
 *     --keep-workdir            keep the temp assembly/clone dir for inspection
 *
 *   Fail-closed preflight (any failure aborts before anything is written):
 *     1. packages/<pkg>/package.json exists, is not "private", and its npm name maps
 *        back to the SAME dir (mirror = jeswr/<pkg> — the flat-layout invariant), so a
 *        stray manifest name can never retarget the push at a different repo
 *     2. the monorepo working tree is CLEAN (git status --porcelain empty) — checked
 *        before the build and RE-CHECKED after every build/test/gate run (a build that
 *        mutates tracked files would invalidate the Mirror-Of claim)
 *     3. dist/ is DELETED before every build (no stale outputs can ride along); the
 *        scoped build (+ test, if present) must pass and produce a non-empty dist/
 *     4. every `workspace:` dependency is either declared inlined
 *        (package.json "mirrorPublish": { "inlined": [...] } — esbuild-inlined into
 *        dist/) or has a --dep-sha mirror pin; anything else throws
 *     5. (--execute only) the FULL workspace gate (`pnpm run gate`) passes at HEAD —
 *        a mirror never publishes past a red workspace
 *     6. (--execute only) HEAD is an ancestor of origin/main, so the Mirror-Of trailer
 *        always references a publicly resolvable monorepo sha
 *     7. (--execute only) every --dep-sha pin is resolved against its mirror repo via
 *        `gh api` — a nonexistent sha aborts; short shas expand to the full 40-char
 *        sha, and the RESOLVED sha is what gets published
 *     8. (--execute only) determinism check: a clean second build must byte-match the
 *        published dist
 *
 *   Mirror commit shape (committed with --no-gpg-sign, identity = the maintainer's
 *   noreply email):
 *     mirror(<pkg>): publish from jeswr/solid-sdk@<sha12>
 *
 *     Mirror-Of: jeswr/solid-sdk@<full sha>
 *     Model: claude-fable-5
 *     Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
 *
 *   Manifest rewriting (pure; unit-tested):
 *     - scripts + devDependencies are STRIPPED (a mirror is a built artifact; nothing
 *       must ever build or run a lifecycle script on install)
 *     - inlined `workspace:` deps are REMOVED (already inside dist/)
 *     - non-inlined `workspace:` deps become `github:jeswr/<dep>#<mirror sha>`
 *     - registry (semver) deps pass through unchanged (e.g. @jeswr/fetch-rdf@^0.1.0)
 *     - everything else (exports, types, files, securityCritical, …) passes through
 *
 * Phase 0 note: this script is written + unit-shaped but NOT exercised against any real
 * mirror repo; Phase 1 (the 3-package pilot) is where --execute first runs.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MONOREPO = "jeswr/solid-sdk";
const GIT_USER_NAME = "Jesse Wright";
const GIT_USER_EMAIL = "63333554+jeswr@users.noreply.github.com";
const MODEL_TRAILERS = [
  "Model: claude-fable-5",
  "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>",
];
const MIRROR_BANNER_MARK = "<!-- mirror-banner -->";

/** Parse CLI argv (after node + script). Throws on anything unrecognised — fail closed. */
export function parseCliArgs(argv) {
  const out = {
    pkg: null,
    execute: false,
    depShas: new Map(),
    skipRebuildCheck: false,
    keepWorkdir: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute") out.execute = true;
    else if (a === "--skip-rebuild-check") out.skipRebuildCheck = true;
    else if (a === "--keep-workdir") out.keepWorkdir = true;
    else if (a === "--dep-sha") {
      const v = argv[++i];
      const m = /^(?<name>[^=]+)=(?<sha>[0-9a-f]{7,40})$/.exec(v ?? "");
      if (!m) throw new Error(`--dep-sha expects <npm-name>=<sha>, got: ${v}`);
      out.depShas.set(m.groups.name, m.groups.sha);
    } else if (a.startsWith("-")) {
      throw new Error(`unknown flag: ${a}`);
    } else if (out.pkg === null) {
      out.pkg = a;
    } else {
      throw new Error(`unexpected extra argument: ${a}`);
    }
  }
  if (!out.pkg)
    throw new Error(
      "usage: mirror-publish.mjs <package-dir-name> [--execute] [--dep-sha name=sha ...]",
    );
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(out.pkg))
    throw new Error(`invalid package dir name: ${out.pkg}`);
  return out;
}

/** Mirror repo (owner/name) for an npm package name: strip the @jeswr/ scope. */
export function mirrorRepoFor(npmName) {
  if (npmName.startsWith("@jeswr/")) return `jeswr/${npmName.slice("@jeswr/".length)}`;
  if (npmName.startsWith("@"))
    throw new Error(`non-@jeswr scoped package cannot be mirrored: ${npmName}`);
  return `jeswr/${npmName}`;
}

/**
 * The flat-layout invariant: packages/<dir> is the npm name minus the @jeswr/ scope,
 * so the mirror derived from the manifest name must be jeswr/<dir>. Enforcing this
 * means a mistaken manifest name can never point the publish at a different repo.
 */
export function assertDirMatchesName(pkgDirName, npmName) {
  const expected = `jeswr/${pkgDirName}`;
  const actual = mirrorRepoFor(npmName);
  if (actual !== expected) {
    throw new Error(
      `package dir/name mismatch: packages/${pkgDirName} declares npm name ${npmName} ` +
        `(mirror ${actual}) but the flat-layout invariant requires mirror ${expected} — ` +
        "refusing to publish to a repo that does not match the requested package",
    );
  }
}

/**
 * Rewrite a workspace package.json into its mirror manifest. Pure.
 * @param {object} manifest      the package's package.json (parsed)
 * @param {Map<string,string>} depShas  npm-name → mirror sha for non-inlined workspace deps
 */
export function rewriteManifest(manifest, depShas = new Map()) {
  if (manifest.private) throw new Error(`refusing to mirror a private package: ${manifest.name}`);
  if (!manifest.name) throw new Error("package.json has no name");
  const inlined = new Set(manifest.mirrorPublish?.inlined ?? []);
  const out = structuredClone(manifest);
  // A mirror is a built artifact: nothing may run or build on install.
  delete out.scripts;
  delete out.devDependencies;
  delete out.mirrorPublish;
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = out[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (!String(range).startsWith("workspace:")) continue; // registry/git deps pass through
      if (inlined.has(name)) {
        if (field !== "dependencies") {
          throw new Error(`inlined dep ${name} must be a regular dependency, found in ${field}`);
        }
        delete deps[name]; // esbuild-inlined into dist/ — not installed by consumers
        continue;
      }
      const sha = depShas.get(name);
      if (!sha) {
        throw new Error(
          `workspace dep ${name} is neither declared inlined (mirrorPublish.inlined) nor pinned via --dep-sha ${name}=<mirror sha>`,
        );
      }
      deps[name] = `github:${mirrorRepoFor(name)}#${sha}`;
    }
    if (Object.keys(deps).length === 0) delete out[field];
  }
  return out;
}

/** Ensure the read-only-mirror banner heads the README. Idempotent. Pure. */
export function bannerifyReadme(readme, npmName) {
  if (readme.includes(MIRROR_BANNER_MARK)) return readme;
  const banner = [
    MIRROR_BANNER_MARK,
    `> **Read-only mirror.** \`${npmName}\` is developed in the`,
    `> [jeswr/solid-sdk](https://github.com/jeswr/solid-sdk) monorepo and published here by`,
    "> `scripts/mirror-publish.mjs` so `github:`-pinned installs keep working — do not edit",
    "> or PR this repo. File issues on the monorepo.",
    "",
    "",
  ].join("\n");
  return banner + readme;
}

/**
 * Extra artifact files/dirs the mirror must carry beyond { dist, package.json, README,
 * LICENSE }: everything else the manifest's `files` array names. Some packages ship
 * non-dist artifacts as subpath exports (e.g. @jeswr/solid-bookmark exports
 * ./bookmark.ttl + ./bookmark.shacl.ttl from the package root) — a mirror missing them
 * would break those exports for every `github:` consumer. Literal paths only — globs,
 * absolute paths, and traversal fail closed. Pure.
 */
export function extraMirrorFiles(manifest) {
  const handled = new Set(["dist", "README.md", "LICENSE", "package.json"]);
  const out = new Set();
  for (const entry of manifest.files ?? []) {
    const clean = String(entry).replace(/^\.\//, "").replace(/\/+$/, "");
    if (handled.has(clean)) continue;
    if (clean === "" || clean.startsWith("/") || clean.split("/").includes("..")) {
      throw new Error(`refusing package.json files entry outside the package: ${entry}`);
    }
    if (/[*?[\]{}!]/.test(clean)) {
      throw new Error(
        `package.json files entry ${entry} is a glob — mirror-publish carries literal ` +
          "paths only; name the file/dir explicitly",
      );
    }
    out.add(clean);
  }
  return [...out].sort();
}

/**
 * Copy the extraMirrorFiles entries from the package dir into the assembly. A nested
 * literal entry (e.g. `assets/vocab.ttl`) needs its destination parent created first —
 * Node's cpSync does not guarantee that for file sources across versions (roborev
 * finding on a39ba26). Fails closed if an entry named by the manifest is missing.
 */
export function copyExtraFiles(pkgDir, assembly, extras, pkgDirName = pkgDir) {
  for (const extra of extras) {
    const src = join(pkgDir, extra);
    if (!existsSync(src)) {
      throw new Error(`package.json files entry missing from ${pkgDirName}: ${extra}`);
    }
    const dest = join(assembly, extra);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });
  }
}

/** Build the mirror commit message (subject + provenance trailers). Pure. */
export function buildCommitMessage(pkgDirName, monorepoSha) {
  if (!/^[0-9a-f]{40}$/.test(monorepoSha))
    throw new Error(`expected a full 40-char sha, got: ${monorepoSha}`);
  return [
    `mirror(${pkgDirName}): publish from ${MONOREPO}@${monorepoSha.slice(0, 12)}`,
    "",
    `Mirror-Of: ${MONOREPO}@${monorepoSha}`,
    ...MODEL_TRAILERS,
  ].join("\n");
}

/** Recursively list files under dir as sorted relative paths. */
export function listFilesRecursive(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(p, base));
    else out.push(relative(base, p));
  }
  return out.sort();
}

/** Byte-compare two directory trees; returns a list of differences (empty = identical). */
export function compareDirs(a, b) {
  const filesA = listFilesRecursive(a);
  const filesB = listFilesRecursive(b);
  const diffs = [];
  for (const f of filesA) if (!filesB.includes(f)) diffs.push(`only in first: ${f}`);
  for (const f of filesB) if (!filesA.includes(f)) diffs.push(`only in second: ${f}`);
  for (const f of filesA) {
    if (!filesB.includes(f)) continue;
    if (!readFileSync(join(a, f)).equals(readFileSync(join(b, f))))
      diffs.push(`content differs: ${f}`);
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Effectful half — every external command is spawned argv-style (no shell).
// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  if (res.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (exit ${res.status}):\n${res.stderr || res.stdout}`,
    );
  }
  return res.stdout.trim();
}

/** Abort unless the monorepo working tree is clean; `when` names the checkpoint. */
function assertCleanTree(repoRoot, when) {
  const dirty = run("git", ["status", "--porcelain"], { cwd: repoRoot });
  if (dirty !== "") throw new Error(`working tree is dirty ${when}:\n${dirty}`);
}

/**
 * Resolve a --dep-sha pin against its mirror repo via `gh api` — aborts if the commit
 * does not exist there, and expands short shas to the full 40-char form (which is what
 * gets published into the mirror manifest).
 */
function resolveDepSha(repo, sha) {
  const full = run("gh", ["api", `repos/${repo}/commits/${sha}`, "--jq", ".sha"]);
  if (!/^[0-9a-f]{40}$/.test(full)) {
    throw new Error(`could not resolve ${sha} in ${repo} (gh api returned: ${full})`);
  }
  return full;
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const pkgDir = join(repoRoot, "packages", args.pkg);
  const manifestPath = join(pkgDir, "package.json");
  if (!existsSync(manifestPath)) throw new Error(`no such workspace package: packages/${args.pkg}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // The flat-layout invariant: a stray manifest name must never retarget the push.
  assertDirMatchesName(args.pkg, manifest.name);
  const mirrorRepo = mirrorRepoFor(manifest.name);

  // 1. clean tree — a mirror must correspond exactly to a committed monorepo sha
  assertCleanTree(repoRoot, "— commit or stash first");
  const monorepoSha = run("git", ["rev-parse", "HEAD"], { cwd: repoRoot });

  // 2. scoped build from an EMPTY dist (stale outputs must not ride along) + test.
  //    `<name>...` selects the package AND its workspace dependencies, topologically:
  //    dist/ is gitignored in the monorepo, so a dependent that bundles a sibling
  //    (e.g. solid-openid-client esbuild-inlining solid-dpop's built dist/esm) needs
  //    that sibling built first — a bare `--filter <name>` would inline stale or
  //    missing output on a fresh checkout.
  const distDir = join(pkgDir, "dist");
  rmSync(distDir, { recursive: true, force: true });
  console.log(`[mirror-publish] building ${manifest.name} (+ workspace deps) …`);
  run("pnpm", ["--filter", `${manifest.name}...`, "run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  run("pnpm", ["--filter", manifest.name, "run", "--if-present", "test"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  // A build/test that mutates TRACKED files would decouple the published bytes from the
  // Mirror-Of sha — re-check, don't assume.
  assertCleanTree(repoRoot, "after build/test — the build mutated tracked files");

  if (!existsSync(distDir) || listFilesRecursive(distDir).length === 0) {
    throw new Error(`build produced no dist/ for packages/${args.pkg}`);
  }

  // 3. resolve --dep-sha pins against their mirror repos (--execute only: needs network;
  //    a dry run uses them as given and says so in the plan)
  let depShas = args.depShas;
  if (args.execute && args.depShas.size > 0) {
    depShas = new Map(
      [...args.depShas].map(([name, sha]) => [name, resolveDepSha(mirrorRepoFor(name), sha)]),
    );
  }

  // 4. assemble the mirror tree
  const work = mkdtempSync(join(tmpdir(), `mirror-${args.pkg}-`));
  const assembly = join(work, "assembly");
  cpSync(distDir, join(assembly, "dist"), { recursive: true });
  const mirrorManifest = rewriteManifest(manifest, depShas);
  writeFileSync(join(assembly, "package.json"), `${JSON.stringify(mirrorManifest, null, 2)}\n`);
  const readmePath = join(pkgDir, "README.md");
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : `# ${manifest.name}\n`;
  writeFileSync(join(assembly, "README.md"), bannerifyReadme(readme, manifest.name));
  const licenseSrc = [join(pkgDir, "LICENSE"), join(repoRoot, "LICENSE")].find((p) =>
    existsSync(p),
  );
  if (!licenseSrc) throw new Error("no LICENSE found (package or workspace root)");
  cpSync(licenseSrc, join(assembly, "LICENSE"));
  // Non-dist artifacts the manifest's `files` array ships (subpath-exported TTL, etc.).
  copyExtraFiles(pkgDir, assembly, extraMirrorFiles(manifest), `packages/${args.pkg}`);

  const commitMessage = buildCommitMessage(args.pkg, monorepoSha);
  const fileList = listFilesRecursive(assembly);

  console.log(`\n[mirror-publish] plan for ${manifest.name}`);
  console.log(`  mirror repo:   https://github.com/${mirrorRepo} (branch main)`);
  console.log(`  monorepo sha:  ${monorepoSha}`);
  console.log(`  files (${fileList.length}):\n    ${fileList.join("\n    ")}`);
  console.log(`  manifest:\n${JSON.stringify(mirrorManifest, null, 2).replace(/^/gm, "    ")}`);
  console.log(`  commit message:\n${commitMessage.replace(/^/gm, "    ")}`);

  if (!args.execute) {
    if (args.depShas.size > 0) {
      console.log(
        "  NOTE: --dep-sha pins are NOT resolved against their mirror repos in a dry run;",
      );
      console.log("        --execute verifies each exists and expands it to the full sha.");
    }
    console.log(
      "\nDRY RUN — nothing cloned, committed, or pushed. Re-run with --execute to publish.",
    );
    if (!args.keepWorkdir) rmSync(work, { recursive: true, force: true });
    else console.log(`workdir kept: ${work}`);
    return;
  }

  // 5. --execute integrity gates
  // 5a. the FULL workspace gate — a mirror never publishes past a red workspace
  console.log("[mirror-publish] full workspace gate …");
  run("pnpm", ["run", "gate"], { cwd: repoRoot, stdio: "inherit" });
  assertCleanTree(repoRoot, "after the workspace gate — the gate mutated tracked files");

  // 5b. the Mirror-Of sha must be publicly resolvable
  run("git", ["fetch", "origin", "main"], { cwd: repoRoot });
  try {
    run("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], { cwd: repoRoot });
  } catch {
    throw new Error(
      "HEAD is not on origin/main — push the monorepo first so Mirror-Of references a public sha",
    );
  }

  // 5c. determinism: a clean rebuild must byte-match what we are about to publish
  if (!args.skipRebuildCheck) {
    console.log("[mirror-publish] determinism check: clean rebuild …");
    rmSync(distDir, { recursive: true, force: true });
    run("pnpm", ["--filter", `${manifest.name}...`, "run", "build"], {
      cwd: repoRoot,
      stdio: "inherit",
    });
    const diffs = compareDirs(distDir, join(assembly, "dist"));
    if (diffs.length > 0) {
      throw new Error(`build is not deterministic — refusing to publish:\n${diffs.join("\n")}`);
    }
    assertCleanTree(repoRoot, "after the determinism rebuild");
  }

  // 6. clone the mirror, replace its tree with the assembly, commit, push
  const clone = join(work, "mirror");
  run("git", ["clone", "--no-local", `https://github.com/${mirrorRepo}.git`, clone]);
  run("git", ["config", "user.name", GIT_USER_NAME], { cwd: clone });
  run("git", ["config", "user.email", GIT_USER_EMAIL], { cwd: clone });
  const tracked = run("git", ["ls-files"], { cwd: clone });
  if (tracked !== "") run("git", ["rm", "-r", "-q", "."], { cwd: clone });
  cpSync(assembly, clone, { recursive: true });
  // The whole tree IS the generated artifact — staging everything is intentional here.
  run("git", ["add", "-A"], { cwd: clone });
  const staged = run("git", ["status", "--porcelain"], { cwd: clone });
  if (staged === "") {
    console.log("[mirror-publish] mirror already up to date — nothing to publish.");
  } else {
    run("git", ["-c", "commit.gpgsign=false", "commit", "--no-gpg-sign", "-m", commitMessage], {
      cwd: clone,
    });
    run("git", ["push", "origin", "HEAD:main"], { cwd: clone });
    const mirrorSha = run("git", ["rev-parse", "HEAD"], { cwd: clone });
    console.log(`[mirror-publish] published ${mirrorRepo}@${mirrorSha}`);
  }
  if (!args.keepWorkdir) rmSync(work, { recursive: true, force: true });
  else console.log(`workdir kept: ${work}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`mirror-publish: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
