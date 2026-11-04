#!/usr/bin/env node
// AUTHORED-BY Codex GPT-6.1-Sol

import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { JSON_SCHEMA, load } from "js-yaml";

const manifestName = ".solid-skills-manifest.json";
const checkout = fileURLToPath(new URL("..", import.meta.url));
const safeName = /^[a-z0-9][a-z0-9._-]*$/;
const info = (path) => lstatSync(path, { throwIfNoEntry: false });

class SyncError extends Error {}

function requireDirectory(path) {
  const entry = info(path);
  if (entry && !entry.isDirectory()) {
    throw new SyncError(
      "home, target, and backup paths must be real directories, without symlinks.",
    );
  }
}

function jsonFile(path) {
  if (!info(path)?.isFile()) throw new SyncError("expected a regular JSON file, without symlinks.");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new SyncError("invalid JSON file (contents omitted).");
  }
}

function manifestAt(targetDir) {
  const path = join(targetDir, manifestName);
  if (!info(path)) return {};
  const manifest = jsonFile(path);
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    Object.entries(manifest).some(
      ([name, hash]) =>
        !safeName.test(name) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash),
    )
  ) {
    throw new SyncError("invalid ownership manifest; refusing to change installed skills.");
  }
  return manifest;
}

// Hash exactly the payload being installed, including names, empty directories, and executable bits.
// Never traverse source or installed companion symlinks.
function payloadHash(directory, entries = readdirSync(directory).sort()) {
  const hash = createHash("sha256");
  function visit(path) {
    const absolute = join(directory, path);
    const entry = info(absolute);
    if (entry?.isDirectory()) {
      hash.update(JSON.stringify([path, "directory"]));
      for (const name of readdirSync(absolute).sort()) visit(join(path, name));
    } else if (entry?.isFile()) {
      const bytes = readFileSync(absolute);
      hash.update(JSON.stringify([path, "file", entry.mode & 0o111, bytes.length]));
      hash.update(bytes);
    } else {
      throw new SyncError("skill payloads must contain only regular files and directories.");
    }
  }
  for (const entry of entries) visit(entry);
  return hash.digest("hex");
}

function sourcesAt(root) {
  const sources = new Map();
  for (const collection of ["skills", "packages"]) {
    const parent = join(root, collection);
    requireDirectory(parent);
    if (!info(parent)) continue;
    for (const directory of readdirSync(parent, { withFileTypes: true })) {
      if (directory.name.startsWith(".")) continue;
      if (directory.isSymbolicLink())
        throw new SyncError("symbolic-link skill roots are forbidden.");
      if (!directory.isDirectory()) continue;
      const source = join(parent, directory.name);
      const entry = join(source, "SKILL.md");
      if (!info(entry) && collection === "packages") continue;
      if (!info(entry)?.isFile()) throw new SyncError("expected a regular SKILL.md entry point.");
      const text = readFileSync(entry, "utf8").replaceAll("\r\n", "\n");
      const match = /^(?:\uFEFF)?---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
      let metadata;
      try {
        metadata = match && load(match[1], { schema: JSON_SCHEMA });
      } catch {
        throw new SyncError("invalid skill frontmatter (contents omitted).");
      }
      if (!metadata || metadata.name !== directory.name || !safeName.test(metadata.name)) {
        throw new SyncError("skill frontmatter must name its containing directory.");
      }
      if (metadata.metadata?.internal === true) continue;

      let name = metadata.name;
      let entries = readdirSync(source).sort();
      if (collection === "packages") {
        const packageName = jsonFile(join(source, "package.json"))?.name;
        if (
          typeof packageName !== "string" ||
          !/^(?:@[^/]+\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName)
        ) {
          throw new SyncError("package skills require a valid package name.");
        }
        name = packageName.split("/").at(-1);
        // Package implementation, dist, and node_modules are not skill companions.
        entries = ["SKILL.md", "assets", "references", "scripts"].filter((path) =>
          info(join(source, path)),
        );
      }
      if (sources.has(name)) throw new SyncError("duplicate install name across skill sources.");
      sources.set(name, { source, entries, hash: payloadHash(source, entries) });
    }
  }
  return sources;
}

function matches(destination, source, link) {
  const entry = info(destination);
  if (link) {
    return (
      entry?.isSymbolicLink() &&
      resolve(dirname(destination), readlinkSync(destination)) === source.source
    );
  }
  if (!entry?.isDirectory()) return false;
  try {
    return payloadHash(destination) === source.hash;
  } catch {
    return false;
  }
}

function targetPlan(home, target, sources, { adopt, link }) {
  const harnessDir = join(home, `.${target}`);
  const targetDir = join(harnessDir, "skills");
  const backupDir = join(harnessDir, "skills.bak");
  requireDirectory(harnessDir);
  requireDirectory(targetDir);
  const manifest = manifestAt(targetDir);
  const names = new Set([...sources.keys(), ...Object.keys(manifest)]);
  if (info(targetDir)) {
    for (const name of readdirSync(targetDir)) if (name !== manifestName) names.add(name);
  }
  const plan = [];
  for (const name of [...names].sort()) {
    const destination = join(targetDir, name);
    const existing = info(destination);
    const owned = Object.hasOwn(manifest, name);
    const source = sources.get(name);
    let action;
    if (existing && !owned && !(adopt && source)) action = "skip-foreign";
    else if (!source && owned) action = "remove";
    else if (source && !existing) action = "add";
    else if (
      source &&
      (!owned || manifest[name] !== source.hash || !matches(destination, source, link))
    ) {
      action = "update";
    }
    if (action) plan.push({ target, name, action });
  }
  if (plan.some(({ name, action }) => action !== "skip-foreign" && info(join(targetDir, name)))) {
    requireDirectory(backupDir);
  }
  return { targetDir, backupDir, manifest, plan };
}

function writeManifest(targetDir, manifest) {
  const temporary = mkdtempSync(join(targetDir, ".solid-skills-manifest-"));
  try {
    const path = join(temporary, manifestName);
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(path, join(targetDir, manifestName));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function copyBackup(source, destination) {
  const entry = info(source);
  if (entry?.isSymbolicLink()) {
    // Normalize relative links so moving the backup does not change their targets.
    symlinkSync(resolve(dirname(source), readlinkSync(source)), destination);
  } else if (entry?.isDirectory()) {
    mkdirSync(destination);
    for (const name of readdirSync(source)) copyBackup(join(source, name), join(destination, name));
    chmodSync(destination, entry.mode & 0o777);
  } else if (entry?.isFile()) cpSync(source, destination);
  else throw new SyncError("cannot back up this file type; refusing to replace the installation.");
}

function applyTarget({ targetDir, backupDir, manifest, plan }, sources, link) {
  const changes = plan.filter(({ action }) => action !== "skip-foreign");
  if (changes.length === 0) return;
  mkdirSync(targetDir, { recursive: true });
  let backup;
  for (const { name, action } of changes) {
    const destination = join(targetDir, name);
    const source = sources.get(name);
    const stage = mkdtempSync(join(targetDir, ".solid-skills-stage-"));
    try {
      const staged = join(stage, name);
      // Prepare the new payload before moving or deleting any existing installation.
      if (action !== "remove") {
        if (link) symlinkSync(source.source, staged, "dir");
        else {
          mkdirSync(staged);
          for (const entry of source.entries) {
            cpSync(join(source.source, entry), join(staged, entry), { recursive: true });
          }
        }
      }
      if (info(destination)) {
        if (!backup) {
          mkdirSync(backupDir, { recursive: true });
          const timestamp = new Date().toISOString().replaceAll(":", "-");
          backup = mkdtempSync(join(backupDir, `${timestamp}-`));
        }
        // Back up links without traversing them, including dangling links.
        copyBackup(destination, join(backup, name));
        rmSync(destination, { recursive: true, force: true });
      }
      if (action === "remove") delete manifest[name];
      else {
        renameSync(staged, destination);
        manifest[name] = source.hash;
      }
      // Record each completed operation so a later failure does not orphan earlier installs.
      writeManifest(targetDir, manifest);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }
}

export function syncSkills({
  root = checkout,
  home = homedir(),
  target = "both",
  apply = false,
  adopt = false,
  link = false,
} = {}) {
  if (!["claude", "codex", "both"].includes(target)) {
    throw new SyncError("--target must be claude, codex, or both.");
  }
  home = resolve(home);
  requireDirectory(home);
  const sources = sourcesAt(resolve(root));
  const targets = (target === "both" ? ["claude", "codex"] : [target]).map((name) =>
    targetPlan(home, name, sources, { adopt, link }),
  );
  // Preflight both targets before applying either one.
  if (apply) for (const entry of targets) applyTarget(entry, sources, link);
  return targets.flatMap(({ plan }) => plan);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        apply: { type: "boolean" },
        adopt: { type: "boolean" },
        link: { type: "boolean" },
        target: { type: "string" },
        home: { type: "string" },
        help: { type: "boolean" },
      },
    });
    if (values.help) {
      console.log(
        "Usage: node scripts/skills-sync.mjs [--apply] [--adopt] [--link] [--target claude|codex|both] [--home <dir>]\nDry run by default. --adopt backs up and replaces matching foreign skills.",
      );
    } else {
      const plan = syncSkills(values);
      console.log(values.apply ? "Applied skill sync:" : "Dry-run skill sync (no writes):");
      for (const { target, name, action } of plan) {
        console.log(`${target}: ${action} ${JSON.stringify(name)}`);
      }
      if (plan.length === 0) console.log("No changes.");
    }
  } catch (error) {
    console.error(
      `Skill sync failed: ${error instanceof SyncError ? error.message : "cannot read/write skills or invalid arguments (details omitted)."}`,
    );
    process.exitCode = 1;
  }
}
