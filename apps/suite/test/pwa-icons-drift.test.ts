// AUTHORED-BY Claude Sonnet 5.5
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

// The icons are rendered from public/icon.svg and the design tokens. If this fails after a logo
// or token change, run `pnpm --filter @jeswr/app-suite run generate:icons` and commit the result.
// Set PWICONS_CHROMIUM to a Chromium binary when Playwright's pinned build is not installed.
it("committed PWA icons match the generator output byte for byte", () => {
  const out = mkdtempSync(join(tmpdir(), "pwa-icons-"));
  try {
    execFileSync(process.execPath, ["scripts/generate-pwa-icons.mjs", "--out", out], {
      stdio: "pipe",
    });
    const generated = readdirSync(out).sort();
    expect(generated).toEqual(readdirSync(resolve("public/icons")).sort());
    for (const name of generated)
      expect(
        readFileSync(join(out, name)).equals(readFileSync(resolve("public/icons", name))),
        name,
      ).toBe(true);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 120_000);
