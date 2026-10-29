// AUTHORED-BY Codex
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { FontLoader } from "next/font";
import type localFont from "next/font/local";
import { expect, it, vi } from "vitest";

type FontOptions = Parameters<typeof localFont>[0];
const { configurations, googleFont } = vi.hoisted(() => ({
  configurations: [] as FontOptions[],
  googleFont: vi.fn(() => ({})),
}));
vi.mock("next/font/local", () => ({
  default: (options: FontOptions) => {
    configurations.push(options);
    return {};
  },
}));
vi.mock("next/font/google", () =>
  Object.fromEntries(
    ["Onest", "Source_Code_Pro", "Source_Serif_4"].map((name) => [name, googleFont]),
  ),
);

await import("../../../packages/suite-ui/src/fonts");
const require = createRequire(import.meta.url);
const loader = require("next/dist/compiled/@next/font/dist/local/loader").default as FontLoader;

it("root-layout fonts compile offline from bundled assets in source and built packages", async () => {
  expect(googleFont).not.toHaveBeenCalled();
  expect(configurations.map(({ variable }) => variable)).toEqual([
    "--font-onest",
    "--font-source-serif",
    "--font-source-code",
  ]);
  for (const directory of ["src", "dist"]) {
    for (const configuration of configurations) {
      const emitted: Buffer[] = [];
      const result = await loader({
        functionName: "",
        variableName: "suiteFont",
        data: [configuration],
        isDev: false,
        isServer: true,
        resolve: (path) =>
          fileURLToPath(
            new URL(`../../../packages/suite-ui/${directory}/${path}`, import.meta.url),
          ),
        loaderContext: {
          fs: {
            readFile: (path: string, callback: (error: unknown, buffer?: Buffer) => void) => {
              void readFile(path).then((buffer) => callback(null, buffer), callback);
            },
          },
        },
        emitFontFile: (buffer, extension) => {
          expect(extension).toBe("woff2");
          expect(buffer.toString("ascii", 0, 4)).toBe("wOF2");
          expect(buffer.readUInt32BE(8)).toBe(buffer.length);
          emitted.push(buffer);
          return `/fonts/${emitted.length}.woff2`;
        },
      });
      expect(emitted.length).toBeGreaterThan(0);
      expect(result.css.match(/@font-face/g)).toHaveLength(emitted.length);
      expect(result.css).toContain("font-display: swap");
      expect(result.css).not.toMatch(/https?:/);
      expect(result.variable).toBe(configuration.variable);
      expect(result.fallbackFonts).toEqual(configuration.fallback);
      expect(result.adjustFontFallback?.sizeAdjust).toMatch(/^[\d.]+%$/);
    }
  }
});
