// AUTHORED-BY Codex GPT-6
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  // biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
} from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
import { ScenarioTraceWriter, withExclusiveFileLock } from "./write-scenario-traces.mjs";

const configurationOf = (row) => row.configuration ?? "baseline";

export function readScenarioRuns(root) {
  return JSON.parse(readFileSync(join(root, "scenario-runs.json"), "utf8")).paths.map((row) => ({
    ...row,
    settlement: row.settlement ?? "rdf-order",
  }));
}

function mergePaths(previous, paths, scenario, configuration) {
  if (!scenario) return paths;
  // Replace existing rows in place and append newly discovered paths.
  const keyOf = (row) => JSON.stringify([configurationOf(row), row.path]);
  const updates = new Map(paths.map((row) => [keyOf(row), row]));
  const merged = previous.flatMap((row) => {
    if (row.scenario !== scenario || (configuration && configurationOf(row) !== configuration))
      return [row];
    const key = keyOf(row);
    const update = updates.get(key);
    updates.delete(key);
    return update ? [update] : [];
  });
  return [...merged, ...updates.values()];
}

function removeUnlistedTraces(directory, removed) {
  const groups = new Map();
  for (const row of removed) {
    const configuration = configurationOf(row);
    const key = JSON.stringify([row.scenario, configuration]);
    const group = groups.get(key) ?? { scenario: row.scenario, configuration, files: [] };
    group.files.push(row.trace);
    groups.set(key, group);
  }
  for (const { scenario, configuration, files } of groups.values()) {
    using writer = new ScenarioTraceWriter(directory, scenario, configuration);
    for (const file of files) writer.remove(file);
    writer.publish();
  }
}

function replaceJson(target, value) {
  const stage = mkdtempSync(`${target}.`);
  try {
    const file = join(stage, "data.json");
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(file, target);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export function publishScenarioRuns(
  root,
  status,
  index,
  { scenario, configuration, writers = [] },
) {
  const manifestPath = join(root, "scenario-runs.json");
  const directory = join(root, "traces");
  const indexPath = join(directory, "index.json");
  // One lock covers the whole corpus so full and selected runs publish in the same order.
  // Run and stage each scenario before taking the lock.
  return withExclusiveFileLock(
    manifestPath,
    () => {
      const previous = readScenarioRuns(root);
      const paths = mergePaths(previous, status.paths, scenario, configuration);
      const namedFiles = new Set(paths.map((row) => row.trace));
      const removed = previous.filter((row) => row.trace && !namedFiles.has(row.trace));
      const existing = JSON.parse(readFileSync(indexPath, "utf8"));
      const replacedFiles = new Set([
        ...index.map((item) => item.file),
        ...removed.map((row) => row.trace),
      ]);
      for (const writer of writers) writer.publish();
      removeUnlistedTraces(directory, removed);
      replaceJson(indexPath, [
        ...existing.filter((item) => !replacedFiles.has(item.file)),
        ...index,
      ]);
      replaceJson(manifestPath, { ...status, paths });
      return paths;
    },
    10_000,
  );
}
