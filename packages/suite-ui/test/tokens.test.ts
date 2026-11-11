// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
// @ts-expect-error Root script is intentionally a dependency-free ESM module.
import { declarations, normalizeCssValue, parseTokens } from "../../../scripts/token-css.mjs";
import { PROJECT_COLOURS, tokens } from "../src/tokens.js";

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
test("CSS exactly equals every exported value in both themes and densities", () => {
  const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  const density = readFileSync(new URL("../src/styles/density.css", import.meta.url), "utf8");
  const actual = parseTokens(css);
  const comfortable = declarations(density.match(/comfortable"\]\s*\{([^}]+)\}/)?.[1] ?? "");
  const compact = declarations(density.match(/compact"\]\s*\{([^}]+)\}/)?.[1] ?? "");
  for (const theme of ["light", "dark"] as const) {
    expect({ ...actual[theme], ...comfortable }).toEqual(
      Object.fromEntries(tokens.map((t) => [t.name, normalizeCssValue(t[theme])])),
    );
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
