// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// PUBLIC API CONTRACT GUARD — the reviewability cornerstone for this package.
//
// `@jeswr/app-shell` is GitHub-installed (no semver gate), and the public surface
// is consumed by solid-issues, create-solid-app's template, Pod Manager, and the
// 7 pod-apps. This test pins the EXACT set of runtime values the package barrel
// (`src/index.ts`) exports, so any addition/removal/rename of a public export
// shows up as a one-line diff in THIS test — a deliberate, reviewed, semver-aware
// change, never an accidental contract drift. (Types are checked by `typecheck`
// + the committed `dist/*.d.ts`; this guards the runtime value surface.)
//
// It ALSO pins that the internal-only helpers stay OUT of the barrel: the
// `tabbableElements` (a11y tab-order helper) and `APP_SHELL_CONTROL_ATTR`
// (CSS-isolation marker) are exported from their modules for unit tests, but are
// deliberately NOT part of the package's public API — re-exposing them through
// the barrel would be an unintended surface expansion.
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

// The committed public runtime surface. Keep this list = the README's documented
// API. A diff here is a CONTRACT change — coordinate it with consumers.
const PUBLIC_EXPORTS = [
  // Account menu
  "AccountMenu",
  "initials",
  // Feedback (components + pure, testable helpers)
  "FeedbackButton",
  "FeedbackDialog",
  "buildIssueUrl",
  "composeIssueBody",
  "composeIssueTitle",
  "feedbackLabels",
  // shadcn-compatible primitives (for apps building their own chrome)
  "Avatar",
  "AvatarFallback",
  "AvatarImage",
  "Button",
  "DropdownMenu",
  "DropdownMenuContent",
  "DropdownMenuItem",
  "DropdownMenuLabel",
  "DropdownMenuSeparator",
  "DropdownMenuTrigger",
  // Theme system
  "ThemeProvider",
  "ThemeToggle",
  "themeScript",
  "useTheme",
  // Solid browser-extension presence
  "useSolidExtensionPresent",
  // class-name joiner
  "cn",
].sort();

describe("public API contract (@jeswr/app-shell barrel)", () => {
  it("exports EXACTLY the documented runtime surface (a diff here is a semver change)", () => {
    const actual = Object.keys(api).sort();
    expect(actual).toEqual(PUBLIC_EXPORTS);
  });

  it("does NOT leak the internal-only helpers through the barrel", () => {
    // These are module-level exports for unit tests, not public API.
    expect(api).not.toHaveProperty("tabbableElements");
    expect(api).not.toHaveProperty("APP_SHELL_CONTROL_ATTR");
  });
});
