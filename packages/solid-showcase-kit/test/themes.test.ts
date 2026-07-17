// AUTHORED-BY Claude Fable 5
import { expect, test } from "vitest";
import { paletteTokens, themeCssProperties, themeFromSpec } from "../src/index.js";
import { walletTheme } from "./support/fixtures.js";

const TOKEN_NAMES = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "muted",
  "muted-foreground",
  "border",
  "primary",
  "primary-foreground",
  "accent",
  "accent-foreground",
] as const;

test("paletteTokens derives a full token set from the hue anchor", () => {
  const tokens = paletteTokens({
    accent: "oklch(0.5 0.19 20)",
    hue: 270,
    primary: "oklch(0.22 0.012 270)",
  });
  for (const token of TOKEN_NAMES) {
    // Palette-inspired original oklch values only — never brand-guideline colours.
    expect(tokens[token], token).toMatch(/^oklch\(/);
  }
  expect(tokens.background).toBe("oklch(0.985 0.004 270)");
  expect(tokens.primary).toBe("oklch(0.22 0.012 270)");
  // Foregrounds default to the light foreground unless overridden.
  expect(tokens["accent-foreground"]).toBe("oklch(0.985 0.003 250)");
  expect(
    paletteTokens({
      accent: "a",
      accentForeground: "oklch(0.24 0.02 250)",
      hue: 240,
      primary: "p",
    })["accent-foreground"],
  ).toBe("oklch(0.24 0.02 250)");
});

test("themeFromSpec builds a role-first OrgTheme from a validated spec", () => {
  expect(walletTheme.modelledOn).toBe("Globex Telecom");
  expect(walletTheme.role).toBe("consumer data custodian");
  expect(walletTheme.tokens.primary).toBe("oklch(0.22 0.012 270)");
  expect(() =>
    themeFromSpec(
      // @ts-expect-error deliberately malformed spec — role is required
      { accent: "a", hue: 1, primary: "p" },
      "Anyone",
    ),
  ).toThrow();
});

test("themeCssProperties emits CSS custom properties for every token", () => {
  const style = themeCssProperties(walletTheme);
  for (const token of TOKEN_NAMES) {
    expect(style[`--${token}`]).toBe(walletTheme.tokens[token]);
  }
});
