// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// @jeswr/solid-elements/react — ergonomic, typed React wrappers around the
// custom elements, built with @lit/react's `createComponent`. Each wrapper maps
// the element's CustomEvents to React props (onThemeChange, onSignOut,
// onFeedbackSubmit) and exposes the reactive properties as typed JSX props.
//
// ── Next.js STATIC EXPORT / SSR caveat ──────────────────────────────────────
// Custom elements need a real DOM (window.customElements), so these wrappers are
// CLIENT-ONLY. In Next.js (App Router or `output: 'export'`):
//   - Put `'use client'` at the top of the file that imports these wrappers.
//   - Do NOT render them on the server. Either gate on mount
//       (`const [m, setM] = useState(false); useEffect(() => setM(true), []);`)
//     or import the consuming component with `next/dynamic` and `{ ssr: false }`:
//       const ThemeToggle = dynamic(
//         () => import("@jeswr/solid-elements/react").then(m => m.ThemeToggle),
//         { ssr: false },
//       );
// The raw `.` custom elements stay framework-agnostic; only this React layer is
// client-only. (Plain Vite/CSR React has no SSR step, so no gating is needed.)
import { createComponent } from "@lit/react";
import * as React from "react";
import { JeswrAccountMenu } from "../components/account-menu.js";
import { JeswrEmptyState } from "../components/empty-state.js";
import { JeswrErrorState } from "../components/error-state.js";
import { JeswrFeedbackButton } from "../components/feedback-button.js";
import { JeswrLoading } from "../components/loading.js";
import { JeswrSavingIndicator } from "../components/saving-indicator.js";
import { JeswrThemeToggle } from "../components/theme-toggle.js";
/** React wrapper for `<jeswr-theme-toggle>`. `onThemeChange` ← `theme-change`. */
export const ThemeToggle = createComponent({
    react: React,
    tagName: "jeswr-theme-toggle",
    elementClass: JeswrThemeToggle,
    events: {
        onThemeChange: "theme-change",
    },
});
/** React wrapper for `<jeswr-account-menu>`. `onSignOut` ← `sign-out`. */
export const AccountMenu = createComponent({
    react: React,
    tagName: "jeswr-account-menu",
    elementClass: JeswrAccountMenu,
    events: {
        onSignOut: "sign-out",
    },
});
/** React wrapper for `<jeswr-feedback-button>`. `onFeedbackSubmit` ← `feedback-submit`. */
export const FeedbackButton = createComponent({
    react: React,
    tagName: "jeswr-feedback-button",
    elementClass: JeswrFeedbackButton,
    events: {
        onFeedbackSubmit: "feedback-submit",
    },
});
/** React wrapper for `<jeswr-empty-state>`. */
export const EmptyState = createComponent({
    react: React,
    tagName: "jeswr-empty-state",
    elementClass: JeswrEmptyState,
});
/** React wrapper for `<jeswr-error-state>`. */
export const ErrorState = createComponent({
    react: React,
    tagName: "jeswr-error-state",
    elementClass: JeswrErrorState,
});
/** React wrapper for `<jeswr-loading>`. */
export const Loading = createComponent({
    react: React,
    tagName: "jeswr-loading",
    elementClass: JeswrLoading,
});
/** React wrapper for `<jeswr-saving-indicator>`. */
export const SavingIndicator = createComponent({
    react: React,
    tagName: "jeswr-saving-indicator",
    elementClass: JeswrSavingIndicator,
});
export { buildIssueUrl, composeIssueBody, composeIssueTitle, feedbackLabels, initials, isValidRepo, } from "../index.js";
