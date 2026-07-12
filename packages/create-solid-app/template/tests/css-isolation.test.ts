// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// CSS-ISOLATION REGRESSION GUARD (#121 / #80) — baked into every create-solid-app
// scaffold so a new app can't reintroduce the app-shell CSS-leak bug that bit the
// early pod-app adopters.
//
// A scaffolded app styles its buttons with shadcn <Button>/Tailwind utilities, so
// it ships NO bare-element button base. But if an app author later adds a plain
// `<button>` and reaches for a global `button { … }` filled style, that bare rule
// LEAKS onto every @jeswr/app-shell control (the ThemeToggle/AccountMenu/
// FeedbackButton triggers + the portaled FeedbackDialog buttons) and distorts their
// look. globals.css ships the PROVEN safe form for any such host button base —
// `button:where(:not([data-app-shell-control]))` — and this test pins it:
//
//   • The safe form MUST be present (the base, when present, excludes app-shell
//     controls via the zero-specificity :where() wrapper).
//   • The UNSCOPED bare `button {` form MUST NOT appear (it would repaint the shell
//     controls' colour) — outside @layer (the @layer base wrapper is matched
//     separately and is fine).
//   • The bare `button:not([data-app-shell-control]) {` form MUST NOT appear: an
//     attribute selector's specificity escapes through `:not()`, raising the base
//     from (0,0,1) to (0,1,1) and out-ranking the host's class-only overrides — the
//     known regression. Only the `:where(:not(...))` form is allowed.
//
// We assert against the SOURCE selector text (jsdom doesn't run the cascade; the
// selector form is the contract the cascade math relies on, and app-shell's own
// suite tests the cascade itself). Pure file read — Node env, no DOM needed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8",
);

describe("globals.css host-button base is the safe form (#121/#80)", () => {
  it("uses the zero-specificity :where(:not([data-app-shell-control])) scope", () => {
    expect(css).toMatch(/button:where\(:not\(\[data-app-shell-control\]\)\)\s*[{:]/);
  });

  it("does NOT use the leaky bare `button:not([data-app-shell-control])` form", () => {
    // Match the SELECTOR position only (`button:not([…]) {` or `:disabled {`), so the
    // explanatory comment that NAMES the rejected form does not trip this guard.
    expect(css).not.toMatch(/button:not\(\[data-app-shell-control\]\)\s*[{:]/);
  });

  it("does NOT introduce an unscoped global `button {` filled base", () => {
    // A bare `button {` (no :where/:not scope, no pseudo) would leak onto every
    // app-shell control. Allow the prefixed safe form; reject the bare element rule.
    // (`*`, `body`, `html` bases are fine; we look specifically for `button` alone.)
    expect(css).not.toMatch(/(^|[\s{};])button\s*\{/m);
  });
});
