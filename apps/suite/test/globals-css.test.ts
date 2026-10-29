// AUTHORED-BY Claude Opus 5.5
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps bare-element defaults at zero specificity so component classes win", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  // A bare `button:not([data-slot])` (0,1,1) would beat `.suite-primary` (0,1,0).
  const bare = css.match(/^[^\n{]*(?:button|input|select):not\(\[data-slot\]\)[^\n{]*\{/gm) ?? [];
  expect(bare.length).toBeGreaterThan(0);
  for (const selector of bare) expect(selector.startsWith(":where(")).toBe(true);
});
