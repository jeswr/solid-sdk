// AUTHORED-BY Codex GPT-6.1-Sol
import { readdir, readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("keeps the health model canonical and independent of React and the SDK facade", async () => {
  const root = new URL("../../src/apps/health/lib/model/", import.meta.url);
  for (const file of await readdir(root)) {
    const source = await readFile(new URL(file, root), "utf8");
    expect(source, file).not.toContain(["TBD", "example"].join("."));
    expect(source, file).not.toMatch(/from\s+["'](?:react|react-dom|@jeswr\/suite-sdk)(?:["'/])/);
    expect(
      source
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n"),
      file,
    ).not.toMatch(/(?:DataFactory|factory)\.quad\(/);
  }
});

it("keeps placeholder host strings out of all health test sources", async () => {
  for (const file of await readdir(new URL("./", import.meta.url))) {
    if (!file.endsWith(".ts")) continue;
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    expect(source, file).not.toContain(["TBD", "example"].join("."));
  }
});
