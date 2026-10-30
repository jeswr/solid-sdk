// AUTHORED-BY Codex GPT-6.1-Sol
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { checkLocalFonts, importsGoogleFonts } from "../scripts/check-local-fonts.mjs";
import { runCommand } from "./helpers/run-command.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

it("detects Google font imports, re-exports and dynamic loads without matching prose", () => {
  for (const source of [
    'import { Inter } from "next/font/google";',
    "export { Inter } from 'next/font/google';",
    'const font = import("next/font/google");',
    'const font = require("next/font/google");',
    'import font = require("next/font/google");',
  ]) {
    expect(importsGoogleFonts(source, "example.ts")).toBe(true);
  }
  expect(importsGoogleFonts('// import { Inter } from "next/font/google";', "example.ts")).toBe(
    false,
  );
  expect(importsGoogleFonts('const note = "next/font/google";', "example.ts")).toBe(false);
  expect(importsGoogleFonts('import localFont from "next/font/local";', "example.ts")).toBe(false);
});

it("uses local fonts throughout packages and apps, including the standalone template", () => {
  expect(checkLocalFonts(root), "Vendor fonts and load them with next/font/local").toEqual([]);
});

it("fails the CLI for nested app and template imports while ignoring generated files", () => {
  const fixture = mkdtempSync(join(tmpdir(), "local-fonts-"));
  try {
    for (const path of [
      "apps/example/src/app/layout.tsx",
      "packages/scaffold/template/app/layout.tsx",
      "apps/example/.next/generated.js",
      "packages/example/node_modules/next/internal.js",
    ]) {
      const destination = join(fixture, path);
      mkdirSync(join(destination, ".."), { recursive: true });
      writeFileSync(destination, 'import { Inter } from "next/font/google";');
    }
    const result = runCommand(
      process.execPath,
      [join(root, "scripts/check-local-fonts.mjs"), "--root", fixture],
      { cwd: tmpdir() },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("apps/example/src/app/layout.tsx");
    expect(result.stderr).toContain("packages/scaffold/template/app/layout.tsx");
    expect(result.stderr).not.toContain("generated.js");
    expect(result.stderr).not.toContain("internal.js");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

it("bundles standalone template fonts and licences identical to the suite assets", () => {
  const assets = globSync("packages/create-solid-app/template/app/fonts/**/*.{woff2,txt}", {
    cwd: root,
  });
  expect(assets).toHaveLength(4);
  for (const path of assets) {
    const asset = path.replace(
      "packages/create-solid-app/template/app/fonts/",
      "packages/suite-ui/src/font-assets/",
    );
    expect(readFileSync(join(root, path)).equals(readFileSync(join(root, asset)))).toBe(true);
  }
});
