// AUTHORED-BY Codex (GPT-6.1 Sol)
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("regenerates every committed artifact byte-for-byte through the package codegen script", async () => {
  const output = mkdtempSync(join(tmpdir(), "solid-events-codegen-"));
  try {
    await promisify(execFile)("pnpm", ["run", "codegen", "--out", output], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
    });
    const committed = new URL("../src/generated/", import.meta.url);
    const files = readdirSync(committed).sort();
    expect(files).toContain("codegen.lock.json");
    expect(readdirSync(output).sort()).toEqual(files);
    for (const name of files) {
      expect(readFileSync(join(output, name)), `${name} drifted; run pnpm run codegen`).toEqual(
        readFileSync(new URL(name, committed)),
      );
    }
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
