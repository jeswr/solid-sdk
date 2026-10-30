// AUTHORED-BY Codex GPT-6.1-Sol
import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

it("ships every vendored font and OFL licence beside the built font entry", () => {
  const assets = globSync("src/font-assets/**/*.woff2", { cwd: root }).sort();
  expect(assets).toHaveLength(7);
  for (const path of assets) {
    const source = readFileSync(join(root, path));
    expect(source.subarray(0, 4).toString()).toBe("wOF2");
    expect(readFileSync(join(root, path.replace(/^src\//, "dist/"))).equals(source)).toBe(true);
    const licence = join(dirname(path), "OFL.txt");
    expect(readFileSync(join(root, licence), "utf8")).toMatch(/SIL OPEN FONT LICENSE/i);
    expect(readFileSync(join(root, licence.replace(/^src\//, "dist/")))).toEqual(
      readFileSync(join(root, licence)),
    );
  }

  const fonts = readFileSync(join(root, "dist/fonts.js"), "utf8");
  const sources = [...fonts.matchAll(/(?:src|path):\s*"(\.\/font-assets\/[^"\n]+\.woff2)"/g)];
  expect(sources).toHaveLength(4);
  for (const [, path] of sources) {
    expect(
      readFileSync(join(root, "dist", path))
        .subarray(0, 4)
        .toString(),
    ).toBe("wOF2");
  }
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  expect(manifest.files).toContain("dist");
});
