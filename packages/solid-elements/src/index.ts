// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// @jeswr/solid-elements — framework-agnostic W3C Web Components (Lit 3) for the
// Solid app suite. Importing this module SIDE-EFFECT registers every component
// (each `customElements.define` is guarded, so re-import / double-load is safe).
//
//   import "@jeswr/solid-elements";        // registers <jeswr-*> tags
//   import { JeswrThemeToggle } from "@jeswr/solid-elements"; // also the classes
//
// For React, use the `@jeswr/solid-elements/react` subexport (typed wrappers).

// Side-effect imports: register the custom elements.
import "./components/theme-toggle.js";
import "./components/account-menu.js";
import "./components/feedback-button.js";
import "./components/login-panel.js";
import "./components/empty-state.js";
import "./components/error-state.js";
import "./components/loading.js";
import "./components/saving-indicator.js";

// Component classes (for direct construction / typing / extension).
export { initials, JeswrAccountMenu } from "./components/account-menu.js";
export { JeswrEmptyState } from "./components/empty-state.js";
export { JeswrErrorState } from "./components/error-state.js";
export { JeswrFeedbackButton } from "./components/feedback-button.js";
export { JeswrLoading } from "./components/loading.js";
export {
  initialsOf,
  JeswrLoginPanel,
  type LoginDetail,
  type SessionChangeDetail,
} from "./components/login-panel.js";
export { JeswrSavingIndicator, type SavingState } from "./components/saving-indicator.js";
export { JeswrThemeToggle } from "./components/theme-toggle.js";
// Feedback pure helpers + types (re-implemented here; no app-shell dependency).
export {
  buildIssueUrl,
  composeIssueBody,
  composeIssueTitle,
  FEEDBACK_CATEGORIES,
  type FeedbackCategory,
  type FeedbackDiagnostics,
  type FeedbackPayload,
  type FeedbackSubmitResult,
  feedbackLabels,
  isValidRepo,
} from "./feedback-core.js";
// The login auth seam — the dependency-injection CONTRACT (pure types, no auth
// dep). The optional adapter that implements it (createReactiveAuthController) is
// in the separate `@jeswr/solid-elements/auth` subexport so the core stays
// auth-dep-free + self-contained for the GitHub-installable build.
export {
  type LoginController,
  type LoginResult,
  type RecentLoginAccount,
  type RestoreOutcome,
  sameWebId,
} from "./login-controller.js";
// Theme primitives (the app-shell-co-operative contract).
export {
  applyResolvedTheme,
  nextTheme,
  persistTheme,
  type ResolvedTheme,
  readStoredTheme,
  resolveTheme,
  systemPrefersDark,
  THEME_DARK_CLASS,
  THEME_STORAGE_KEY,
  type Theme,
} from "./theme-core.js";

// The token-contract style block (for consumers building related components).
export { tokenStyles } from "./theme-tokens.js";
