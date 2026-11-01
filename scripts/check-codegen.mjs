#!/usr/bin/env node
// AUTHORED-BY Claude Opus 5.5
//
// Workspace codegen guard (bead sst-ild.4.3). Every workspace project that commits a
// generated domain model (marked by `src/generated/codegen.lock.json`) must keep that
// model reproducible inside the affected Turbo gate:
//
// 1. a `codegen` script that runs @jeswr/federation-codegen into `src/generated`;
// 2. a `workspace:` devDependency (or dependency) on @jeswr/federation-codegen, so a
//    generator change marks the project affected and the generator builds first;
// 3. a drift test that regenerates through that script into a temporary directory
//    (`pnpm run codegen --out <tmp>`) and compares every file byte-for-byte. The
//    guard checks for the call (outside comments) plus an assertion in the same file.
//
// Projects are found from the `packages:` globs of pnpm-workspace.yaml.
//
// The drift test is what proves byte-identity; this guard proves every generated
// project has one and that Turbo re-runs it whenever the generator or project changes.
import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const GENERATOR = "@jeswr/federation-codegen";
const SKIP = /(?:^|\/)(?:node_modules|dist|out|build|coverage|\.next|\.turbo|\.git)(?:\/|$)/;
/** `"codegen", "--out"` as execFile/spawn arguments, quotes of either kind. */
const DRIFT_CALL = /["'`]codegen["'`]\s*,\s*["'`]--out["'`]/;
/** A drift test must also assert something about what it regenerated. */
const ASSERTION = /\bexpect\s*\(|\bassert(?:\.\w+)?\s*\(/;
/** `--out src/generated`, `--out=./src/generated/`, `--out 'src/generated'` and similar. */
const OUT_GENERATED = /--out(?:\s+|=)(["']?)(?:\.\/)?src\/generated\/?\1(?:\s|$)/;
const TEST_GLOBS = [
  "{src,test,tests,__tests__}/**/*.{test,spec}.{ts,mts,cts,tsx,js,mjs,cjs,jsx}",
  "*.{test,spec}.{ts,mts,cts,tsx,js,mjs,cjs,jsx}",
];

/**
 * Drop line and block comments so a commented-out call never counts as a drift test.
 * String and template literals are copied through untouched, so `"//x"` or `"src/*"`
 * inside a string never starts a comment. (Regex literals are not special-cased.)
 */
export function stripComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (char === '"' || char === "'" || char === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== char) {
        if (source[j] === "\\") j++;
        else if (char !== "`" && source[j] === "\n") break;
        j++;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += char;
      i++;
    }
  }
  return out;
}

const unquote = (value) =>
  value
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
    .replace(/\/+$/, "");

/**
 * The `packages:` globs of `pnpm-workspace.yaml` (block or flow sequence, comments
 * allowed), split into includes and `!` negations, so every workspace project kind
 * (including nested `apps/<slug>/web` deployables and `tools/*`) is covered.
 */
export function workspaceGlobs(root) {
  const path = join(root, "pnpm-workspace.yaml");
  if (!existsSync(path)) throw new Error(`no pnpm-workspace.yaml under ${root}`);
  const entries = [];
  let inPackages = false;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, "");
    if (!line.trim()) continue;
    const key = /^packages:\s*(.*)$/.exec(line);
    if (key) {
      const flow = /^\[(.*)\]$/.exec(key[1].trim());
      if (flow) entries.push(...flow[1].split(",").map(unquote).filter(Boolean));
      inPackages = !flow;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (item) entries.push(unquote(item[1]));
    else if (/^\S/.test(line)) inPackages = false;
  }
  const include = entries.filter((entry) => !entry.startsWith("!"));
  const exclude = entries.filter((entry) => entry.startsWith("!")).map((entry) => entry.slice(1));
  if (!include.length) throw new Error(`pnpm-workspace.yaml under ${root} lists no packages`);
  return { include, exclude };
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Return one human-readable problem per violation, sorted, for the workspace at `root`. */
export function checkCodegen(root) {
  const problems = [];
  const { include, exclude } = workspaceGlobs(root);
  const locks = [
    ...new Set(
      globSync(
        include.map((glob) => `${glob}/src/generated/codegen.lock.json`),
        { cwd: root },
      ),
    ),
  ].filter((lock) => {
    const project = dirname(dirname(dirname(lock)));
    return (
      !project.split("/").includes("node_modules") &&
      !exclude.some((glob) => matchesGlob(project, glob))
    );
  });
  for (const lock of locks.sort()) {
    const project = dirname(dirname(dirname(lock)));
    const manifest = readJson(join(root, project, "package.json"));
    if (!manifest) {
      problems.push(`${project}: commits a generated model but has no readable package.json`);
      continue;
    }
    const script = manifest.scripts?.codegen;
    if (typeof script !== "string" || !script.includes("federation-codegen")) {
      problems.push(`${project}: needs a "codegen" script that runs ${GENERATOR}`);
    } else if (!OUT_GENERATED.test(script)) {
      problems.push(`${project}: the "codegen" script must write to src/generated`);
    }
    const spec = manifest.devDependencies?.[GENERATOR] ?? manifest.dependencies?.[GENERATOR];
    if (typeof spec !== "string" || !spec.startsWith("workspace:")) {
      problems.push(`${project}: needs a workspace: devDependency on ${GENERATOR}`);
    }
    const tests = globSync(TEST_GLOBS, {
      cwd: join(root, project),
      exclude: (entry) => SKIP.test(entry),
    });
    const drift = tests.some((test) => {
      const source = stripComments(readFileSync(join(root, project, test), "utf8"));
      return DRIFT_CALL.test(source) && ASSERTION.test(source);
    });
    if (!drift) {
      problems.push(
        `${project}: needs a drift test that runs \`pnpm run codegen --out <tmp>\` and compares src/generated byte-for-byte`,
      );
    }
  }
  return { projects: locks.length, problems: problems.sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  const root = resolve(values.root ?? fileURLToPath(new URL("../", import.meta.url)));
  let result;
  try {
    result = checkCodegen(root);
  } catch (error) {
    console.error(`Codegen guard failed: ${error.message}`);
    process.exit(1);
  }
  const { projects, problems } = result;
  if (problems.length) {
    console.error("Codegen guard failed:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`Codegen guard passed (${projects} generated project(s)).`);
}
