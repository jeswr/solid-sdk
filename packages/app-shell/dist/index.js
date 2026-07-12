// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// @jeswr/app-shell — the suite's framework-agnostic React shell components.
// Public API barrel. The surfaces shipped here:
//  - Theme system: <ThemeProvider>, <ThemeToggle>, useTheme, themeScript.
//  - Account menu: <AccountMenu>, initials.
//  - Feedback: <FeedbackButton>/<FeedbackDialog> + the pure buildIssueUrl /
//    composeIssueBody helpers (report-issue / feedback / help → a GitHub issue
//    on the app's own repo, via prefill or a server-side proxy hook).
//  - Solid browser-extension presence: useSolidExtensionPresent() — flip an app's
//    own chrome off when the @jeswr Solid browser extension is on the page.
//  - Error handling: <ErrorBoundary> (subtree render-error catcher, resetKey /
//    onError / custom fallback) + <ErrorState> (themed role="alert" error panel,
//    also usable standalone for failed fetches).
// The shadcn-compatible primitives are exported too for apps that want to build
// their own header chrome on the same Radix + token base.
export { AccountMenu, initials } from "./components/account-menu.js";
export { ErrorBoundary, } from "./components/error-boundary.js";
export { ErrorState } from "./components/error-state.js";
export { FeedbackButton, FeedbackDialog, } from "./components/feedback.js";
export { Avatar, AvatarFallback, AvatarImage, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, } from "./components/primitives.js";
export { ThemeProvider, themeScript, useTheme, } from "./components/theme-provider.js";
export { ThemeToggle } from "./components/theme-toggle.js";
export { useSolidExtensionPresent } from "./hooks/use-solid-extension-present.js";
export { cn } from "./lib/cn.js";
export { buildIssueUrl, composeIssueBody, composeIssueTitle, feedbackLabels, } from "./lib/feedback-core.js";
