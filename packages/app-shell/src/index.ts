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
// The shadcn-compatible primitives are exported too for apps that want to build
// their own header chrome on the same Radix + token base.

export { AccountMenu, type AccountMenuProps, initials } from "./components/account-menu.js";
export {
  FeedbackButton,
  type FeedbackButtonProps,
  FeedbackDialog,
  type FeedbackDialogProps,
} from "./components/feedback.js";
export {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  type ButtonProps,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/primitives.js";
export {
  type ResolvedTheme,
  type Theme,
  type ThemeContextValue,
  ThemeProvider,
  type ThemeProviderProps,
  themeScript,
  useTheme,
} from "./components/theme-provider.js";
export { ThemeToggle } from "./components/theme-toggle.js";
export { useSolidExtensionPresent } from "./hooks/use-solid-extension-present.js";
export { type ClassValue, cn } from "./lib/cn.js";
export {
  buildIssueUrl,
  composeIssueBody,
  composeIssueTitle,
  type FeedbackCategory,
  type FeedbackDiagnostics,
  type FeedbackPayload,
  type FeedbackSubmitResult,
  feedbackLabels,
} from "./lib/feedback-core.js";
