// AUTHORED-BY Codex GPT-6.1-Sol
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tokens } from "@jeswr/suite-ui/tokens";
import { describe, expect, it } from "vitest";
import manifest from "../src/app/manifest";

describe("PWA manifest", () => {
  it("declares the suite identity, standalone scope and light theme tokens", () => {
    const background = tokens.find((token) => token.name === "--background")?.light;
    expect(background).toBeTruthy();
    expect(manifest()).toMatchObject({
      id: "/",
      name: "Solid Suite",
      short_name: "Suite",
      start_url: "/",
      scope: "/",
      display: "standalone",
      display_override: ["window-controls-overlay", "standalone"],
      theme_color: background,
      background_color: background,
      categories: ["productivity"],
    });
    expect(manifest().description).toBeTruthy();
  });

  it("ships correctly sized PNGs for any, maskable and Apple icons", () => {
    expect(manifest().icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", purpose: "any", type: "image/png" }),
        expect.objectContaining({ sizes: "512x512", purpose: "any", type: "image/png" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable", type: "image/png" }),
        expect.objectContaining({ purpose: "monochrome", type: "image/svg+xml" }),
      ]),
    );
    for (const icon of [
      ...(manifest().icons ?? []),
      { src: "/icons/apple-touch-icon.png", sizes: "180x180" },
    ]) {
      const file = resolve("public", icon.src.slice(1));
      expect(existsSync(file), icon.src).toBe(true);
      if (!icon.src.endsWith(".png")) continue;
      const data = readFileSync(file);
      expect(data.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(`${data.readUInt32BE(16)}x${data.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });

  it("links each shortcut to an existing sub-app page", () => {
    const shortcuts = manifest().shortcuts ?? [];
    expect(shortcuts.map(({ name }) => name)).toEqual([
      "Drive",
      "Docs",
      "Mail",
      "Calendar",
      "Tasks",
    ]);
    for (const shortcut of shortcuts)
      expect(
        existsSync(resolve("src/app/(suite)", shortcut.url.slice(1), "page.tsx")),
        shortcut.url,
      ).toBe(true);
  });
});
