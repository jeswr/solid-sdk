#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { spawnSync } from "child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  // biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
} from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { fileURLToPath } from "url";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { isDeepStrictEqual } from "util";

const root = fileURLToPath(new URL("../", import.meta.url));
const scenarios = new Set(["mortgage-core", "pay-an-invoice"]);
const manifestFile = "scenario-runs.json";
const indexFile = "traces/index.json";
const modules = join(root, "node_modules");
if (
  !existsSync(join(root, "dist/engine/run.js")) ||
  !existsSync(join(root, "dist/generated/model.js"))
) {
  console.error(
    "Compile @jeswr/agent-reference first with tsc -p tsconfig.build.json and scripts/copy-generated.mjs.",
  );
  process.exit(1);
}

const { canonicalJson } = await import("../dist/core/canonical.js");
const json = (directory, file) => JSON.parse(readFileSync(join(directory, file), "utf8"));
const multiset = (rows) => rows.map(canonicalJson).sort();
const files = (directory, prefix) =>
  readdirSync(join(directory, prefix), { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name).slice(directory.length).replace(/^\//, ""));

const copy = mkdtempSync(join(tmpdir(), "awp-no-trace-change-"));
const differences = [];
try {
  cpSync(root, copy, { recursive: true, filter: (path) => path !== modules });
  symlinkSync(modules, join(copy, "node_modules"), "dir");
  for (const scenario of scenarios) {
    const log = join(copy, `check-${scenario}.log`);
    const output = openSync(log, "wx");
    let run;
    try {
      run = spawnSync(
        process.execPath,
        ["scripts/run-scenarios.mjs", `--scenario=${scenario}`, "--no-linked"],
        {
          cwd: copy,
          stdio: ["ignore", output, "inherit"],
        },
      );
    } finally {
      closeSync(output);
    }
    const stdout = readFileSync(log, "utf8");
    process.stdout.write(stdout);
    if (run.error || run.status !== 0)
      differences.push(`${scenario}: runner failed (${run.error ?? run.signal ?? run.status})`);
    const lines = stdout
      .split("\n")
      .filter((line) => line.includes("live data paths ran; manifest:"));
    if (lines.length !== 1 || !lines[0].endsWith("278 runs, 0 disagree, 5 blocked"))
      differences.push(`${scenario}: unexpected manifest totals in runner output`);
  }
  const before = json(root, manifestFile);
  const after = json(copy, manifestFile);
  const selected = new Set(
    before.paths
      .filter((row) => row.trace && scenarios.has(row.scenario))
      .map((row) => join("traces", row.trace)),
  );
  const compare = (name, actual, expected) => {
    if (!isDeepStrictEqual(actual, expected)) differences.push(`${name}: content differs`);
  };
  const { paths: oldPaths, ...oldMeta } = before;
  const { paths: newPaths, ...newMeta } = after;
  compare(manifestFile + " metadata", newMeta, oldMeta);
  compare(manifestFile + " paths", multiset(newPaths), multiset(oldPaths));
  compare(indexFile, multiset(json(copy, indexFile)), multiset(json(root, indexFile)));

  for (const dir of ["traces", "outlines"]) {
    const committed = new Set(files(root, dir));
    const regenerated = new Set(files(copy, dir));
    for (const file of new Set([...committed, ...regenerated])) {
      if (file === indexFile) continue;
      if (!committed.has(file) || !regenerated.has(file)) {
        differences.push(`${file}: ${committed.has(file) ? "missing from copy" : "added in copy"}`);
      } else if (selected.has(file)) {
        const expected = json(root, file);
        const actual = json(copy, file);
        delete expected.generated?.commit;
        delete expected.linked;
        for (const event of expected.events) delete event.linked;
        delete actual.generated?.commit;
        compare(file, actual, expected);
      } else if (!readFileSync(join(root, file)).equals(readFileSync(join(copy, file)))) {
        differences.push(`${file}: bytes differ`);
      }
    }
  }
} finally {
  rmSync(copy, { recursive: true, force: true });
}
if (differences.length) {
  console.error(differences.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Both scenario runs preserve the traces, outlines and manifest rows.");
}
