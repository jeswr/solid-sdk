// AUTHORED-BY Claude Fable 5
// Regression tests for the two guard-bypass classes roborev flagged in the ported
// check-packages.mjs: optionalDependencies were not scanned, and npm: aliases were
// checked under the manifest key instead of the target package name.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guard = join(repoRoot, "guardrails", "scripts", "check-packages.mjs");

let dirs = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function scan(manifest) {
  const dir = mkdtempSync(join(tmpdir(), "guard-test-"));
  dirs.push(dir);
  const fixture = join(dir, "package.json");
  writeFileSync(fixture, JSON.stringify(manifest));
  // --mode policy is offline (deny/allow lists only) — deterministic in tests.
  return spawnSync(process.execPath, [guard, "--mode", "policy", "--scan", fixture], {
    encoding: "utf8",
  });
}

describe("check-packages guard (policy mode, offline)", () => {
  it("passes a clean manifest (registry + workspace + github deps)", () => {
    const res = scan({
      dependencies: { vitest: "^4.0.0", "@jeswr/solid-dpop": "workspace:*" },
      devDependencies: { "@jeswr/fetch-rdf": "github:jeswr/fetch-rdf#abc1234" },
    });
    expect(res.status).toBe(0);
  });

  it("catches a denylisted package hidden in optionalDependencies", () => {
    const res = scan({ optionalDependencies: { request: "^2.88.0" } });
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toMatch(/request/);
  });

  it("catches a denylisted package hidden behind an npm: alias", () => {
    const res = scan({ dependencies: { "totally-safe-alias": "npm:request@^2.88.0" } });
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toMatch(/request/);
  });

  it("resolves scoped npm: aliases to the scoped target name", () => {
    // moment is denylisted; a scoped alias of an allowed package must still pass
    const bad = scan({ dependencies: { m: "npm:moment@^2.29.0" } });
    expect(bad.status).toBe(1);
    const ok = scan({ dependencies: { b: "npm:@biomejs/biome@^2.0.0" } });
    expect(ok.status).toBe(0);
  });
});
