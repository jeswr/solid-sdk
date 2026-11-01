// Compact live-run configuration: one JSON document (a single CI secret or a local file) instead of hundreds of
// separate variables, validated against the variables the manifest declares:
//
//   {"variables": {"RA_INTEROP_GITHUB_CLIENT_ID": "…"},
//    "files": {"RA_INTEROP_GITHUB_STORAGE_STATE": {"base64": "…"}}}
//
// Variables are applied to the process environment; files (storageState sessions, private JWKs) are written to a
// fresh directory under the user's temporary directory and their variables point there. On POSIX systems the
// directory is 0700 and files are 0600; Windows has no POSIX mode bits, so there the per-user temporary
// directory's ACL (by default the user, SYSTEM and Administrators) governs access. Every value is registered for
// redaction. `cleanup()` removes the directory; the runner calls it on every exit path. Errors never echo unknown
// keys or names.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSensitive } from "./redact.js";

/**
 * @param {string} json the configuration document
 * @param {Set<string>} declared variable names declared by manifest targets
 * @param {Record<string, string | undefined>} [environment] where variables are applied (default process.env)
 * @returns {{variables: string[], files: string[], cleanup(): void}} the names applied (never the values)
 */
export function applyRunConfig(json, declared, environment = process.env) {
  let config;
  try {
    config = JSON.parse(json);
  } catch {
    throw new Error("the run configuration is not valid JSON");
  }
  // Errors never echo unknown keys or unrecognized names: a mistyped entry may itself be a secret value.
  // Only names that a target declares (public, from the manifest) are named.
  const plainObject = (value) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
  if (!plainObject(config)) throw new Error("the run configuration must be a JSON object");
  const unknownKeys = Object.keys(config).filter((key) => key !== "variables" && key !== "files");
  if (unknownKeys.length > 0)
    throw new Error(
      `the run configuration has ${unknownKeys.length} unknown top-level key(s); only "variables" and "files" are allowed`,
    );
  for (const section of ["variables", "files"]) {
    if (config[section] !== undefined && !plainObject(config[section]))
      throw new Error(`"${section}" must be a JSON object mapping variable names to values`);
  }
  const variables = Object.entries(config.variables ?? {});
  const files = Object.entries(config.files ?? {});
  const unrecognized = [...variables, ...files].filter(
    ([name]) => !/^RA_INTEROP_[A-Z0-9_]+$/.test(name) || !declared.has(name),
  ).length;
  if (unrecognized > 0)
    throw new Error(
      `the run configuration has ${unrecognized} name(s) that no target declares (names are not shown; check them against npm run interop:list)`,
    );
  for (const [name] of variables) {
    if (files.some(([n]) => n === name)) throw new Error(`${name} is both a variable and a file`);
  }
  for (const [name, value] of variables) {
    if (typeof value !== "string" || value === "")
      throw new Error(`${name} must be a non-empty string`);
  }
  for (const [name, value] of files) {
    if (
      !plainObject(value) ||
      typeof value.base64 !== "string" ||
      value.base64 === "" ||
      Object.keys(value).length !== 1
    )
      throw new Error(`${name} must be {"base64": "…"}`);
  }

  let directory;
  const cleanup = () => {
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  };
  try {
    for (const [name, value] of variables) {
      registerSensitive(value);
      environment[name] = value;
    }
    if (files.length > 0) {
      directory = mkdtempSync(join(tmpdir(), "ra-interop-secrets-")); // created 0700
      for (const [index, [name, value]] of files.entries()) {
        const content = Buffer.from(value.base64, "base64");
        if (content.length === 0) throw new Error(`${name} decodes to an empty file`);
        const path = join(directory, `file-${index}`);
        writeFileSync(path, content, { mode: 0o600, flag: "wx" });
        environment[name] = path;
      }
    }
  } catch (error) {
    cleanup();
    throw error;
  }
  return {
    variables: variables.map(([name]) => name),
    files: files.map(([name]) => name),
    cleanup,
  };
}
