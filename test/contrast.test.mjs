// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { contrast, documentedPairs, evaluateContrast, oklchToSrgb } from "../scripts/contrast.mjs";
import { parseTokens } from "../scripts/token-css.mjs";

const themes = () =>
  parseTokens(
    readFileSync(new URL("../packages/suite-ui/src/styles/tokens.css", import.meta.url), "utf8"),
  );

test("WCAG reference extremes and neutral inverse conversion", () => {
  expect(contrast("oklch(1 0 0)", "oklch(0 0 0)")).toBeCloseTo(21, 5);
  expect(contrast("oklch(0.5 0 0)", "oklch(0.5 0 0)")).toBe(1);
  expect(oklchToSrgb("oklch(0.5 0 0)").rgb[0]).toBeCloseTo(0.388573, 5);
  expect(contrast("oklch(0 0 0 / 50%)", "oklch(1 0 0)")).toBeCloseTo(3.97665, 4);
  expect(() => oklchToSrgb("nonsense")).toThrow();
});
test("documented pairs cover text, aliases, tiles, links and UI boundaries", () => {
  const pairs = documentedPairs({
    "--primary": "",
    "--primary-foreground": "x",
    "--app-home": "x",
  });
  expect(pairs).toContainEqual({ fg: "--primary-foreground", bg: "--primary", minimum: 4.5 });
  expect(pairs.filter((p) => p.fg === "--foreground-muted")).toHaveLength(4);
  expect(pairs).toContainEqual({ fg: "--glyph", bg: "--app-home", minimum: 3 });
  expect(pairs).toContainEqual({ fg: "--foreground-subtle", bg: "--surface-3", minimum: 3 });
});
test("amended input boundaries and warning text meet contrast in both themes without exceptions", () => {
  const rows = evaluateContrast(themes());
  expect(rows.filter((row) => row.status !== "PASS")).toEqual([]);
  for (const theme of ["light", "dark"]) {
    for (const [fg, bg, minimum] of [
      ["--input", "--background", 3],
      ["--input", "--surface", 3],
      ["--warning-foreground", "--warning", 4.5],
    ]) {
      const row = rows.find((r) => r.theme === theme && r.fg === fg && r.bg === bg);
      expect(row).toMatchObject({ minimum, status: "PASS" });
      expect(row.ratio).toBeGreaterThanOrEqual(minimum);
    }
  }
});

test("input and warning contrast regressions fail the gate", () => {
  const values = themes();
  for (const theme of Object.values(values)) {
    theme["--input"] = theme["--background"];
    theme["--warning-foreground"] = theme["--warning"];
  }
  const failures = evaluateContrast(values).filter((row) => row.status === "FAIL");
  expect(failures).toHaveLength(6);
  expect(failures.every((row) => ["--input", "--warning-foreground"].includes(row.fg))).toBe(true);
});
