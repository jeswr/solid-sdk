// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Styles contract (#80) — the CSS-isolation primitives the shell relies on must
// be present in the SOURCE stylesheets (and therefore the shipped dist, which
// check:dist proves matches src). These are structural guards: drop a private
// token / the reset / the barrel import and the shell silently re-exposes itself
// to a consuming app's global CSS, so we pin them here.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const stylesDir = join(here, "..", "src", "styles");
const read = (f: string) => readFileSync(join(stylesDir, f), "utf8");

// The exact nine tokens the components consume through the `as-` namespace.
const PRIVATE_TOKENS = [
  "--as-accent",
  "--as-accent-foreground",
  "--as-background",
  "--as-foreground",
  "--as-popover",
  "--as-popover-foreground",
  "--as-muted-foreground",
  "--as-border",
  "--as-ring",
  "--as-destructive",
] as const;

describe("tokens.css — shell-private token mirror", () => {
  const tokens = read("tokens.css");
  // Each private token must be DEFINED for BOTH light (:root) and dark (.dark).
  for (const t of PRIVATE_TOKENS) {
    it(`defines ${t} in both light and dark`, () => {
      const occurrences = tokens.split(`${t}:`).length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(2);
    });
  }

  it("each private token holds a LITERAL value (no var() indirection that a consumer could re-clobber)", () => {
    for (const t of PRIVATE_TOKENS) {
      // Match the first declaration's value; it must be an oklch() literal, never
      // `var(--accent)` etc. (which would resolve a consumer override at use-time).
      const m = tokens.match(new RegExp(`${t}:\\s*([^;]+);`));
      expect(m, `${t} should be declared`).not.toBeNull();
      const value = (m?.[1] ?? "").trim();
      expect(value.startsWith("oklch("), `${t} = "${value}"`).toBe(true);
      expect(value.includes("var("), `${t} must not indirect through a public token`).toBe(false);
    }
  });
});

describe("theme.css — @theme inline mapping for the private keys", () => {
  const theme = read("theme.css");
  for (const t of PRIVATE_TOKENS) {
    const colorKey = t.replace("--as-", "--color-as-");
    it(`maps ${colorKey} → var(${t})`, () => {
      expect(theme).toContain(`${colorKey}: var(${t});`);
    });
  }
});

describe("styles.css — the barrel pulls in the defensive reset", () => {
  it("imports reset.css after the tokens + theme", () => {
    const barrel = read("styles.css");
    expect(barrel).toContain('@import "./reset.css";');
    const tokensIdx = barrel.indexOf('@import "./tokens.css";');
    const resetIdx = barrel.indexOf('@import "./reset.css";');
    expect(tokensIdx).toBeGreaterThanOrEqual(0);
    expect(resetIdx).toBeGreaterThan(tokensIdx);
  });
});

describe("reset.css — the unlayered control reset", () => {
  // Strip CSS comments so prose (which legitimately discusses `@layer`) doesn't
  // trip the structural checks; we assert on the actual CSS rules only.
  const reset = read("reset.css").replace(/\/\*[\s\S]*?\*\//g, "");
  it("is NOT wrapped in an @layer (so it out-ranks unlayered host element rules)", () => {
    expect(reset).not.toContain("@layer");
  });
  it("scopes every rule to [data-app-shell-control]", () => {
    // Every selector block targets the marker — no bare element selectors that
    // could themselves leak back onto a consuming app's controls.
    const selectorLines = reset
      .split("\n")
      .filter((l) => l.trim().endsWith("{") && !l.includes("@"));
    expect(selectorLines.length).toBeGreaterThan(0);
    for (const line of selectorLines) {
      expect(line, `selector "${line.trim()}" must be marker-scoped`).toContain(
        "data-app-shell-control",
      );
    }
  });
  it("references only the shell-PRIVATE tokens (never the clobberable public ones)", () => {
    // The reset must resolve its colours through --as-* so a consumer override of
    // --accent / --border / --background can't repaint the shell controls either.
    // (`--radius-*` is a sizing key, not a clobberable colour token; allow it.)
    const publicRefs = (reset.match(/var\(--(?!as-)[a-z-]+/g) ?? []).filter(
      (r) => !r.startsWith("var(--radius"),
    );
    expect(publicRefs).toEqual([]);
  });

  it("preserves a keyboard focus indicator (no blanket outline:none / box-shadow:none)", () => {
    // Erasing the focus ring unlayered would out-rank the components' layered
    // focus-visible:ring utilities — an a11y regression (roborev #80). The reset
    // must NOT blanket-suppress focus, and must re-assert an outline on :focus-visible.
    expect(reset).not.toMatch(/outline:\s*none/);
    expect(reset).not.toMatch(/box-shadow:\s*none/);
    expect(reset).toMatch(/:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--as-ring\)/s);
    // The focus ring must cover the button, the textarea, AND the consent checkbox
    // (each can have its native focus stripped by a host `button {}` / `input {}`).
    const focusRule =
      reset.match(/([^{}]*):focus-visible[^{]*\{[^}]*outline:\s*2px solid/s)?.[0] ?? "";
    expect(focusRule).toContain("button[data-app-shell-control]:focus-visible");
    expect(focusRule).toContain("textarea[data-app-shell-control]:focus-visible");
    expect(focusRule).toContain('input[type="checkbox"][data-app-shell-control]:focus-visible');
  });

  it("the base rule neutralises only host-reset artefacts (not box model, not consumer-overridable colour)", () => {
    // The AccountMenu trigger overrides h-auto / px-2 / py-1.5 via className, and a
    // consumer may set a text colour via className on an exported <Button>; an
    // unlayered lock of the box model OR colour would clobber those. The base
    // [data-app-shell-control] rule must touch ONLY appearance / font-family /
    // background-image — the per-variant rules own the fill/border. (roborev #80)
    const base = reset.match(/\[data-app-shell-control\]\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(base).not.toMatch(/(^|\s)(height|width|padding|display|flex)\s*:/);
    expect(base).not.toMatch(/(^|\s)color\s*:/); // not locked → consumer className wins
    expect(base).not.toMatch(/background-color\s*:/); // owned per-variant, not base
    expect(base).toMatch(/appearance:\s*none/);
  });

  it("the ghost/outline variants own their fill AND resting text colour (so a bare host button {} can't leak background OR color)", () => {
    // The shell's own fill + text colour is re-asserted in the resting variant rules
    // (the variant selector out-ranks a bare element selector), keeping the leak fix
    // (incl. a host `button { color }`) while leaving the base free for the escape
    // hatch. (roborev #80 — host button text colour.)
    const ghostResting =
      reset.match(/button\[data-app-shell-control\]\[data-variant="ghost"\]\s*\{([^}]*)\}/)?.[1] ??
      "";
    expect(ghostResting).toMatch(/background-color:\s*transparent/);
    expect(ghostResting).toMatch(/color:\s*var\(--as-foreground\)/);
    const outlineResting =
      reset.match(
        /button\[data-app-shell-control\]\[data-variant="outline"\]\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    expect(outlineResting).toMatch(/background-color:\s*var\(--as-background\)/);
    expect(outlineResting).toMatch(/color:\s*var\(--as-foreground\)/);
  });
});
