// AUTHORED-BY Claude Fable 5
// The root export is browser-safe by contract: no node builtin may be imported anywhere
// in the module graph reachable from src/index.ts. Node usage is confined to the
// ./testing subpath.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) yield path;
  }
}

test("no module outside src/testing imports node builtins", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    if (file.startsWith(join(SRC, "testing"))) continue;
    const source = readFileSync(file, "utf8");
    if (/from\s+["']node:|require\(\s*["']node:/.test(source)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

test("root src modules never import from the testing subpath", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    if (file.startsWith(join(SRC, "testing"))) continue;
    const source = readFileSync(file, "utf8");
    if (/from\s+["']\.\/testing\//.test(source)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

test("package exports split the browser-safe root from the node-only testing subpath", () => {
  const manifest = JSON.parse(readFileSync(resolve(SRC, "..", "package.json"), "utf8")) as {
    exports: Record<string, { import: string }>;
  };
  expect(manifest.exports["."]?.import).toBe("./dist/index.js");
  expect(manifest.exports["./testing"]?.import).toBe("./dist/testing/index.js");
});
