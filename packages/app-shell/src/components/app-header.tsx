// AUTHORED-BY Claude Sonnet 5.5
import type { ReactNode } from "react";
import { AccountControl, type AccountControlProps } from "./account-control.js";
import { FeedbackButton, type FeedbackButtonProps } from "./feedback.js";
import { ThemeToggle } from "./theme-toggle.js";

export interface AppHeaderProps {
  /** Brand text rendered in `.app-brand`. */
  brand: ReactNode;
  /** Props for the header-level FeedbackButton (`repo`, `appName`, `appVersion`, `webId`, ...). */
  feedback: FeedbackButtonProps;
  /** Props for the AccountControl (`webId`, `displayName`, `avatarUrl`, `onSignOut`). */
  account: AccountControlProps;
  /** Extra header actions, rendered before the feedback button. */
  children?: ReactNode;
}

/**
 * The suite's standard app header: brand, then right-aligned actions
 * (extra children, FeedbackButton, ThemeToggle, AccountControl). Fully prop-driven:
 * the host owns session, profile and logout.
 */
export function AppHeader({ brand, feedback, account, children }: AppHeaderProps) {
  return (
    <header className="app-header">
      <span className="app-brand">{brand}</span>
      <div className="app-header-actions">
        {children}
        <FeedbackButton {...feedback} />
        <ThemeToggle />
        <AccountControl {...account} />
      </div>
    </header>
  );
}
