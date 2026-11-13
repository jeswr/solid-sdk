// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { execFile } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { join } from "path";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { promisify } from "util";
import { expect, it } from "vitest";

it("regenerates every model artifact and the full admission errors byte-for-byte", async () => {
  const out = mkdtempSync(join(tmpdir(), "answerable-codegen-"));
  try {
    await promisify(execFile)("pnpm", ["run", "codegen", "--out", out], {
      cwd: join(import.meta.dirname, ".."),
    });
    const committed = new URL("../src/generated/", import.meta.url);
    const files = readdirSync(committed).sort();
    expect(files).toContain("codegen.lock.json");
    expect(readdirSync(out).sort()).toEqual(files);
    for (const file of files)
      expect(readFileSync(join(out, file)), file).toEqual(readFileSync(new URL(file, committed)));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 30_000);
