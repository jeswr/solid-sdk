// AUTHORED-BY Codex (GPT-6.1 Sol)
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("regenerates every generated file byte-for-byte", async () => {
  const out = mkdtempSync(join(tmpdir(), "wallet-model-"));
  try {
    await promisify(execFile)("pnpm", ["run", "codegen", "--out", out], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
    });
    const committed = new URL("../src/generated/", import.meta.url);
    expect(readdirSync(out).sort()).toEqual(readdirSync(committed).sort());
    expect(readdirSync(out)).toContain("codegen.lock.json");
    for (const artifact of readdirSync(out))
      expect(readFileSync(join(out, artifact))).toEqual(readFileSync(new URL(artifact, committed)));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
