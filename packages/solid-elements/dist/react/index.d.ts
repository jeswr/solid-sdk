import { type EventName } from "@lit/react";
import { JeswrAccountMenu } from "../components/account-menu.js";
import { JeswrEmptyState } from "../components/empty-state.js";
import { JeswrErrorState } from "../components/error-state.js";
import { JeswrFeedbackButton } from "../components/feedback-button.js";
import { JeswrLoading } from "../components/loading.js";
import { JeswrSavingIndicator } from "../components/saving-indicator.js";
import { JeswrThemeToggle } from "../components/theme-toggle.js";
import type { FeedbackPayload, ResolvedTheme, Theme } from "../index.js";
/** The `theme-change` CustomEvent detail. */
export interface ThemeChangeDetail {
    theme: Theme;
    resolvedTheme: ResolvedTheme;
}
/** React wrapper for `<jeswr-theme-toggle>`. `onThemeChange` ← `theme-change`. */
export declare const ThemeToggle: import("@lit/react").ReactWebComponent<JeswrThemeToggle, {
    onThemeChange: EventName<CustomEvent<ThemeChangeDetail>>;
}>;
/** React wrapper for `<jeswr-account-menu>`. `onSignOut` ← `sign-out`. */
export declare const AccountMenu: import("@lit/react").ReactWebComponent<JeswrAccountMenu, {
    onSignOut: EventName<CustomEvent<void>>;
}>;
/** React wrapper for `<jeswr-feedback-button>`. `onFeedbackSubmit` ← `feedback-submit`. */
export declare const FeedbackButton: import("@lit/react").ReactWebComponent<JeswrFeedbackButton, {
    onFeedbackSubmit: EventName<CustomEvent<FeedbackPayload>>;
}>;
/** React wrapper for `<jeswr-empty-state>`. */
export declare const EmptyState: import("@lit/react").ReactWebComponent<JeswrEmptyState, {}>;
/** React wrapper for `<jeswr-error-state>`. */
export declare const ErrorState: import("@lit/react").ReactWebComponent<JeswrErrorState, {}>;
/** React wrapper for `<jeswr-loading>`. */
export declare const Loading: import("@lit/react").ReactWebComponent<JeswrLoading, {}>;
/** React wrapper for `<jeswr-saving-indicator>`. */
export declare const SavingIndicator: import("@lit/react").ReactWebComponent<JeswrSavingIndicator, {}>;
export type { FeedbackCategory, FeedbackDiagnostics, FeedbackPayload, FeedbackSubmitResult, ResolvedTheme, SavingState, Theme, } from "../index.js";
export { buildIssueUrl, composeIssueBody, composeIssueTitle, feedbackLabels, initials, isValidRepo, } from "../index.js";
