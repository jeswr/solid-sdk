// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "vitest";
import {
  contrast,
  contrastIssues,
  documentedPairs,
  evaluateContrast,
  oklchToSrgb,
} from "../scripts/contrast.mjs";

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
test("only an exact documented theme/pair/measurement exempts a failure", () => {
  const values = Object.fromEntries(
    [
      "background",
      "surface",
      "surface-2",
      "surface-3",
      "foreground",
      "foreground-muted",
      "foreground-subtle",
      "primary",
      "rail",
      "rail-foreground",
      "ring",
      "border-strong",
    ].map((n) => [`--${n}`, "oklch(1 0 0)"]),
  );
  const known = contrastIssues("<!-- contrast-issue: light|--ring|--background|1.000 -->");
  const rows = evaluateContrast({ light: values, dark: values }, known);
  expect(rows.filter((r) => r.status === "KNOWN SPEC ISSUE")).toHaveLength(1);
  expect(rows.filter((r) => r.status === "FAIL").length).toBeGreaterThan(0);
  values["--ring"] = "oklch(0.8 0 0)";
  expect(
    evaluateContrast({ light: values }, known).some((r) => r.status === "KNOWN SPEC ISSUE"),
  ).toBe(false);
});
