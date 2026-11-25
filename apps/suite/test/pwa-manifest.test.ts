// AUTHORED-BY Codex GPT-6.1-Sol
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { oklchToHex, tokens } from "@jeswr/suite-ui/tokens";
import { describe, expect, it } from "vitest";
import manifest from "../src/app/manifest";
import { SHELL_ROUTES } from "../src/shell/lib/service-worker";

describe("PWA manifest", () => {
  it("declares the suite identity, standalone scope and light theme tokens", () => {
    const background = tokens.find((token) => token.name === "--background")?.light;
    expect(background).toBeTruthy();
    expect(manifest()).toMatchObject({
      id: "/",
      name: "Solid Suite",
      short_name: "Suite",
      start_url: "/home",
      scope: "/",
      display: "standalone",
      display_override: ["standalone"],
      // Hex, not oklch(): manifests and PWA tooling do not all accept CSS Color 4.
      theme_color: oklchToHex(background as string),
      background_color: oklchToHex(background as string),
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

  it("does not claim the title-bar area the shell does not lay out", () => {
    expect(manifest().display_override).not.toContain("window-controls-overlay");
  });

  it("launches and shortcuts only to routes the service worker precaches", () => {
    const targets = [manifest().start_url, ...(manifest().shortcuts ?? []).map(({ url }) => url)];
    expect(targets).toHaveLength(6);
    for (const target of targets) expect(SHELL_ROUTES, String(target)).toContain(target);
  });

  it("precaches the page each launch route redirects to", () => {
    const targets = [manifest().start_url, ...(manifest().shortcuts ?? []).map(({ url }) => url)];
    for (const target of targets) {
      const file = resolve("src/app/(suite)", String(target).slice(1), "page.tsx");
      if (!existsSync(file)) continue;
      const landing = /redirect\(\s*[`"'](\/[^`"'?$]+)/.exec(readFileSync(file, "utf8"))?.[1];
      if (landing) expect(SHELL_ROUTES, `${target} -> ${landing}`).toContain(landing);
    }
  });

  it("precaches the page a signed-out launch lands on", () => {
    // start_url -> the session guard sends a signed-out visitor to /signin (and / to /welcome).
    const guard = readFileSync(resolve("src/shell/session/session-guard.tsx"), "utf8");
    const root = readFileSync(resolve("src/app/page.tsx"), "utf8");
    expect(guard).toContain("/signin?next=");
    expect(root).toContain('"/welcome"');
    for (const landing of ["/signin", "/welcome"]) {
      expect(SHELL_ROUTES, landing).toContain(landing);
      const dir = landing === "/signin" ? "(public)" : "(welcome)";
      expect(existsSync(resolve("src/app", dir, landing.slice(1), "page.tsx")), landing).toBe(true);
    }
  });
});
