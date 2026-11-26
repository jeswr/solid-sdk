// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { describe, expect, it, test } from "vitest";
// @ts-expect-error Root script is intentionally a dependency-free ESM module.
import { declarations, normalizeCssValue, parseTokens } from "../../../scripts/token-css.mjs";
import { oklchToHex, PROJECT_COLOURS, tokens } from "../src/tokens.js";

test("exported inventory equals the frozen spec tables (§2.1–2.7)", async () => {
  await expect(`${JSON.stringify(tokens, null, 2)}\n`).toMatchFileSnapshot(
    new URL("./spec-tokens.json", import.meta.url).pathname,
  );
  expect(new Set(tokens.map((token) => token.name)).size).toBe(tokens.length);
});
test("project palette preserves wire values independently of the active theme", () => {
  expect(PROJECT_COLOURS).toHaveLength(12);
  expect(new Set(PROJECT_COLOURS.map((colour) => colour.hex)).size).toBe(12);
  for (const colour of PROJECT_COLOURS) {
    expect(colour.hex).toMatch(/^#[\dA-F]{6}$/);
    expect(tokens.find((token) => token.name === `--project-${colour.token}`)).toMatchObject({
      light: colour.hex.toLowerCase(),
      category: "colour",
      tag: "graphic",
    });
  }
});
test("CSS exactly equals every exported value and the shared chart palette in both themes and densities", () => {
  const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  const density = readFileSync(new URL("../src/styles/density.css", import.meta.url), "utf8");
  const actual = parseTokens(css);
  const shared = parseTokens(
    readFileSync(new URL("../../app-shell/src/styles/tokens.css", import.meta.url), "utf8"),
  );
  const comfortable = declarations(density.match(/comfortable"\]\s*\{([^}]+)\}/)?.[1] ?? "");
  const compact = declarations(density.match(/compact"\]\s*\{([^}]+)\}/)?.[1] ?? "");
  for (const theme of ["light", "dark"] as const) {
    expect({ ...actual[theme], ...comfortable }).toEqual({
      ...Object.fromEntries(tokens.map((t) => [t.name, normalizeCssValue(t[theme])])),
      ...Object.fromEntries(
        Array.from({ length: 5 }, (_, i) => {
          const name = `--chart-${i + 1}`;
          return [name, shared[theme][name]];
        }),
      ),
    });
  }
  expect(compact).toEqual(
    Object.fromEntries(
      tokens
        .filter((t) => "compact" in t)
        .map((t) => [t.name, "compact" in t ? normalizeCssValue(t.compact) : undefined]),
    ),
  );
});

test("Tailwind theme exposes all colour tokens and the normative shadcn aliases", () => {
  const theme = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
  for (const token of tokens.filter((t) => t.category === "colour")) {
    expect(theme).toContain(`--color-${token.name.slice(2)}: var(${token.name});`);
  }
  for (const [name, target] of Object.entries({
    card: "surface",
    popover: "surface",
    muted: "surface-2",
    "muted-foreground": "foreground-muted",
    accent: "primary-soft",
    "accent-foreground": "primary-soft-foreground",
    secondary: "surface-2",
    "secondary-foreground": "foreground",
  })) {
    expect(theme).toContain(`--${name}: var(--${target});`);
    expect(theme).toContain(`--color-${name}: var(--${name});`);
  }
});

// AUTHORED-BY Claude Opus 5.5
describe("oklchToHex", () => {
  it.each([
    ["oklch(1 0 0)", "#ffffff"],
    ["oklch(0 0 0)", "#000000"],
    ["oklch(62.8% 0.2577 29.23)", "#ff0000"],
    ["oklch(0.8664 0.2948 142.5)", "#00ff00"],
    ["oklch(0.452 0.313 264.05 / 50%)", "#0000ff"],
  ])("converts %s", (value, hex) => {
    expect(oklchToHex(value)).toBe(hex);
  });

  it("converts every oklch token to a valid hex colour", () => {
    for (const token of tokens)
      for (const value of [token.light, token.dark])
        if (typeof value === "string" && value.startsWith("oklch("))
          expect(oklchToHex(value)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("rejects values that are not oklch()", () => {
    expect(() => oklchToHex("#ffffff")).toThrow();
  });
});
