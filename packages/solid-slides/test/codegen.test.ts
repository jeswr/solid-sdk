// AUTHORED-BY Codex (GPT-6.1 Sol)
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("regenerates every committed codegen artifact byte-for-byte", async () => {
  const output = await mkdtemp(join(tmpdir(), "solid-slides-codegen-"));
  try {
    await promisify(execFile)("pnpm", ["run", "codegen", "--out", output], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
    });
    const committed = new URL("../src/generated/", import.meta.url);
    const files = (await readdir(committed)).sort();
    expect(files).toContain("codegen.lock.json");
    expect((await readdir(output)).sort()).toEqual(files);
    for (const file of files)
      expect(await readFile(join(output, file)), file).toEqual(
        await readFile(new URL(file, committed)),
      );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
